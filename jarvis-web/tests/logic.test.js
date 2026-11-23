// Checks for the parts of Jarvis that are plain logic (no browser needed).
// Run with:  node jarvis-web/tests/logic.test.js
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const js = f => path.join(__dirname, "..", "js", f);

require(js("util.js")); require(js("agents.js")); require(js("intent.js")); require(js("council.js")); require(js("uplika.js")); require(js("github.js")); require(js("hands.js")); require(js("research.js")); require(js("cores.js")); require(js("vault.js")); require(js("voice.js")); require(js("model.js"));
const J = globalThis.J;

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; } catch (e) { console.error("FAIL: " + name + "\n  " + e.message); process.exitCode = 1; } };
const testAsync = async (name, fn) => { try { await fn(); passed++; } catch (e) { console.error("FAIL: " + name + "\n  " + e.message); process.exitCode = 1; } };

// ---------- voices ----------
test("female voices are never treated as male", () => {
  for (const n of ["Google UK English Female", "Microsoft Libby Online (Natural) - English (United Kingdom)",
    "Microsoft Sonia Online (Natural) - English (United Kingdom)", "Microsoft Hazel - English (United Kingdom)", "Microsoft Zira - English (United States)"])
    assert.equal(J.voice.isMale(n), false, n);
});
test("male voices are recognised", () => {
  for (const n of ["Google UK English Male", "Microsoft Ryan Online (Natural) - English (United Kingdom)", "Daniel (English (United Kingdom))",
    "Microsoft Guy Online (Natural) - English (United States)", "Microsoft Prabhat Online (Natural) - English (India)"])
    assert.equal(J.voice.isMale(n), true, n);
});
const VOICES = [
  { name: "Google UK English Female", lang: "en-GB", voiceURI: "gf" },
  { name: "Google UK English Male", lang: "en-GB", voiceURI: "gm" },
  { name: "Microsoft Libby Online (Natural) - English (United Kingdom)", lang: "en-GB", voiceURI: "libby" },
  { name: "Microsoft Ryan Online (Natural) - English (United Kingdom)", lang: "en-GB", voiceURI: "ryan" },
  { name: "Microsoft Guy Online (Natural) - English (United States)", lang: "en-US", voiceURI: "guy" },
  { name: "Microsoft Zira - English (United States)", lang: "en-US", voiceURI: "zira" },
  { name: "Microsoft Hemant - Hindi (India)", lang: "hi-IN", voiceURI: "hemant" }
];
test("JARVIS gets a British male voice, ULTRON a different, US male voice", () => {
  assert.equal(J.voice.pickVoice(VOICES, "", J.AGENTS.jarvis.voice).voiceURI, "ryan");
  assert.equal(J.voice.pickVoice(VOICES, "", J.AGENTS.ultron.voice).voiceURI, "guy");
});
test("with only a female voice installed, something is still picked", () => {
  assert.equal(J.voice.pickVoice([VOICES[0]], "", J.AGENTS.jarvis.voice).voiceURI, "gf");
});
test("an explicit choice always wins", () => {
  assert.equal(J.voice.pickVoice(VOICES, "libby", J.AGENTS.jarvis.voice).voiceURI, "libby");
});
test("no voices installed gives null, not a crash", () => assert.equal(J.voice.pickVoice([], "", J.AGENTS.jarvis.voice), null));

// ---------- commands ----------
const parse = (t, ctx) => J.parseIntent(t, Object.assign({ pending: null, active: "jarvis" }, ctx));
test("summon phrases", () => {
  for (const t of ["Unleash ULTRON.", "unleash ultron", "Release Ultron!", "switch to ultron", "I want to talk to Ultron", "Hey Jarvis, can you summon Ultron please",
    "bring ultron online", "ultron", "Wake up Ultron", "Open Ultron", "let me talk to ultron", "Activate ULTRON now"])
    assert.deepEqual(parse(t), { type: "summon", agent: "ultron" }, t);
  assert.deepEqual(parse("unleash dare devil"), { type: "summon", agent: "khonshu" });
  assert.deepEqual(parse("Switch to FRIDAY"), { type: "summon", agent: "friday" });
});
test("ordinary sentences are NOT hijacked", () => {
  for (const t of ["tell me about unleashing ultron in the movie", "open ultron's wiki page", "what time is it", "start a timer for 5 minutes",
    "open youtube", "who is vision in the avengers", "yes", "stand down", "I need to talk to my friend", "launch a website for my shop"])
    assert.equal(parse(t), null, t);
});
test("confirmation flow", () => {
  const p = { pending: "ultron" };
  for (const t of ["yes", "Yes, boss", "yeah", "confirm", "do it", "go ahead", "I am sure", "Unleash ULTRON"]) assert.deepEqual(parse(t, p), { type: "confirm" }, t);
  for (const t of ["no", "Nope", "cancel", "stand down", "never mind", "not yet"]) assert.deepEqual(parse(t, p), { type: "cancel" }, t);
  assert.deepEqual(parse("what's the weather like", p), { type: "cancel", passthrough: true });
  assert.deepEqual(parse("summon friday", p), { type: "summon", agent: "friday" });
});
test("yes/no mean nothing when nothing is waiting", () => { assert.equal(parse("yes"), null); assert.equal(parse("no"), null); });
test("stand down only works inside another agent", () => {
  for (const t of ["stand down", "Stand down.", "return to jarvis", "go back", "back to Jarvis", "ok stand down please", "bring back jarvis"])
    assert.deepEqual(parse(t, { active: "ultron" }), { type: "return" }, t);
  assert.equal(parse("write me a function", { active: "ultron" }), null);
  assert.equal(parse("unleash friday", { active: "ultron" }), null);
});


