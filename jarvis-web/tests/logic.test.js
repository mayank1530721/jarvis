// Checks for the parts of Jarvis that are plain logic (no browser needed).
// Run with:  node jarvis-web/tests/logic.test.js
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const js = f => path.join(__dirname, "..", "js", f);

require(js("util.js")); require(js("agents.js")); require(js("intent.js")); require(js("voice.js")); require(js("model.js"));
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
  assert.deepEqual(parse("unleash dare devil"), { type: "summon", agent: "daredevil" });
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

  console.log(process.exitCode ? "\nSome checks FAILED." : "\nAll " + passed + " checks passed.");
})();
