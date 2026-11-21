// Understands the few commands the interface handles itself (no AI call needed, works with no key):
//   "Unleash ULTRON"        -> summon      (JARVIS asks for confirmation first)
//   "yes" / "no"            -> confirm / cancel, only while a confirmation is waiting
//   "stand down"            -> return to JARVIS, only while another agent is active
// Matching is strict on purpose: the whole sentence must be the command, so a question like
// "tell me about unleashing ultron in the film" is never hijacked.
(function (root) {
  "use strict";
  var J = root.J = root.J || {};

  var NAMES = "jarvis|ultron|friday|dare\\s?devil|vision";
  var VERB = "(?:unleash|release|summon|activate|wake(?: up)?|bring(?: up| in| out)?|call(?: in| up| out)?|switch(?: over)? to|go to|" +
    "talk to|speak (?:to|with)|connect me (?:to|with)|put me through to|hand (?:me )?over to|transfer (?:me )?to|open|load|launch|deploy|" +
    "engage|fire up|boot up|start|enable|get me|i want|i need|let me (?:talk|speak) (?:to|with)|take me to|bring me)";
  var LEAD = "(?:(?:hey|ok|okay|alright|please|jarvis|yo|now|boss|can you|could you|would you|will you|i want you to|i would like to|id like to|i want to|i need to|lets|let us)\\s+)*";
  var TAIL = "(?:\\s+(?:now|please|for me|right now|already|boss|sir|online|up))*$";

  var SUMMON = new RegExp("^" + LEAD + VERB + "\\s+(?:up\\s+)?(?:the\\s+)?(" + NAMES + ")" + TAIL);
  var BARE = new RegExp("^(?:the\\s+)?(" + NAMES + ")(?:\\s+(?:now|please|online|boss|sir))*$");
  var RETURN = /^(?:(?:ok|okay|alright|please|thanks|thank you|yes|boss|hey)\s+)*(?:stand down|return(?: to jarvis)?|go back(?: to jarvis)?|back to jarvis|switch(?: back)? to jarvis|bring (?:back )?jarvis(?: back)?|jarvis take over|jarvis come back|get jarvis|call jarvis|talk to jarvis|speak to jarvis|dismissed|power down|thats enough)(?:\s+(?:now|please|boss|sir))*$/;
  var CONFIRM = /^(?:(?:ok|okay|alright|boss|jarvis)\s+)*(?:yes|yeah|yep|yup|sure|confirm|confirmed|affirmative|do it|go ahead|proceed|absolutely|certainly|definitely|i am sure|i am certain|i am|im sure|im certain|release (?:him|it)|unleash (?:him|it)|go for it)(?:\s+(?:please|boss|sir|jarvis|im sure|im certain))*$/;
  var CANCEL = /^(?:no|nope|nah|cancel|stand down|abort|negative|never ?mind|not yet|wait|hold on|dont|stop)(?:\s+(?:please|boss|sir|jarvis))*$/;

  function normalize(text) {
    return String(text || "").toLowerCase()
      .replace(/[‘’“”"'`]/g, "")
      .replace(/[.!?,;:…]+/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function agentId(raw) { return raw.replace(/\s+/g, ""); }

  // ctx = { pending: agent id waiting for confirmation or null, active: agent id on screen }
  J.parseIntent = function (text, ctx) {
    var t = normalize(text);
    if (!t) return null;
    var m;

    if (ctx.pending) {
      if (CONFIRM.test(t)) return { type: "confirm" };
      if (CANCEL.test(t)) return { type: "cancel" };
      m = SUMMON.exec(t) || BARE.exec(t);
      if (m) return agentId(m[1]) === ctx.pending ? { type: "confirm" } : { type: "summon", agent: agentId(m[1]) };
      return { type: "cancel", passthrough: true };   // anything else: drop the question, treat it as a normal message
    }

    if (ctx.active !== "jarvis") {
      return RETURN.test(t) ? { type: "return" } : null;   // other agents only listen for "stand down"
    }

    m = SUMMON.exec(t) || BARE.exec(t);
    if (m) return { type: "summon", agent: agentId(m[1]) };
    return null;
  };

  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
