// Long-term memory for the agents. Two parts, both plain logic with no network:
//  1. Facts about the user (one short line each). With hundreds of them the prompt cannot hold everything, so only the ones that
//     matter for the current message are sent: pinned facts, then the best keyword matches, then the newest.
//  2. Rolling summaries of old conversation, so what was said 200 messages ago is not simply forgotten when the saved chat is trimmed.
(function (root) {
  var J = root.J = root.J || {};
  var PIN = "★ ";   // a fact starting with a star is pinned: always sent
  var STOP = /^(the|and|for|that|with|this|have|from|you|your|are|was|were|has|had|but|not|can|will|just|about|what|when|where|who|how|why|its|his|her|she|him|they|them|their|our|out|into|than|then|also|been|does|did|get|got|let|too|any|all|one)$/;

  function words(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9ऀ-ॿ\s]/g, " ").split(/\s+/)
      .filter(function (w) { return w.length > 2 && !STOP.test(w); })
      .map(function (w) { return w.replace(/(ing|ed|es|s)$/, ""); });
  }
  function norm(s) { return words(s).sort().join(" "); }
  function isPinned(f) { return f.indexOf(PIN) === 0; }

  var memory = {
    PIN: PIN, words: words, isPinned: isPinned,

    // Which facts go into the prompt for this message. Keeps original order. `limit` facts and `maxChars` characters at most.
    select: function (facts, query, limit, maxChars) {
      limit = limit || 30; maxChars = maxChars || 4000;
      facts = facts || [];
      var q = words(query), qset = {}; q.forEach(function (w) { qset[w] = 1; });
      var scored = facts.map(function (f, i) {
        var hits = 0, seen = {};
        words(f).forEach(function (w) { if (qset[w] && !seen[w]) { seen[w] = 1; hits++; } });
        return { f: f, i: i, score: (isPinned(f) ? 1000 : 0) + hits * 10 + (i / Math.max(1, facts.length)) };   // newer breaks ties
      });
      var chosen = scored.slice().sort(function (a, b) { return b.score - a.score; }), out = [], used = 0;
      for (var k = 0; k < chosen.length && out.length < limit; k++) {
        var len = chosen[k].f.length + 3;
        if (used + len > maxChars && !isPinned(chosen[k].f)) continue;
        out.push(chosen[k]); used += len;
      }
      return out.sort(function (a, b) { return a.i - b.i; }).map(function (x) { return x.f; });
    },

    // Adds a fact unless it is empty or says (nearly) what an existing one already says. Returns { facts, status }.
    // status: "saved" | "duplicate" | "empty". Over `cap` facts, the oldest unpinned ones are dropped.
    add: function (facts, fact, cap) {
      cap = cap || 1000;
      fact = String(fact || "").replace(/\s+/g, " ").trim().slice(0, 400);
      if (!fact) return { facts: facts, status: "empty" };
      var n = norm(fact), nw = n.split(" ");
      for (var i = 0; i < facts.length; i++) {
        var m = norm(facts[i]);
        if (m === n) return { facts: facts, status: "duplicate" };
        var mw = m.split(" "), shared = nw.filter(function (w) { return mw.indexOf(w) >= 0; }).length;
        if (nw.length >= 3 && shared / Math.max(nw.length, mw.length) >= 0.8) return { facts: facts, status: "duplicate" };
      }
      var out = facts.concat([fact]);
      while (out.length > cap) { var idx = out.findIndex(function (f) { return !isPinned(f); }); if (idx < 0) break; out.splice(idx, 1); }
      return { facts: out, status: "saved" };
    },

    // Merge imported lines into existing facts. Returns { facts, added, skipped }.
    merge: function (facts, lines, cap) {
      var cur = facts.slice(), added = 0, skipped = 0;
      (lines || []).forEach(function (l) { var r = memory.add(cur, l, cap); cur = r.facts; if (r.status === "saved") added++; else skipped++; });
      return { facts: cur, added: added, skipped: skipped };
    },

    // ---- rolling conversation summary ----
    SUMMARY_PROMPT:
      "You keep long-term notes of a conversation between a user and an AI agent. Merge the earlier notes (if any) with the new conversation excerpt into ONE updated set of notes, at most 12 short bullet lines. " +
      "Keep what would matter weeks later: what the user is working on and decided, their preferences and plans, open problems, promises made, names and numbers that were mentioned, and the tone of the relationship. " +
      "Drop greetings, small talk, and anything already finished and irrelevant. Write plain text lines starting with '- '. Never invent anything that is not in the text. Reply with only the notes.",

    // Where to cut the history: everything before the returned index gets summarised. Keeps at least `keep` newest messages and cuts on a user message.
    splitPoint: function (history, keep) {
      keep = keep || 30;
      var cut = history.length - keep;
      if (cut <= 0) return 0;
      while (cut < history.length && history[cut] && history[cut].role !== "user") cut++;
      return cut >= history.length ? 0 : cut;
    },

    // Readable text of the messages being summarised. Tool calls and results are left out; long messages are clipped.
    transcript: function (messages, userName, agentName) {
      return messages.filter(function (m) { return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim(); })
        .map(function (m) { var t = m.content.trim(); if (t.length > 700) t = t.slice(0, 700) + " ..."; return (m.role === "user" ? userName : agentName) + ": " + t; }).join("\n");
    },

    cleanSummary: function (text, maxChars) {
      var t = String(text || "").replace(/^```[a-z]*\n?|```$/gm, "").trim();
      if (t.length > (maxChars || 2400)) t = t.slice(0, maxChars || 2400).replace(/\n[^\n]*$/, "");
      return t;
    }
  };

  J.memory = memory;
  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
