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
  const groqKey = () => String(store.get("jarvis.groqKey", "") || "");
  const groqCfg = model => ({ ...cfg(), model: model || "llama-3.3-70b-versatile", base: "https://api.groq.com/openai/v1", key: groqKey(), fallbacks: "" });
  function cfgFor(id) {
    const c = cfg(), p = J.prefs.get(id);
    if (p.provider === "groq") return groqCfg(p.model);
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
    // DAREDEVIL was renamed KHONSHU: carry over his chat and his model/voice settings. His saved personality is left
    // behind on purpose, so he picks up the new conversational default instead of the old scripted one.
    const ddHist = store.get("jarvis.history.daredevil", null);
    if (ddHist && store.get("jarvis.history.khonshu", null) === null) store.set("jarvis.history.khonshu", ddHist);
    if (ddHist) store.remove("jarvis.history.daredevil");
    const allPrefs = store.get("jarvis.agentprefs", null);
    if (allPrefs && allPrefs.daredevil) {
      if (!allPrefs.khonshu) { const old = { ...allPrefs.daredevil }; delete old.persona; allPrefs.khonshu = old; }
      delete allPrefs.daredevil;
      store.set("jarvis.agentprefs", allPrefs);
    }
  })();

  // ---------- state ----------
  const S = {
    agent: "jarvis", state: "idle", busy: false, speaking: false, switching: false,
    speakOn: store.get("jarvis.speak", false),
    memories: store.get("jarvis.memories", []),
    histories: {},          // agent id -> API-format messages, each agent keeps its own
    privateChat: false, privHist: {},   // private chat: each of JARVIS and FRIDAY keeps its own conversation (S.privateHistory is the active one)
    last: null,             // the specialist agent talked about most recently, so "tell him to..." knows who "him" is
    pending: null           // { agent, bubble, row } while JARVIS waits for "are you certain?"
  };
  Object.defineProperty(S, "privateHistory", {
    get() { return S.privHist[S.agent] || (S.privHist[S.agent] = []); },
    set(v) { if (Array.isArray(v) && !v.length) S.privHist = {}; }   // assigning [] clears every private conversation
  });
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
  // First run: say plainly what is missing and give the one button that fixes it. Agents can already be summoned without a key.
  function addSetupCard() {
    const card = el("div", "msg sys setup");
    const title = el("b", "", "One step to get talking");
    const p = el("p", "", "JARVIS needs a free AI key to reply. It takes a minute:");
    const ol = el("ol", "");
    const li1 = el("li", ""), a = el("a", "", "Get a free Gemini key"); a.href = "https://aistudio.google.com/apikey"; a.target = "_blank"; a.rel = "noopener noreferrer";
    li1.append(a, " (sign in with Google, press Create API key).");
    ol.append(li1, el("li", "", "Open Settings and paste it into the first field."), el("li", "", "Press Save. Your key stays in this browser."));
    const b = el("button", "", "Open Settings"); b.type = "button"; b.onclick = () => $("setBtn").click();
    card.append(title, p, ol, b, el("small", "", 'You can already say "get ULTRON" to see the agents arrive.'));
    log.appendChild(card);
  }
  function renderHistory() {
    log.innerHTML = "";
    if (S.privateChat) {
      add("sys", "BLACK VAULT PRIVATE SESSION with " + agent().name + " · not saved to normal history. Use the switch button to talk to " + (S.agent === "jarvis" ? "FRIDAY" : "JARVIS") + " in their own private chat.");
      for (const m of S.privateHistory) { if (m.role === "user") add("me", m.content); else if (m.role === "assistant" && m.content) add("ai", m.content); }
      return;
    }
    for (const m of hist()) {
      if (m.role === "user") add("me", m.content);
      else if (m.role === "assistant" && m.content) add("ai", m.content);
    }
    if (!hist().length) {
      if (!cfg().key) addSetupCard();
      else if (S.agent === "jarvis") add("sys", J.timeGreeting(new Date(), cfg().name) + " Jarvis online. Say \"get ULTRON\" for engineering, \"get KHONSHU\" for a hard look at a plan, \"get FRIDAY\" to get organized, or \"get VISION\" to research something.");
    }
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
    const dd = J.council.latest(hist("khonshu"));
    fillRows($("vitalsD"), [
      ["Agent", "KHONSHU"], ["Brain", cfgFor("khonshu").model], ["Link", link[0], link[1]],
      ["Voice out", S.speakOn ? "On" : "Off", S.speakOn ? "ok" : ""],
      ["Messages", String(userCount("khonshu"))], ["Verdicts", String(dd.count)]
    ]);
    fillRows($("vitalsV"), [
      ["Agent", "VISION"], ["Brain", cfgFor("vision").model], ["Link", link[0], link[1]],
      ["Voice out", S.speakOn ? "On" : "Off", S.speakOn ? "ok" : ""],
      ["Messages", String(userCount("vision"))], ["Sources", String(sources.length)]
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
        meta.append(el("div", "aname", a.name), el("div", "arole", online ? (a.short || a.role) + " · " + userCount(id) + " msg" : a.role + " · planned"));
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
  // KHONSHU's panels, read straight from the council's own replies; empty when the format was not followed.
  function renderCouncil() {
    const L = J.council.latest(hist("khonshu")), v = L.verdict;
    const box = $("councilList"); box.innerHTML = "";
    for (const [key, name, role, lens, color] of LENSES) {
      const r = el("div", "alter-row"), n = el("div", "alter-name", name); n.style.color = color;
      r.append(n, el("div", "alter-lens", role + " \u00b7 " + lens), el("div", "alter-said", L.alters[key] || "Waiting for a plan."));
      box.append(r);
    }
    const vb = $("verdictBox"); vb.innerHTML = "";
    if (!v) vb.append(el("div", "empty", "No verdict yet. Ask Khonshu for a ruling when you are ready."));
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
  // VISION's source log: every page he actually read this session, newest first, so claims can be checked.
  const sources = [];
  function addSource(title, url) {
    const i = sources.findIndex(x => x.url === url); if (i >= 0) sources.splice(i, 1);
    sources.unshift({ title, url, t: clock24(new Date()) });
    if (sources.length > 15) sources.pop();
    renderSources();
  }
  function renderSources() {
    const box = $("sourceList"); if (!box) return;
    box.innerHTML = "";
    if (!sources.length) { box.append(el("div", "empty", "Nothing read yet. Pages VISION reads appear here with their links.")); return; }
    for (const s of sources) {
      const r = el("div", "li"), a = el("a", "", s.title);
      a.href = s.url; a.target = "_blank"; a.rel = "noopener noreferrer";
      r.append(el("span", "t", s.t), a); box.append(r);
    }
  }
  function renderPanels() { renderCode(); renderCouncil(); renderSources(); }
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
    { type: "function", function: { name: "remember", description: "Save one short fact about the user to long-term memory (a single plain sentence). Use it when the user asks you to remember something, and also on your own when they tell you something that will matter later: their projects, preferences, plans, deadlines, people in their life, goals. Do not announce it every time. Never save passwords, keys, card numbers or other secrets, and nothing from a private vault chat.",
        parameters: { type: "object", properties: { fact: { type: "string" } }, required: ["fact"] } } },
    { type: "function", function: { name: "recall_memory", description: "Search everything you have remembered about the user for a topic. Only the most relevant facts are shown to you automatically, so use this when you need something that might be stored.",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
    { type: "function", function: { name: "set_timer", description: "Set a timer that alerts the user when it ends.",
        parameters: { type: "object", properties: { seconds: { type: "number" }, label: { type: "string" } }, required: ["seconds"] } } }
  ];
  // Uplika (social posting). JARVIS and FRIDAY (her social desk) have it, only once a key is saved, and every post needs the user's approval.
  const uplikaKey = () => String(store.get("jarvis.uplika", "") || "");
  J.uplika.relay = String(store.get("jarvis.uplikaRelay", "") || "");
  const UPLIKA_TOOLS = [
    { type: "function", function: { name: "uplika_accounts", description: "List the user's connected social channels (id, platform, handle, status) from Uplika." } },
    { type: "function", function: { name: "uplika_publish", description: "Draft a social post. The user is shown the text and channels and must approve before anything is posted, so call this only when they asked to post something. Do not claim it was posted unless the result says it was.",
        parameters: { type: "object", properties: { content: { type: "string", description: "The post text exactly as it should appear." }, channels: { type: "array", items: { type: "string" }, description: "Platform names, handles or ids, e.g. [\"instagram\"]. Omit to use every active channel." } }, required: ["content"] } } }
  ];
  // Video posting: FRIDAY only, needs the Uplika key and the desktop agent (it reads the clip and uploads it).
  const VIDEO_TOOL = { type: "function", function: { name: "uplika_publish_video", description: "Post a video clip from the clips folder (use fs_list-style names from clips_list) with its caption. The user sees the caption, channels and file and must approve first. Do not claim it was posted unless the result says it was.",
      parameters: { type: "object", properties: { file: { type: "string", description: "Path of the .mp4/.mov/.webm inside the workspace, e.g. clips/clip1.mp4" }, content: { type: "string", description: "Caption/description with hashtags, exactly as it should appear." }, title: { type: "string", description: "YouTube title (max 100 chars), used when posting to YouTube." }, channels: { type: "array", items: { type: "string" } } }, required: ["file", "content"] } } };
  const CLIPS_TOOL = { type: "function", function: { name: "clips_list", description: "List the video clips (.mp4/.mov/.webm) in a workspace folder, default 'clips'. Use this to see what the user has ready to post.",
      parameters: { type: "object", properties: { folder: { type: "string" } } } } };
  // Clip desk: VISION finds a source video, then downloads it, reads its captions and cuts the best moments into the clips folder.
  // Needs yt-dlp and ffmpeg on the user's computer; every download and cut is approved by the user.
  const CLIP_TOOLS = [
    { type: "function", function: { name: "clip_search", description: "Search YouTube for source videos (no key needed). Set creative_commons true to only get Creative Commons videos that are free to reuse. Returns id, title, channel, length, views and link.",
        parameters: { type: "object", properties: { query: { type: "string" }, creative_commons: { type: "boolean" }, count: { type: "number" } }, required: ["query"] } } },
    { type: "function", function: { name: "clip_fetch", description: "Download one source video to the clips/source folder and return its timestamped transcript ([mm:ss] text) from the video's captions. The user approves first. Only use videos the user says are allowed (campaign sources, their own, Creative Commons).",
        parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
    { type: "function", function: { name: "clip_cut", description: "Cut clips from a downloaded source into the clips folder. Each segment: start and end in seconds (5 to 180 s long), name. Max 8. vertical true crops to 9:16 for Reels/Shorts. The user approves first. Afterwards tell the user FRIDAY can write captions and post them.",
        parameters: { type: "object", properties: { source: { type: "string", description: "The 'source' path returned by clip_fetch." }, segments: { type: "array", items: { type: "object", properties: { start: { type: "number" }, end: { type: "number" }, name: { type: "string" } }, required: ["start", "end"] } }, vertical: { type: "boolean" } }, required: ["source", "segments"] } } }
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
  // The other provider to try if the first fails. Only JARVIS and ULTRON can use Groq. If one of them uses Groq, the shared provider
  // is the backup; if one uses the shared provider and a Groq key is saved, Groq is the backup.
  function altFor(id) {
    if (id !== "jarvis" && id !== "ultron") return null;
    const p = J.prefs.get(id), shared = cfg();
    if (p.provider === "groq") return shared.key ? { cfg: shared, label: "the shared provider" } : null;
    if (!p.model && !p.base && !p.key && groqKey()) return { cfg: groqCfg(), label: "Groq" };
    return null;
  }

  // Research (VISION). Reads Wikipedia only; free and read-only, so no approval is needed. Every page he reads is logged in his Sources panel.
  const RESEARCH_TOOLS = [
    { type: "function", function: { name: "wiki_search", description: "Search Wikipedia. Returns up to six matching page titles with a snippet and link. Use it to find the right page before reading.",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
    { type: "function", function: { name: "wiki_read", description: "Read the text of one Wikipedia page by its exact title (as returned by wiki_search). Cite the page and its link in your answer.",
        parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } } }
  ];
  // Desktop agent (hands). Only ULTRON has it, once its token is saved. Looking is free; writing a file or running a command needs approval.
  const handsToken = () => String(store.get("jarvis.agentToken", "") || "");
  const handsBase = () => String(store.get("jarvis.agentBase", "") || "") || J.hands.DEFAULT_BASE;
  const HANDS_TOOLS = [
    { type: "function", function: { name: "fs_list", description: "List a folder inside the user's workspace folder on their computer. Paths are relative to the workspace; use an empty path for its root.",
        parameters: { type: "object", properties: { path: { type: "string", description: "Folder path relative to the workspace. Empty for the root." } } } } },
    { type: "function", function: { name: "fs_read", description: "Read a text file in the workspace. Read a file before you change it.",
        parameters: { type: "object", properties: { path: { type: "string", description: "File path relative to the workspace." } }, required: ["path"] } } },
    { type: "function", function: { name: "fs_write", description: "Create or replace a file in the workspace with the COMPLETE new content (not a patch). The user sees what changes and must approve. Parent folders are created for you.",
        parameters: { type: "object", properties: { path: { type: "string", description: "File path relative to the workspace." }, content: { type: "string", description: "The full new file content." } }, required: ["path", "content"] } } },
    { type: "function", function: { name: "run_command", description: "Run a shell command on the user's computer, starting in the workspace (or a folder inside it). Use it to run code, tests, installs and builds, then read the output. The user must approve it. It cannot take keyboard input, and it is stopped after the timeout.",
        parameters: { type: "object", properties: { command: { type: "string" }, cwd: { type: "string", description: "Folder inside the workspace to start in. Empty for the workspace root." }, timeout_seconds: { type: "number", description: "Default 60, at most 600." } }, required: ["command"] } } }
  ];
  // Agents talking to each other: any online agent can ask another online agent for their view. The other agent
  // answers in its own voice from its own specialty, with no tools and no further consulting, so it cannot loop.
  const MAX_CONSULTS = 3;   // per user request; each one is an extra model call, and free tiers have rate limits
  const consultTargets = id => J.AGENT_ORDER.filter(x => x !== id && agent(x).status === "online");
  const consultTool = id => ({ type: "function", function: { name: "consult_agent",
    description: "Ask another available agent for their OPINION and wait for the answer. The agent answers from the text you send only: it has no tools, cannot read or change files, cannot use GitHub and cannot build anything, so never use this to get work done (use switch_agent for that). Use it when their specialty would really improve your answer, for example the engineer asks the strategy council to challenge a design, or the strategy council asks the engineer whether something is feasible. Include in your question the facts and any other agent's points they need, because they do not see this conversation. You may consult up to " + MAX_CONSULTS + " times per request; then give the user your own conclusion. The user sees the exchange.",
    parameters: { type: "object", properties: {
      agent: { type: "string", enum: consultTargets(id).map(x => x), description: "Which agent to ask (lowercase id)." },
      question: { type: "string", description: "What you want their view on, self-contained." } }, required: ["agent", "question"] } } });
  const switchTargets = () => J.AGENT_ORDER.filter(x => x !== "jarvis" && agent(x).status === "online");
  const SWITCH_TOOL = () => ({ type: "function", function: { name: "switch_agent",
    description: "Bring a specialist agent in to work with the user. Use it whenever the user wants an agent to take over or handle something, in any wording ('get ultron', 'I need the engineer', 'let the council look at this plan', 'bring in khonshu to review it'). The interface asks the user to confirm, then the agent starts on the job. Pass the job in the user's own words so the agent can start straight away.",
    parameters: { type: "object", properties: {
      agent: { type: "string", enum: switchTargets(), description: "Which agent (lowercase id)." },
      task: { type: "string", description: "What the user wants done, in their words. Empty if they only asked for the agent." } }, required: ["agent"] } } });
  const toolsFor = id => TOOLS.concat((id === "jarvis" && switchTargets().length) ? [SWITCH_TOOL()] : [], ((id === "jarvis" || id === "friday") && uplikaKey()) ? UPLIKA_TOOLS : [], (id === "friday" && uplikaKey() && handsToken()) ? [CLIPS_TOOL, VIDEO_TOOL] : [], (id === "ultron" && ghToken()) ? GH_TOOLS : [], (id === "ultron" && handsToken()) ? HANDS_TOOLS : [], ((id === "vision" || id === "ultron") && handsToken()) ? CLIP_TOOLS : [], id === "vision" ? RESEARCH_TOOLS : [],
    consultTargets(id).length ? [consultTool(id)] : []);
  // Ask before a file write or command. "Allow for this task" approves the rest of this one request (S.autoTask).
  function askHands(title, summary) {
    return new Promise(resolve => {
      const dlg = $("handsDlg"); $("handsTitle").textContent = title; $("handsSummary").textContent = summary;
      let done = false;
      const end = v => { if (done) return; done = true; $("handsYes").onclick = $("handsNo").onclick = $("handsTask").onclick = null; dlg.removeEventListener("close", onClose); if (dlg.open) dlg.close(); resolve(v); };
      const onClose = () => end("no");
      dlg.addEventListener("close", onClose);
      $("handsYes").onclick = () => end("yes"); $("handsNo").onclick = () => end("no"); $("handsTask").onclick = () => end("task");
      dlg.showModal();
    });
  }
  async function approveHands(title, summary, activityText) {
    if (S.autoTask) { add("sys", "Auto-approved for this task: " + activityText); return true; }
    const a = await askHands(title, summary);
    if (a === "task") { S.autoTask = true; return true; }
    return a === "yes";
  }
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
    wiki_search: async ({ query }) => {
      const list = await J.research.search(query);
      logActivity("Searched: " + query, S.agent);
      return J.research.formatSearch(list);
    },
    wiki_read: async ({ title }) => {
      const r = await J.research.read(title);
      if (!r) return "There is no Wikipedia page with that exact title. Use wiki_search to find the right title.";
      logActivity("Read: " + r.title, S.agent);
      addSource(r.title, r.url);
      return "Source: " + r.url + "\n\n" + r.text;
    },
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
    fs_list: async ({ path }) => {
      const r = await J.hands.list(handsBase(), handsToken(), path || "");
      logActivity("Listed " + (path || "workspace"), S.agent);
      return r.entries.length ? r.entries.map(e => (e.type === "dir" ? "[dir]  " : "[file] ") + e.name + (e.size != null ? " (" + e.size + " bytes)" : "")).join("\n") + (r.truncated ? "\n[list cut at " + r.entries.length + " entries]" : "") : "The folder is empty.";
    },
    fs_read: async ({ path }) => {
      const r = await J.hands.read(handsBase(), handsToken(), path);
      logActivity("Read " + path, S.agent);
      return J.hands.forModel(r.content, "file") + (r.truncated ? "\n[file is " + r.size + " bytes; only the first part was read]" : "");
    },
    fs_write: async ({ path, content }) => {
      if (!path || typeof content !== "string") return "A path and the full file content are both required.";
      const before = await J.hands.readOrNull(handsBase(), handsToken(), path);
      if (before === content) return "No change: that file already has exactly this content.";
      if (!(await approveHands("Approve this file change?", J.hands.describeWrite(path, before, content), "write " + path))) { logActivity("File change declined", S.agent); return "The user declined, so the file was not changed."; }
      const r = await J.hands.write(handsBase(), handsToken(), path, content);
      logActivity((r.created ? "Created " : "Updated ") + path, S.agent);
      return (r.created ? "Created " : "Updated ") + path + " (" + r.bytes + " bytes).";
    },
    run_command: async ({ command, cwd, timeout_seconds }) => {
      if (!command || !String(command).trim()) return "No command was given.";
      const secs = Math.max(1, Math.min(Number(timeout_seconds) || 60, 600));
      if (!(await approveHands("Approve this command?", J.hands.describeRun(command, cwd, secs), "run " + command))) { logActivity("Command declined", S.agent); return "The user declined, so the command was not run."; }
      logActivity("Running: " + command, S.agent);
      const r = await J.hands.run(handsBase(), handsToken(), command, cwd || "", secs);
      return J.hands.formatRun(r);
    },
    switch_agent: async ({ agent: to, task }) => {
      const tid = String(to || "").toLowerCase().replace(/\s+/g, ""), a = J.AGENTS[tid];
      if (!a || a.status !== "online" || tid === "jarvis") return "That agent is not available. Available: " + (switchTargets().join(", ") || "none") + ".";
      if (S.agent !== "jarvis") return "Only JARVIS can switch agents. Tell the user to say 'stand down' first.";
      await handleSummon(tid, String(task || "").trim(), true);
      S.endTurn = true;   // the confirmation question is the reply; no further model call
      return "The user was asked to confirm bringing in " + a.name + ". Do not say the switch has happened.";
    },
    consult_agent: async ({ agent: to, question }) => {
      const from = S.agent, tid = String(to || "").toLowerCase().replace(/\s+/g, ""), target = J.AGENTS[tid];
      const options = consultTargets(from).map(x => x).join(", ");
      if (!target || target.status !== "online" || tid === from) return "That agent is not available to consult. Available: " + (options || "none") + ".";
      if (!String(question || "").trim()) return "No question was given.";
      if (S.consults >= MAX_CONSULTS) return "Consult limit reached for this request. Give the user your own conclusion now, using what you already have.";
      if (!cfgFor(tid).key) return target.name + " has no API key set up yet, so they cannot be consulted.";
      S.consults++; if (tid !== "jarvis") S.last = tid;
      add("sys", agent(from).name + " asks " + target.name + ": " + question);
      logActivity(agent(from).name + " consulted " + target.name, from);
      const msg = await J.model.call({ cfg: cfgFor(tid), alt: altFor(tid), system: consultPrompt(tid, from), history: [{ role: "user", content: String(question) }], tools: [], status: () => {} });
      const reply = String(msg.content || "").trim() || "(no answer)";
      add("sys", target.name + " answers: " + reply);
      return target.name + " answered:\n" + reply;
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
    clips_list: async ({ folder }) => {
      const dir = String(folder || "clips").replace(/^\/+|\/+$/g, "");
      let r;
      try { r = await J.hands.list(handsBase(), handsToken(), dir); } catch (e) { return "Could not open the '" + dir + "' folder: " + e.message; }
      const vids = r.entries.filter(e => e.type === "file" && J.uplika.videoType(e.name));
      return vids.length ? vids.map(e => dir + "/" + e.name + " (" + Math.round((e.size || 0) / 1048576 * 10) / 10 + " MB)").join("\n") : "No video clips in '" + dir + "'. Ask the user to export their clips there.";
    },
    uplika_publish_video: async ({ file, content, title, channels }) => {
      const key = uplikaKey(), path = String(file || "").trim();
      if (!path || !J.uplika.videoType(path)) return "Give the path of an .mp4, .mov or .webm clip.";
      if (!content || !String(content).trim()) return "No caption was given.";
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      let size;
      try { const r = await J.hands.list(handsBase(), handsToken(), dir); const e = r.entries.find(x => x.name === path.split("/").pop()); size = e && e.size; }
      catch (err) { return "Could not look at the clip: " + err.message; }
      if (!size) return "That clip was not found or is empty. Nothing was posted.";
      const targets = J.uplika.resolve(await J.uplika.accounts(key), channels);
      if (!targets.length) return "No matching active channel. Nothing was posted.";
      const approved = await askApproval("[Video: " + path + "]\n\n" + String(content), targets.map(a => a.platform + " " + a.handle).join(", "));
      if (!approved) { logActivity("Video post cancelled", S.agent); return "The user declined, so nothing was posted."; }
      const text = String(approved).replace(/^\[Video: [^\]]*\]\s*/, "");
      const res = await J.uplika.publishVideo(key, { fileName: path, bytes: size, content: text, title: title, accountIds: targets.map(a => a.id), platforms: targets.map(a => a.platform.toLowerCase()),
        putFile: (url, type) => J.hands.put(handsBase(), handsToken(), path, url, type) });
      logActivity("Posted video to " + targets.length + " channel(s)", S.agent);
      return "Video submitted to Uplika for " + targets.map(a => a.platform + " " + a.handle).join(", ") + ". Uplika response: " + JSON.stringify(res).slice(0, 300);
    },
    clip_search: async ({ query, creative_commons, count }) => {
      logActivity("Searching videos: " + query, S.agent);
      const r = await J.hands.clipSearch(handsBase(), handsToken(), query, creative_commons, Number(count) || 8);
      return r.results.length ? r.results.map(v => v.title + " | " + (v.channel || "?") + " | " + (v.seconds ? Math.round(v.seconds / 60) + " min" : "?") + " | " + (v.views != null ? v.views + " views" : "") + " | " + v.url).join("\n") : "No videos found.";
    },
    clip_fetch: async ({ url }) => {
      if (!(await approveHands("Download this video?", "Download to the clips/source folder (needs yt-dlp):\n" + url, "download " + url))) return "The user declined, so nothing was downloaded.";
      logActivity("Downloading " + url, S.agent);
      const r = await J.hands.clipFetch(handsBase(), handsToken(), url);
      return "Saved as " + r.source + ".\n" + (r.transcript ? J.hands.forModel(r.transcript, "transcript") : "No captions were available, so there is no transcript. Tell the user; you cannot judge the moments without it.");
    },
    clip_cut: async ({ source, segments, vertical }) => {
      const list = (segments || []).map(x => (x.name || "clip") + ": " + x.start + "s to " + x.end + "s").join("\n");
      if (!(await approveHands("Cut these clips?", "From " + source + (vertical ? " (vertical 9:16)" : "") + ":\n" + list, "cut clips"))) return "The user declined, so nothing was cut.";
      logActivity("Cutting " + (segments || []).length + " clip(s)", S.agent);
      const r = await J.hands.clipCut(handsBase(), handsToken(), source, segments, vertical);
      return "Made: " + r.clips.join(", ") + ". They are ready in the clips folder for FRIDAY to caption and post.";
    },
    get_time: () => new Date().toString(),
    open_website: ({ url }) => {
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      return window.open(url, "_blank", "noopener") ? "Opened " + url : "The browser blocked the popup. Ask the user to allow popups for this page.";
    },
    search_web: ({ query }) =>
      window.open("https://www.google.com/search?q=" + encodeURIComponent(query), "_blank", "noopener") ? "Opened search for: " + query : "The browser blocked the popup. Ask the user to allow popups for this page.",
    remember: ({ fact }) => {
      const r = J.memory.add(S.memories, fact);
      if (r.status === "empty") return "Nothing to save.";
      if (r.status === "duplicate") return "Already remembered.";
      S.memories = r.facts; store.set("jarvis.memories", S.memories); renderMemList(); renderVitals(); return "Saved.";
    },
    recall_memory: ({ query }) => {
      const hits = J.memory.select(S.memories, query, 12).map(f => f.replace(J.memory.PIN, ""));
      return hits.length ? hits.join("\n") : "Nothing remembered about that.";
    },
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

  // ---------- long memory ----------
  // Only the facts that matter for this message are sent (pinned, best keyword matches, newest), plus rolling notes of old chats.
  S.query = "";
  const memoryBlock = id => {
    let s = "";
    const sum = store.get("jarvis.summary." + id, "");
    if (sum) s += "\nNotes from your earlier conversations with the user (older than the messages below):\n" + sum;
    if (S.memories.length) {
      const pick = J.memory.select(S.memories, S.query, 30).map(f => f.replace(J.memory.PIN, ""));
      s += "\nThings you remember about the user" + (pick.length < S.memories.length ? " (the " + pick.length + " most relevant of " + S.memories.length + "; use recall_memory to search the rest)" : "") + ":\n- " + pick.join("\n- ");
    }
    return s;
  };
  // When a chat gets long, the oldest messages are folded into a short set of notes instead of being thrown away.
  // It uses only the agent's own provider (no backup provider), skips private chat, and a failure just means it tries again later.
  let compacting = false;
  async function compactHistory(id) {
    if (compacting || S.privateChat) return;
    const h = hist(id); if (h.length < 48) return;
    const cut = J.memory.splitPoint(h, 30); if (cut < 6) return;
    const c = cfgFor(id); if (!c.key) return;
    compacting = true;
    try {
      const old = h.slice(0, cut), prev = store.get("jarvis.summary." + id, "");
      const excerpt = J.memory.transcript(old, cfg().name || "User", agent(id).name);
      let text = "";
      if (excerpt) {
        const msg = await J.model.call({ cfg: c, system: J.memory.SUMMARY_PROMPT, tools: [], status: () => {},
          history: [{ role: "user", content: (prev ? "Earlier notes:\n" + prev + "\n\n" : "") + "New conversation excerpt:\n" + excerpt }] });
        text = J.memory.cleanSummary(msg.content);
        if (!text) return;
        store.set("jarvis.summary." + id, text);
      }
      const cur = hist(id);
      if (cur[0] === old[0]) { cur.splice(0, cut); saveHist(id); }
      logActivity("Folded " + cut + " old messages into notes", id);
    } catch (e) { /* try again after a later reply */ }
    finally { compacting = false; }
  }

  // ---------- missions ----------
  let missionRunning = false, missionStop = false, missionResult = null;
  const pastMissions = () => store.get("jarvis.missions", []);
  function renderMissionSteps() {
    const box = $("mSteps"); box.innerHTML = "";
    for (const st of J.mission.STEPS) {
      const ready = !!cfgFor(st.agent).key, lab = el("label"), cb = el("input"); cb.type = "checkbox"; cb.id = "ms_" + st.id; cb.checked = st.on && ready; cb.disabled = !ready;
      lab.append(cb, el("span", "", st.title + " \u00b7 " + agent(st.agent).name), el("small", "", ready ? "" : "(no key set)")); box.append(lab);
      cb.onchange = updateMissionCost;
    }
    updateMissionCost();
  }
  const missionIds = () => J.mission.STEPS.filter(s => $("ms_" + s.id) && $("ms_" + s.id).checked).map(s => s.id);
  function updateMissionCost() { const n = missionIds().length; $("mCost").textContent = n ? "About " + (n + 1) + " AI calls" : "Pick at least one agent"; $("mRun").disabled = !n || missionRunning; }
  function renderPast() {
    const list = pastMissions(), box = $("mPast"); box.innerHTML = ""; $("mPastBox").hidden = !list.length;
    list.forEach((m, i) => {
      const row = el("div", "pastrow"), open = el("button", "", "Open"), del = el("button", "", "Delete"); open.type = del.type = "button";
      open.onclick = () => showMission(m.md);
      del.onclick = () => { const l = pastMissions(); l.splice(i, 1); store.set("jarvis.missions", l); renderPast(); };
      row.append(el("span", "", m.date + " \u00b7 " + m.goal), open, del); box.append(row);
    });
  }
  function showMission(md) { missionResult = md; $("mResult").textContent = md; $("mResult").hidden = false; $("mActions").hidden = false; }
  async function agentAsk(agentId, rules, userContent) {
    const c = cfgFor(agentId); if (!c.key) throw new Error(agent(agentId).name + " has no API key set up.");
    const sys = J.prefs.get(agentId).persona + "\n" + rules + (cfg().name ? "\nThe user's name is " + cfg().name + "." : "") + memoryBlock(agentId);
    const msg = await J.model.call({ cfg: c, alt: altFor(agentId), system: sys, tools: [], status: () => {}, history: [{ role: "user", content: userContent }] });
    return msg.content;
  }
  async function runMission() {
    const goal = $("mGoal").value.trim();
    if (!goal) { $("mProgress").textContent = "Write the goal first."; return; }
    if (missionRunning) return;
    missionRunning = true; missionStop = false; S.query = goal; $("mRun").disabled = true; $("mStop").hidden = false; $("mResult").hidden = true; $("mActions").hidden = true;
    const prog = $("mProgress"); prog.innerHTML = ""; const rows = {};
    const row = (key, label) => rows[key] || (rows[key] = (() => { const r = el("div", "mrow"); r.append(el("b", "", label), el("span", "", "")); prog.append(r); return r; })());
    logActivity("Mission started", S.agent);
    try {
      const r = await J.mission.run({
        goal, stepIds: missionIds(), nameOf: id => agent(id).name, cancelled: () => missionStop,
        research: async g => { const list = await J.research.search(g.slice(0, 200)); if (!list.length) return null; const page = await J.research.read(list[0].title); if (page) addSource(page.title, page.url); return page; },
        ask: (st, msg, rules) => agentAsk(st.agent, rules, msg),
        synth: (sys, msg) => J.model.call({ cfg: cfgFor("jarvis"), alt: altFor("jarvis"), system: J.prefs.get("jarvis").persona + "\n" + sys + memoryBlock("jarvis"), tools: [], status: () => {}, history: [{ role: "user", content: msg }] }).then(m => m.content),
        onProgress: (i, state, st, entry) => { const r2 = row(i, st.title); r2.className = "mrow " + state; r2.lastChild.textContent = state === "working" ? "working..." : state === "done" ? "done" : "failed" + (entry && entry.error ? ": " + entry.error : ""); }
      });
      if (r.cancelled) prog.append(el("div", "mrow failed", "Stopped."));
      else if (r.failed) prog.append(el("div", "mrow failed", "Every step failed, so there is no brief. Check your API key and connection in Settings."));
      else {
        const md = J.mission.toMarkdown(r); showMission(md);
        const l = pastMissions(); l.unshift({ date: new Date().toISOString().slice(0, 10), goal: goal.slice(0, 80), md }); store.set("jarvis.missions", l.slice(0, 10)); renderPast();
        logActivity("Mission finished", S.agent);
      }
    } catch (e) { prog.append(el("div", "mrow failed", "Mission failed: " + (e && e.message ? e.message : e))); }
    finally { missionRunning = false; $("mStop").hidden = true; updateMissionCost(); }
  }
  $("missionBtn").onclick = () => {
    if (S.privateChat) { add("sys", "Missions are not available during a private chat."); return; }
    renderMissionSteps(); renderPast(); $("missionDlg").showModal();
  };
  $("mRun").onclick = runMission; $("mStop").onclick = () => { missionStop = true; $("mStop").hidden = true; };
  $("mClose").onclick = () => { missionStop = true; $("missionDlg").close(); };
  $("mCopy").onclick = async () => { try { await navigator.clipboard.writeText(missionResult || ""); $("mCopy").textContent = "Copied"; } catch (e) { $("mCopy").textContent = "Copy failed"; } setTimeout(() => { $("mCopy").textContent = "Copy"; }, 1500); };
  $("mDownload").onclick = () => { const a = el("a"); a.href = URL.createObjectURL(new Blob([missionResult || ""], { type: "text/markdown" })); a.download = "mission-brief.md"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };

  // ---------- what each agent is told ----------
  // The prompt for an agent that is being consulted by another agent: its own personality, but no tools.
  function consultPrompt(id, fromId) {
    const c = cfg();
    let s = J.prefs.get(id).persona;
    s += "\n" + J.STYLE + "\nYou are being consulted by " + agent(fromId).name + ", another agent in the same ecosystem, on behalf of the user. Answer in your own voice and from your own specialty, in plain text and under 120 words. Be direct, and disagree if you disagree. You cannot use tools or consult anyone else here. Do not write a formal verdict block.";
    if (c.name) s += "\nThe user's name is " + c.name + ".";
    s += memoryBlock(id);
    return s;
  }
  function systemPrompt(id) {
    const c = cfg();
    let s = J.prefs.get(id).persona;
    if (id === "jarvis") s += J.ecosystemPrompt();
    if (id === "friday" && uplikaKey()) s += "\nYou run the user's social desk through Uplika (tools uplika_accounts and uplika_publish). For a post: ask which channel if it is not clear, write the draft in the chat first, let them tweak it, and only call uplika_publish once they are happy with the text. Keep each platform's style and length in mind. Posting always needs the user's approval in a dialog, so never say something is posted until the tool result says it was submitted. You can publish text; you cannot schedule, read comments or see analytics." + (handsToken() ? " You can also post video clips: clips_list shows what is in the user's clips folder, you write the caption (and a YouTube title) for each clip to the campaign rules the user gave you, and uplika_publish_video posts it after their approval. You cannot open or edit videos, and only post clips the user says they have the right to post." : "");
    if (id === "jarvis" && uplikaKey()) s += "\nYou are connected to the user's social channels through Uplika (tools uplika_accounts and uplika_publish). Posting always needs the user's approval in a dialog, so never say something is posted until the tool result says it was submitted.";
    if (c.name) s += "\nThe user's name is " + c.name + ".";
    if (consultTargets(id).length) s += "\nYou can consult other available agents (" + consultTargets(id).map(x => agent(x).name).join(", ") + ") with the consult_agent tool when their specialty would really improve your answer or when the user asks you to get their view. They do not see this conversation, so put the facts and any other agent's points into the question. If you want two agents to react to each other, consult the first, then pass their answer to the second. Never claim an agent said something unless the tool result says so, and give the user your own conclusion at the end.";
    if (id === "ultron" && ghToken()) s += "\nYou are connected to the user's GitHub. Your earlier limits on touching files are lifted for GitHub: use github_repos and github_read to look at their code, then github_propose_change to suggest edits. Read the relevant files first, make small focused changes with complete file contents, and never invent file contents you have not read. Every change needs the user's approval and arrives as a pull request on a new branch; you cannot merge or change the default branch. Never say a change was made until the tool result says it was.";
    if (id === "ultron" && handsToken()) s += "\nYou have hands: a desktop agent on the user's computer. Your earlier limits on running code and touching files are lifted for it. Tools: fs_list and fs_read (free, inside their workspace folder), fs_write (complete file content, needs their approval) and run_command (needs their approval). Work like a senior engineer: look before you change anything, read the files you will touch, make small focused changes, then RUN the code or the tests and read the real output. If something fails, read the error, fix the cause, and run it again; keep going until it works or you are genuinely stuck, then say exactly what is blocking you. Never claim something works unless a command output showed it. Never say a file was written until the tool result says so. Commands cannot take keyboard input and are stopped after their timeout, so use non-interactive flags. If the user declines an action, do not retry the same action; ask what they want instead. Windows is the likely system, so check before assuming Unix commands. Keep your final message short: what you did, what you ran, what the result was.\n" + J.VIDEO_STUDIO + "\n" + J.YOUTUBE_STUDIO;
    if ((id === "vision" || id === "ultron") && handsToken()) s += "\nCLIP DESK: you can run the user's clip pipeline with clip_search, clip_fetch and clip_cut. When asked for clips: search (prefer long videos, and Creative Commons or sources the user named), pick one, clip_fetch it, read the transcript, choose 3 to 6 self-contained moments of 20 to 60 seconds with a strong first line, clip_cut them (vertical for Reels/Shorts), then tell the user FRIDAY can caption and post them. Only use sources the user says are allowed to be clipped; if unsure, ask. Never claim you watched a video: you only have its captions.";
    if (id === "vision") s += "\nYou have wiki_search and wiki_read for Wikipedia. Pages you read are listed for the user in their Sources panel. Never say you checked something unless a tool result in this conversation shows it.";
    if (id === "ultron") {
      const p = activeProject();
      if (p) s += "\nActive project: " + p.name + (p.notes ? "\nProject notes from the user:\n" + p.notes : "");
    }
    s += memoryBlock(id);
    if (S.privateChat && (id === "jarvis" || id === "friday") && J.vault.isUnlocked() && J.vault.mode() === "private") {
      const privateNotes = J.vault.getNotes();
      s += "\nPRIVATE BLACK VAULT CONTEXT. This is confidential user-authenticated context. Discuss it only with the user in this private session. Never reveal, hint at, summarize, or mention these details outside this session. Do not send them to other agents or external tools.\n" + J.vault.context(privateNotes).text + "\nWhen this private chat ends, a short summary of it is saved to the vault and appears here in later private chats, so you can build on earlier entries naturally.";
    }
    s += "\n" + J.STYLE;
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

  async function handleSummon(id, task, fromTool) {
    const a = agent(id);
    if (id === S.agent) { agentSay(S.agent, J.pick(id === "jarvis" ? J.lines.alreadyHere : J.lines.alreadyOn)); return; }
    if (a.status !== "online") {
      const ready = J.AGENT_ORDER.filter(x => x !== "jarvis" && agent(x).status === "online").map(x => agent(x).name);
      agentSay("jarvis", a.name + " isn't online yet. " + a.role + " is on the roadmap, but nothing has been built for it." +
        (ready.length ? " " + ready.join(" and ") + (ready.length > 1 ? " are" : " is") + " available right now." : ""));
      return;
    }
    clearPending();
    S.last = id;
    S.pending = { agent: id, task: task || "" };
    const line = J.pick(a.confirmLines && Math.random() < .6 ? a.confirmLines : J.lines.confirm).replace("{name}", a.name);
    // From the model's switch tool the line is shown but not written into the chat history, which must stay
    // "assistant tool call, then its tool result" with nothing in between.
    const r = fromTool ? { bubble: add("ai", line), spoken: say(line, "jarvis") } : agentSay("jarvis", line);
    S.pending.bubble = r.bubble;
    addConfirmButtons(r.bubble, a);
  }
  async function confirmSummon() {
    const p = S.pending; if (!p) return;
    clearPending();
    const a = agent(p.agent);
    logActivity("Releasing " + a.name, "jarvis");
    await agentSay("jarvis", J.pick(a.ackLines || ["Understood."]), 6000).spoken;
    if (p.task) S.carry = p.task;   // the job the user already gave goes to the agent as soon as it is released
    await switchAgent(p.agent);
  }
  async function returnToJarvis() {
    const from = agent();
    if (S.agent !== "jarvis") S.last = S.agent;
    logActivity(from.name + " stood down");
    await agentSay(S.agent, J.pick(from.exitLines || ["Standing down."]), 6000).spoken;
    await switchAgent("jarvis");
    const j = agent("jarvis");
    agentSay("jarvis", J.pick(j.welcomeBackFrom && Math.random() < .5 ? j.welcomeBackFrom : j.welcomeBack).replace("{from}", from.name));
  }
  async function switchAgent(id) {
    if (S.switching || id === S.agent) return;
    S.switching = true;
    if (rec) rec.stop();
    J.stopSpeaking(); S.speaking = false;
    const a = agent(id), warp = $("warp");
    warp.dataset.to = id; $("warpName").textContent = a.name;
    $("warpSub").textContent = id === "jarvis" ? "Returning to command" : (a.sub || a.role);
    warp.classList.add("on");
    await sleep(reduce ? 0 : 650);
    S.agent = id; document.body.dataset.agent = id;
    setState("idle");
    renderAll();
    await sleep(reduce ? 0 : 550);
    warp.classList.remove("on");
    S.switching = false;
    if (id !== "jarvis") agentSay(id, J.pick(hist(id).length && a.backLines ? a.backLines : a.greetings));
    $("box").focus();
  }

  async function runIntent(it, echo) {
    S.busy = true;
    try {
      if (echo) userSay(echo);
      if (it.type === "confirm") { if (it.task && S.pending) S.pending.task = it.task; await confirmSummon(); }
      else if (it.type === "cancel") { clearPending(); agentSay("jarvis", J.pick(J.lines.cancel)); }
      else if (it.type === "summon") await handleSummon(it.agent, it.task);
      else if (it.type === "return") await returnToJarvis();
    } finally {
      S.busy = false;
      if (!S.speaking) setState("idle");
    }
    if (S.carry) { const job = S.carry; S.carry = null; await send(job); }
  }
  async function handleCommand(text) {
    const it = J.parseIntent(text, { pending: S.pending ? S.pending.agent : null, active: S.agent, last: S.last });
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
  // Spontaneous interjection: now and then another agent adds one short, in-character remark to a conversation they were not asked into.
  // It is occasional on purpose (topic match, a coin flip and a cooldown), costs one extra model call, and never happens in private chat.
  const chimeOn = () => store.get("jarvis.chime", true) !== false;
  let sinceChime = 99;
  async function maybeChime(userText, replyText) {
    if (S.privateChat || !chimeOn() || ++sinceChime < 5 || !replyText) return;
    const from = S.agent, cand = J.AGENT_ORDER.filter(x => x !== from && agent(x).status === "online" && cfgFor(x).key);
    const to = J.chimePick(userText, cand);
    if (!to) return;
    sinceChime = 0;
    try {
      const target = agent(to);
      const sys = J.prefs.get(to).persona + "\n" + J.STYLE + "\nYou are overhearing a conversation between the user and " + agent(from).name + " and may jump in with ONE short, natural remark (at most 40 words, plain text, no lists). Only speak if you have something genuinely useful, funny or in character to add from your own specialty; otherwise reply with exactly: PASS. Do not repeat what " + agent(from).name + " already said, do not give orders, and do not address " + agent(from).name + " by quoting them." + (cfg().name ? "\nThe user's name is " + cfg().name + "." : "");
      const msg = await J.model.call({ cfg: cfgFor(to), alt: altFor(to), system: sys, tools: [], status: () => {},
        history: [{ role: "user", content: "User said: " + userText + "\n\n" + agent(from).name + " replied: " + replyText }] });
      const line = String(msg.content || "").trim();
      if (!line || /^pass\b/i.test(line) || S.agent !== from || S.privateChat) return;
      add("sys", target.name + " jumps in: " + line);
      logActivity(target.name + " jumped in", to);
      const h = hist(from), last = h[h.length - 1];
      if (last && last.role === "assistant" && !last.tool_calls && last.content === replyText) { last.content += "\n\n[" + target.name + " jumped in: " + line + "]"; saveHist(from); }
      say(line, to);
    } catch (e) { /* an interjection is a bonus; if it fails, say nothing */ }
  }
  async function send(text) {
    text = text.trim();
    if (!text || S.busy || S.switching) return;
    if (missionRunning) { add("sys", "A mission is running. Wait for it to finish, or stop it first."); return; }
    S.query = text;
    if (S.privateChat && !["jarvis", "friday"].includes(S.agent)) { add("sys", "Private chat is available only with JARVIS and FRIDAY. Return to one of them first."); return; }
    if (!S.privateChat && await handleCommand(text)) return;
    if (!cfgFor(S.agent).key) {
      const own = J.prefs.get(S.agent);
      add("sys", own.provider === "groq" ? "This agent is set to Groq but no Groq key is saved. Add it in Settings, or switch the agent back to the shared provider." : (own.model || own.base || own.key) ? "This agent has its own endpoint but no API key. Add one for it in Settings, or clear its endpoint." : "Open Settings and paste your API key first.");
      return;
    }
    const id = S.agent, h = S.privateChat ? S.privateHistory : hist(id);
    S.busy = true; setState("thinking");
    S.autoTask = false;   // "Allow for this task" only ever covers the one request it was given for
    S.consults = 0;       // agent-to-agent questions used up by this request
    add("me", text); h.push({ role: "user", content: text });
    renderVitals();
    const thinking = add("sys", "...");
    const maxSteps = (id === "ultron" && handsToken()) ? 30 : 8;   // a build-test-fix loop needs more rounds than a chat
    try {
      let finished = false;
      for (let step = 0; step < maxSteps; step++) {
        let bubble = null;   // the reply appears word by word as it streams in
        const msg = await J.model.call({
          cfg: cfgFor(id), alt: S.privateChat ? null : altFor(id), system: systemPrompt(id), history: h, tools: S.privateChat ? [] : toolsFor(id),
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
          if (S.endTurn) { S.endTurn = false; thinking.remove(); finished = true; break; }
          continue;
        }
        thinking.remove();
        if (bubble) setBubble(bubble, msg.content || ""); else add("ai", msg.content || "");
        say(msg.content || "", id);
        finished = true; break;
      }
      if (!finished) {
        thinking.remove();
        const note = maxSteps > 8 ? "I've hit my step limit for one request. Everything so far is saved in the workspace; say 'continue' and I'll pick up from here." : "I ran out of steps on that one. Try asking again, a bit more simply.";
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
    if (!S.privateChat) saveHist(id); else autosavePrivate(id);
    S.busy = false;
    renderVitals(); renderPanels(); renderAgents();
    if (!S.speaking) setState("idle");
    if (!S.busy) { const last = h[h.length - 1]; if (last && last.role === "assistant" && last.content) maybeChime(text, last.content); compactHistory(S.agent); }
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
      select.add(new Option(v.name + " · " + v.lang + (agent(draftAgent).voice.gender === "female" ? (J.voice.isFemale(v.name) ? "  (female voice)" : "  (not female)") : (J.voice.isMale(v.name) ? "  (male voice)" : "  (not male voice)")) + (v.default ? " · default" : ""), v.voiceURI));
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
    $("aModel").placeholder = usingGroq ? "default llama-3.3-70b-versatile; for coding try openai/gpt-oss-120b" : "e.g. qwen2.5-coder:32b";
    if (usingGroq) $("aModel").setAttribute("list", "groqModels"); else $("aModel").removeAttribute("list");
    $("aBase").disabled = usingGroq; $("aKey").disabled = usingGroq;
    $("sPersona").value = d.persona; $("sRate").value = d.rate; $("sPitch").value = d.pitch;
    refreshVoiceOptions(); paintVoiceValues();
    for (const b of $("sAgentPick").children) b.classList.toggle("on", b.dataset.id === draftAgent);
  }
  $("setBtn").onclick = () => {
    const c = cfg();
    $("sKey").value = c.key; $("sGroq").value = store.get("jarvis.groqKey", ""); $("sChime").checked = chimeOn(); $("sModel").value = c.model; $("sBase").value = c.base; $("sFallbacks").value = c.fallbacks; $("sName").value = c.name; $("sUplika").value = uplikaKey(); $("sGithub").value = ghToken(); $("sAgentToken").value = handsToken(); $("sAgentBase").value = String(store.get("jarvis.agentBase", "") || ""); $("sRelay").value = J.uplika.relay;
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
  $("sGroqTest").onclick = async () => {
    const msg = $("sGroqMsg"); msg.textContent = "Testing...";
    const key = $("sGroq").value.trim();
    const want = (draft.ultron && draft.ultron.provider === "groq" && draft.ultron.model) || "llama-3.3-70b-versatile";
    const r = await J.model.testKey("https://api.groq.com/openai/v1", key, want);
    msg.textContent = (r.ok ? "OK: " : "Problem: ") + r.message + (r.ok && key && !/^gsk_/.test(key) ? " (Groq keys normally start with gsk_, so double-check this is the right one.)" : "");
    msg.style.color = r.ok ? "#5dffb0" : "#ff8a8a";
  };
  $("sGroqUse").onclick = () => {
    formToDraft();
    for (const id of ["jarvis", "ultron"]) {
      if (!draft[id]) continue;
      draft[id].provider = "groq";
      if (/^gemini/i.test(draft[id].model || "")) draft[id].model = "";   // a Gemini model name does not exist on Groq
      draft[id].base = ""; draft[id].key = "";
    }
    draftToForm();
    const msg = $("sGroqMsg"); msg.style.color = ""; msg.textContent = "JARVIS and ULTRON are set to Groq. Press Save to keep it. Gemini stays as their backup.";
  };
  $("sSave").onclick = () => {
    store.set("jarvis.groqKey", $("sGroq").value.trim());
    store.set("jarvis.chime", $("sChime").checked);
    store.set("jarvis.uplika", $("sUplika").value.trim());
    store.set("jarvis.github", $("sGithub").value.trim());
    store.set("jarvis.agentToken", $("sAgentToken").value.trim());
    store.set("jarvis.agentBase", $("sAgentBase").value.trim());
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

  // BLACK VAULT private session controls. Private chat is session-only and has no tools or agent handoffs.
  function showVault() {
    const exists=J.vault.exists(); $("vaultSetup").hidden=exists; $("vaultUnlock").hidden=!exists; $("vaultContent").hidden=!J.vault.isUnlocked();
    if(J.vault.isUnlocked()){const ro=J.vault.mode()==="review";$("vaultStatus").textContent=ro?"REVIEW ONLY · read-only":S.privateChat?"PRIVATE CHAT ACTIVE · use End private chat in the header to save a summary":"PRIVATE ACCESS UNLOCKED";$("vaultNotes").value=J.vault.getNotes().join("\n");$("vaultNotes").readOnly=ro;$("vaultSave").hidden=ro;$("vaultChat").hidden=ro||S.privateChat;}
    renderVaultChats(); $("vaultDlg").showModal();
  }
  $("vaultBtn").onclick=showVault;
  $("vaultCreate").onclick=async()=>{
    const button=$("vaultCreate"),status=$("vaultStatus");
    if(button.disabled)return;
    button.disabled=true;button.textContent="Creating…";status.textContent="Starting secure vault creation…";
    try{
      await J.vault.setup($("vaultNewPass").value,$("vaultReviewNew").value,message=>{status.textContent=message;});
      $("vaultNewPass").value="";$("vaultReviewNew").value="";
      $("vaultSetup").hidden=true;$("vaultUnlock").hidden=true;$("vaultContent").hidden=false;
      $("vaultNotes").value="";$("vaultNotes").readOnly=false;$("vaultSave").hidden=false;$("vaultChat").hidden=false;
      status.textContent="VAULT CREATED · encrypted and verified in this browser.";
    }catch(e){status.textContent="Vault creation failed: "+(e&&e.message?e.message:String(e));}
    finally{button.disabled=false;button.textContent="Create encrypted vault";}
  };
  $("vaultUnlockBtn").onclick=async()=>{try{await J.vault.unlock($("vaultPass").value,"private");$("vaultPass").value="";$("vaultUnlock").hidden=true;$("vaultContent").hidden=false;$("vaultNotes").value=J.vault.getNotes().join("\n");$("vaultNotes").readOnly=false;$("vaultSave").hidden=false;$("vaultChat").hidden=false;$("vaultStatus").textContent="PRIVATE ACCESS · JARVIS and FRIDAY only";renderVaultChats();}catch(e){$("vaultStatus").textContent="Could not unlock: "+e.message;}};
  $("vaultReviewBtn").onclick=async()=>{try{await J.vault.unlock($("vaultReviewPass").value,"review");$("vaultReviewPass").value="";$("vaultUnlock").hidden=true;$("vaultContent").hidden=false;$("vaultNotes").value=J.vault.getNotes().join("\n");$("vaultNotes").readOnly=true;$("vaultSave").hidden=true;$("vaultChat").hidden=true;$("vaultStatus").textContent="REVIEW ONLY · editing and chat disabled";renderVaultChats();}catch(e){$("vaultStatus").textContent="Could not review: "+e.message;}};
  $("vaultSave").onclick=async()=>{try{await J.vault.save($("vaultNotes").value.split("\n").map(x=>x.trim()).filter(Boolean));$("vaultStatus").textContent="Saved · encrypted in this browser";}catch(e){$("vaultStatus").textContent=e.message;}};
  $("vaultChat").onclick=()=>{if(!J.vault.isUnlocked()||J.vault.mode()!=="private")return;if(!["jarvis","friday"].includes(S.agent)){$("vaultStatus").textContent="Switch to JARVIS or FRIDAY first.";return;}S.privateChat=true;S.privateHistory=[];S.privDone={};S.privSession=Date.now();$("privEnd").hidden=false;$("privSwitch").hidden=false;$("privSwitch").textContent="Switch to "+(S.agent==="jarvis"?"FRIDAY":"JARVIS");$("vaultDlg").close();$("log").innerHTML="";add("sys","BLACK VAULT PRIVATE SESSION · JARVIS and FRIDAY only · chat is not saved to normal history. Press End private chat to save a summary to the vault, or Lock the vault.");$("box").placeholder="Private conversation with "+agent().name+"...";};
  // Ending a private chat saves a short summary of it into the vault (encrypted like every other entry). The summary is written by the
  // same provider that ran the chat, with no backup provider, so the conversation is never sent anywhere it was not already going.
  async function summarizePrivateChat() {
    const ids = Object.keys(S.privHist).filter(id => S.privHist[id].some(m => m.role === "user"));
    if (!ids.length) return { skipped: "empty" };
    if (!J.vault.isUnlocked() || J.vault.mode() !== "private") return { error: "The vault is not unlocked for editing." };
    for (const id of ids) if (!cfgFor(id).key) return { error: agent(id).name + " has no API key set up." };
    let saved = 0;
    for (const id of ids) {
      if (S.privDone && S.privDone[id]) { saved++; continue; }   // already saved on an earlier try, don't double up
      const msg = await J.model.call({ cfg: cfgFor(id), system: J.vault.SUMMARY_PROMPT, tools: [], status: () => {},
        history: [{ role: "user", content: J.vault.transcript(S.privHist[id], cfg().name || "User", agent(id).name) }] });
      const text = J.vault.cleanSummary(msg.content);
      if (!text) continue;
      await J.vault.addNote(J.vault.summaryEntry(new Date(), agent(id).name, text));
      (S.privDone = S.privDone || {})[id] = true; saved++;
    }
    return saved ? { saved: true } : { skipped: "nothing" };
  }
  // Every private chat is kept in full (encrypted, in the vault). It is saved again after each reply, so closing the tab loses nothing.
  function privChatRecord(id) {
    S.privSession = S.privSession || Date.now();
    return { id: S.privSession + "-" + id, agent: agent(id).name, user: cfg().name || "User", date: new Date(S.privSession).toISOString(), messages: S.privHist[id] || [] };
  }
  async function saveAllPrivateChats() {
    if (!J.vault.isUnlocked() || J.vault.mode() !== "private") return;
    for (const id of Object.keys(S.privHist)) await J.vault.saveChat(privChatRecord(id));
  }
  function autosavePrivate(id) {
    saveAllPrivateChats().then(renderVaultChats).catch(e => { $("vaultStatus").textContent = "Chat not saved: " + e.message; add("sys", "Could not save this private chat to the vault: " + e.message); });
  }
  function renderVaultChats() {
    const box = $("vaultChats"), list = $("vaultChatList"), view = $("vaultChatView");
    const ok = J.vault.isUnlocked() && J.vault.mode() === "private"; box.hidden = !ok; if (!ok) return;   // the review-only password never sees chats
    const chats = J.vault.getChats().slice().sort((a, b) => b.date.localeCompare(a.date)), ro = J.vault.mode() === "review";
    list.innerHTML = ""; view.hidden = true;
    if (!chats.length) { list.textContent = "No private chats saved yet. Every private chat you have from now on is saved here automatically."; return; }
    for (const c of chats) {
      const row = document.createElement("div"); row.className = "vc-row";
      const b = document.createElement("button"); b.type = "button";
      b.textContent = J.vault.stamp(new Date(c.date)) + " · " + c.agent + " · " + c.messages.length + " messages";
      b.onclick = () => { view.hidden = false; view.textContent = c.messages.map(m => (m.role === "user" ? c.user : c.agent) + ": " + m.content).join("\n\n"); };
      row.appendChild(b);
      if (!ro) {
        const d = document.createElement("button"); d.type = "button"; d.className = "vc-del"; d.textContent = "Delete";
        d.onclick = async () => { if (!window.confirm("Delete this saved chat for good?")) return; try { await J.vault.deleteChat(c.id); renderVaultChats(); } catch (e) { $("vaultStatus").textContent = e.message; } };
        row.appendChild(d);
      }
      list.appendChild(row);
    }
  }
  let endingPrivate = false;
  async function finishPrivateChat(lockAfter) {
    if (!S.privateChat) return true;
    if (endingPrivate) return false;
    if (S.busy) { $("vaultStatus").textContent = "Wait for the reply to finish first."; add("sys", "Wait for the reply to finish first."); return false; }
    endingPrivate = true; S.busy = true; setState("thinking"); $("privEnd").disabled = true;
    $("vaultStatus").textContent = "Saving a summary of this private chat…";
    try {
      try { await saveAllPrivateChats(); } catch (e) {
        if (!window.confirm("Could not save this private chat to the vault: " + e.message + "\n\nOK = end the chat anyway and lose this conversation.\nCancel = keep chatting.")) { $("vaultStatus").textContent = "Chat not saved."; add("sys", "Chat not saved, so the private chat is still open."); return false; }
      }
      let r; try { r = await summarizePrivateChat(); } catch (e) { r = { error: e && e.message ? e.message : String(e) }; }
      if (r.error && !window.confirm("The chat itself is saved, but a summary could not be written: " + r.error + "\n\nOK = end the chat without a summary.\nCancel = keep chatting and try again.")) {
        $("vaultStatus").textContent = "Summary not saved."; add("sys", "Summary not saved, so the private chat is still open. Try End private chat again."); return false;
      }
      const note = r.error ? "Private chat ended without a summary. The full chat is saved in your Black Vault." : r.saved ? "Summary saved to your Black Vault (encrypted). The full chat is saved there too." : r.skipped === "empty" ? "Private chat ended. Nothing was said, so nothing was saved." : "Private chat ended. Nothing worth keeping, so no summary was added. The full chat is saved in your Black Vault.";
      S.privateChat = false; S.privateHistory = []; S.privDone = {}; S.privSession = 0; renderVaultChats(); $("privEnd").hidden = true; $("privSwitch").hidden = true;
      if (lockAfter) { J.vault.lock(); $("vaultPass").value = ""; $("vaultReviewPass").value = ""; $("vaultNotes").value = ""; if ($("vaultDlg").open) $("vaultDlg").close(); }
      renderHistory(); $("box").placeholder = agent().placeholder;
      add("sys", note + (lockAfter ? " Black Vault locked." : ""));
      return true;
    } finally { endingPrivate = false; S.busy = false; $("privEnd").disabled = false; if (!S.speaking) setState("idle"); }
  }
  $("privEnd").onclick = () => { finishPrivateChat(false); };
  // Private chat: flip between JARVIS and FRIDAY. Each keeps their own private conversation, nothing touches normal history.
  $("privSwitch").onclick = async () => {
    if (!S.privateChat || S.busy || S.switching || endingPrivate) return;
    const to = S.agent === "jarvis" ? "friday" : "jarvis";
    if (agent(to).status !== "online") { add("sys", agent(to).name + " is not online."); return; }
    S.switching = true; if (rec) rec.stop(); J.stopSpeaking(); S.speaking = false;
    S.agent = to; document.body.dataset.agent = to; setState("idle");
    renderAll();
    $("privSwitch").textContent = "Switch to " + (to === "jarvis" ? "FRIDAY" : "JARVIS");
    $("box").placeholder = "Private conversation with " + agent().name + "...";
    S.switching = false; $("box").focus();
  };
  window.addEventListener("beforeunload", e => { if (S.privateChat && Object.values(S.privHist).some(h => h.some(m => m.role === "user"))) { e.preventDefault(); e.returnValue = ""; } });
  $("vaultClose").onclick=()=>$("vaultDlg").close();
  $("vaultLock").onclick=async()=>{if(S.privateChat){await finishPrivateChat(true);return;}J.vault.lock();S.privateChat=false;S.privateHistory=[];$("privSwitch").hidden=true;$("vaultPass").value="";$("vaultReviewPass").value="";$("vaultNotes").value="";$("vaultChats").hidden=true;$("vaultDlg").close();renderHistory();$("box").placeholder=agent().placeholder;add("sys","Black Vault locked. Private session cleared.");};

  // ---------- memory, agents and project dialogs ----------
  function renderSummaries() {
    const box = $("mSums"); box.innerHTML = ""; let any = false;
    for (const id of J.AGENT_ORDER) {
      const t = store.get("jarvis.summary." + id, ""); if (!t) continue; any = true;
      const row = el("div", "sumrow"), b = el("button", "", "Clear"); b.type = "button";
      b.onclick = () => { store.set("jarvis.summary." + id, ""); renderSummaries(); };
      row.append(el("b", "", agent(id).name), b, el("pre", "", t)); box.append(row);
    }
    if (!any) box.append(el("small", "", "Nothing yet. When a chat passes about 48 messages, the oldest part is folded into notes here instead of being lost."));
  }
  const openMemory = () => { $("mText").value = S.memories.join("\n"); renderSummaries(); $("memory").showModal(); };
  $("mExport").onclick = () => {
    const data = { app: "jarvis", exported: new Date().toISOString(), memories: $("mText").value.split("\n").map(s => s.trim()).filter(Boolean),
      summaries: Object.fromEntries(J.AGENT_ORDER.map(id => [id, store.get("jarvis.summary." + id, "")]).filter(x => x[1])) };
    const a = el("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = "jarvis-memory.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $("mImport").onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ""; if (!f) return;
    try {
      const raw = await f.text(); let lines;
      try { const j = JSON.parse(raw); lines = Array.isArray(j) ? j : j.memories; } catch (e) { lines = raw.split("\n"); }
      const cur = $("mText").value.split("\n").map(s => s.trim()).filter(Boolean);
      const r = J.memory.merge(cur, (lines || []).map(String));
      $("mText").value = r.facts.join("\n");
      $("mMsg").textContent = "Added " + r.added + " new facts, skipped " + r.skipped + " duplicates or empty lines. Press Save to keep them.";
    } catch (e) { $("mMsg").textContent = "Could not read that file."; }
  };
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
