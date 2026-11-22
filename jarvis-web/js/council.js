// Reads DAREDEVIL's replies. The council ends a verdict with labelled lines (VERDICT / CONDITIONS /
// RISKS / NEXT) and opens with one line per lens (STEVEN / MARC / JAKE). This turns that text into
// data for the Verdict, Council and Risk register panels. If the model does not follow the format,
// nothing is parsed and the panels stay empty rather than showing guesses.
(function (root) {
  "use strict";
  var J = root.J = root.J || {};

  var LEAD = "^[ \\t>*_#-]*";                       // tolerate a stray bullet or markdown bold before a label
  var VERDICT = new RegExp(LEAD + "VERDICT[ \\t*_]*:[ \\t*_]*(APPROVED|CONDITIONAL|REJECTED)\\b", "im");
  var SECTION = new RegExp(LEAD + "(CONDITIONS|RISKS|NEXT)[ \\t*_]*:(.*)$", "i");
  var ITEM = /^[ \t]*(?:[-*•]|\d+[.)])[ \t]+(.*)$/;
  var RISK = /^\[?\s*(HIGH|MEDIUM|MED|LOW)\s*\]?\s*[:\-–]?\s*(.*)$/i;

  function clean(s) { return String(s || "").replace(/[*_`]+/g, "").replace(/\s+/g, " ").trim(); }

  // One verdict block from a single reply, or null.
  function parseVerdict(text) {
    if (!text) return null;
    var v = VERDICT.exec(text);
    if (!v) return null;
    var out = { verdict: v[1].toUpperCase(), conditions: [], risks: [], next: "" }, section = "", lines = text.slice(v.index).split("\n");
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i], m = SECTION.exec(line);
      if (m) {
        section = m[1].toUpperCase();
        line = m[2];
        if (!clean(line)) continue;
        if (section === "NEXT") { out.next = clean(line); continue; }
      } else if (!section || !clean(line)) { if (section === "NEXT" && !clean(line)) section = ""; continue; }
      else if (section === "NEXT") { out.next = clean(out.next + " " + line); continue; }
      var it = ITEM.exec(line), body = clean(it ? it[1] : line);
      if (!body) continue;
      if (section === "CONDITIONS") out.conditions.push(body);
      else if (section === "RISKS") {
        var r = RISK.exec(body), level = r ? r[1].toUpperCase() : "MED", rest = r ? r[2] : body;
        var parts = rest.split("|");
        out.risks.push({ level: level === "MEDIUM" ? "MED" : level, text: clean(parts[0]), fix: clean(parts.slice(1).join("|")) });
      }
    }
    return out;
  }

  // Each lens's opening objection ("STEVEN (CFO): ..."), first one per name.
  function parseAlters(text) {
    var out = {};
    ["STEVEN", "MARC", "JAKE"].forEach(function (name) {
      var m = new RegExp(LEAD + name + "\\b[^:\\n]{0,30}:[ \\t*_]*(.+)$", "im").exec(text || "");
      if (m) out[name.toLowerCase()] = clean(m[1]).slice(0, 170);
    });
    return out;
  }

  // The newest verdict and lens lines across a chat history, plus how many verdicts there have been.
  function latest(messages) {
    var res = { verdict: null, alters: {}, count: 0 }, gotAlters = false;
    for (var i = (messages || []).length - 1; i >= 0; i--) {
      var m = messages[i];
      if (!m || m.role !== "assistant" || !m.content) continue;
      var v = parseVerdict(m.content);
      if (v) { res.count++; if (!res.verdict) res.verdict = v; }
      if (!gotAlters) { var a = parseAlters(m.content); if (Object.keys(a).length) { res.alters = a; gotAlters = true; } }
    }
    return res;
  }

  J.council = { parseVerdict: parseVerdict, parseAlters: parseAlters, latest: latest };
  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
