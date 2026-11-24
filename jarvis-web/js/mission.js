// Missions: one goal, worked by the whole team in turn, ending in one written brief. The order is fixed on purpose
// (research, then challenge, then plan, then technical notes) because each agent reads what the earlier ones wrote.
// This file is only the logic; the app supplies the functions that actually call the models.
(function (root) {
  var J = root.J = root.J || {};
  var STEPS = [
    { id: "vision", agent: "vision", title: "Research", on: true,
      ask: "Gather the facts that matter for the goal: 4 to 7 short bullet findings. Say which are well established and which are uncertain. If Wikipedia notes are supplied, base the findings on them and name the page; never invent a source or a number." },
    { id: "khonshu", agent: "khonshu", title: "Challenge", on: true,
      ask: "Stress-test the goal and the research so far: the 3 biggest risks or flaws, the assumptions being made, and a one-sentence go / adjust / no-go lean with the reason." },
    { id: "friday", agent: "friday", title: "Plan", on: true,
      ask: "Turn it into a concrete plan: 5 to 8 numbered next steps in a sensible order, each saying what to do and roughly how long it takes. Be decisive." },
    { id: "ultron", agent: "ultron", title: "Technical notes", on: false,
      ask: "If any part of this needs software or engineering, give the technical approach in 4 to 6 bullets and say what to build first. If nothing technical is needed, say so in one line." }
  ];
  var SECTION_RULES = "You are writing ONE section of a joint written brief that other agents also contribute to. Write only your section as plain text with short bullet lines. No greeting, no sign-off, no banter, no jokes, no roleplay, and keep it under 170 words. Use only what the goal and the earlier notes support, and say so when something is unknown.";
  var SYNTH =
    "You are JARVIS, the chief intelligence. Write the final brief for the user from the team's notes. Use exactly these headings: Goal, What we know, Risks, Plan, Open questions. " +
    "Plan is a numbered list of next steps. Keep it under 350 words, plain and practical, and use only what the team's notes say; do not add facts. If a section of notes is missing, say what is missing under Open questions.";

  function userMessage(goal, step, sections, wiki) {
    var m = "GOAL: " + goal + "\n";
    if (step.id === "vision" && wiki) m += "\nWikipedia notes (" + wiki.title + ", " + wiki.url + "):\n" + String(wiki.text).slice(0, 3500) + "\n";
    if (step.id === "vision" && !wiki) m += "\nNo Wikipedia page was found for this goal, so say plainly that your findings come from general knowledge and are unchecked.\n";
    if (sections.length) m += "\nNOTES SO FAR:\n" + sections.map(function (s) { return "## " + s.title + " (" + s.agentName + ")\n" + s.text; }).join("\n\n") + "\n";
    return m + "\nYOUR TASK (" + step.title + "): " + step.ask;
  }

  async function run(o) {
    var goal = String(o.goal || "").trim();
    if (!goal) throw new Error("Write the goal first.");
    var ids = o.stepIds && o.stepIds.length ? o.stepIds : STEPS.filter(function (s) { return s.on; }).map(function (s) { return s.id; });
    var steps = STEPS.filter(function (s) { return ids.indexOf(s.id) >= 0; });
    var sections = [], sources = [], wiki = null;
    if (steps.some(function (s) { return s.id === "vision"; }) && o.research) {
      try { wiki = await o.research(goal); } catch (e) { wiki = null; }
      if (wiki) sources.push({ title: wiki.title, url: wiki.url });
    }
    for (var i = 0; i < steps.length; i++) {
      if (o.cancelled && o.cancelled()) return { goal: goal, sections: sections, sources: sources, brief: "", cancelled: true };
      var st = steps[i];
      if (o.onProgress) o.onProgress(i, "working", st);
      var entry = { id: st.id, title: st.title, agent: st.agent, agentName: o.nameOf ? o.nameOf(st.agent) : st.agent.toUpperCase() };
      try {
        entry.text = String(await o.ask(st, userMessage(goal, st, sections.filter(function (s) { return s.text; }), wiki), SECTION_RULES) || "").trim();
        if (!entry.text) entry.error = "empty reply";
      } catch (e) { entry.error = e && e.message ? e.message : String(e); }
      sections.push(entry);
      if (o.onProgress) o.onProgress(i, entry.error ? "failed" : "done", st, entry);
    }
    var good = sections.filter(function (s) { return s.text && !s.error; });
    if (!good.length) return { goal: goal, sections: sections, sources: sources, brief: "", failed: true };
    if (o.cancelled && o.cancelled()) return { goal: goal, sections: sections, sources: sources, brief: "", cancelled: true };
    if (o.onProgress) o.onProgress(steps.length, "working", { title: "Final brief", agent: "jarvis" });
    var brief = "";
    try {
      brief = String(await o.synth(SYNTH, "GOAL: " + goal + "\n\nTEAM NOTES:\n" + sections.map(function (s) { return "## " + s.title + " (" + s.agentName + ")\n" + (s.text || "(missing: " + s.error + ")"); }).join("\n\n")) || "").trim();
    } catch (e) { brief = ""; }
    if (o.onProgress) o.onProgress(steps.length, brief ? "done" : "failed", { title: "Final brief", agent: "jarvis" });
    return { goal: goal, sections: sections, sources: sources, brief: brief };
  }

  function toMarkdown(r, when) {
    var d = (when || new Date()).toISOString().slice(0, 10);
    var out = "# Mission brief\n\n*" + d + "*\n\n";
    out += r.brief ? r.brief + "\n\n" : "**Goal:** " + r.goal + "\n\n_The final brief could not be written; the team notes are below._\n\n";
    out += "---\n\n## Team notes\n\n";
    r.sections.forEach(function (s) { out += "### " + s.title + " (" + s.agentName + ")\n\n" + (s.text || "_Missing: " + s.error + "_") + "\n\n"; });
    if (r.sources && r.sources.length) out += "## Sources\n\n" + r.sources.map(function (s) { return "- [" + s.title + "](" + s.url + ")"; }).join("\n") + "\n";
    return out;
  }

  J.mission = { STEPS: STEPS, SECTION_RULES: SECTION_RULES, SYNTH: SYNTH, userMessage: userMessage, run: run, toMarkdown: toMarkdown };
  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
