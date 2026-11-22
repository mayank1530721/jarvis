// Speech output: picking a voice for each agent, and speaking.
// A browser can only use the voices installed on the computer, so "deep male" is a best effort:
// voices are scored, and the user can always pick one by hand in Settings.
(function (root) {
  "use strict";
  var J = root.J = root.J || {};

  // Word-boundary matching matters: the old check looked for the letters "male", which are
  // also inside "Female", so female voices were being picked as male ones.
  var FEMALE = /\b(female|woman|girl|zira|hazel|susan|libby|sonia|maisie|aria|jenny|emma|amy|michelle|ana|eva|heera|neerja|swara|samantha|victoria|karen|moira|tessa|fiona|serena|kate|catherine|ava|ivy|joanna|salli|kendra|kimberly|nicole|olivia|sara|clara|natasha|isabella|ayanda|kalpana)\b/i;
  var MALE = /\b(male|ryan|thomas|george|alfie|oliver|arthur|daniel|james|brian|david|mark|guy|christopher|eric|davis|andrew|roger|steffan|jason|tony|william|ravi|prabhat|rishi|liam|connor|mitchell|aaron|fred|alex|tom|lee|hemant|steven|ronald|ollie)\b/i;

  function isFemale(name) { return FEMALE.test(name || ""); }
  function isMale(name) { return !isFemale(name) && MALE.test(name || ""); }

  // Higher is better. Gender dominates, then language, then a preferred name, then voice quality.
  function scoreVoice(v, hint) {
    var s = 0, name = v.name || "", lang = v.lang || "";
    s += isMale(name) ? 100 : (isFemale(name) ? -100 : 0);
    if (hint && hint.lang && lang.toLowerCase().replace("_", "-").indexOf(hint.lang.toLowerCase()) === 0) s += 40;
    else if (/^en([-_]|$)/i.test(lang)) s += 20;
    if (hint && hint.names) {
      var lower = name.toLowerCase();
      for (var i = 0; i < hint.names.length; i++) if (new RegExp("\\b" + hint.names[i] + "\\b").test(lower)) { s += 25; break; }
    }
    if (/natural|neural|online/i.test(name)) s += 15;
    else if (/google/i.test(name)) s += 10;
    else if (/microsoft/i.test(name)) s += 8;
    return s;
  }

  // The user's explicit choice wins; otherwise the best-scoring voice; otherwise whatever exists.
  function pickVoice(voices, voiceURI, hint) {
    if (!voices || !voices.length) return null;
    if (voiceURI) {
      for (var i = 0; i < voices.length; i++) if (voices[i].voiceURI === voiceURI) return voices[i];
    }
    var best = null, bestScore = -Infinity;
    for (var j = 0; j < voices.length; j++) {
      var sc = scoreVoice(voices[j], hint);
      if (sc > bestScore) { best = voices[j]; bestScore = sc; }
    }
    return best;
  }

  // Voices in the order shown in Settings: likely-male English first, then everything else.
  function orderVoices(voices, hint) {
    return voices.slice().sort(function (a, b) { return scoreVoice(b, hint) - scoreVoice(a, hint); });
  }

  J.voice = { isMale: isMale, isFemale: isFemale, scoreVoice: scoreVoice, pickVoice: pickVoice, orderVoices: orderVoices };

  // ---- everything below needs a browser ----
  var synth = root.speechSynthesis;
  var current = null;

  // What is actually read aloud. Code is not read out, and a council verdict block (VERDICT / CONDITIONS /
  // RISKS / NEXT) is shown on screen instead of being read as labels and symbols, which sounds like a script.
  var VERDICT_BLOCK = /^[ \t>*_#-]*VERDICT[ \t*_]*:[ \t*_]*(APPROVED|CONDITIONAL|REJECTED)\b/im;
  function speakable(text) {
    var t = String(text == null ? "" : text).replace(/```[\s\S]*?```/g, " code block. ");
    var m = VERDICT_BLOCK.exec(t);
    if (m) {
      var before = t.slice(0, m.index).replace(/[*_`#>\s]+/g, " ").trim();
      t = before.length > 20 ? before + " The full verdict is on screen." : "My verdict is " + m[1].toLowerCase() + ". The conditions and risks are on screen.";
    }
    return t.replace(/[*_`#>]/g, "").replace(/\s{2,}/g, " ").trim();
  }
  J.speakable = speakable;

  J.voices = function () { return synth ? synth.getVoices() : []; };

  J.stopSpeaking = function () {
    if (!synth) return;
    var u = current;
    if (u && u._finish) u._finish();
    current = null;
    synth.cancel();
  };

  // Speak as one agent. Returns a promise that resolves when speech ends (or after maxMs),
  // so a caller can wait for a line to finish before doing the next thing.
  J.speak = function (text, agentId, hooks, maxMs, override) {
    hooks = hooks || {};
    if (!synth) return Promise.resolve();
    var clean = speakable(text);
    if (!clean) return Promise.resolve();
    synth.cancel();
    var agent = J.AGENTS[agentId], prefs = override ? { voice: override } : J.prefs.get(agentId);
    var u = new root.SpeechSynthesisUtterance(clean);
    var voice = pickVoice(J.voices(), prefs.voice.voiceURI, agent.voice);
    if (voice) u.voice = voice;
    u.rate = prefs.voice.rate; u.pitch = prefs.voice.pitch; u.volume = 1;
    current = u;
    return new Promise(function (resolve) {
      var finished = false;
      var timer = setTimeout(function () { u._finish(); }, maxMs || 15000);
      u._finish = function () {
        if (finished) return; finished = true; clearTimeout(timer);
        if (hooks.onEnd) hooks.onEnd(u === current);
        resolve();
      };
      u.onstart = function () { if (current === u && hooks.onStart) hooks.onStart(); };
      u.onend = u._finish; u.onerror = u._finish;
      synth.speak(u);
    });
  };

  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
