// Understands the few commands the interface handles itself (no AI call needed, works with no key):
//   "Unleash ULTRON"        -> summon      (JARVIS asks for confirmation first)
//   "yes" / "no"            -> confirm / cancel, only while a confirmation is waiting
//   "stand down"            -> return to JARVIS, only while another agent is active
// Matching is strict on purpose: the whole sentence must be the command, so a question like
// "tell me about unleashing ultron in the film" is never hijacked.
(function (root) {
  "use strict";
  var J = root.J = root.J || {};

  // "kh?onsh?u" also catches how speech recognition tends to spell him (Konshu, Khonsu). "dare devil" still works as his old name.
  var NAMES = "jarvis|ultron|friday|kh?onsh?u|dare\\s?devil|vision|council";
  var VERB = "(?:unleash|release|convene|summon|activate|wake(?: up)?|bring(?: up| in| out| on)?|call(?: in| up| out| on)?|switch(?: over)? to|go to|" +
    "get|grab|fetch|give me|pull up|pull in|put on|put me on to|send for|send in|hand (?:this|it) (?:over )?to|pass (?:this|it|me) to|ask for|" +
    "talk to|speak (?:to|with)|connect me (?:to|with)|put me through to|hand (?:me )?over to|transfer (?:me )?to|open|load|launch|deploy|" +
    "engage|fire up|boot up|start|enable|get me|i want|i need|let me (?:talk|speak) (?:to|with)|take me to|bring me)";
  var LEAD = "(?:(?:hey|ok|okay|alright|please|jarvis|yo|now|boss|can you|could you|would you|will you|i want you to|i would like to|id like to|i want to|i need to|lets|let us)\\s+)*";
  var TAIL = "(?:\\s+(?:now|please|for me|right now|already|boss|sir|online|up))*$";

  var SUMMON = new RegExp("^" + LEAD + VERB + "\\s+(?:up\\s+)?(?:the\\s+)?(" + NAMES + ")" + TAIL);
  // The same, followed by what the user wants done: "get ultron to fix the login bug", "bring in the council for this plan".
  // The job must be introduced by to / and / for / so / about / with / on, so "call ultron a villain" is still just chat.
  var SUMMON_TASK = new RegExp("^" + LEAD + VERB + "\\s+(?:up\\s+)?(?:the\\s+)?(" + NAMES + ")(?:\\s+(?:in|up|out|on|over))?\\s+(?:to|and|for|so|about|with|on)\\s+\\S.*$");
  // Handing work to an agent: "tell ultron to build it", "tell him he has access, make X", "have him fix it", "make ultron build it".
  // "him / her / them / it" means whichever agent was talked about last. "ask khonshu what he thinks" is a question, not a job, so it is not here.
  var WHO = "(?:the\\s+)?(" + NAMES + "|him|her|them)";
  var DELEGATE = [
    new RegExp("^" + LEAD + "(?:tell|order|instruct|command)\\s+" + WHO + "\\s+(?:to|that|he|she|they|you|and)\\s+\\S.*$"),
    new RegExp("^" + LEAD + "(?:ask|get|make|let)\\s+" + WHO + "\\s+to\\s+\\S.*$"),
    new RegExp("^" + LEAD + "(?:have|make)\\s+" + WHO + "\\s+(?!been\\b|seen\\b|a\\b|an\\b|the\\b)\\S.*$")
  ];
  var BARE = new RegExp("^(?:(?:hey|ok|okay|yo|oi|hi)\\s+)?(?:the\\s+)?(" + NAMES + ")(?:\\s+(?:now|please|online|boss|sir|here))*$");
  var RETURN = /^(?:(?:ok|okay|alright|please|thanks|thank you|yes|boss|hey)\s+)*(?:stand down|return(?: to jarvis)?|go back(?: to jarvis)?|back to jarvis|switch(?: back)? to jarvis|bring (?:back )?jarvis(?: back)?|jarvis take over|jarvis come back|get jarvis|call jarvis|talk to jarvis|speak to jarvis|dismissed|power down|thats enough)(?:\s+(?:now|please|boss|sir))*$/;
  var CONFIRM = /^(?:(?:ok|okay|alright|boss|jarvis)\s+)*(?:yes|yeah|yep|yup|sure|confirm|confirmed|affirmative|do it|go ahead|proceed|absolutely|certainly|definitely|i am sure|i am certain|i am|im sure|im certain|release (?:him|it)|unleash (?:him|it)|go for it)(?:\s+(?:please|boss|sir|jarvis|im sure|im certain))*$/;
  var CANCEL = /^(?:no|nope|nah|cancel|stand down|abort|negative|never ?mind|not yet|wait|hold on|dont|stop)(?:\s+(?:please|boss|sir|jarvis))*$/;

  function normalize(text) {
    return String(text || "").toLowerCase()
      .replace(/[‘’“”"'`]/g, "")
      .replace(/[.!?,;:…]+/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function agentId(raw) {
    var id = raw.replace(/\s+/g, "");
    return (id === "council" || id === "daredevil" || /^kh?onsh?u$/.test(id)) ? "khonshu" : id;
  }

  // Which agent does this "do something" sentence hand work to, or null. ctx.last is the agent talked about last.
  function taskAgent(t, ctx) {
    var m = SUMMON_TASK.exec(t);
    if (m) return agentId(m[1]);
    for (var i = 0; i < DELEGATE.length; i++) {
      m = DELEGATE[i].exec(t);
      if (!m) continue;
      var who = m[1];
      if (/^(him|her|them)$/.test(who)) { if (ctx.last && ctx.last !== "jarvis") return ctx.last; continue; }
      return agentId(who);
    }
    return null;
  }

  // ctx = { pending: agent id waiting for confirmation or null, active: agent id on screen, last: agent talked about last or null }
  J.parseIntent = function (text, ctx) {
    var t = normalize(text);
    if (!t) return null;
    var m;

    if (ctx.pending) {
      if (CONFIRM.test(t)) return { type: "confirm" };
      if (CANCEL.test(t)) return { type: "cancel" };
      m = SUMMON.exec(t) || BARE.exec(t);
      if (m) return agentId(m[1]) === ctx.pending ? { type: "confirm" } : { type: "summon", agent: agentId(m[1]) };
      var pa = taskAgent(t, { last: ctx.pending });   // "get ultron to fix the login bug" while the question is open: confirm, and take the job along
      if (pa) return pa === ctx.pending ? { type: "confirm", task: String(text).trim() } : { type: "summon", agent: pa, task: String(text).trim() };
      return { type: "cancel", passthrough: true };   // anything else: drop the question, treat it as a normal message
    }

    if (ctx.active !== "jarvis") {
      return RETURN.test(t) ? { type: "return" } : null;   // other agents only listen for "stand down"
    }

    m = SUMMON.exec(t) || BARE.exec(t);
    if (m) return { type: "summon", agent: agentId(m[1]) };
    var ta = taskAgent(t, ctx);
    if (ta) return { type: "summon", agent: ta, task: String(text).trim() };   // the agent gets the whole request once it is released
    return null;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
