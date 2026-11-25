// ULTRON's hands: a small client for the JARVIS desktop agent (desktop-agent/agent.py) running on this
// computer. Listing and reading files is free; writing a file and running a command are shown to the
// user for approval by the page before they are sent here. The agent itself keeps files inside one
// workspace folder. The token stays in this browser and is only sent to the agent address you save.
(function (root) {
  "use strict";
  var J = root.J = root.J || {};
  var DEFAULT_BASE = "http://127.0.0.1:8765";
  var MAX_TO_MODEL = 24000;      // most file text handed back to the model in one reply
  var DIFF_LINES = 40;           // most changed lines shown in an approval box

  function clean(base) { return String(base || DEFAULT_BASE).trim().replace(/\/+$/, ""); }

  // One call to the agent. Throws an Error with a plain-English message.
  async function call(base, token, path, body) {
    var url = clean(base) + path, res, data;
    try {
      res = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      throw new Error("Can't reach the desktop agent at " + clean(base) + ". Is agent.py running on this computer, and is this page one it allows?");
    }
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401) throw new Error("The desktop agent rejected the token. It changes every time agent.py restarts; paste the new one in Settings.");
    if (!res.ok || !data || data.ok === false) {
      var err = new Error((data && data.error) || ("Desktop agent error " + res.status));
      err.status = res.status; throw err;
    }
    return data;
  }

  // Cut text for the model, saying so when something was left out.
  function forModel(text, what) {
    text = String(text == null ? "" : text);
    if (text.length <= MAX_TO_MODEL) return text;
    return text.slice(0, MAX_TO_MODEL) + "\n[" + (what || "text") + " cut: showing the first " + MAX_TO_MODEL + " of " + text.length + " characters]";
  }

  // A compact before/after: trim the lines that did not change at both ends, show the rest.
  function lineDiff(oldText, newText) {
    var a = String(oldText || "").split("\n"), b = String(newText || "").split("\n");
    var s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    var ea = a.length, eb = b.length;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    var removed = a.slice(s, ea), added = b.slice(s, eb);
    var lines = removed.map(function (l) { return "- " + l; }).concat(added.map(function (l) { return "+ " + l; }));
    var more = lines.length > DIFF_LINES ? lines.length - DIFF_LINES : 0;
    return { removed: removed.length, added: added.length, startLine: s + 1, text: lines.slice(0, DIFF_LINES).join("\n") + (more ? "\n... and " + more + " more changed lines" : "") };
  }

  // Text for the approval box when ULTRON wants to write a file. oldText is null for a new file.
  function describeWrite(path, oldText, newText) {
    var n = String(newText || "");
    if (oldText === null || oldText === undefined)
      return "NEW FILE  " + path + "\n" + n.split("\n").length + " lines, " + n.length + " characters\n\n" + n.split("\n").slice(0, DIFF_LINES).map(function (l) { return "+ " + l; }).join("\n") +
        (n.split("\n").length > DIFF_LINES ? "\n... and " + (n.split("\n").length - DIFF_LINES) + " more lines" : "");
    if (oldText === n) return "NO CHANGE  " + path + "\nThe new content is identical to what is already there.";
    var d = lineDiff(oldText, n);
    return "EDIT  " + path + "\n" + d.removed + " line(s) removed, " + d.added + " added, starting at line " + d.startLine + "\n\n" + d.text;
  }

  function describeRun(command, cwd, timeout) {
    return "RUN COMMAND\n  " + command + "\n\nstarts in: " + (cwd ? "workspace/" + cwd : "the workspace folder") +
      "\nstops after: " + (Number(timeout) || 60) + " seconds\n\nThis runs with your normal permissions on this computer, so read it before approving.";
  }

  // What the model is told after a command ran.
  function formatRun(r) {
    var head = r.timed_out ? "The command timed out after " + r.seconds + "s and was stopped." : "Exit code " + r.exit_code + " after " + r.seconds + "s" + (r.exit_code === 0 ? " (success)." : " (failed).");
    return head + "\n" + (r.output ? forModel(r.output, "output") : "[no output]");
  }

  J.hands = {
    DEFAULT_BASE: DEFAULT_BASE, clean: clean, call: call, forModel: forModel, lineDiff: lineDiff,
    describeWrite: describeWrite, describeRun: describeRun, formatRun: formatRun,
    status: function (base, token) { return call(base, token, "/api/status"); },
    list: function (base, token, path) { return call(base, token, "/fs/list", { path: path || "" }); },
    read: function (base, token, path) { return call(base, token, "/fs/read", { path: path }); },
    // Resolves to the current text of a file, or null when it does not exist yet.
    readOrNull: async function (base, token, path) {
      try { return (await call(base, token, "/fs/read", { path: path })).content; }
      catch (e) { if (e.status === 404) return null; throw e; }
    },
    write: function (base, token, path, content) { return call(base, token, "/fs/write", { path: path, content: content }); },
    put: function (base, token, path, url, contentType) { return call(base, token, "/fs/put", { path: path, url: url, contentType: contentType }); },
    clipSearch: function (base, token, query, cc, n) { return call(base, token, "/clip/search", { query: query, cc: !!cc, n: n || 8 }); },
    clipFetch: function (base, token, url) { return call(base, token, "/clip/fetch", { url: url }); },
    clipCut: function (base, token, source, segments, vertical) { return call(base, token, "/clip/cut", { source: source, segments: segments, vertical: !!vertical }); },
    run: function (base, token, command, cwd, timeout) { return call(base, token, "/run", { command: command, cwd: cwd || "", timeout: timeout || 60 }); }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
