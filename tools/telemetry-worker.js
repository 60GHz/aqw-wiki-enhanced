/* AQW Wiki Enhanced - telemetry worker (Cloudflare, free tier).
   One KV write per weekly ping (no read-modify-write races), 90-day TTL.
   GET /stats aggregates the current ISO week on demand.

   Deploy (all free, ~5 minutes):
   1. dash.cloudflare.com -> Workers & Pages -> Create Worker -> paste this file.
   2. Storage & Databases -> KV -> create a namespace named COUNTS.
   3. Worker -> Settings -> Bindings -> add KV binding: variable COUNTS -> that namespace.
   4. Copy the worker URL (https://<name>.<account>.workers.dev) into
      TELEMETRY_URL at the top of extension/src/background.js and rebuild.

   Free-tier budget: 100k requests + 1k KV writes per DAY. One write per
   user per week means ~7,000 weekly users fit the free write quota; past
   that, batch pings into Workers Analytics Engine or pay the $5 tier. */

function isoWeek(d = new Date()) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t - yearStart) / 864e5 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export default {
    async fetch(req, env) {
        const url = new URL(req.url);

        if (req.method === "POST") {
            let body;
            try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
            // counters only: reject anything that smells like more than numbers
            const counts = {};
            for (const [k, v] of Object.entries(body.counts || {})) {
                if (typeof v === "number" && /^[a-zA-Z]{1,32}$/.test(k)) counts[k] = Math.min(Math.floor(v), 1e6);
            }
            const ping = {
                v: String(body.v || "").slice(0, 16),
                b: body.b === "firefox" ? "firefox" : "chromium",
                theme: body.theme === "evil" ? "evil" : "good",
                counts,
            };
            const key = `w:${isoWeek()}:${crypto.randomUUID()}`;
            await env.COUNTS.put(key, JSON.stringify(ping), { expirationTtl: 90 * 86400 });
            return new Response("ok");
        }

        if (req.method === "GET" && url.pathname === "/stats") {
            const week = url.searchParams.get("week") || isoWeek();
            const agg = { week, pings: 0, firefox: 0, evil: 0, versions: {}, counts: {} };
            let cursor;
            do {
                const page = await env.COUNTS.list({ prefix: `w:${week}:`, cursor });
                for (const { name } of page.keys) {
                    const p = await env.COUNTS.get(name, "json");
                    if (!p) continue;
                    agg.pings++;
                    if (p.b === "firefox") agg.firefox++;
                    if (p.theme === "evil") agg.evil++;
                    agg.versions[p.v] = (agg.versions[p.v] || 0) + 1;
                    for (const [k, v] of Object.entries(p.counts || {})) agg.counts[k] = (agg.counts[k] || 0) + v;
                }
                cursor = page.list_complete ? null : page.cursor;
            } while (cursor);
            return new Response(JSON.stringify(agg, null, 1), {
                headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
            });
        }

        return new Response("AQW Wiki Enhanced telemetry. POST a ping or GET /stats.", { status: 200 });
    },
};
