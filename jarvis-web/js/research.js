// VISION's research tools. Reads Wikipedia's public API, which a web page is allowed to call directly,
// so it needs no key and no server. Results are plain text with the source link, clipped so one lookup
// cannot flood the model's context. Nothing here can change anything; it only reads.
(function (root) {
  var J = root.J = root.J || {};
  var API = "https://en.wikipedia.org/w/api.php";
  var MAX_EXTRACT = 6000;

  function clean(html) {   // search snippets arrive with <span class="searchmatch"> and entities
    return String(html || "").replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  }
  function pageUrl(title) { return "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(title).replace(/ /g, "_")); }
  function clip(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n) + "\n[cut: the article is longer; ask for a more specific page or section topic]" : s; }

  async function get(params, f) {
    var q = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    var res = await (f || root.fetch)(API + "?format=json&origin=*&" + q);
    if (!res.ok) throw new Error("Wikipedia answered " + res.status + ".");
    return res.json();
  }

  J.research = {
    clean: clean, pageUrl: pageUrl,
    // Returns [{title, snippet, url}]
    search: async function (query, f) {
      query = String(query || "").trim();
      if (!query) throw new Error("No search query was given.");
      var d = await get({ action: "query", list: "search", srsearch: query, srlimit: 6 }, f);
      return ((d.query && d.query.search) || []).map(function (r) { return { title: r.title, snippet: clean(r.snippet), url: pageUrl(r.title) }; });
    },
    // Returns {title, text, url} or null when there is no such page.
    read: async function (title, f) {
      title = String(title || "").trim();
      if (!title) throw new Error("No page title was given.");
      var d = await get({ action: "query", prop: "extracts", explaintext: 1, exlimit: 1, redirects: 1, titles: title }, f);
      var pages = (d.query && d.query.pages) || {}, p = pages[Object.keys(pages)[0]];
      if (!p || p.missing !== undefined || !p.extract) return null;
      return { title: p.title, text: clip(p.extract, MAX_EXTRACT), url: pageUrl(p.title) };
    },
    formatSearch: function (list) {
      if (!list.length) return "No Wikipedia pages matched. Try different words, or say plainly that you could not find it.";
      return list.map(function (r, i) { return (i + 1) + ". " + r.title + " - " + r.snippet + "\n   " + r.url; }).join("\n");
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = J;
})(typeof window !== "undefined" ? window : globalThis);