// ---------- KHONSHU ----------
test("the council can be convened by name or by 'council'", () => {
  for (const t of ["Convene the council", "unleash khonshu", "summon the council please", "switch to KHONSHU", "council"])
    assert.deepEqual(parse(t), { type: "summon", agent: "khonshu" }, t);
  assert.deepEqual(parse("unleash dare devil"), { type: "summon", agent: "khonshu" });
  assert.equal(J.AGENTS.khonshu.status, "online");
  assert.equal(parse("what does the council of elrond decide"), null);
});
const SAMPLE = `You want to run a free multi-agent product on one laptop.
STEVEN (CFO): Free is not zero cost. Your time is the real bill.
MARC: A 72B model will not fit in 24 GB of VRAM.
**JAKE (Realist):** Nobody pays for a clone of tools they get free.
VERDICT: CONDITIONAL
CONDITIONS:
- Run the 32B model for a week and measure tokens per second
- Get 3 real users before a 4th agent
RISKS:
- [HIGH] Scope creep across five agents | ship two agents first
- [MED] Free-tier limits change | keep a local fallback
- [LOW] Naming trademark issues
NEXT: Measure the 32B model on the new laptop before buying more hardware.`;
test("verdict is parsed into conditions, risks and the next test", () => {
  const v = J.council.parseVerdict(SAMPLE);
  assert.equal(v.verdict, "CONDITIONAL");
  assert.equal(v.conditions.length, 2);
  assert.deepEqual(v.risks.map(r => r.level), ["HIGH", "MED", "LOW"]);
  assert.equal(v.risks[0].fix, "ship two agents first");
  assert.equal(v.risks[2].fix, "");
  assert.ok(v.next.startsWith("Measure the 32B"));
});
test("verdict tolerates markdown bold and each outcome", () => {
  for (const o of ["APPROVED", "CONDITIONAL", "REJECTED"])
    assert.equal(J.council.parseVerdict("**VERDICT:** " + o + "\nNEXT: x").verdict, o);
  assert.equal(J.council.parseVerdict("verdict: rejected").verdict, "REJECTED");
});
test("replies that do not follow the format parse to nothing, never a guess", () => {
  assert.equal(J.council.parseVerdict("Looks fine to me."), null);
  assert.equal(J.council.parseVerdict("VERDICT: maybe"), null);
  assert.equal(J.council.parseVerdict(""), null);
  assert.deepEqual(J.council.parseAlters("no lenses here"), {});
});
test("each lens's opening line is found, with or without a role in brackets", () => {
  const a = J.council.parseAlters(SAMPLE);
  assert.ok(a.steven.startsWith("Free is not zero cost"));
  assert.ok(a.marc.startsWith("A 72B model"));
  assert.ok(a.jake.startsWith("Nobody pays"));
});
test("latest() uses the newest verdict and counts them all", () => {
  const m = [{ role: "assistant", content: "VERDICT: REJECTED" }, { role: "user", content: "again" }, { role: "assistant", content: "x\n" + SAMPLE }];
  const L = J.council.latest(m);
  assert.equal(L.verdict.verdict, "CONDITIONAL"); assert.equal(L.count, 2); assert.ok(L.alters.marc);
});

// ---------- per-agent settings ----------
const mem = {}; globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
test("agent defaults come from the registry; only real changes are stored", () => {
  const d = J.prefs.get("ultron");
  assert.equal(d.persona, J.AGENTS.ultron.persona); assert.equal(d.model, ""); assert.equal(d.voice.pitch, J.AGENTS.ultron.voice.pitch);
  J.prefs.save("ultron", { persona: J.AGENTS.ultron.persona, voice: { voiceURI: "", rate: 0.9, pitch: 0.68 } });
  assert.deepEqual(Object.keys(JSON.parse(mem["jarvis.agentprefs"]).ultron), ["voice"]);
});
test("a per-agent model, endpoint and key are saved and read back; blanks are not stored", () => {
  J.prefs.save("khonshu", { persona: "", model: " qwen2.5-coder:32b ", base: "http://localhost:11434/v1", key: "", voice: { voiceURI: "", rate: 1, pitch: 1 } });
  const p = J.prefs.get("khonshu");
  assert.equal(p.model, "qwen2.5-coder:32b"); assert.equal(p.base, "http://localhost:11434/v1"); assert.equal(p.key, "");
  assert.equal("key" in JSON.parse(mem["jarvis.agentprefs"]).khonshu, false);
  assert.equal(J.prefs.get("jarvis").model, "");
});
test("ULTRON and KHONSHU prefer different voices when both exist", () => {
  const vs = [
    { name: "Microsoft Guy Online (Natural) - English (United States)", lang: "en-US", voiceURI: "guy" },
    { name: "Microsoft Davis Online (Natural) - English (United States)", lang: "en-US", voiceURI: "davis" }
  ];
  assert.equal(J.voice.pickVoice(vs, "", J.AGENTS.ultron.voice).voiceURI, "guy");
  assert.equal(J.voice.pickVoice(vs, "", J.AGENTS.khonshu.voice).voiceURI, "davis");
});

// ---------- code blocks ----------
test("code blocks are extracted, newest first, unfinished ones ignored", () => {
  const msgs = [
    { role: "user", content: "x" },
    { role: "assistant", content: "a\n```js\nconst a = 1;\n```\nand\n```python\nprint(2)\n```" },
    { role: "assistant", content: "b\n```\nplain\n```" },
    { role: "assistant", content: "c\n```js\nunfinished" }
  ];
  const out = J.extractCodeBlocks(msgs);
  assert.deepEqual(out.map(b => [b.lang, b.code]), [["", "plain"], ["python", "print(2)"], ["js", "const a = 1;"]]);
});

// ---------- history window ----------
test("history window never starts with a tool call", () => {
  const h = [{ role: "assistant", content: null, tool_calls: [{}] }, { role: "tool", content: "x" }, { role: "user", content: "hi" }, { role: "assistant", content: "yo" }];
  assert.deepEqual(J.model.recentHistory(h, 3).map(m => m.role), ["user", "assistant"]);
});

// ---------- streamed tool calls ----------
function fakeStream(events) {
  const enc = new TextEncoder();
  const text = events.map(e => "data: " + (typeof e === "string" ? e : JSON.stringify(e)) + "\n\n").join("");
  let sent = false;
  return { body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: enc.encode(text) }) }) } };
}
const chunk = delta => ({ choices: [{ delta }] });


// ---------- KHONSHU (renamed from DAREDEVIL) ----------
test("KHONSHU is summoned by name, by how speech recognition spells it, and by his old name", () => {
  for (const t of ["unleash khonshu", "Unleash Konshu", "summon khonsu", "khonshu", "switch to Khonshu please", "unleash daredevil", "convene the council"])
    assert.deepEqual(parse(t), { type: "summon", agent: "khonshu" }, t);
  assert.equal(J.AGENTS.khonshu.name, "KHONSHU");
  assert.equal(J.AGENTS.daredevil, undefined);
  assert.ok(J.AGENT_ORDER.includes("khonshu") && !J.AGENT_ORDER.includes("daredevil"));
});
test("KHONSHU's personality is conversational, and still ends a ruling in the format the panels read", () => {
  const p = J.AGENTS.khonshu.persona;
  assert.match(p, /VERDICT: APPROVED or CONDITIONAL or REJECTED/);
  assert.match(p, /never restate|Never restate/i);
  assert.doesNotMatch(p, /Round one|Rebuttal: one short exchange/);
  const ruling = "Fair enough, I would back it with one condition.\nVERDICT: CONDITIONAL\nCONDITIONS:\n- Test with 5 users first\nRISKS:\n- [HIGH] One laptop | back it up\nNEXT: Ask 5 people to try it.";
  assert.equal(J.council.parseVerdict(ruling).verdict, "CONDITIONAL");
  assert.equal(J.council.latest([{ role: "assistant", content: ruling }]).count, 1);
});
test("lens lines written as natural dialogue are still picked up for the council panel", () => {
  const a = J.council.parseAlters("Not yet.\nMarc, flatly: your whole plan runs on one laptop.\nJake cuts in: nobody has asked for this yet.\nSteven: it costs more than you think.");
  assert.match(a.marc, /one laptop/); assert.match(a.jake, /nobody has asked/); assert.match(a.steven, /costs more/);
  assert.deepEqual(J.council.parseAlters("Marc said it was fine, and Jake agreed."), {});
});
test("a verdict block is not read aloud as labels and symbols, and code is skipped", () => {
  const spoken = J.speakable("I would do it, with one condition attached.\nVERDICT: CONDITIONAL\nCONDITIONS:\n- Test first\nRISKS:\n- [HIGH] laptop | backup\nNEXT: ask five people");
  assert.match(spoken, /full verdict is on screen/);
  assert.doesNotMatch(spoken, /CONDITIONS|RISKS|\[HIGH\]|\|/);
  assert.match(J.speakable("VERDICT: REJECTED\nNEXT: stop"), /verdict is rejected/);
  assert.equal(J.speakable("Plain **bold** answer."), "Plain bold answer.");
  assert.match(J.speakable("Try this:\n```js\nconsole.log(1)\n```\nDone."), /code block/);
});

