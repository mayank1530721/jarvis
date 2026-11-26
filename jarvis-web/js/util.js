// Small shared helpers. Every file in js/ hangs its pieces on one global object, J,
// so the page works as plain scripts (no build step, also fine when opened from a file).
(function (root) {
  "use strict";
  var J = root.J = root.J || {};

  // Everything is kept in this browser only. Data lives in IndexedDB (hundreds of MB) with an in-memory copy so reads stay instant;
  // where IndexedDB is missing it falls back to localStorage (about 5 MB). J.storageReady resolves once the copy is loaded and any
  // old localStorage data has been moved over. Reads never throw.
  var cache = null, db = null, DB_NAME = "jarvis", OS = "kv";
  function req(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error || new Error("IndexedDB error")); }; }); }
  function txDone(t) { return new Promise(function (res, rej) { t.oncomplete = function () { res(); }; t.onerror = t.onabort = function () { rej(t.error || new Error("IndexedDB write failed")); }; }); }
  function idbPut(k, v) { var t = db.transaction(OS, "readwrite"); t.objectStore(OS).put(v, k); return txDone(t); }
  function idbDel(k) { var t = db.transaction(OS, "readwrite"); t.objectStore(OS).delete(k); return txDone(t); }
  function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  J.kv = {
    mode: function () { return cache ? "indexeddb" : "localstorage"; },
    getItem: function (k) { return cache ? (cache.has(k) ? cache.get(k) : null) : lsGet(k); },
    // Resolves when the value is really stored; rejects if the browser refused it (disk full, blocked).
    setAsync: function (k, v) {
      v = String(v);
      if (!cache) {
        try { root.localStorage.setItem(k, v); if (root.localStorage.getItem(k) !== v) throw new Error("Storage verification failed."); return Promise.resolve(); }
        catch (e) { return Promise.reject(e); }
      }
      var had = cache.has(k), prev = had ? cache.get(k) : null;
      cache.set(k, v);
      return idbPut(k, v).catch(function (e) { if (had) cache.set(k, prev); else cache.delete(k); throw e; });
    },
    setItem: function (k, v) { J.kv.setAsync(k, v).catch(function (e) { if (root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent("jarvis-storage-error", { detail: e && e.message })); }); },
    removeItem: function (k) {
      if (!cache) { try { root.localStorage.removeItem(k); } catch (e) {} return; }
      cache.delete(k); idbDel(k).catch(function () {});
    },
    keys: function () {
      if (cache) return Array.from(cache.keys());
      var out = []; try { for (var i = 0; i < root.localStorage.length; i++) out.push(root.localStorage.key(i)); } catch (e) {} return out;
    }
  };
  J.storageReady = (async function () {
    if (!root.indexedDB) return "localstorage";
    try {
      var open = root.indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = function () { open.result.createObjectStore(OS); };
      db = await req(open);
      var t = db.transaction(OS, "readonly"), store = t.objectStore(OS), keys = await req(store.getAllKeys()), vals = await req(store.getAll());
      var all = new Map(); keys.forEach(function (k, i) { all.set(k, vals[i]); });
      // Move anything an older version left in localStorage, verify it, then free that space.
      var moved = [], ls = null; try { ls = root.localStorage; } catch (e) {}
      if (ls) {
        var names = []; for (var i = 0; i < ls.length; i++) names.push(ls.key(i));
        for (var j = 0; j < names.length; j++) {
          var k = names[j]; if (!/^jarvis\./.test(k) || all.has(k)) continue;
          var v = ls.getItem(k); if (v === null) continue;
          await idbPut(k, v); all.set(k, v); moved.push(k);
        }
      }
      cache = all;
      moved.forEach(function (k) { try { root.localStorage.removeItem(k); } catch (e) {} });
      try { if (root.navigator && root.navigator.storage && root.navigator.storage.persist) root.navigator.storage.persist(); } catch (e) {}
      return "indexeddb";
    } catch (e) { cache = null; return "localstorage"; }
  })();

  J.store = {
    get: function (k, d) {
      try { var v = J.kv.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { J.kv.setItem(k, JSON.stringify(v)); } catch (e) {} },
    remove: function (k) { try { J.kv.removeItem(k); } catch (e) {} }
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
