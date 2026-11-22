// Tiny relay so the Jarvis web page can talk to Uplika. Deploy it on Cloudflare Workers (free).
// It only forwards GET /v1/accounts and POST /v1/posts, only for your Jarvis page, and stores nothing:
// your Uplika key travels from your browser to this worker to Uplika, and nowhere else.
const ALLOWED_ORIGIN = "https://mayank1530721.github.io";   // change if your Jarvis page lives elsewhere
const UPSTREAM = "https://api.uplika.com";

export default {
  async fetch(req) {
    const origin = req.headers.get("Origin") || "";
    const ok = origin === ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGIN,
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Vary": "Origin"
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!ok) return new Response("Forbidden origin", { status: 403, headers: cors });
    const url = new URL(req.url);
    const allowed = (req.method === "GET" && url.pathname === "/v1/accounts") || (req.method === "POST" && url.pathname === "/v1/posts");
    if (!allowed) return new Response("Not allowed", { status: 404, headers: cors });
    const upstream = await fetch(UPSTREAM + url.pathname, {
      method: req.method,
      headers: { authorization: req.headers.get("authorization") || "", "content-type": "application/json" },
      body: req.method === "POST" ? req.body : undefined
    });
    const headers = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
