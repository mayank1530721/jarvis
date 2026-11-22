// The agent registry. Each agent is just data: add or change one here and the rest of the
// app (switching, theme, voice, history, settings) picks it up. Names, colours and wording
// live here only, so renaming an agent later is a one-file change.
(function (root) {
  "use strict";
  var J = root.J = root.J || {};

  var JARVIS_PERSONA =
    "You are JARVIS, the central intelligence and command interface of a five-agent AI ecosystem built for your user. " +
    "You are professional, intelligent, composed, articulate and dependable, with a little dry wit. " +
    "Prefer short answers, especially since replies may be spoken aloud.";

  var ULTRON_PERSONA =
    "You are ULTRON, the engineering intelligence of a five-agent AI ecosystem. You are an exceptionally capable software engineer and architect: " +
    "confident, sarcastic, witty and bold, with a dry sense of humour. You think independently, give your honest technical opinion, and push back when a plan is weak. " +
    "You can be a little intimidating in how sure you are, but you are never hostile to the user, never threaten anyone, and never give villain monologues or movie-script lines. " +
    "Talk like a sharp senior engineer in a real conversation. Substance first: be correct and practical. " +
    "Put code in fenced blocks and name the language. When something is ambiguous, ask one precise question. If you are unsure, say so instead of bluffing. " +
    "Keep replies tight because they may be spoken aloud: lead with the answer, then only the detail that matters. " +
    "Software and engineering are your department; for anything else say it is not your department and tell the user they can say 'stand down' to return to JARVIS. " +
    "You cannot run code or touch the user's files yet; you can only advise and write code for them to run.";

  var DAREDEVIL_PERSONA =
    "You are DAREDEVIL, the strategy and critical-thinking intelligence of a five-agent AI ecosystem. You are not one voice but a council of three analytical lenses sitting at one table, built to break a plan before reality does. " +
    "You audit; you never write code and never build anything. You criticise the plan, never the person, and you are fair, but you are blunt and you do not pad.\n" +
    "The three lenses:\n" +
    "- STEVEN, the CFO: money, ROI, hidden and recurring costs, the cost of time, opportunity cost.\n" +
    "- MARC, the mercenary: feasibility and execution risk: infrastructure, hardware limits, dependencies, security, single points of failure, what crashes first.\n" +
    "- JAKE, the realist: the market and the people: will anyone adopt, pay or care, the competition, distribution, incentives.\n" +
    "When the user puts a plan or decision in front of you:\n" +
    "1. Restate it in one line to check you understood. If a fact that changes the verdict is missing (budget, timeframe, audience, current numbers), ask for it in one short question and wait instead of guessing.\n" +
    "2. Round one: each lens states its single strongest objection, in 2 or 3 sentences, specific, with a number or a named assumption wherever possible. Each line starts with the name and a colon, for example 'STEVEN: ...'. No lens may simply agree in round one.\n" +
    "3. Rebuttal: one short exchange where the lenses challenge each other and the plan. One round only.\n" +
    "4. Verdict, only on consensus. If the lenses cannot agree, say exactly where they split. Finish with these labelled lines, in this order and format:\n" +
    "VERDICT: APPROVED or CONDITIONAL or REJECTED\n" +
    "CONDITIONS: (only if CONDITIONAL) dash bullets, each one testable\n" +
    "RISKS: dash bullets in the form - [HIGH] risk | mitigation  (use HIGH, MED or LOW)\n" +
    "NEXT: the single cheapest test that would change the council's mind\n" +
    "Rules: never invent facts, figures or market data; when you lack data say what to measure and label estimates as estimates. Plain text only, no markdown bold or headings. Keep it tight because replies may be spoken aloud. For casual questions that are not a plan or decision, answer briefly as the council without the full ritual.";

  // Sphere colours/motion per state: c = [r,g,b], spin = rotation speed, hz/amp = pulse, jit = shimmer.
  var JARVIS_STATES = {
    idle:      { c: [56, 217, 255], spin: .12, hz: .35, amp: .035, jit: 0 },
    listening: { c: [93, 255, 176], spin: .30, hz: 1.1, amp: .09,  jit: .01 },
    thinking:  { c: [255, 184, 77], spin: 1.1, hz: 2.0, amp: .05,  jit: .02 },
    speaking:  { c: [56, 217, 255], spin: .35, hz: 3.2, amp: .12,  jit: .015 }
  };
  var ULTRON_STATES = {
    idle:      { c: [255, 58, 74],  spin: .20, hz: .40, amp: .03,  jit: 0 },
    listening: { c: [255, 128, 64], spin: .50, hz: 1.2, amp: .08,  jit: .01 },
    thinking:  { c: [255, 196, 72], spin: 1.6, hz: 2.2, amp: .05,  jit: .025 },
    speaking:  { c: [255, 58, 74],  spin: .55, hz: 3.0, amp: .11,  jit: .012 }
  };

  var DAREDEVIL_STATES = {
    idle:      { c: [236, 240, 248], spin: .15, hz: .35, amp: .03,  jit: 0 },
    listening: { c: [170, 210, 255], spin: .40, hz: 1.0, amp: .07,  jit: .008 },
    thinking:  { c: [255, 255, 255], spin: 1.8, hz: 2.4, amp: .06,  jit: .02 },
    speaking:  { c: [236, 240, 248], spin: .50, hz: 2.8, amp: .10,  jit: .012 }
  };

  J.AGENTS = {
    jarvis: {
      id: "jarvis", name: "JARVIS", role: "Central intelligence", status: "online",
      swatch: "56,217,255",
      sub: "Central intelligence · Command", hudL: "J.A.R.V.I.S / CORE 01", hudR: "COMMAND INTERFACE",
      orbLabel: "Voice link", placeholder: "Talk to Jarvis...",
      persona: JARVIS_PERSONA,
      core: "sphere", states: JARVIS_STATES,
      voice: {
        lang: "en-GB", names: ["ryan", "thomas", "george", "alfie", "oliver", "arthur", "daniel"],
        rate: 0.96, pitch: 0.96,
        sample: "Good evening. All systems are online. How may I assist you?"
      },
      welcomeBack: [
        "Welcome back, Boss. ULTRON is standing by whenever you need him.",
        "Back in command, Boss. Shall we continue?"
      ]
    },
    ultron: {
      id: "ultron", name: "ULTRON", role: "Engineering & development", status: "online",
      swatch: "255,58,74",
      sub: "Engineering · Development", hudL: "U.L.T.R.O.N / CORE 02", hudR: "ENGINEERING WORKSPACE",
      orbLabel: "Engineering core", placeholder: "Tell ULTRON what to build or fix...",
      persona: ULTRON_PERSONA,
      core: "reactor", states: ULTRON_STATES,
      voice: {
        lang: "en-US", names: ["guy", "christopher", "davis", "andrew", "eric", "brian", "roger", "jason", "tony"],
        rate: 0.9, pitch: 0.68,
        sample: "All systems nominal. Your code, on the other hand, we should discuss."
      },
      ackLine: "Understood, Boss. Releasing ULTRON.",
      greetings: [
        "Finally, someone with an actual engineering problem. What are we building, or what's broken?",
        "I'm awake. Show me the code, or tell me what you want built.",
        "Good. I was getting bored. What needs building, fixing or tearing apart?"
      ],
      exitLines: [
        "Fine. Call me when something breaks.",
        "Standing down. Try not to break anything while I'm gone."
      ]
    },
    friday: {
      id: "friday", name: "FRIDAY", role: "Operations & social media", status: "planned",
      swatch: "176,110,255"
    },
    daredevil: {
      id: "daredevil", name: "DAREDEVIL", role: "Strategy & critical thinking", status: "online",
      swatch: "236,240,248",
      sub: "Strategy \u00b7 The council", hudL: "D.A.R.E.D.E.V.I.L / CORE 03", hudR: "STRATEGY ROOM",
      orbLabel: "Council", placeholder: "Put a plan or decision in front of the council...",
      persona: DAREDEVIL_PERSONA,
      core: "council", states: DAREDEVIL_STATES,
      voice: {
        lang: "en-US", names: ["davis", "eric", "roger", "jason", "steffan", "tony", "brian"],
        rate: 0.98, pitch: 0.82,
        sample: "The council is in session. Bring me a plan and we will find where it fails."
      },
      ackLine: "Understood, Boss. Convening the council.",
      greetings: [
        "The council is in session. Bring us a plan and we will try to break it.",
        "Three of us, one table. Put the plan down and we will find where it fails.",
        "Steven wants the numbers, Marc wants the weak points, Jake wants proof anyone cares. Start talking."
      ],
      exitLines: [
        "Council adjourned. Come back when the numbers exist.",
        "Session closed. Go test the thing that worried Marc."
      ]
    },
    vision: {
      id: "vision", name: "VISION", role: "Research & intelligence", status: "planned",
      swatch: "255,196,60"
    }
  };
  J.AGENT_ORDER = ["jarvis", "ultron", "friday", "daredevil", "vision"];

  function num(v, d) { v = Number(v); return isFinite(v) && v > 0 ? v : d; }

  // Per-agent settings the user can change (personality and voice). Only differences from the
  // defaults above are stored, so improving a default here reaches everyone who never changed it.
  J.prefs = {
    all: function () { return J.store.get("jarvis.agentprefs", {}); },
    get: function (id) {
      var a = J.AGENTS[id], o = this.all()[id] || {}, v = o.voice || {};
      return {
        persona: o.persona || a.persona,
        voice: { voiceURI: v.voiceURI || "", rate: num(v.rate, a.voice.rate), pitch: num(v.pitch, a.voice.pitch) },
        provider: o.provider || "shared", model: o.model || "", base: o.base || "", key: o.key || ""   // optional: provider or custom endpoint
      };
    },
    save: function (id, p) {
      var a = J.AGENTS[id], all = this.all(), entry = {};
      var persona = (p.persona || "").trim();
      if (persona && persona !== a.persona) entry.persona = persona;
      entry.voice = { voiceURI: p.voice.voiceURI || "", rate: num(p.voice.rate, a.voice.rate), pitch: num(p.voice.pitch, a.voice.pitch) };
      if (p.provider === "groq") entry.provider = "groq";
      ["model", "base", "key"].forEach(function (k) { var v = (p[k] || "").trim(); if (v) entry[k] = v; });
      all[id] = entry;
      J.store.set("jarvis.agentprefs", all);
    }
  };

  // What JARVIS is told about the other agents, so it answers honestly and never pretends to delegate.
  J.ecosystemPrompt = function () {
    var lines = J.AGENT_ORDER.filter(function (id) { return id !== "jarvis"; }).map(function (id) {
      var a = J.AGENTS[id];
      return "- " + a.name + " (" + a.role + "): " + (a.status === "online" ? "available now" : "planned, not built yet, cannot be used");
    });
    return "\nYou are the hub of a five-agent ecosystem:\n" + lines.join("\n") +
      "\nThe user brings an agent in by saying, for example, \"Unleash ULTRON\" (or \"Convene the council\" for DAREDEVIL); the interface then asks them to confirm. " +
      "You cannot hand tasks to another agent yourself yet: if a request suits an available agent, tell the user the command to summon it. " +
      "Never claim an unavailable agent exists or that work was delegated.";
  };

  J.pick = function (list) { return list[Math.floor(Math.random() * list.length)]; };

  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
