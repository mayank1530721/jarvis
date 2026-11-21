// Small shared helpers. Every file in js/ hangs its pieces on one global object, J,
// so the page works as plain scripts (no build step, also fine when opened from a file).
(function (root) {
  "use strict";
  var J = root.J = root.J || {};

  // Everything is kept in this browser only (localStorage). Reads never throw.
  J.store = {
    get: function (k, d) {
      try { var v = root.localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    remove: function (k) { try { root.localStorage.removeItem(k); } catch (e) {} }
  };

  J.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  J.clock24 = function (d) { return d.toLocaleTimeString("en-GB"); };

  // Pull the closed ``` code blocks out of a chat history (newest first).
  J.extractCodeBlocks = function (messages, limit) {
    var out = [];
    (messages || []).forEach(function (m, i) {
      if (!m || m.role !== "assistant" || !m.content) return;
      var re = /```([^\n`]*)\n([\s\S]*?)```/g, hit;
      while ((hit = re.exec(m.content))) {
        var code = hit[2].replace(/\n$/, "");
        if (code.trim()) out.push({ lang: hit[1].trim(), code: code, msg: i });
      }
    });
    return out.reverse().slice(0, limit || 30);
  };

  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