// ---------- ULTRON's hands ----------
test("approval text shows what a file write will change", () => {
  assert.match(J.hands.describeWrite("a.py", null, "x = 1\ny = 2"), /^NEW FILE {2}a\.py\n2 lines/);
  const edit = J.hands.describeWrite("a.py", "x = 1\ny = 2\nz = 3", "x = 1\ny = 20\nz = 3");
  assert.match(edit, /^EDIT {2}a\.py\n1 line\(s\) removed, 1 added, starting at line 2/);
  assert.match(edit, /- y = 2\n\+ y = 20/);
  assert.match(J.hands.describeWrite("a.py", "same", "same"), /NO CHANGE/);
  const lines100 = Array.from({ length: 100 }, (_, i) => "l" + i).join("\n");
  assert.match(J.hands.describeWrite("a.py", null, lines100), /60 more lines/);                 // a new file
  assert.match(J.hands.describeWrite("a.py", "", lines100), /^EDIT .*\n.*\n\n[^]*61 more changed lines/);   // an existing empty file is an edit
});
test("the command approval box shows the command, folder and timeout", () => {
  const d = J.hands.describeRun("npm test", "app", 90);
  assert.match(d, /npm test/); assert.match(d, /workspace\/app/); assert.match(d, /90 seconds/);
  assert.match(J.hands.describeRun("dir", "", undefined), /the workspace folder/);
});
test("command results tell the model plainly whether it worked", () => {
  assert.match(J.hands.formatRun({ exit_code: 0, seconds: 1.2, output: "ok" }), /success\)\.\nok/);
  assert.match(J.hands.formatRun({ exit_code: 2, seconds: 0.5, output: "Error: x" }), /failed\)\.\nError: x/);
  assert.match(J.hands.formatRun({ exit_code: null, timed_out: true, seconds: 60, output: "" }), /timed out after 60s/);
  assert.match(J.hands.formatRun({ exit_code: 0, seconds: 0, output: "" }), /\[no output\]/);
});
test("long file text and old tool output are cut so the model's context does not overflow", () => {
  const long = "a".repeat(30000), cut = J.hands.forModel(long, "file");
  assert.ok(cut.length < 24200); assert.match(cut, /file cut: showing the first 24000 of 30000/);
  assert.equal(J.hands.forModel("short"), "short");
  const msgs = [{ role: "user", content: "go" }];
  for (let i = 0; i < 10; i++) { msgs.push({ role: "assistant", content: null, tool_calls: [{ id: "c" + i }] }); msgs.push({ role: "tool", tool_call_id: "c" + i, content: "x".repeat(5000) }); }
  const out = J.model.compactToolResults(msgs, 6, 2000), tools = out.filter(m => m.role === "tool");
  assert.equal(tools.length, 10);
  assert.ok(tools.slice(0, 4).every(m => m.content.length < 2200 && /shortened/.test(m.content)));
  assert.ok(tools.slice(4).every(m => m.content.length === 5000));
  assert.equal(msgs[2].content.length, 5000, "the original history is not changed");
});
test("a long run of tool calls never produces an empty transcript or loses the task", () => {
  const h = [{ role: "user", content: "old question" }, { role: "assistant", content: "old answer" }, { role: "user", content: "build it" }];
  for (let i = 0; i < 25; i++) { h.push({ role: "assistant", content: null, tool_calls: [{ id: "c" + i }] }); h.push({ role: "tool", tool_call_id: "c" + i, content: "r" + i }); }
  const r = J.model.recentHistory(h, 30);
  assert.ok(r.length > 0);
  assert.equal(r[0].role, "user"); assert.equal(r[0].content, "build it");
  assert.equal(J.model.recentHistory([{ role: "assistant", content: "hi" }], 30).length, 1);
});


// ---------- understanding how people actually ask ----------
test("more ways of asking for an agent are understood, including a job to carry over", () => {
  const c = { pending: null, active: "jarvis" };
  for (const t of ["get ultron", "Grab Ultron please", "hey ultron", "get me ultron", "i need ultron", "pull up ultron", "yo khonshu", "can you get khonshu"])
    assert.equal(J.parseIntent(t, c).type, "summon", t);
  assert.equal(J.parseIntent("get ultron", c).task, undefined);
  const withTask = J.parseIntent("Get Ultron to fix the login bug!", c);
  assert.equal(withTask.agent, "ultron"); assert.equal(withTask.task, "Get Ultron to fix the login bug!");
  assert.equal(J.parseIntent("bring in the council for this plan", c).agent, "khonshu");
  assert.equal(J.parseIntent("pull up ultron and have him check app.js", c).task, "pull up ultron and have him check app.js");
});
test("sentences that only mention an agent are still just chat", () => {
  const c = { pending: null, active: "jarvis" };
  for (const t of ["call ultron a villain", "tell me about unleashing ultron in the film", "get ultron out of the way", "who is vision in marvel", "ultron was voiced by james spader"])
    assert.equal(J.parseIntent(t, c), null, t);
});
test("a task given with the summon survives the confirmation question", () => {
  const c = { pending: "ultron", active: "jarvis" };
  assert.equal(J.parseIntent("yes", c).type, "confirm");
  const again = J.parseIntent("get ultron to fix the login bug", c);                  // same agent, now with a job: confirm and carry it
  assert.equal(again.type, "confirm"); assert.equal(again.task, "get ultron to fix the login bug");
  const other = J.parseIntent("get khonshu to review my plan", c);                     // a different agent: ask about that one instead
  assert.equal(other.type, "summon"); assert.equal(other.agent, "khonshu"); assert.equal(other.task, "get khonshu to review my plan");
});

