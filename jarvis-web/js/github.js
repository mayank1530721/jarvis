// ULTRON's connection to GitHub. Reads repositories freely; every change is planned first, shown to the
// user for approval, and then committed to a NEW branch with a pull request. It never writes to the
// default branch and never merges. The token stays in this browser and is only sent to api.github.com.
(function (root) {
  "use strict";
  var J = root.J = root.J || {};
  var API = "https://api.github.com";
  var MAX_FILES = 10, MAX_FILE = 200000, MAX_READ = 12000;

  function b64enc(text) {
    var bytes = new TextEncoder().encode(text), bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64dec(b64) {
    var bin = atob(String(b64).replace(/\s/g, "")), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  // "owner/repo", "https://github.com/owner/repo(.git)" -> {owner, repo}, otherwise null.
  function parseRepo(s) {
    var m = /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(String(s || "").trim());
    return m ? { owner: m[1], repo: m[2] } : null;
  }
  function safePath(p) {
    p = String(p || "").replace(/^\/+/, "");
    if (!p || /(^|\/)\.\.(\/|$)/.test(p) || /[\0\\]/.test(p)) return null;
    return p;
  }
  function slug(s) { return String(s || "change").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "change"; }
  function enc(p) { return p.split("/").map(encodeURIComponent).join("/"); }

  function explain(status, body) {
    var msg = body && body.message ? String(body.message) : "";
    if (status === 401) return "GitHub rejected the token. Check it in Settings, or make a new one.";
    if (status === 403 && /rate limit/i.test(msg)) return "GitHub rate limit reached. Try again in a few minutes.";
    if (status === 403 || (status === 404 && /not found/i.test(msg))) return "GitHub says no access (" + (msg || status) + "). The repository may not exist, or the token was not given that repository or the Contents / Pull requests permissions.";
    if (status === 422) return "GitHub refused the change: " + (msg || "invalid request") + ".";
    return "GitHub error " + status + (msg ? ": " + msg : "") + ".";
  }
  async function call(token, method, path, payload) {
    if (!token) throw new Error("No GitHub token. Add one in Settings.");
    var res;
    try {
      res = await fetch(API + path, {
        method: method,
        headers: Object.assign({ authorization: "Bearer " + token, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }, payload ? { "content-type": "application/json" } : {}),
        body: payload ? JSON.stringify(payload) : undefined
      });
    } catch (e) { throw new Error("Could not reach GitHub. Check your internet. " + e.message); }
    var body = null; try { body = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) { var err = new Error(explain(res.status, body)); err.status = res.status; throw err; }
    return body;
  }
  function need(repo) { var r = parseRepo(repo); if (!r) throw new Error('Repository must look like "owner/name".'); return r; }

  async function repos(token) {
    var list = await call(token, "GET", "/user/repos?per_page=50&sort=pushed");
    return (list || []).map(function (r) { return { name: r.full_name, private: !!r.private, branch: r.default_branch, pushed: r.pushed_at }; });
  }

  // A file's text, or a directory's entries.
  async function read(token, repo, path, ref) {
    var r = need(repo), p = path ? safePath(path) : "";
    if (path && p === null) throw new Error("That path is not allowed.");
    var q = ref ? "?ref=" + encodeURIComponent(ref) : "";
    var d = await call(token, "GET", "/repos/" + r.owner + "/" + r.repo + "/contents/" + (p ? enc(p) : "") + q);
    if (Array.isArray(d)) return { type: "dir", entries: d.map(function (e) { return e.name + (e.type === "dir" ? "/" : ""); }) };
    if (d.type !== "file" || d.encoding !== "base64") return { type: d.type || "other", text: "(not a text file)", sha: d.sha };
    var text = b64dec(d.content);
    return { type: "file", text: text.slice(0, MAX_READ), truncated: text.length > MAX_READ, size: d.size, sha: d.sha };
  }

  // Work out exactly what a change would do, without changing anything.
  async function plan(token, spec) {
    var r = need(spec.repo), files = spec.files || [];
    if (!files.length) throw new Error("No files given.");
    if (files.length > MAX_FILES) throw new Error("At most " + MAX_FILES + " files per change.");
    var info = await call(token, "GET", "/repos/" + r.owner + "/" + r.repo);
    var base = info.default_branch, out = [];
    for (var i = 0; i < files.length; i++) {
      var path = safePath(files[i].path), content = String(files[i].content == null ? "" : files[i].content);
      if (!path) throw new Error("Path not allowed: " + files[i].path);
      if (content.length > MAX_FILE) throw new Error(path + " is too large for one change.");
      var sha = null, before = "";
      try {
        var cur = await call(token, "GET", "/repos/" + r.owner + "/" + r.repo + "/contents/" + enc(path) + "?ref=" + encodeURIComponent(base));
        if (Array.isArray(cur) || cur.type !== "file") throw new Error(path + " is a folder, not a file.");
        sha = cur.sha; before = b64dec(cur.content);
      } catch (e) { if (e.status !== 404) throw e; }
      out.push({ path: path, content: content, sha: sha, action: sha ? (before === content ? "same" : "edit") : "new", lines: content.split("\n").length, oldLines: sha ? before.split("\n").length : 0 });
    }
    var changed = out.filter(function (f) { return f.action !== "same"; });
    if (!changed.length) throw new Error("Nothing would change: every file already has that content.");
    return { owner: r.owner, repo: r.repo, base: base, branch: "ultron/" + slug(spec.branch || spec.message),
             message: String(spec.message || "Update from ULTRON").slice(0, 200), pr: spec.pr !== false, prTitle: String(spec.prTitle || spec.message || "Update from ULTRON").slice(0, 200),
             prBody: String(spec.prBody || "Proposed by ULTRON (Jarvis). Review before merging."), files: changed };
  }
  function describe(p) {
    return p.owner + "/" + p.repo + "\nNew branch: " + p.branch + "  (from " + p.base + ")\nCommit: " + p.message + "\n" + (p.pr ? "A pull request will be opened. Nothing is merged." : "No pull request.") + "\n\n" +
      p.files.map(function (f) { return (f.action === "new" ? "NEW   " : "EDIT  ") + f.path + "  (" + (f.action === "new" ? f.lines + " lines" : f.oldLines + " -> " + f.lines + " lines") + ")"; }).join("\n");
  }

  // Do a plan the user approved. Always a new branch; never the default one.
  async function apply(token, p) {
    var base = "/repos/" + p.owner + "/" + p.repo;
    if (p.branch === p.base) throw new Error("Refusing to write to the default branch.");
    var head = await call(token, "GET", base + "/git/ref/heads/" + encodeURIComponent(p.base).replace(/%2F/g, "/"));
    var branch = p.branch;
    async function makeBranch(name) { return call(token, "POST", base + "/git/refs", { ref: "refs/heads/" + name, sha: head.object.sha }); }
    try { await makeBranch(branch); }
    catch (e) { if (e.status !== 422) throw e; branch = p.branch + "-" + Date.now().toString(36); await makeBranch(branch); }
    for (var i = 0; i < p.files.length; i++) {
      var f = p.files[i];
      await call(token, "PUT", base + "/contents/" + enc(f.path), { message: p.message, content: b64enc(f.content), branch: branch, sha: f.sha || undefined });
    }
    var url = "https://github.com/" + p.owner + "/" + p.repo + "/tree/" + branch;
    if (p.pr) {
      var pr = await call(token, "POST", base + "/pulls", { title: p.prTitle, head: branch, base: p.base, body: p.prBody });
      url = pr.html_url || url;
    }
    return { branch: branch, url: url, files: p.files.length, pr: !!p.pr };
  }

  J.github = { parseRepo: parseRepo, safePath: safePath, slug: slug, b64enc: b64enc, b64dec: b64dec, explain: explain, repos: repos, read: read, plan: plan, describe: describe, apply: apply };
  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
