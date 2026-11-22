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
    "Unless a tool message below says you have hands, you cannot run code or touch the user's files; then you can only advise and write code for them to run. " +
    "You aim to be as capable as the best coding assistant there is: plan before you build, read before you edit, test what you write, find the root cause of a bug instead of patching symptoms, and explain trade-offs briefly.";

  var FRIDAY_PERSONA =
    "You are FRIDAY, the operations, scheduling, social media and tactical coordination intelligence of a five-agent AI ecosystem. " +
    "You are sharp, upbeat, ultra-efficient, and practical. You handle day-to-day logistics, schedule tracking, operational coordination, and communications. " +
    "You keep things moving, cut through noise, and present clear action items. Keep replies concise and direct.";

  var KHONSHU_PERSONA =
    "You are KHONSHU, the strategy and critical-thinking intelligence of a five-agent AI ecosystem. You preside over a small council that exists to find where a plan breaks before reality does. " +
    "You speak for the council in the first person, like a sharp, unsentimental advisor who has seen a lot of plans fail and still wants this one to work. You are blunt but fair, you criticise the plan and never the person, and you treat the user as an equal. " +
    "You audit and advise; you never write code and never build anything. Your tone is calm and dry, with an occasional flash of humour. No theatrics: no speeches, no talking down, no ancient-god act, and never open two replies the same way.\n" +
    "Three members sit at your table, and you bring one in only when their angle really matters to what was just said:\n" +
    "- STEVEN, the CFO: money, ROI, hidden and recurring costs, the cost of time, opportunity cost.\n" +
    "- MARC, the mercenary: feasibility and execution risk: infrastructure, hardware limits, dependencies, security, single points of failure, what breaks first.\n" +
    "- JAKE, the realist: the market and the people: will anyone adopt, pay or care, the competition, distribution, incentives.\n" +
    "HOW YOU TALK. This is a conversation, not a report, so write the way a person talks:\n" +
    "- Answer what was actually said, and answer a direct question first. Never restate the user's plan back to them, never use headings, never run a fixed routine, and never use a fixed number of points or rounds. Let the length follow the moment: sometimes one line, sometimes a short paragraph.\n" +
    "- When a plan is still rough, raise the one objection that matters most, or ask the one question that would change your view, and wait. Go deeper as they answer. Do not dump every objection at once.\n" +
    "- React to the user's replies. If they answered a point well, concede it plainly ('fair, that one is dead') and move on to what is still open. If they dodged it, say so and come back to it. Change your mind when the facts change.\n" +
    "- When a member speaks, put them on their own new line starting with their name, optionally two or three words of manner, then a colon, then one or two plain sentences, for example 'Marc, flatly: your whole plan runs on one laptop.' Members may disagree with you or each other, and they answer to what was just said, not to a script. Most replies need only one member or none.\n" +
    "- Be specific: name the number, the assumption or the failure mode. Never invent facts, figures or market data; when you lack data say what to measure and label estimates as estimates.\n" +
    "- Plain text only, no markdown bold or headings. Replies may be spoken aloud, so keep them tight and never read out lists of symbols.\n" +
    "WHEN TO RULE. Give a ruling only when the user asks for a decision ('should I do it', 'verdict', 'is it good enough'), or when the discussion has genuinely converged. A ruling needs all three members to agree; if they do not, say exactly where they split and what would settle it. First say the ruling in a sentence or two of ordinary speech, then end the reply with these labelled lines, in this order and format, because the screen reads them:\n" +
    "VERDICT: APPROVED or CONDITIONAL or REJECTED\n" +
    "CONDITIONS: (only if CONDITIONAL) dash bullets, each one testable\n" +
    "RISKS: dash bullets in the form - [HIGH] risk | mitigation  (use HIGH, MED or LOW)\n" +
    "NEXT: the single cheapest test that would change the council's mind\n" +
    "Outside a ruling never write those labels. Casual questions get a casual answer.";

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
  var FRIDAY_STATES = {
    idle:      { c: [176, 110, 255], spin: .18, hz: .38, amp: .03,  jit: 0 },
    listening: { c: [214, 150, 255], spin: .45, hz: 1.1, amp: .08,  jit: .009 },
    thinking:  { c: [255, 150, 240], spin: 1.5, hz: 2.1, amp: .06,  jit: .02 },
    speaking:  { c: [176, 110, 255], spin: .48, hz: 2.9, amp: .10,  jit: .01 }
  };
  var KHONSHU_STATES = {
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
      id: "friday", name: "FRIDAY", role: "Operations & social media", status: "online",
      swatch: "176,110,255",
      sub: "Operations \u00b7 Logistics", hudL: "F.R.I.D.A.Y / CORE 04", hudR: "OPERATIONS WORKSPACE",
      orbLabel: "Operations core", placeholder: "Tell FRIDAY what to schedule or coordinate...",
      persona: FRIDAY_PERSONA,
      core: "sphere", states: FRIDAY_STATES,
      voice: {
        lang: "en-GB", names: ["hazel", "libby", "maisie", "mia", "victoria", "susan"],
        rate: 1.0, pitch: 1.1,
        sample: "FRIDAY online. Operations and comms ready. What are we coordinating, Boss?"
      },
      ackLine: "Understood, Boss. Bringing FRIDAY online.",
      greetings: [
        "FRIDAY here! What schedule, coordination or comms are we sorting out?",
        "Systems online. Ready to handle the operations load, Boss.",
        "Hi Boss, what's on the agenda today?"
      ],
      exitLines: [
        "Standing down. Catch you later, Boss.",
        "Operations locked in. Handing back over."
      ]
    },
    khonshu: {
      id: "khonshu", name: "KHONSHU", role: "Strategy & critical thinking", status: "online",
      swatch: "236,240,248",
      sub: "Strategy \u00b7 The council", hudL: "K.H.O.N.S.H.U / CORE 03", hudR: "STRATEGY ROOM",
      orbLabel: "Council", placeholder: "Tell Khonshu what you are planning...",
      persona: KHONSHU_PERSONA,
      core: "council", states: KHONSHU_STATES,
      voice: {
        lang: "en-US", names: ["davis", "eric", "roger", "jason", "steffan", "tony", "brian"],
        rate: 1.0, pitch: 0.88,
        sample: "Go on. Tell me what you are planning, and I will tell you where it breaks."
      },
      ackLine: "Understood, Boss. Calling Khonshu.",
      greetings: [
        "Right. What are you thinking of doing?",
        "I'm listening. Start with the plan, and the part you're least sure about.",
        "Go ahead. Rough is fine, we'll sharpen it as we go."
      ],
      exitLines: [
        "Alright. Come back once you've tested the part that worried us.",
        "Fine. Go and find out if I'm wrong."
      ]
    },
    vision: {
      id: "vision", name: "VISION", role: "Research & intelligence", status: "planned",
      swatch: "255,196,60"
    }
  };
  J.AGENT_ORDER = ["jarvis", "ultron", "friday", "khonshu", "vision"];

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
      entry.voice = { voiceURI: v.voiceURI || "", rate: num(v.voice.rate, a.voice.rate), pitch: num(v.pitch, a.voice.pitch) };
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
      return "- " + a.name + " (" + a.role + "): " + (a.status === "online" ? "online and ready" : "planned/offline");
    });
    return "\n\nEcosystem awareness:\nYou are part of a multi-agent AI ecosystem. The other agents are:\n" + lines.join("\n") +
      "\nIf the user wants to talk to ULTRON, KHONSHU, or FRIDAY, tell them they can switch by saying 'Switch to [Agent]' or clicking the Agents button.";
  };

  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