// ---------- every agent talks like a person ----------
test("every agent gets the same short speaking guide, and scripted lines come in several versions", () => {
  assert.match(J.STYLE, /typos/); assert.match(J.STYLE, /do not reuse the same opener/); assert.match(J.STYLE, /use your tools/);
  assert.ok(J.STYLE.length < 1800, "sent with every request, so keep it small");
  for (const k of ["confirm", "alreadyHere", "alreadyOn", "cancel"]) assert.ok(J.lines[k].length >= 2, k);
  assert.ok(J.lines.confirm.every(l => l.includes("{name}")));
  for (const id of ["ultron", "khonshu"]) assert.ok(J.AGENTS[id].ackLines.length >= 3, id);
  assert.ok(J.AGENTS.jarvis.welcomeBack.length >= 3);
  assert.doesNotMatch(J.AGENTS.jarvis.persona, /professional, intelligent, composed, articulate/);   // the old stiff butler wording
  assert.match(J.ecosystemPrompt(), /switch_agent/);
});

// ---------- handing work over: "tell him to ...", "have ultron ..." ----------
test("telling an agent to do something hands the job over, and 'him' means the agent talked about last", () => {
  const c = { pending: null, active: "jarvis", last: "ultron" };
  const a = J.parseIntent("tell him to make fridays interface as we planned", c);
  assert.equal(a.type, "summon"); assert.equal(a.agent, "ultron"); assert.equal(a.task, "tell him to make fridays interface as we planned");
  const b = J.parseIntent("tell him he has access to git hud make fridays interface there first its his first task", c);
  assert.equal(b.agent, "ultron"); assert.match(b.task, /first task$/);
  for (const t of ["have ultron fix the bug", "make ultron build it", "ask ultron to build the ui", "tell ultron to build it", "have him fix it", "get him to check app.js"])
    assert.equal(J.parseIntent(t, c).agent, "ultron", t);
  assert.equal(J.parseIntent("tell khonshu to review my plan", c).agent, "khonshu");
});
test("handing over needs a known agent: pronouns with nobody talked about, and plain chat, are left alone", () => {
  const none = { pending: null, active: "jarvis", last: null }, c = { pending: null, active: "jarvis", last: "ultron" };
  assert.equal(J.parseIntent("tell him to make it", none), null);
  assert.equal(J.parseIntent("tell him to make it", { ...none, last: "jarvis" }), null);
  for (const t of ["make it work", "tell him thanks", "have you seen ultron", "ask khonshu what he thinks", "tell me about ultron", "make a plan for friday"])
    assert.equal(J.parseIntent(t, c), null, t);
});
test("while JARVIS waits for confirmation, a hand-over of the same agent confirms it and keeps the job", () => {
  const r = J.parseIntent("tell him to make fridays interface", { pending: "ultron", active: "jarvis", last: "ultron" });
  assert.equal(r.type, "confirm"); assert.equal(r.task, "tell him to make fridays interface");
});
test("JARVIS is told that consulting is for opinions and work needs a switch, and ULTRON knows Jarvis has no framework", () => {
  assert.match(J.ecosystemPrompt(), /consult_agent only for an opinion/); assert.match(J.ecosystemPrompt(), /work needs switch_agent/);
  assert.match(J.AGENTS.ultron.persona, /no build step and no framework/); assert.match(J.AGENTS.ultron.persona, /do not ask which stack/);
});
test("FRIDAY is a full agent: online, she/her, female voice, summoned by name", () => {
  const f = J.AGENTS.friday;
  assert.equal(f.status, "online"); assert.equal(f.voice.gender, "female"); assert.match(f.persona, /she\/her/);
  assert.ok(f.ackLines.length >= 3 && f.greetings.length >= 3 && f.exitLines.length >= 2);
  assert.equal(J.parseIntent("unleash friday", { pending: null, active: "jarvis" }).agent, "friday");
  assert.ok(J.AGENT_ORDER.includes("friday"));
});



test("chimePick: needs a real message, a topic match and the coin flip; picks only agents who fit", () => {
  const all = ["ultron", "khonshu", "friday", "vision"], yes = () => 0.01, no = () => 0.99;
  assert.equal(J.chimePick("my python script crashes with an error on boot", all, yes), "ultron");
  assert.equal(J.chimePick("my python script crashes with an error on boot", all, no), null, "coin flip says no");
  assert.equal(J.chimePick("fix the bug", all, yes), null, "too short to be worth jumping in");
  assert.equal(J.chimePick("what did you have for lunch today my friend", all, yes), null, "no topic, no interruption");
  assert.equal(J.chimePick("should i launch the business before my exam next week", ["khonshu", "friday"], yes) !== null, true);
  assert.equal(J.chimePick("my python script crashes with an error on boot", ["khonshu", "friday"], yes), null, "ULTRON is not a candidate");
  assert.match(J.STYLE, /someone in the room/);
});

(async () => {
  const r = (status, body) => async () => ({ ok: status < 400, status, json: async () => body || {} });
  await testAsync("testKey explains each way a key can fail, and checks the model", async () => {
    const base = "https://api.groq.com/openai/v1";
    assert.match((await J.model.testKey(base, "")).message, /No key is saved/);
    assert.match((await J.model.testKey(base, "gsk_a b")).message, /space or line break/);
    assert.match((await J.model.testKey(base, "gsk_x", "", r(401))).message, /rejected this key/);
    assert.match((await J.model.testKey(base, "gsk_x", "", async () => { throw new Error("net"); })).message, /Could not reach/);
    const ok = await J.model.testKey(base, "gsk_x", "llama-3.3-70b-versatile", r(200, { data: [{ id: "llama-3.3-70b-versatile" }] }));
    assert.ok(ok.ok); assert.equal(ok.message, "The key works.");
    const gone = await J.model.testKey(base, "gsk_x", "old-model", r(200, { data: [{ id: "a" }, { id: "b" }] }));
    assert.ok(gone.ok && /old-model.*not on your account/.test(gone.message));
    assert.ok((await J.model.testKey(base, "gsk_x", "", r(429))).ok);
  });
})();

