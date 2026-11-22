// Connection to Uplika (social publishing). Talks to Uplika's REST API with the user's own API key.
// The key is kept only in this browser and is only ever sent to Uplika's address below.
// Nothing here posts by itself: the app asks the user to approve every post (see app.js).
(function (root) {
  "use strict";
  var J = root.J = root.J || {};
  var BASE = "https://api.uplika.com/v1";
  // If the browser blocks calls straight to Uplika, the user can point this at their own relay (uplika-relay/worker.js).
  function base() {
    var r = J.uplika && J.uplika.relay ? String(J.uplika.relay).trim().replace(/\/+$/, "") : "";
    if (!r) return BASE;
    return /\/v1$/.test(r) ? r : r + "/v1";
  }

  function list(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.data)) return body.data;
    if (body && Array.isArray(body.accounts)) return body.accounts;
    return [];
  }
  function normalizeAccounts(body) {
    return list(body).filter(function (a) { return a && a.id; }).map(function (a) {
      return { id: String(a.id), platform: String(a.platform || "?"), handle: String(a.handle || a.name || ""), status: String(a.status || "active"), health: a.health ? String(a.health) : "" };
    });
  }
  // Turn a failed request into a sentence a person can act on.
  function explain(status, body) {
    var code = body && (body.code || (body.error && body.error.code) || (typeof body.error === "string" ? body.error : ""));
    var msg = body && (body.message || (body.error && body.error.message));
    if (status === 401 || status === 403) return "Uplika rejected the API key. Check it in Settings (create a new one under API Keys in the Uplika dashboard).";
    if (code === "reconsent_required") return "That channel needs to be reconnected at https://uplika.com/dashboard/connections.";
    if (status === 429) return "Uplika says slow down (rate limit). Try again in a minute.";
    return "Uplika error " + status + (code ? " (" + code + ")" : "") + (msg ? ": " + msg : "") + ".";
  }
  async function call(key, method, path, payload) {
    if (!key) throw new Error("No Uplika API key. Add one in Settings.");
    var res;
    try {
      res = await fetch(base() + path, {
        method: method,
        headers: Object.assign({ authorization: "Bearer " + key }, payload ? { "content-type": "application/json" } : {}),
        body: payload ? JSON.stringify(payload) : undefined
      });
    } catch (e) {
      throw new Error(J.uplika.relay ? "Could not reach your Uplika relay. Check the relay address in Settings. " + e.message : "The browser blocked the call to Uplika (CORS) or you are offline. Set up the free relay in uplika-relay/ and paste its address in Settings. " + e.message);
    }
    var body = null; try { body = await res.json(); } catch (e) { /* empty or non-JSON body */ }
    if (!res.ok) throw new Error(explain(res.status, body));
    return body;
  }

  async function accounts(key) { return normalizeAccounts(await call(key, "GET", "/accounts")); }
  async function publish(key, content, accountIds) { return call(key, "POST", "/posts", { content: content, accountIds: accountIds }); }

  // Which accounts the user meant: ids, platform names or handles. No names given = every active account.
  function resolve(all, wanted) {
    var active = all.filter(function (a) { return a.status === "active" && (!a.health || a.health === "ok" || a.health === "expiring"); });
    if (!wanted || !wanted.length) return active;
    var w = wanted.map(function (x) { return String(x).toLowerCase().replace(/^@/, ""); });
    return active.filter(function (a) { return w.indexOf(a.id.toLowerCase()) >= 0 || w.indexOf(a.platform.toLowerCase()) >= 0 || w.indexOf(a.handle.toLowerCase().replace(/^@/, "")) >= 0; });
  }

  J.uplika = { BASE: BASE, relay: "", base: base, normalizeAccounts: normalizeAccounts, explain: explain, resolve: resolve, accounts: accounts, publish: publish };
  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
