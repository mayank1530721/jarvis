// Talking to the AI model over any OpenAI-compatible API (Gemini by default).
// Handles streaming, retries, backup models and tool calls.
(function (root) {
  "use strict";
  var J = root.J = root.J || {};
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // Read a streamed (server-sent events) reply, calling onToken with the text so far.
  async function readStream(res, onToken, bump) {
    var reader = res.body.getReader(), dec = new TextDecoder();
    var buf = "", content = "", calls = [];
    while (true) {
      var r = await reader.read();
      if (r.done) break;
      if (bump) bump();
      buf += dec.decode(r.value, { stream: true });
      var i;
      while ((i = buf.indexOf("\n")) >= 0) {
        var line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        var data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        var j; try { j = JSON.parse(data); } catch (e) { continue; }
        var d = j.choices && j.choices[0] && j.choices[0].delta;
        if (!d) continue;
        if (d.content) { content += d.content; if (onToken) onToken(content); }
        for (var k = 0; k < (d.tool_calls || []).length; k++) {
          var tc = d.tool_calls[k], call;
          var slot = tc.index !== undefined ? calls[tc.index] : undefined;
          // A chunk that arrives with a different id than the call already in its slot is a new
          // call. Some providers number every parallel call 0; without this they get merged.
          var sameCall = slot && !(tc.id && slot.id && tc.id !== slot.id);
          if (sameCall) call = slot;
          else if ((tc.function && tc.function.name) || tc.id) {
            call = { id: tc.id || "", type: "function", function: { name: "", arguments: "" } };
            if (tc.index !== undefined && !slot) calls[tc.index] = call; else calls.push(call);
          } else call = calls[calls.length - 1];
          if (!call) continue;
          if (tc.id) call.id = tc.id;
          if (tc.function && tc.function.name) call.function.name = tc.function.name;
          if (tc.function && tc.function.arguments) call.function.arguments += tc.function.arguments;
          // Gemini 3+ needs Google's opaque thought signature sent back unchanged with the tool call.
          if (tc.extra_content) call.extra_content = Object.assign({}, call.extra_content || {}, tc.extra_content);
        }
      }
    }
    calls = calls.filter(Boolean);
    calls.forEach(function (c, n) { if (!c.id) c.id = "call_" + Date.now() + "_" + n; });
    if (!content && !calls.length) { var e = new Error("Empty reply from the model"); e.parse = true; throw e; }
    var msg = { role: "assistant", content: content || null };
    if (calls.length) msg.tool_calls = calls;
    return msg;
  }

  // One attempt with one model. Errors are tagged: e.retry = worth trying the same model again,
  // e.next = worth trying the next backup model, e.parse = streaming itself broke (try without it).
  async function callOnce(c, model, messages, tools, onToken, stream) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 25000);   // never hang forever on "..."
    var bump = function () { clearTimeout(timer); timer = setTimeout(function () { ctl.abort(); }, 25000); };
    var timeoutErr = function () { var e = new Error("Timed out waiting for the model"); e.retry = e.next = true; return e; };
    var res;
    try {
      var body = { model: model, messages: messages, stream: stream };
      if (tools && tools.length) { body.tools = tools; body.tool_choice = "auto"; }
      res = await fetch(c.base.replace(/\/+$/, "") + "/chat/completions", {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.key },
        body: JSON.stringify(body)
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") throw timeoutErr();
      var ne = new Error("Network problem: " + err.message); ne.retry = ne.next = true; throw ne;
    }
    if (!res.ok) {
      clearTimeout(timer);
      var detail = "";
      try {
        var raw = await res.text();
        if (raw) {
          try { var data = JSON.parse(raw); detail = (data && data.error && (data.error.message || data.error.status)) || (data && data.message) || raw; }
          catch (e2) { detail = raw; }
        }
      } catch (e3) {}
      detail = String(detail || "The provider returned no error details").replace(/\s+/g, " ").slice(0, 700);
      var he = new Error("API error " + res.status + ": " + detail);
      he.status = res.status;
      if (res.status === 429 || res.status >= 500) he.retry = he.next = true;   // busy or rate limited
      else if (res.status === 404) he.next = true;                              // model name not available
      throw he;
    }
    try {
      if (!stream) return (await res.json()).choices[0].message;
      return await readStream(res, onToken, bump);
    } catch (err2) {
      if (err2.retry || err2.next) throw err2;
      if (err2.name === "AbortError") throw timeoutErr();
      err2.parse = true; throw err2;
    } finally { clearTimeout(timer); }
  }

  // Keep the request aligned to a complete conversation turn. Gemini rejects a transcript that
  // starts with an assistant function call, which a blind "last 30 messages" slice can produce.
  function recentHistory(history, limit) {
    limit = limit || 30;
    var start = Math.max(0, history.length - limit);
    while (start < history.length && history[start] && history[start].role !== "user") start++;
    // A long run of tool calls (a build-test-fix loop) can have no user message after the cut. Never send
    // an empty transcript or lose the task itself: step back to the user message that started this run.
    if (start >= history.length) {
      for (var j = history.length - 1; j >= 0; j--) { if (history[j] && history[j].role === "user") { start = j; break; } }
      if (start >= history.length) start = 0;
    }
    return history.slice(start);
  }

  // In a long build-test-fix loop old command output and file text pile up and would overflow the model's
  // context. Keep the newest tool results whole and shorten the older ones. Returns a new array.
  function compactToolResults(messages, keep, max) {
    keep = keep === undefined ? 6 : keep; max = max || 2000;
    var seen = 0, out = messages.slice();
    for (var i = out.length - 1; i >= 0; i--) {
      if (!out[i] || out[i].role !== "tool") continue;
      seen++;
      var text = String(out[i].content == null ? "" : out[i].content);
      if (seen > keep && text.length > max)
        out[i] = Object.assign({}, out[i], { content: text.slice(0, max) + "\n[older result shortened: " + (text.length - max) + " more characters omitted]" });
    }
    return out;
  }

  // opts: { cfg, system, history, tools, status(text), onToken(text) }
  async function callProvider(opts) {
    var c = opts.cfg;
    var models = [c.model].concat(String(c.fallbacks || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean))
      .filter(function (m, i, a) { return m && a.indexOf(m) === i; });
    var messages = [{ role: "system", content: opts.system }].concat(compactToolResults(recentHistory(opts.history, 30)));
    var lastErr, stream = true;
    for (var i = 0; i < models.length; i++) {
      for (var attempt = 0; attempt < 2; attempt++) {
        try { return await callOnce(c, models[i], messages, opts.tools, opts.onToken, stream); }
        catch (e) {
          lastErr = e;
          if (e.parse && stream) { stream = false; attempt--; continue; }   // streaming broke: retry plainly
          if (!e.next) throw e;                 // e.g. wrong key: retrying will not help
          if (e.retry && attempt === 0) {
            if (opts.status) opts.status("Model busy, retrying...");
            await sleep(2000);
          } else break;
        }
      }
      if (i < models.length - 1 && opts.status) opts.status("Switching to backup model " + models[i + 1] + "...");
    }
    throw lastErr;
  }

  // Same as callProvider, plus an optional second provider (opts.alt = { cfg, label }). If the first one fails for
  // any provider reason (rate limit, outage, network, wrong key or model), the same request goes to the second, so
  // Groq and Gemini back each other up. If both fail, the error says so.
  async function call(opts) {
    try { return await callProvider(opts); }
    catch (e) {
      var alt = opts.alt;
      if (!alt || !alt.cfg || !alt.cfg.key || !(e.next || e.status)) throw e;
      if (opts.status) opts.status("That provider failed, trying " + (alt.label || "the backup provider") + "...");
      try { return await callProvider(Object.assign({}, opts, { cfg: alt.cfg, alt: null })); }
      catch (e2) { e.message = e.message + " | " + (alt.label || "Backup provider") + " also failed: " + e2.message; throw e; }
    }
  }

  // Checks a key by asking the provider for its model list (free, no tokens used). Returns { ok, message, models }.
  // The messages are written for a person, because "API error 401" does not say what to do.
  async function testKey(base, key, wantModel, f) {
    key = String(key || "").trim();
    if (!key) return { ok: false, message: "No key is saved. Paste it in the field above first." };
    if (/\s/.test(key)) return { ok: false, message: "The key contains a space or line break. Paste it again without anything around it." };
    var res;
    try { res = await (f || root.fetch)(String(base).replace(/\/+$/, "") + "/models", { headers: { Authorization: "Bearer " + key } }); }
    catch (e) { return { ok: false, message: "Could not reach the service. Check your internet, or an ad blocker or VPN blocking it." }; }
    if (res.status === 401 || res.status === 403) return { ok: false, message: "The service rejected this key (" + res.status + "). Copy it again from the provider's console, with no extra characters, and make sure it is a key for this service." };
    if (res.status === 429) return { ok: true, message: "The key looks valid, but the service says you are being rate limited right now. Try again in a minute." };
    if (!res.ok) return { ok: false, message: "The service answered with an error (" + res.status + "). Try again in a moment." };
    var data = {}; try { data = await res.json(); } catch (e) { /* fine */ }
    var models = ((data && data.data) || []).map(function (m) { return m.id; });
    var has = !wantModel || !models.length || models.indexOf(wantModel) >= 0;
    return { ok: true, models: models, message: "The key works." + (has ? "" : " But the model \"" + wantModel + "\" is not on your account's list, so pick another one (for example " + models.slice(0, 3).join(", ") + ").") };
  }

  J.model = { testKey: testKey, call: call, callProvider: callProvider, readStream: readStream, recentHistory: recentHistory, compactToolResults: compactToolResults };
  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