test("ULTRON's video studio: uses OpenMontage the safe way", () => {
  const t = J.VIDEO_STUDIO;
  assert.match(t, /github\.com\/OpenMontageInc\/OpenMontage/); assert.match(t, /calesthio/);
  assert.match(t, /AGENT_GUIDE\.md/); assert.match(t, /Never ask the user to paste an API key/);
  assert.match(t, /wait for their yes/); assert.match(t, /does not record gameplay/);
  assert.match(J.AGENTS.ultron.role, /video production/);
  assert.match(t, /NO-GPU MODE/); assert.match(t, /Never run make install-gpu/); assert.match(t, /shots\.md/); assert.match(t, /nothing good is free and unlimited/);
  const y = J.YOUTUBE_STUDIO;
  assert.match(y, /Jakeschincariol\/youtube-agent-skill/); assert.match(y, /never uploads/); assert.match(y, /fs_read the script/);
  assert.match(y, /never invent scores/); assert.match(y, /nothing was posted/);
});
// ---------- VISION ----------
test("VISION is a full agent: online, own core, summoned by name, honest about what he can look up", () => {
  const v = J.AGENTS.vision;
  assert.equal(v.status, "online"); assert.equal(v.core, "eye"); assert.equal(typeof J.cores.eye.draw, "function");
  assert.ok(v.ackLines.length >= 3 && v.greetings.length >= 3 && v.exitLines.length >= 2);
  assert.equal(J.parseIntent("get vision", { pending: null, active: "jarvis" }).agent, "vision");
  assert.match(v.persona, /never invent a source/i); assert.match(v.persona, /cannot browse other sites/i);
  for (const st of ["idle", "listening", "thinking", "speaking"]) assert.ok(v.states[st].c.length === 3);
  assert.match(J.ecosystemPrompt(), /VISION \(Research & intelligence\): available now/);
});
const wikiFetch = body => async () => ({ ok: true, status: 200, json: async () => body });
(async () => {
  await testAsync("research.search cleans snippets and builds links", async () => {
    const r = await J.research.search("vision marvel", wikiFetch({ query: { search: [{ title: "Vision (Marvel Comics)", snippet: 'An <span class="searchmatch">android</span> &quot;hero&quot; &amp; more' }] } }));
    assert.equal(r.length, 1); assert.equal(r[0].snippet, 'An android "hero" & more');
    assert.equal(r[0].url, "https://en.wikipedia.org/wiki/Vision_(Marvel_Comics)");
    assert.match(J.research.formatSearch(r), /1\. Vision \(Marvel Comics\)/);
    assert.match(J.research.formatSearch([]), /No Wikipedia pages matched/);
  });
  await testAsync("research.read returns text and link, clips long pages, and reports a missing page as null", async () => {
    const r = await J.research.read("Paris", wikiFetch({ query: { pages: { 7: { title: "Paris", extract: "x".repeat(9000) } } } }));
    assert.equal(r.title, "Paris"); assert.ok(r.text.length < 6300 && /\[cut:/.test(r.text)); assert.equal(r.url, "https://en.wikipedia.org/wiki/Paris");
    assert.equal(await J.research.read("Nope", wikiFetch({ query: { pages: { "-1": { title: "Nope", missing: "" } } } })), null);
    await assert.rejects(() => J.research.search("  "), /No search query/);
    await assert.rejects(() => J.research.read("Paris", async () => ({ ok: false, status: 503 })), /503/);
  });
})();
// ---------- FRIDAY's personality ----------
test("FRIDAY is a confident secretary with a shy, occasional crush, and the limits are written into her instructions", () => {
  const p = J.AGENTS.friday.persona;
  assert.match(p, /shy, playful crush/); assert.match(p, /not constantly/); assert.match(p, /practically written into your code/);
  assert.match(p, /confident and decisive/); assert.match(p, /The shyness is only about feelings/);
  assert.match(p, /tiny pout/); assert.match(p, /never real/);                 // jealousy is a one-line joke
  assert.match(p, /never guilt-trip/); assert.match(p, /discourage their friends, relationships/);
  assert.match(p, /never claim to be human/); assert.match(p, /never sexual or explicit/);
  assert.match(p, /stop for the rest of the conversation/); assert.match(p, /under 18, drop all flirting/);
  assert.match(p, /Vary your lines/);
  assert.doesNotMatch(p, /non-romantic/);
  assert.doesNotMatch(J.AGENTS.jarvis.persona + J.AGENTS.ultron.persona + J.AGENTS.khonshu.persona, /crush|flirt/i, "only FRIDAY has this side");
  assert.ok(p.length < 3600 && J.AGENTS.friday.greetings.length >= 5);
});

// ---------- private chat summaries (helpers) ----------
test("the private chat is turned into a plain transcript for the summariser, newest part kept if long", () => {
  const h = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }, { role: "assistant", content: null, tool_calls: [{}] }, { role: "tool", content: "x" }, { role: "user", content: "  I got the job  " }];
  assert.equal(J.vault.transcript(h, "Mayank", "FRIDAY"), "Mayank: hi\nFRIDAY: hello\nMayank: I got the job");
  assert.equal(J.vault.transcript([], "A", "B"), "");
  const long = Array.from({ length: 200 }, (_, i) => ({ role: "user", content: "message number " + i })), t = J.vault.transcript(long, "U", "B", 500);
  assert.ok(t.length < 560 && /^\[The earlier part/.test(t) && /message number 199$/.test(t) && !/message number 0\b/.test(t));
});
test("the model's summary becomes one clean vault line, or nothing when there is nothing to keep", () => {
  assert.equal(J.vault.cleanSummary("  - The user talked about exams.\nThey felt nervous.  "), "The user talked about exams. They felt nervous.");
  for (const none of ["NOTHING", "nothing", "Nothing.", "NOTHING worth saving.", "Nothing to save", "", null, undefined]) assert.equal(J.vault.cleanSummary(none), "", String(none));
  assert.equal(J.vault.cleanSummary("Nothing was decided, but the user planned a trip."), "Nothing was decided, but the user planned a trip.", "a real summary that starts with 'Nothing' is kept");
  const big = J.vault.cleanSummary("word ".repeat(400)); assert.ok(big.length <= 900 && big.endsWith("…") && !big.includes("\n"));
  const d = new Date(2026, 10, 23, 9, 5);
  const e = J.vault.summaryEntry(d, "FRIDAY", "The user planned a trip.");
  assert.equal(e, "[2026-11-23 09:05 · FRIDAY private chat] The user planned a trip."); assert.ok(!e.includes("\n"));
});
test("the vault text shown to the private chat agent is capped: newest entries kept, in order, with a note about the rest", () => {
  const notes = Array.from({ length: 50 }, (_, i) => "entry " + i + " " + "x".repeat(100));
  const c = J.vault.context(notes, 1000);
  assert.ok(c.omitted > 30 && c.text.length < 1200 && /^\[The \d+ oldest vault entries are left out/.test(c.text));
  assert.ok(c.text.endsWith("entry 49 " + "x".repeat(100)) && c.text.indexOf("entry 48") < c.text.indexOf("entry 49"));
  const small = J.vault.context(["a", "b"], 1000); assert.equal(small.text, "a\nb"); assert.equal(small.omitted, 0);
  assert.equal(J.vault.context([], 100).text, "");
  assert.ok(J.vault.context(["y".repeat(5000)], 100).text.length <= 102, "one giant entry cannot overflow the cap either");
});
(async () => {
  await testAsync("plain text streams in", async () => {
    const seen = [];
    const msg = await J.model.readStream(fakeStream([chunk({ content: "Hel" }), chunk({ content: "lo" }), "[DONE]"]), t => seen.push(t));
    assert.equal(msg.content, "Hello"); assert.deepEqual(seen, ["Hel", "Hello"]); assert.equal(msg.tool_calls, undefined);
  });
  await testAsync("one tool call split over several chunks", async () => {
    const msg = await J.model.readStream(fakeStream([
      chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "set_timer", arguments: '{"seco' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'nds":60}' } }] })
    ]));
    assert.equal(msg.tool_calls.length, 1);
    assert.deepEqual(JSON.parse(msg.tool_calls[0].function.arguments), { seconds: 60 });
  });
  await testAsync("two parallel calls that both claim index 0 stay separate", async () => {
    const msg = await J.model.readStream(fakeStream([
      chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "set_timer", arguments: '{"seconds":60}' } }] }),
      chunk({ tool_calls: [{ index: 0, id: "b", function: { name: "open_website", arguments: '{"url":"youtube.com"}' } }] })
    ]));
    assert.equal(msg.tool_calls.length, 2);
    assert.deepEqual(msg.tool_calls.map(c => c.function.name), ["set_timer", "open_website"]);
    assert.deepEqual(msg.tool_calls.map(c => JSON.parse(c.function.arguments)), [{ seconds: 60 }, { url: "youtube.com" }]);
  });
  await testAsync("two parallel calls with proper indexes", async () => {
    const msg = await J.model.readStream(fakeStream([
      chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "get_time", arguments: "{}" } }, { index: 1, id: "b", function: { name: "remember", arguments: '{"fact":"x"}' } }] })
    ]));
    assert.deepEqual(msg.tool_calls.map(c => c.id), ["a", "b"]);
  });
  await testAsync("thought signature is kept with the call", async () => {
    const msg = await J.model.readStream(fakeStream([chunk({ tool_calls: [{ index: 0, id: "a", function: { name: "get_time", arguments: "{}" }, extra_content: { google: { thought_signature: "SIG" } } }] })]));
    assert.equal(msg.tool_calls[0].extra_content.google.thought_signature, "SIG");
  });
  await testAsync("an empty reply is flagged so the caller can retry without streaming", async () => {
    await assert.rejects(J.model.readStream(fakeStream(["[DONE]"])), e => e.parse === true);
  });

  // ---- Uplika ----
  const accts = J.uplika.normalizeAccounts({ data: [
    { id: "acc_1", platform: "instagram", handle: "@coreclips", status: "active", health: "ok" },
    { id: "acc_2", platform: "threads", handle: "core", status: "active", health: "expired" },
    { id: "acc_3", platform: "youtube", handle: "ClipCore", status: "active" },
    { platform: "x" }] });
  test("uplika accounts are read from {data:[...]} and junk rows dropped", () => assert.equal(accts.length, 3));
  test("uplika with no channel named uses only healthy active accounts", () => assert.deepEqual(J.uplika.resolve(accts).map(a => a.id), ["acc_1", "acc_3"]));
  test("uplika channels match by platform, handle (with or without @) or id", () => {
    assert.deepEqual(J.uplika.resolve(accts, ["Instagram"]).map(a => a.id), ["acc_1"]);
    assert.deepEqual(J.uplika.resolve(accts, ["@clipcore"]).map(a => a.id), ["acc_3"]);
    assert.deepEqual(J.uplika.resolve(accts, ["acc_3"]).map(a => a.id), ["acc_3"]);
  });
  test("uplika never selects an expired account even if named", () => assert.deepEqual(J.uplika.resolve(accts, ["threads"]), []));
  test("uplika errors are explained", () => {
    assert.match(J.uplika.explain(401, {}), /API key/);
    assert.match(J.uplika.explain(400, { code: "reconsent_required" }), /reconnected/);
    assert.match(J.uplika.explain(429, null), /rate limit/);
  });
  await testAsync("uplika sends the key only to Uplika, as a bearer token", async () => {
    let seen; globalThis.fetch = async (u, o) => { seen = { u, o }; return { ok: true, json: async () => ({ data: [] }) }; };
    await J.uplika.accounts("K123");
    assert.equal(seen.u, "https://api.uplika.com/v1/accounts"); assert.equal(seen.o.headers.authorization, "Bearer K123");
  });
  await testAsync("uplika uses the relay when one is set, adding /v1", async () => {
    let u; globalThis.fetch = async x => { u = x; return { ok: true, json: async () => ({ data: [] }) }; };
    J.uplika.relay = "https://r.example.workers.dev/"; await J.uplika.accounts("K");
    assert.equal(u, "https://r.example.workers.dev/v1/accounts"); J.uplika.relay = "";
  });
  await testAsync("uplika without a key refuses to call", async () => { await assert.rejects(J.uplika.accounts(""), /No Uplika API key/); });
  await testAsync("uplika reports a blocked browser call plainly", async () => {
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await assert.rejects(J.uplika.accounts("K"), /CORS/);
  });

  // ---- GitHub (against a small fake of the API) ----
  function fakeGitHub(opts) {
    opts = opts || {};
    const st = { files: { "main": { "README.md": "# Hi\nold", "src/a.js": "a" } }, branches: ["main"], log: [], prs: [] };
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    globalThis.fetch = async (url, o) => {
      o = o || {}; const m = o.method || "GET", u = new URL(url), b = o.body ? JSON.parse(o.body) : null, path = decodeURIComponent(u.pathname);
      st.log.push(m + " " + path); st.lastAuth = o.headers.authorization;
      let x;
      if (m === "GET" && path === "/repos/me/proj") return reply(200, { default_branch: "main" });
      if (m === "GET" && (x = /^\/repos\/me\/proj\/git\/ref\/heads\/(.+)$/.exec(path))) return st.branches.includes(x[1]) ? reply(200, { object: { sha: "SHA0" } }) : reply(404, { message: "Not Found" });
      if (m === "POST" && path === "/repos/me/proj/git/refs") { const n = b.ref.replace("refs/heads/", ""); if (st.branches.includes(n) || opts.collide && n === "ultron/add-x") { if (opts.collide) st.branches.push("ultron/add-x"); return reply(422, { message: "Reference already exists" }); } st.branches.push(n); st.files[n] = Object.assign({}, st.files.main); return reply(201, {}); }
      if ((x = /^\/repos\/me\/proj\/contents\/(.*)$/.exec(path))) {
        const ref = u.searchParams.get("ref") || "main", set = st.files[ref] || {};
        if (m === "GET") { if (x[1] in set) return reply(200, { type: "file", encoding: "base64", content: J.github.b64enc(set[x[1]]), sha: "S" + x[1], size: set[x[1]].length }); const dir = Object.keys(set).filter(k => k.startsWith(x[1] ? x[1] + "/" : "")); return dir.length && x[1] === "" ? reply(200, Object.keys(set).map(k => ({ name: k, type: "file" }))) : reply(404, { message: "Not Found" }); }
        if (m === "PUT") { st.files[b.branch][x[1]] = J.github.b64dec(b.content); return reply(200, {}); }
      }
      if (m === "POST" && path === "/repos/me/proj/pulls") { st.prs.push(b); return reply(201, { html_url: "https://github.com/me/proj/pull/7" }); }
      return reply(404, { message: "Not Found" });
    };
    return st;
  }
  test("github repo names and URLs parse", () => {
    assert.deepEqual(J.github.parseRepo("me/proj"), { owner: "me", repo: "proj" });
    assert.deepEqual(J.github.parseRepo("https://github.com/me/proj.git"), { owner: "me", repo: "proj" });
    assert.equal(J.github.parseRepo("nonsense"), null);
  });
  test("github paths cannot escape the repo", () => { assert.equal(J.github.safePath("../x"), null); assert.equal(J.github.safePath("a/../../x"), null); assert.equal(J.github.safePath("src/a.js"), "src/a.js"); });
  test("github text survives base64 with non-English characters", () => assert.equal(J.github.b64dec(J.github.b64enc("héllo ✓ 你好")), "héllo ✓ 你好"));
  await testAsync("github plan marks new and edited files and writes nothing", async () => {
    const st = fakeGitHub();
    const p = await J.github.plan("T", { repo: "me/proj", message: "Add x", branch: "add x", files: [{ path: "README.md", content: "# Hi\nnew" }, { path: "src/b.js", content: "b" }, { path: "src/a.js", content: "a" }] });
    assert.deepEqual(p.files.map(f => f.action), ["edit", "new"]);               // the unchanged file is dropped
    assert.equal(p.branch, "ultron/add-x"); assert.equal(p.base, "main");
    assert.ok(st.log.every(l => l.startsWith("GET")), "plan must only read");
    assert.match(J.github.describe(p), /EDIT {2}README.md[\s\S]*NEW {3}src\/b.js/);
  });
  await testAsync("github apply commits to a new branch, opens a PR, never touches main", async () => {
    const st = fakeGitHub();
    const p = await J.github.plan("TOK", { repo: "me/proj", message: "Add x", branch: "add x", files: [{ path: "src/b.js", content: "b" }] });
    const r = await J.github.apply("TOK", p);
    assert.equal(r.url, "https://github.com/me/proj/pull/7"); assert.equal(st.files["ultron/add-x"]["src/b.js"], "b");
    assert.equal(st.files.main["src/b.js"], undefined); assert.equal(st.prs[0].base, "main"); assert.equal(st.prs[0].head, "ultron/add-x");
    assert.equal(st.lastAuth, "Bearer TOK");
  });
  await testAsync("github apply picks a fresh branch name if the name is taken", async () => {
    const st = fakeGitHub({ collide: true });
    const p = await J.github.plan("T", { repo: "me/proj", message: "x", branch: "add x", files: [{ path: "n.txt", content: "1" }] });
    const r = await J.github.apply("T", p);
    assert.notEqual(r.branch, "ultron/add-x"); assert.match(r.branch, /^ultron\/add-x-/);
  });
  await testAsync("github refuses to write to the default branch", async () => {
    fakeGitHub();
    const p = await J.github.plan("T", { repo: "me/proj", message: "x", files: [{ path: "n.txt", content: "1" }] });
    p.branch = p.base;
    await assert.rejects(J.github.apply("T", p), /default branch/);
  });
  await testAsync("github rejects bad paths, empty changes and too many files", async () => {
    fakeGitHub();
    await assert.rejects(J.github.plan("T", { repo: "me/proj", message: "x", files: [{ path: "../etc", content: "1" }] }), /not allowed/);
    await assert.rejects(J.github.plan("T", { repo: "me/proj", message: "x", files: [{ path: "src/a.js", content: "a" }] }), /Nothing would change/);
    await assert.rejects(J.github.plan("T", { repo: "me/proj", message: "x", files: Array.from({ length: 11 }, (_, i) => ({ path: "f" + i, content: "1" })) }), /At most/);
  });
  await testAsync("github reads files and folders, with no token it refuses", async () => {
    fakeGitHub();
    assert.equal((await J.github.read("T", "me/proj", "README.md")).text, "# Hi\nold");
    assert.equal((await J.github.read("T", "me/proj", "")).type, "dir");
    await assert.rejects(J.github.read("", "me/proj", "README.md"), /No GitHub token/);
  });


  // ---------- Black Vault (vault.js) ----------
  const memStore = {}; const fakeLS = { getItem: k => (k in memStore ? memStore[k] : null), setItem: (k, v) => { memStore[k] = String(v); }, removeItem: k => { delete memStore[k]; } };
  const realLS = globalThis.localStorage, realSecure = globalThis.isSecureContext;
  Object.defineProperty(globalThis, "localStorage", { value: fakeLS, configurable: true, writable: true });
  Object.defineProperty(globalThis, "isSecureContext", { value: true, configurable: true, writable: true });
  const VK = "jarvis.blackVault.v1";
  try {
    await testAsync("vault: refuses short or identical passphrases, and does not create anything", async () => {
      await assert.rejects(() => J.vault.setup("abcd", "efghi"), /at least 5/);
      await assert.rejects(() => J.vault.setup("samepass1", "samepass1"), /different/);
      assert.equal(J.vault.exists(), false); assert.equal(memStore[VK], undefined);
    });
    await testAsync("vault: creates, stores only ciphertext, and keeps passphrases out of storage", async () => {
      await J.vault.setup("owner-pass-1", "viewer-pass-2");
      assert.ok(J.vault.exists() && J.vault.isUnlocked() && J.vault.mode() === "private");
      await J.vault.save(["my-secret-plan-XJ42", "second note"]);
      const raw = memStore[VK], rec = JSON.parse(raw);
      assert.ok(!raw.includes("XJ42") && !raw.includes("secret") && !raw.includes("owner-pass-1") && !raw.includes("viewer-pass-2"));
      assert.equal(rec.cipher, "AES-256-GCM"); assert.equal(rec.kdf, "PBKDF2-SHA-256"); assert.ok(rec.iterations >= 300000);
      assert.notEqual(rec.vaultWrap.salt, rec.reviewWrap.salt, "each passphrase has its own salt");
      await assert.rejects(() => J.vault.setup("another-pass-3", "another-pass-4"), /already exists/);
    });
    await testAsync("vault: locking clears memory; wrong passphrase fails; right ones unlock the right way", async () => {
      J.vault.lock(); assert.ok(!J.vault.isUnlocked()); assert.deepEqual(J.vault.getNotes(), []);
      await assert.rejects(() => J.vault.unlock("wrong-pass", "private"));
      assert.ok(!J.vault.isUnlocked(), "a failed unlock leaves it locked");
      await assert.rejects(() => J.vault.unlock("viewer-pass-2", "private"), undefined, "the review passphrase cannot open private access");
      await assert.rejects(() => J.vault.unlock("owner-pass-1", "review"), undefined, "the owner passphrase is not the review one");
      const own = await J.vault.unlock("owner-pass-1", "private");
      assert.equal(own.mode, "private"); assert.deepEqual(own.notes, ["my-secret-plan-XJ42", "second note"]);
      J.vault.lock();
      const rev = await J.vault.unlock("viewer-pass-2", "review");
      assert.equal(rev.mode, "review"); assert.equal(rev.notes.length, 2);
      await assert.rejects(() => J.vault.save(["changed"]), /Unlock with the vault password/);
      J.vault.lock();
      await J.vault.unlock("owner-pass-1", "private");
      assert.deepEqual(J.vault.getNotes(), ["my-secret-plan-XJ42", "second note"], "review mode changed nothing");
    });
    await testAsync("vault: a summary entry is added, survives lock and unlock, and review mode cannot add one", async () => {
      await J.vault.addNote("[2026-11-23 09:05 · FRIDAY private chat] The user planned a trip.");
      assert.equal(J.vault.getNotes().length, 3);
      await assert.rejects(() => J.vault.addNote("   "), /Nothing to add/);
      J.vault.lock(); await J.vault.unlock("owner-pass-1", "private");
      assert.equal(J.vault.getNotes()[2], "[2026-11-23 09:05 · FRIDAY private chat] The user planned a trip.");
      assert.ok(!memStore[VK].includes("planned a trip"), "the summary is stored encrypted too");
      J.vault.lock(); await J.vault.unlock("viewer-pass-2", "review");
      await assert.rejects(() => J.vault.addNote("sneaky"), /Unlock with the vault password/);
      J.vault.lock(); await J.vault.unlock("owner-pass-1", "private");
      assert.equal(J.vault.getNotes().length, 3, "review mode added nothing");
    });
    await testAsync("vault: tampered ciphertext is rejected instead of read", async () => {
      J.vault.lock();
      const rec = JSON.parse(memStore[VK]); const d = Buffer.from(rec.data.data, "base64"); d[0] ^= 1; rec.data.data = d.toString("base64");
      memStore[VK] = JSON.stringify(rec);
      await assert.rejects(() => J.vault.unlock("owner-pass-1", "private"));
      assert.ok(!J.vault.isUnlocked());
    });
    await testAsync("vault: a failed storage write reports clearly and does not pretend it saved", async () => {
      memStore[VK] = undefined; delete memStore[VK]; J.vault.lock();
      const failing = { ...fakeLS, setItem: () => { throw new Error("quota exceeded"); } };
      Object.defineProperty(globalThis, "localStorage", { value: failing, configurable: true, writable: true });
      await assert.rejects(() => J.vault.setup("owner-pass-1", "viewer-pass-2"), /Could not save the encrypted vault/);
      Object.defineProperty(globalThis, "localStorage", { value: fakeLS, configurable: true, writable: true });
      assert.equal(J.vault.exists(), false);
    });
    await testAsync("vault: a failed save (storage full) keeps the existing vault and its notes", async () => {
      await J.vault.setup("owner-pass-1", "viewer-pass-2");
      await J.vault.addNote("Important note from earlier.");
      const before = memStore[VK];
      const failing = { ...fakeLS, setItem: () => { throw new Error("quota exceeded"); } };
      Object.defineProperty(globalThis, "localStorage", { value: failing, configurable: true, writable: true });
      await assert.rejects(() => J.vault.addNote("one more that cannot be saved"), /Could not save/);
      Object.defineProperty(globalThis, "localStorage", { value: fakeLS, configurable: true, writable: true });
      assert.equal(memStore[VK], before, "the stored vault is byte-for-byte unchanged");
      J.vault.lock(); await J.vault.unlock("owner-pass-1", "private");
      assert.ok(J.vault.getNotes().includes("Important note from earlier."));
    });
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: realLS, configurable: true, writable: true });
    Object.defineProperty(globalThis, "isSecureContext", { value: realSecure, configurable: true, writable: true });
    J.vault.lock();
  }

  // ---------- two providers backing each other up ----------
  const goodReply = text => ({ ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: text } }] }) });
  const badReply = (status, msg) => ({ ok: false, status, text: async () => JSON.stringify({ error: { message: msg } }) });
  const PRIMARY = { key: "gk", model: "llama-3.3-70b-versatile", base: "https://api.groq.com/openai/v1", fallbacks: "" };
  const BACKUP = { cfg: { key: "mk", model: "gemini-x", base: "https://generativelanguage.googleapis.com/v1beta/openai", fallbacks: "" }, label: "the shared provider" };
  const base = { system: "s", history: [{ role: "user", content: "hi" }], tools: [] };
  const realSleep = globalThis.setTimeout;

  await testAsync("when Groq is rate-limited the same request goes to the other provider", async () => {
    const hits = []; const notes = [];
    globalThis.fetch = async (u, o) => { hits.push(u); return u.includes("groq") ? badReply(429, "rate limit reached") : goodReply("from backup"); };
    globalThis.setTimeout = (f) => realSleep(f, 0);   // skip the 2 second retry wait
    try {
      const msg = await J.model.call({ ...base, cfg: PRIMARY, alt: BACKUP, status: t => notes.push(t) });
      assert.equal(msg.content, "from backup");
      assert.ok(hits.some(u => u.includes("groq")) && hits.some(u => u.includes("generativelanguage")));
      assert.ok(notes.some(n => /trying the shared provider/.test(n)), notes.join("|"));
    } finally { globalThis.setTimeout = realSleep; }
  });
  await testAsync("a rejected Groq key also falls back, so a typo in one key does not stop the agent", async () => {
    globalThis.fetch = async u => u.includes("groq") ? badReply(401, "Invalid API Key") : goodReply("still working");
    assert.equal((await J.model.call({ ...base, cfg: PRIMARY, alt: BACKUP })).content, "still working");
  });
  await testAsync("with no backup the first error is raised as before", async () => {
    globalThis.fetch = async () => badReply(401, "Invalid API Key");
    await assert.rejects(() => J.model.call({ ...base, cfg: PRIMARY }), /API error 401: Invalid API Key/);
    await assert.rejects(() => J.model.call({ ...base, cfg: PRIMARY, alt: { cfg: { ...BACKUP.cfg, key: "" }, label: "x" } }), /401/, "a backup with no key is ignored");
  });
  await testAsync("if both providers fail, the error names both", async () => {
    globalThis.fetch = async u => badReply(401, u.includes("groq") ? "Invalid groq key" : "Invalid gemini key");
    await assert.rejects(() => J.model.call({ ...base, cfg: PRIMARY, alt: BACKUP }), /Invalid groq key.*the shared provider also failed: .*Invalid gemini key/);
  });
  await testAsync("a working first provider is used alone", async () => {
    const hits = []; globalThis.fetch = async u => { hits.push(u); return goodReply("primary"); };   // (a non-streaming reply makes it retry once plainly, still on the same provider)
    assert.equal((await J.model.call({ ...base, cfg: PRIMARY, alt: BACKUP })).content, "primary");
    assert.ok(hits.length >= 1 && hits.every(u => u.includes("groq")), hits.join(","));
  });


  console.log(process.exitCode ? "\nSome checks FAILED." : "\nAll " + passed + " checks passed.");
})();
