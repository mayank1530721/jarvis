// The app itself: screen, chat loop, agent switching. The pieces it uses live in the other js/ files.
(function () {
  "use strict";
  const { store, sleep, clock24 } = J;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ---------- settings shared by every agent ----------
  const DEFAULTS = {
    key: "",
    model: "gemini-3.8-flash",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    fallbacks: "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.6-flash",
    name: ""
  };
  const cfg = () => ({ ...DEFAULTS, ...store.get("jarvis.cfg", {}) });
  // The connection one agent uses: the shared settings, unless that agent has its own model/endpoint/key.
  // An agent with its own endpoint never receives the shared key (it could be a different service).
  function cfgFor(id) {
    const c = cfg(), p = J.prefs.get(id);
    if (p.provider === "groq") return {
      ...c, model: p.model || "llama-3.3-70b-versatile",
      base: "https://api.groq.com/openai/v1",
      key: store.get("jarvis.groqKey", ""),
      fallbacks: ""
    };
    if (!p.model && !p.base && !p.key) return c;
    const base = p.base || c.base, local = /localhost|127\.0\.0\.1/.test(base);
    return { ...c, model: p.model || c.model, base,
      key: p.key || (p.base ? (local ? "ollama" : "") : c.key),
      fallbacks: (p.model || p.base) ? "" : c.fallbacks };
  }

  // One-time move of data saved by the older single-agent version into the new per-agent keys.
  (function migrate() {
    const OLD_PERSONA = "You are Jarvis, a loyal, quick-witted personal AI assistant. Be concise, warm and a little dry-humoured. Prefer short answers, especially since replies may be spoken aloud.";
    const saved = store.get("jarvis.cfg", null);
    const prefs = store.get("jarvis.agentprefs", null);
    if (saved && saved.persona !== undefined) {
      const rest = { ...saved }; delete rest.persona;
      store.set("jarvis.cfg", rest);
      if (saved.persona && saved.persona !== OLD_PERSONA && !prefs) store.set("jarvis.agentprefs", { jarvis: { persona: saved.persona } });
    }
    const oldVoice = store.get("jarvis.voice", null);
    if (oldVoice) {
      const all = store.get("jarvis.agentprefs", {});
      all.jarvis = { ...(all.jarvis || {}), voice: { voiceURI: oldVoice.voiceURI || "", rate: oldVoice.rate, pitch: oldVoice.pitch } };
      store.set("jarvis.agentprefs", all); store.remove("jarvis.voice");
    }
    const oldHist = store.get("jarvis.history", null);
    if (oldHist && store.get("jarvis.history.jarvis", null) === null) store.set("jarvis.history.jarvis", oldHist);
    if (oldHist) store.remove("jarvis.history");
  })();

  // ---------- state ----------
  const S = {
    agent: "jarvis", state: "idle", busy: false, speaking: false, switching: false,
    speakOn: store.get("jarvis.speak", false),
    memories: store.get("jarvis.memories", []),
    histories: {},          // agent id -> API-format messages, each agent keeps its own
    pending: null           // { agent, bubble, row } while JARVIS waits for "are you certain?"
  };
  const hist = id => { id = id || S.agent; return S.histories[id] || (S.histories[id] = store.get("jarvis.history." + id, [])); };
  const saveHist = id => { S.histories[id] = hist(id).slice(-60); store.set("jarvis.history." + id, S.histories[id]); };
  const agent = id => J.AGENTS[id || S.agent];
  const userCount = id => hist(id).filter(m => m.role === "user").length;

  let projects = store.get("jarvis.projects", []);
  let activeProjectId = store.get("jarvis.activeProject", null);
  const activeProject = () => projects.find(p => p.id === activeProjectId) || null;

  const activityLog = [];     // newest first: { t, text, agent }
  const timersList = [];      // { label, end }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // ---------- chat bubbles ----------
  const log = $("log");
  log.setAttribute("aria-live", "polite");

  function copyText(text, btn) {
    const done = () => { const old = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { btn.textContent = old; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
    else { const ta = el("textarea"); ta.value = text; document.body.append(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) {} ta.remove(); }
  }
  function appendCode(box, lang, code) {
    const wrap = el("div", "code"), head = el("div", "code-h"), copy = el("button", "mini", "Copy");
    copy.type = "button"; copy.onclick = () => copyText(code, copy);
    head.append(el("span", "", lang || "code"), copy);
    const pre = el("pre"), c = el("code"); c.textContent = code; pre.append(c);
    wrap.append(head, pre); box.append(wrap);
  }
  // Lines like "STEVEN: ..." or "VERDICT: ..." get a coloured label.
  const LABEL = /^(\s*[>*_#-]*\s*\**)(STEVEN|MARC|JAKE|VERDICT|CONDITIONS|RISKS|NEXT)\b([^:\n]{0,30}:)/;
  function appendText(box, str) {
    const lines = str.split("\n");
    lines.forEach((line, i) => {
      const m = LABEL.exec(line);
      if (m) {
        box.append(document.createTextNode(m[1]), el("span", "alter a-" + m[2].toLowerCase(), m[2] + m[3]), document.createTextNode(line.slice(m[0].length)));
      } else box.append(document.createTextNode(line));
      if (i < lines.length - 1) box.append(document.createTextNode("\n"));
    });
  }
  // Show ``` fenced blocks as code boxes with a Copy button. Works while the reply is still streaming.
  function renderRich(box, text) {
    box.textContent = "";
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("```", i);
      if (open < 0) { appendText(box, text.slice(i)); break; }
      if (open > i) appendText(box, text.slice(i, open).replace(/\n$/, ""));
      const nl = text.indexOf("\n", open + 3);
      if (nl < 0) break;                                  // the fence line is still arriving
      const close = text.indexOf("```", nl + 1);
      appendCode(box, text.slice(open + 3, nl).trim(), text.slice(nl + 1, close < 0 ? text.length : close).replace(/\n$/, ""));
      if (close < 0) break;
      i = close + 3;
      if (text[i] === "\n") i++;
    }
  }
  function setBubble(b, text) { if (b.classList.contains("ai")) renderRich(b, text); else b.textContent = text; }
  function add(cls, text) {
    const d = el("div", "msg " + cls);
    setBubble(d, text);
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    return d;
  }
  function renderHistory() {
    log.innerHTML = "";
    for (const m of hist()) {
      if (m.role === "user") add("me", m.content);
      else if (m.role === "assistant" && m.content) add("ai", m.content);
    }
    if (!hist().length) add("sys", cfg().key
      ? "Jarvis online. Say \"Unleash ULTRON\" for engineering, or \"Convene the council\" for a hard look at a plan."
      : "Jarvis online. Open Settings and paste your API key to chat. You can already say \"Unleash ULTRON\".");
  }

  // ---------- side panels (real data only) ----------
  function fillRows(box, rows) {
    if (!box) return;
    box.innerHTML = "";
    for (const [k, v, cls] of rows) { const r = el("div", "row2"); r.append(el("span", "k", k), el("span", "v " + (cls || ""), v)); box.append(r); }
  }
  function linkState() {
    const c = cfgFor(S.agent), local = /localhost|127\.0\.0\.1/.test(c.base);
    if (!c.key) return { text: "NO KEY", warn: true };
    if (!navigator.onLine && !local) return { text: "OFFLINE", warn: true };
    return { text: "READY", warn: false };
  }
  function renderVitals() {
    const c = cfgFor(S.agent), l = linkState();
    const link = [l.warn ? l.text.charAt(0) + l.text.slice(1).toLowerCase() : "Key set", l.warn ? "warn" : "ok"];
    fillRows($("vitals"), [
      ["Brain", cfgFor("jarvis").model], ["Link", link[0], link[1]],
      ["Voice out", S.speakOn ? "On" : "Off", S.speakOn ? "ok" : ""],
      ["Voice in", SR ? "Ready" : "Needs Chrome/Edge", SR ? "ok" : "warn"],
      ["Memory", S.memories.length + (S.memories.length === 1 ? " fact" : " facts")],
      ["Messages", String(J.AGENT_ORDER.filter(id => agent(id).status === "online").reduce((n, id) => n + userCount(id), 0))]
    ]);
    const proj = activeProject();
    fillRows($("vitalsU"), [
      ["Agent", "ULTRON"], ["Brain", cfgFor("ultron").model], ["Link", link[0], link[1]],
      ["Voice out", S.speakOn ? "On" : "Off", S.speakOn ? "ok" : ""],
      ["Messages", String(userCount("ultron"))], ["Project", proj ? proj.name : "None", proj ? "ok" : ""]
    ]);
    const dd = J.council.latest(hist("daredevil"));
    fillRows($("vitalsD"), [
      ["Agent", "DAREDEVIL"], ["Brain", cfgFor("daredevil").model], ["Link", link[0], link[1]],
      ["Voice out", S.speakOn ? "On" : "Off", S.speakOn ? "ok" : ""],
      ["Messages", String(userCount("daredevil"))], ["Verdicts", String(dd.count)]
    ]);
    $("hudLink").textContent = l.warn ? l.text : "KEY SET";
    $("hudModel").textContent = c.model.length > 18 ? c.model.slice(0, 17) + "…" : c.model;
    const chip = $("sysChip"); chip.textContent = l.text; chip.dataset.s = l.warn ? "warn" : "ok";
  }
  function renderMemList() {
    const box = $("memList"); box.innerHTML = "";
    if (!S.memories.length) { box.append(el("div", "empty", "Nothing yet. Say \"remember that...\"")); return; }
    for (const m of S.memories) box.append(el("div", "li", m));
  }
  function renderActivity() {
    for (const box of document.querySelectorAll('[data-render="activity"]')) {
      box.innerHTML = "";
      if (!activityLog.length) { box.append(el("div", "empty", "No activity yet.")); continue; }
      for (const a of activityLog) {
        const r = el("div", "li");
        r.append(el("span", "t", a.t), el("span", "tag", agent(a.agent).name.slice(0, 3)), document.createTextNode(a.text));
        box.append(r);
      }
    }
  }
  function logActivity(text, id) {
    activityLog.unshift({ t: clock24(new Date()), text, agent: id || S.agent });
    if (activityLog.length > 20) activityLog.pop();
    renderActivity();
  }
  function renderTimers() {
    const box = $("timers"); box.innerHTML = "";
    if (!timersList.length) { box.append(el("div", "empty", "No active timers.")); return; }
    const now = Date.now();
    for (const t of timersList) {
      const left = Math.max(0, Math.ceil((t.end - now) / 1000));
      const r = el("div", "row2");
      r.append(el("span", "k", t.label || "Timer"), el("span", "v", String(Math.floor(left / 60)).padStart(2, "0") + ":" + String(left % 60).padStart(2, "0")));
      box.append(r);
    }
  }

  // JARVIS's view of the whole ecosystem: who is built, who is active, how much each has been used.
  function renderAgents() {
    for (const box of [document.querySelector('[data-render="agents"]'), $("agentListDlg")]) {
      if (!box) continue;
      box.innerHTML = "";
      for (const id of J.AGENT_ORDER) {
        const a = agent(id), online = a.status === "online";
        const row = el("div", "agent-row" + (online ? "" : " planned"));
        row.style.setProperty("--ar", a.swatch);
        const meta = el("div", "ameta");
        meta.append(el("div", "aname", a.name), el("div", "arole", online ? a.role + " · " + userCount(id) + " msg" : a.role + " · planned"));
        row.append(el("span", "adot"), meta);
        if (id === S.agent) row.append(el("span", "atag", "Active"));
        else if (online) {
          const b = el("button", "asum", id === "jarvis" ? "Return" : "Summon"); b.type = "button";
          b.onclick = () => { if ($("agentsDlg").open) $("agentsDlg").close(); requestSummon(id); };
          row.append(b);
        } else row.append(el("span", "atag dim", "Planned"));
        box.append(row);
      }
    }
  }
  function renderProjects() {
    const box = $("projList"); box.innerHTML = "";
    if (!projects.length) box.append(el("div", "empty", "No projects yet. Add one so ULTRON knows what you are building."));
    for (const p of projects) {
      const r = el("div", "proj" + (p.id === activeProjectId ? " on" : ""));
      r.append(el("span", "pn", p.name), el("span", "pm", p.id === activeProjectId ? "Active" : ""));
      r.onclick = () => { activeProjectId = p.id; store.set("jarvis.activeProject", p.id); renderProjects(); renderVitals(); logActivity("Active project: " + p.name, "ultron"); };
      box.append(r);
    }
    $("projEdit").style.display = activeProject() ? "" : "none";
  }
  function renderCode() {
    const box = $("codeList"); box.innerHTML = "";
    const blocks = J.extractCodeBlocks(hist("ultron"), 30);
    if (!blocks.length) { box.append(el("div", "empty", "Code ULTRON writes will collect here.")); return; }
    for (const b of blocks) {
      const row = el("div", "cb"), top = el("div", "cb-top"), copy = el("button", "mini", "Copy"); copy.type = "button";
      copy.onclick = () => copyText(b.code, copy);
      top.append(el("span", "cb-lang", b.lang || "code"), copy);
      row.append(top, el("div", "cb-pre", (b.code.split("\n").find(l => l.trim()) || "").trim()));
      box.append(row);
    }
  }
  const LENSES = [
    ["steven", "STEVEN", "The CFO", "money, ROI, hidden costs", "#ffcf6b"],
    ["marc", "MARC", "The mercenary", "feasibility, what breaks first", "#ff7a7a"],
    ["jake", "JAKE", "The realist", "market, adoption, will anyone care", "#7ec8ff"]
  ];
  // DAREDEVIL's panels, read straight from the council's own replies; empty when the format was not followed.
  function renderCouncil() {
    const L = J.council.latest(hist("daredevil")), v = L.verdict;
    const box = $("councilList"); box.innerHTML = "";
    for (const [key, name, role, lens, color] of LENSES) {
      const r = el("div", "alter-row"), n = el("div", "alter-name", name); n.style.color = color;
      r.append(n, el("div", "alter-lens", role + " \u00b7 " + lens), el("div", "alter-said", L.alters[key] || "Waiting for a plan."));
      box.append(r);
    }
    const vb = $("verdictBox"); vb.innerHTML = "";
    if (!v) vb.append(el("div", "empty", "No verdict yet. Put a plan to the council."));
    else {
      vb.append(el("div", "vbadge " + v.verdict.toLowerCase(), v.verdict));
      if (v.conditions.length) { vb.append(el("div", "vsub", "Conditions")); v.conditions.forEach(c => vb.append(el("div", "vtext", "\u2022 " + c))); }
      if (v.next) { vb.append(el("div", "vsub", "Cheapest test")); vb.append(el("div", "vtext", v.next)); }
    }
    const rl = $("riskList"); rl.innerHTML = "";
    if (!v || !v.risks.length) rl.append(el("div", "empty", "No risks logged yet."));
    else {
      const order = { HIGH: 0, MED: 1, LOW: 2 };
      v.risks.slice().sort((a, b) => order[a.level] - order[b.level]).forEach(r => {
        const row = el("div", "risk");
        row.append(el("span", "chip " + r.level.toLowerCase(), r.level), document.createTextNode(r.text));
        if (r.fix) row.append(el("span", "fix", "Fix: " + r.fix));
        rl.append(row);
      });
    }
  }
  function renderPanels() { renderCode(); renderCouncil(); }
  // Title, subtitle, placeholder and HUD text that belong to the active agent.
  function renderChrome() {
    const a = agent();
    $("agentTitle").textContent = a.name; $("agentSub").textContent = a.sub;
    $("hudL").textContent = a.hudL; $("hudR").textContent = a.hudR;
    $("box").placeholder = a.placeholder; document.title = a.name;
  }
  function renderAll() { renderChrome(); renderVitals(); renderMemList(); renderActivity(); renderTimers(); renderAgents(); renderProjects(); renderPanels(); renderHistory(); }

  const jarvisBoot = Date.now();
  function tickClock() {
    $("clock").textContent = clock24(new Date());
    const e = Math.floor((Date.now() - jarvisBoot) / 1000), p = n => String(n).padStart(2, "0");
    $("hudUptime").textContent = p(Math.floor(e / 3600)) + ":" + p(Math.floor((e % 3600) / 60)) + ":" + p(e % 60);
    renderTimers();
  }
  setInterval(tickClock, 500);
  window.addEventListener("online", renderVitals); window.addEventListener("offline", renderVitals);

  // ---------- the core: shows what the active agent is doing ----------
  const ORB = { idle: "Standing by", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };
  const cur = { c: [...agent("jarvis").states.idle.c], spin: .12, hz: .35, amp: .035, jit: 0 };
  let target = agent("jarvis").states.idle;
  function setState(s) {
    S.state = s;
    target = agent().states[s] || agent().states.idle;
    document.body.dataset.state = s;
    $("orbLabel").textContent = agent().orbLabel + " · " + (ORB[s] || "");
    $("hudMode").textContent = s.toUpperCase();
  }
  const cv = $("sphere"), ctx = cv.getContext("2d");
  let W = 0, H = 0;
  function resizeCanvas() {
    const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  if ("ResizeObserver" in window) new ResizeObserver(resizeCanvas).observe(cv);
  window.addEventListener("resize", resizeCanvas);
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const k = Math.min(1, dt * 4), m = reduce ? .15 : 1;
    for (let i = 0; i < 3; i++) cur.c[i] += (target.c[i] - cur.c[i]) * k;
    cur.spin += (target.spin - cur.spin) * k; cur.hz += (target.hz - cur.hz) * k;
    cur.amp += (target.amp - cur.amp) * k; cur.jit += (target.jit - cur.jit) * k;
    ctx.clearRect(0, 0, W, H);
    J.cores[agent().core].draw(ctx, W, H, now / 1000, dt, cur, m);
    requestAnimationFrame(frame);
  }

  // ---------- speech ----------
  // Speak as a given agent. Resolves when the line has been spoken (immediately when voice is off).
  function say(text, id, maxMs) {
    if (!S.speakOn) return Promise.resolve();
    return J.speak(text, id, {
      onStart: () => { S.speaking = true; setState("speaking"); },
      onEnd: wasCurrent => { if (wasCurrent !== false) { S.speaking = false; setState(S.busy ? "thinking" : "idle"); } }
    }, maxMs || 12000);
  }
  function paintSpeakBtn() {
    $("speakBtn").textContent = "Voice: " + (S.speakOn ? "on" : "off");
    $("speakBtn").classList.toggle("on", S.speakOn);
    renderVitals();
  }
  $("speakBtn").onclick = () => {
    S.speakOn = !S.speakOn; store.set("jarvis.speak", S.speakOn); paintSpeakBtn();
    if (!S.speakOn) { J.stopSpeaking(); S.speaking = false; setState(S.busy ? "thinking" : "idle"); }
  };

  let rec = null;
  $("micBtn").onclick = () => {
    if (!SR) { add("sys", "Voice input needs Chrome or Edge."); return; }
    if (rec) { rec.stop(); return; }
    if (S.switching) return;
    J.stopSpeaking();
    rec = new SR();
    rec.lang = navigator.language || "en-IN";
    rec.interimResults = false;
    rec.onstart = () => { $("micBtn").classList.add("rec"); setState("listening"); };
    rec.onend = () => { $("micBtn").classList.remove("rec"); rec = null; if (!S.busy && !S.speaking) setState("idle"); };
    rec.onerror = e => add("sys", "Mic error: " + e.error);
    rec.onresult = e => {
      const t = e.results[0][0].transcript;
      S.speakOn = true; store.set("jarvis.speak", true); paintSpeakBtn();   // talk to it, it talks back
      send(t);
    };
    rec.start();
  };

  // ---------- tools the agents can use ----------
  const TOOLS = [
    // No-argument functions must omit "parameters": Gemini's OpenAI-compatible endpoint rejects an empty schema.
    { type: "function", function: { name: "get_time", description: "Get the current local date and time." } },
    { type: "function", function: { name: "open_website", description: "Open a website in a new browser tab.",
        parameters: { type: "object", properties: { url: { type: "string", description: "Full URL, e.g. https://youtube.com" } }, required: ["url"] } } },
    { type: "function", function: { name: "search_web", description: "Open a Google search for a query in a new tab.",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
    { type: "function", function: { name: "remember", description: "Save a fact about the user to long-term memory. Use when the user asks you to remember something.",
        parameters: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] } } },
    { type: "function", function: { name: "set_timer", description: "Set a timer that alerts the user when it ends.",
        parameters: { type: "object", properties: { seconds: { type: "number" }, label: { type: "string" } }, required: ["seconds"] } } }
  ];
  // Uplika (social posting). Only JARVIS has it for now, only once a key is saved, and every post needs the user's approval.
  const uplikaKey = () => String(store.get("jarvis.uplika", "") || "");
  J.uplika.relay = String(store.get("jarvis.uplikaRelay", "") || "");
  const UPLIKA_TOOLS = [
    { type: "function", function: { name: "uplika_accounts", description: "List the user's connected social channels (id, platform, handle, status) from Uplika." } },
    { type: "function", function: { name: "uplika_publish", description: "Draft a social post. The user is shown the text and channels and must approve before anything is posted, so call this only when they asked to post something. Do not claim it was posted unless the result says it was.",
        parameters: { type: "object", properties: { content: { type: "string", description: "The post text exactly as it should appear." }, channels: { type: "array", items: { type: "string" }, description: "Platform names, handles or ids, e.g. [\"instagram\"]. Omit to use every active channel." } }, required: ["content"] } } }
  ];
  // GitHub (code). Only ULTRON has it, once a token is saved. Reading is free; every change needs approval and lands on a new branch as a pull request.
  const ghToken = () => String(store.get("jarvis.github", "") || "");
  const GH_TOOLS = [
    { type: "function", function: { name: "github_repos", description: "List the user's GitHub repositories (name, default branch, private or public)." } },
    { type: "function", function: { name: "github_read", description: "Read one file, or list a folder, in a GitHub repository. Read before you change anything.",
        parameters: { type: "object", properties: { repo: { type: "string", description: "owner/name" }, path: { type: "string", description: "File or folder path. Empty for the repository root." }, ref: { type: "string", description: "Branch or commit. Defaults to the default branch." } }, required: ["repo"] } } },
    { type: "function", function: { name: "github_propose_change", description: "Propose changes to files in a repository. The user sees exactly what will change and must approve; it is then committed to a NEW branch with a pull request. It never changes the default branch and never merges. Give the COMPLETE new content of each file, not a patch. Only call when the user asked for a change.",
        parameters: { type: "object", properties: {
          repo: { type: "string", description: "owner/name" }, message: { type: "string", description: "Short commit message." }, branch: { type: "string", description: "Short branch name; ultron/ is added." },
          files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string", description: "Full new file content." } }, required: ["path", "content"] } },
          pr_title: { type: "string" }, pr_body: { type: "string", description: "What changed and why." } }, required: ["repo", "message", "files"] } } }
  ];
  const toolsFor = id => TOOLS.concat((id === "jarvis" && uplikaKey()) ? UPLIKA_TOOLS : [], (id === "ultron" && ghToken()) ? GH_TOOLS : []);
  function askChange(summary) {
    return new Promise(resolve => {
      const dlg = $("ghDlg"); $("ghSummary").textContent = summary;
      let done = false;
      const end = v => { if (done) return; done = true; $("ghYes").onclick = $("ghNo").onclick = null; dlg.removeEventListener("close", onClose); if (dlg.open) dlg.close(); resolve(v); };
      const onClose = () => end(false);
      dlg.addEventListener("close", onClose);
      $("ghYes").onclick = () => end(true); $("ghNo").onclick = () => end(false);
      dlg.showModal();
    });
  }
  function askApproval(text, where) {
    return new Promise(resolve => {
      const dlg = $("postDlg"); $("postText").value = text; $("postWhere").textContent = "Going to: " + where;
      let done = false;
      const end = v => { if (done) return; done = true; $("postYes").onclick = $("postNo").onclick = null; dlg.removeEventListener("close", onClose); if (dlg.open) dlg.close(); resolve(v); };
      const onClose = () => end(null);
      dlg.addEventListener("close", onClose);
      $("postYes").onclick = () => end($("postText").value.trim() || null);
      $("postNo").onclick = () => end(null);
      dlg.showModal();
    });
  }
  const toolImpl = {
    github_repos: async () => {
      const list = await J.github.repos(ghToken());
      return list.length ? list.map(r => r.name + " (" + (r.private ? "private" : "public") + ", default " + r.branch + ")").join("\n") : "The token can see no repositories. Give it access to some on GitHub.";
    },
    github_read: async ({ repo, path, ref }) => {
      const r = await J.github.read(ghToken(), repo, path || "", ref);
      logActivity("Read " + repo + "/" + (path || ""), S.agent);
      return r.type === "dir" ? "Folder:\n" + r.entries.join("\n") : r.text + (r.truncated ? "\n[truncated: file is " + r.size + " bytes; ask for a narrower file]" : "");
    },
    github_propose_change: async a => {
      const p = await J.github.plan(ghToken(), { repo: a.repo, message: a.message, branch: a.branch, files: a.files, prTitle: a.pr_title, prBody: a.pr_body });
      if (!(await askChange(J.github.describe(p)))) { logActivity("Change declined", S.agent); return "The user declined, so nothing was changed."; }
      const r = await J.github.apply(ghToken(), p);
      logActivity("Opened " + (r.pr ? "pull request" : "branch") + " on " + p.owner + "/" + p.repo, S.agent);
      return "Done. " + (r.pr ? "Pull request opened: " : "Branch created: ") + r.url + " (" + r.files + " file(s) on branch " + r.branch + "). The default branch was not changed; the user must review and merge it.";
    },
    uplika_accounts: async () => {
      const all = await J.uplika.accounts(uplikaKey());
      return all.length ? all.map(a => a.platform + " " + a.handle + " [" + a.status + (a.health && a.health !== "ok" ? ", " + a.health : "") + "] id=" + a.id).join("\n") : "No channels are connected yet. Connect them at https://uplika.com/dashboard/connections.";
    },
    uplika_publish: async ({ content, channels }) => {
      const key = uplikaKey();
      if (!content || !String(content).trim()) return "No post text was given.";
      const targets = J.uplika.resolve(await J.uplika.accounts(key), channels);
      if (!targets.length) return "No matching active channel. Nothing was posted.";
      const approved = await askApproval(String(content), targets.map(a => a.platform + " " + a.handle).join(", "));
      if (!approved) { logActivity("Post cancelled", S.agent); return "The user declined, so nothing was posted."; }
      const res = await J.uplika.publish(key, approved, targets.map(a => a.id));
      logActivity("Posted to " + targets.length + " channel(s)", S.agent);
      return "Submitted to Uplika for " + targets.map(a => a.platform + " " + a.handle).join(", ") + ". Uplika response: " + JSON.stringify(res).slice(0, 300);
    },
    get_time: () => new Date().toString(),
    open_website: ({ url }) => {
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      return window.open(url, "_blank", "noopener") ? "Opened " + url : "The browser blocked the popup. Ask the user to allow popups for this page.";
    },
    search_web: ({ query }) =>
      window.open("https://www.google.com/search?q=" + encodeURIComponent(query), "_blank", "noopener") ? "Opened search for: " + query : "The browser blocked the popup. Ask the user to allow popups for this page.",
    remember: ({ fact }) => { S.memories.push(fact); store.set("jarvis.memories", S.memories); renderMemList(); renderVitals(); return "Saved."; },
    set_timer: ({ seconds, label }) => {
      const secs = Math.max(1, Number(seconds) || 1);
      const entry = { label: label || "Timer", end: Date.now() + secs * 1000 };
      timersList.push(entry); renderTimers();
      setTimeout(() => {
        const i = timersList.indexOf(entry); if (i >= 0) timersList.splice(i, 1);
        const msg = "Timer finished" + (label ? ": " + label : "") + ".";
        add("ai", msg); say(msg, S.agent); logActivity(msg); renderTimers();
      }, secs * 1000);
      return "Timer set for " + secs + " seconds.";
    }
  };

  // ---------- what each agent is told ----------
  function systemPrompt(id) {
    const c = cfg();
    let s = J.prefs.get(id).persona;
    if (id === "jarvis") s += J.ecosystemPrompt();
    if (id === "jarvis" && uplikaKey()) s += "\nYou are connected to the user's social channels through Uplika (tools uplika_accounts and uplika_publish). Posting always needs the user's approval in a dialog, so never say something is posted until the tool result says it was submitted.";
    if (c.name) s += "\nThe user's name is " + c.name + ".";
    if (id === "ultron" && ghToken()) s += "\nYou are connected to the user's GitHub. Your earlier limits on touching files are lifted for GitHub: use github_repos and github_read to look at their code, then github_propose_change to suggest edits. Read the relevant files first, make small focused changes with complete file contents, and never invent file contents you have not read. Every change needs the user's approval and arrives as a pull request on a new branch; you cannot merge or change the default branch. Never say a change was made until the tool result says it was.";
    if (id === "ultron") {
      const p = activeProject();
      if (p) s += "\nActive project: " + p.name + (p.notes ? "\nProject notes from the user:\n" + p.notes : "");
    }
    if (S.memories.length) s += "\nThings you remember about the user:\n- " + S.memories.join("\n- ");
    s += "\nCurrent time: " + new Date().toString();
    return s;
  }

  // ---------- agent switching ----------
  // These lines are scripted, not generated, so switching is instant, free, and works with no API key.
  function userSay(text) { add("me", text); hist().push({ role: "user", content: text }); saveHist(S.agent); renderVitals(); }
  function agentSay(id, text, maxMs) {
    hist(id).push({ role: "assistant", content: text }); saveHist(id);
    const bubble = S.agent === id ? add("ai", text) : null;
    renderVitals(); renderAgents(); renderPanels();
    return { bubble, spoken: say(text, id, maxMs) };
  }
  function clearPending() {
    if (S.pending && S.pending.row) S.pending.row.remove();
    S.pending = null;
  }
  function addConfirmButtons(bubble, a) {
    const row = el("div", "confirm"), go = el("button", "go", "Release " + a.name), no = el("button", "", "Stand down");
    go.type = no.type = "button";
    go.onclick = () => buttonAnswer({ type: "confirm" }, "Yes.");
    no.onclick = () => buttonAnswer({ type: "cancel" }, "No.");
    bubble.append(row); row.append(go, no);
    S.pending.row = row; log.scrollTop = log.scrollHeight;
  }
  async function buttonAnswer(intent, echo) {
    if (S.busy || S.switching || !S.pending) return;
    await runIntent(intent, echo);
  }

  async function handleSummon(id) {
    const a = agent(id);
    if (id === S.agent) { agentSay(S.agent, id === "jarvis" ? "I'm already here, Boss." : "I'm already on it."); return; }
    if (a.status !== "online") {
      const ready = J.AGENT_ORDER.filter(x => x !== "jarvis" && agent(x).status === "online").map(x => agent(x).name);
      agentSay("jarvis", a.name + " isn't online yet, Boss. " + a.role + " is on the roadmap, but no workspace has been built for it." +
        (ready.length ? " " + ready.join(" and ") + (ready.length > 1 ? " are" : " is") + " available right now." : ""));
      return;
    }
    clearPending();
    S.pending = { agent: id };
    const r = agentSay("jarvis", "Boss, are you certain you wish to release " + a.name + "?");
    S.pending.bubble = r.bubble;
    addConfirmButtons(r.bubble, a);
  }
  async function confirmSummon() {
    const p = S.pending; if (!p) return;
    clearPending();
    const a = agent(p.agent);
    logActivity("Releasing " + a.name, "jarvis");
    await agentSay("jarvis", a.ackLine || "Understood, Boss.", 6000).spoken;
    await switchAgent(p.agent);
  }
  async function returnToJarvis() {
    const from = agent();
    logActivity(from.name + " stood down");
    await agentSay(S.agent, J.pick(from.exitLines || ["Standing down."]), 6000).spoken;
    await switchAgent("jarvis");
    agentSay("jarvis", J.pick(agent("jarvis").welcomeBack));
  }
  async function switchAgent(id) {
    if (S.switching || id === S.agent) return;
    S.switching = true;
    if (rec) rec.stop();
    J.stopSpeaking(); S.speaking = false;
    const a = agent(id), warp = $("warp");
    warp.dataset.to = id; $("warpName").textContent = a.name;
    $("warpSub").textContent = id === "jarvis" ? "Returning to command" : a.role;
    warp.classList.add("on");
    await sleep(reduce ? 0 : 650);
    S.agent = id; document.body.dataset.agent = id;
    setState("idle");
    renderAll();
    await sleep(reduce ? 0 : 550);
    warp.classList.remove("on");
    S.switching = false;
    if (id !== "jarvis") agentSay(id, J.pick(a.greetings));
    $("box").focus();
  }

  async function runIntent(it, echo) {
    S.busy = true;
    try {
      if (echo) userSay(echo);
      if (it.type === "confirm") await confirmSummon();
      else if (it.type === "cancel") { clearPending(); agentSay("jarvis", "Very well, Boss. Standing by."); }
      else if (it.type === "summon") await handleSummon(it.agent);
      else if (it.type === "return") await returnToJarvis();
    } finally {
      S.busy = false;
      if (!S.speaking) setState("idle");
    }
  }
  async function handleCommand(text) {
    const it = J.parseIntent(text, { pending: S.pending ? S.pending.agent : null, active: S.agent });
    if (!it) return false;
    if (it.type === "cancel" && it.passthrough) { clearPending(); return false; }
    await runIntent(it, text);
    return true;
  }
  // From the Agents panel/dialog. From another agent, go back through JARVIS first.
  async function requestSummon(id) {
    if (S.busy || S.switching) { add("sys", "One moment, still working on the last request."); return; }
    if (id === S.agent) return;
    if (S.agent !== "jarvis") {
      S.busy = true; try { await returnToJarvis(); } finally { S.busy = false; }
      if (id === "jarvis") return;
    }
    S.busy = true;
    try { await handleSummon(id); } finally { S.busy = false; }
  }

  // ---------- chat with the model ----------
  async function send(text) {
    text = text.trim();
    if (!text || S.busy || S.switching) return;
    if (await handleCommand(text)) return;
    if (!cfgFor(S.agent).key) {
      const own = J.prefs.get(S.agent);
      add("sys", (own.model || own.base || own.key) ? "This agent has its own endpoint but no API key. Add one for it in Settings, or clear its endpoint." : "Open Settings and paste your API key first.");
      return;
    }
    const id = S.agent, h = hist(id);
    S.busy = true; setState("thinking");
    add("me", text); h.push({ role: "user", content: text });
    renderVitals();
    const thinking = add("sys", "...");
    try {
      let finished = false;
      for (let step = 0; step < 8; step++) {
        let bubble = null;   // the reply appears word by word as it streams in
        const msg = await J.model.call({
          cfg: cfgFor(id), system: systemPrompt(id), history: h, tools: toolsFor(id),
          status: t => { thinking.textContent = t; logActivity(t, id); },
          onToken: txt => {
            if (!bubble) { thinking.remove(); bubble = add("ai", txt); }
            else { setBubble(bubble, txt); log.scrollTop = log.scrollHeight; }
          }
        });
        h.push(msg);
        if (msg.tool_calls && msg.tool_calls.length) {
          for (const call of msg.tool_calls) {
            let out;
            try {
              const args = JSON.parse(call.function.arguments || "{}");
              logActivity("Tool: " + call.function.name + " " + (Object.values(args)[0] ?? ""), id);
              out = String(toolImpl[call.function.name] ? await toolImpl[call.function.name](args) : "Unknown tool.");
            } catch (e) { out = "Tool failed: " + e.message; }
            h.push({ role: "tool", tool_call_id: call.id, content: out });
          }
          continue;
        }
        thinking.remove();
        if (bubble) setBubble(bubble, msg.content || ""); else add("ai", msg.content || "");
        say(msg.content || "", id);
        finished = true; break;
      }
      if (!finished) {
        thinking.remove();
        const note = "I ran out of steps on that one. Try asking again, a bit more simply.";
        add("ai", note); h.push({ role: "assistant", content: note });
      }
    } catch (e) {
      thinking.remove();
      add("sys", "Something went wrong: " + e.message);
      logActivity("Error: " + e.message, id);
      // drop the unanswered turn so history stays valid
      while (h.length && h[h.length - 1].role !== "user") h.pop();
      h.pop();
    }
    saveHist(id);
    S.busy = false;
    renderVitals(); renderPanels(); renderAgents();
    if (!S.speaking) setState("idle");
  }
  $("form").onsubmit = e => {
    e.preventDefault();
    if (S.busy || S.switching) return;        // keep what was typed instead of silently dropping it
    const t = $("box").value; $("box").value = ""; send(t);
  };

  // ---------- settings ----------
  let draft = {}, draftAgent = "jarvis";
  const onlineAgents = () => J.AGENT_ORDER.filter(id => agent(id).status === "online");
  function refreshVoiceOptions() {
    const select = $("sVoice");
    if (!("speechSynthesis" in window)) { select.innerHTML = ""; select.add(new Option("This browser has no speech", "")); return; }
    const voices = J.voices(), keep = draft[draftAgent] ? draft[draftAgent].voiceURI : "";
    select.innerHTML = "";
    if (!voices.length) { select.add(new Option("No system voices found", "")); return; }
    select.add(new Option("Automatic · best matching voice", ""));
    for (const v of J.voice.orderVoices(voices, agent(draftAgent).voice))
      select.add(new Option(v.name + " · " + v.lang + (J.voice.isMale(v.name) ? "" : "  (not a male voice)") + (v.default ? " · default" : ""), v.voiceURI));
    select.value = voices.some(v => v.voiceURI === keep) ? keep : "";
  }
  function paintVoiceValues() {
    $("sRateValue").textContent = Number($("sRate").value).toFixed(2) + "×";
    $("sPitchValue").textContent = Number($("sPitch").value).toFixed(2);
  }
  function formToDraft() {
    draft[draftAgent] = { provider: $("aProvider").value, model: $("aModel").value, base: $("aBase").value, key: $("aKey").value, persona: $("sPersona").value, voiceURI: $("sVoice").value, rate: Number($("sRate").value), pitch: Number($("sPitch").value) };
  }
  function draftToForm() {
    const d = draft[draftAgent], a = agent(draftAgent);
    $("sPersonaLabel").textContent = a.name + " personality";
    $("sVoiceHeading").textContent = a.name + " VOICE";
    $("aProvider").value = d.provider || "shared";
    $("aProvider").disabled = !["jarvis", "ultron"].includes(draftAgent);
    $("aModel").value = d.model; $("aBase").value = d.base; $("aKey").value = d.key;
    const usingGroq = $("aProvider").value === "groq";
    $("aModel").placeholder = usingGroq ? "e.g. llama-3.3-70b-versatile" : "e.g. qwen2.5-coder:32b";
    $("aBase").disabled = usingGroq; $("aKey").disabled = usingGroq;
    $("sPersona").value = d.persona; $("sRate").value = d.rate; $("sPitch").value = d.pitch;
    refreshVoiceOptions(); paintVoiceValues();
    for (const b of $("sAgentPick").children) b.classList.toggle("on", b.dataset.id === draftAgent);
  }
  $("setBtn").onclick = () => {
    const c = cfg();
    $("sKey").value = c.key; $("sGroq").value = store.get("jarvis.groqKey", ""); $("sModel").value = c.model; $("sBase").value = c.base; $("sFallbacks").value = c.fallbacks; $("sName").value = c.name; $("sUplika").value = uplikaKey(); $("sGithub").value = ghToken(); $("sRelay").value = J.uplika.relay;
    draft = {}; draftAgent = agent().status === "online" ? S.agent : "jarvis";
    for (const id of onlineAgents()) { const p = J.prefs.get(id); draft[id] = { provider: p.provider || "shared", model: p.model, base: p.base, key: p.key, persona: p.persona, voiceURI: p.voice.voiceURI, rate: p.voice.rate, pitch: p.voice.pitch }; }
    const pick = $("sAgentPick"); pick.innerHTML = "";
    for (const id of onlineAgents()) {
      const b = el("button", "", agent(id).name); b.type = "button"; b.dataset.id = id;
      b.onclick = () => { formToDraft(); draftAgent = id; draftToForm(); };
      pick.append(b);
    }
    draftToForm();
    $("settings").showModal();
  };
  $("sCancel").onclick = () => $("settings").close();
  $("sRate").oninput = paintVoiceValues; $("sPitch").oninput = paintVoiceValues;
  $("sPreview").onclick = () => {
    S.speakOn = true; store.set("jarvis.speak", true); paintSpeakBtn();
    J.speak(agent(draftAgent).voice.sample, draftAgent, {}, 12000,
      { voiceURI: $("sVoice").value, rate: Number($("sRate").value), pitch: Number($("sPitch").value) });
  };
  $("sLocal").onclick = () => {
    $("sBase").value = "http://localhost:11434/v1";
    $("sFallbacks").value = "";
    if (!$("sKey").value.trim()) $("sKey").value = "ollama";   // local servers ignore the key; Jarvis just needs something here
    if (!$("sModel").value.trim() || $("sModel").value.startsWith("gemini")) $("sModel").value = "";
    $("sModel").placeholder = "type the model name you pulled in Ollama";
    $("sModel").focus();
  };
  $("aProvider").onchange = () => { formToDraft(); draftToForm(); };
  $("sSave").onclick = () => {
    store.set("jarvis.groqKey", $("sGroq").value.trim());
    store.set("jarvis.uplika", $("sUplika").value.trim());
    store.set("jarvis.github", $("sGithub").value.trim());
    J.uplika.relay = $("sRelay").value.trim(); store.set("jarvis.uplikaRelay", J.uplika.relay);
    store.set("jarvis.cfg", {
      key: $("sKey").value.trim(), model: $("sModel").value.trim() || DEFAULTS.model,
      base: $("sBase").value.trim() || DEFAULTS.base, fallbacks: $("sFallbacks").value.trim(), name: $("sName").value.trim()
    });
    formToDraft();
    for (const id of onlineAgents()) {
      const d = draft[id];
      J.prefs.save(id, { persona: d.persona, provider: d.provider, model: d.model, base: d.base, key: d.key, voice: { voiceURI: d.voiceURI, rate: d.rate, pitch: d.pitch } });
    }
    $("settings").close();
    add("sys", "Settings saved.");
    renderVitals();
  };
  if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => { if ($("settings").open) refreshVoiceOptions(); };

  // ---------- memory, agents and project dialogs ----------
  const openMemory = () => { $("mText").value = S.memories.join("\n"); $("memory").showModal(); };
  $("memBtn").onclick = openMemory; $("memEdit").onclick = openMemory;
  $("mCancel").onclick = () => $("memory").close();
  $("mSave").onclick = () => {
    S.memories = $("mText").value.split("\n").map(s => s.trim()).filter(Boolean);
    store.set("jarvis.memories", S.memories); $("memory").close(); renderMemList(); renderVitals();
  };
  $("agentsBtn").onclick = () => { renderAgents(); $("agentsDlg").showModal(); };
  $("agentsClose").onclick = () => $("agentsDlg").close();

  let editingProject = null;
  function openProject(p) {
    editingProject = p;
    $("projTitle").textContent = p ? "Edit project" : "New project";
    $("pName").value = p ? p.name : ""; $("pNotes").value = p ? p.notes : "";
    $("pDelete").style.display = p ? "" : "none";
    $("projDlg").showModal(); $("pName").focus();
  }
  $("projNew").onclick = () => openProject(null);
  $("projEdit").onclick = () => { if (activeProject()) openProject(activeProject()); };
  $("pCancel").onclick = () => $("projDlg").close();
  $("pSave").onclick = () => {
    const name = $("pName").value.trim() || "Untitled", notes = $("pNotes").value.trim().slice(0, 4000);
    if (editingProject) { editingProject.name = name; editingProject.notes = notes; }
    else {
      const p = { id: "p" + Date.now().toString(36), name, notes };
      projects.push(p); activeProjectId = p.id; store.set("jarvis.activeProject", p.id);
    }
    store.set("jarvis.projects", projects);
    $("projDlg").close(); renderProjects(); renderVitals();
  };
  $("pDelete").onclick = () => {
    if (!editingProject || !confirm("Delete project \"" + editingProject.name + "\"?")) return;
    projects = projects.filter(p => p !== editingProject);
    if (activeProjectId === editingProject.id) { activeProjectId = null; store.set("jarvis.activeProject", null); }
    store.set("jarvis.projects", projects);
    $("projDlg").close(); renderProjects(); renderVitals();
  };

  // ---------- start ----------
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  document.body.dataset.agent = "jarvis";
  setState("idle");
  paintSpeakBtn();
  renderAll();
  tickClock();
  resizeCanvas();
  requestAnimationFrame(frame);

  // Handy for debugging in the browser console.
  J.app = { S, switchAgent, send };
})();
