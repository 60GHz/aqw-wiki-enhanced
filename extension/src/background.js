/* AQW Wiki Enhanced - background: silent inventory sync + server boost tracker.
   Works as a Chromium MV3 service worker and a Firefox MV3 event page. */
"use strict";

const api = globalThis.browser ?? globalThis.chrome;

const INVENTORY_URL = "https://account.aq.com/myapi/inventory/InventoryData";
const CALENDAR_URL = "https://www.artix.com/calendar/";
/* EDIT HERE: your Cloudflare Worker URL (docs/telemetry-worker.js). Empty =
   telemetry is fully dormant: no consent line in the popup, nothing counted
   leaves the machine, ever. See docs/TELEMETRY.md. */
const TELEMETRY_URL = "https://aqwe-telemetry.60ghz.workers.dev/";
const SYNC_ALARM = "aqwe-sync";
const BOOST_ALARM = "aqwe-boost";
const TELEMETRY_ALARM = "aqwe-telemetry";
const SYNC_PERIOD_MIN = 240;   // inventory: every 4 h (a raw fetch on the session cookie; no page ever opens)
const pageCache = new Map();   // FETCH_WIKI_PAGE LRU (url -> html)
const PAGE_CACHE_MAX = 300;

/* ---------------- Inventory sync (verified schema 2026-07-05):
   { data: [{ID, Name, Type, Count, Bank:0|1, Coins:0|1, Member:0|1, Added}], totalCount } */

async function fetchInventory(params) {
    const url = `${INVENTORY_URL}?${params}&_=${Date.now()}`;
    const res = await fetch(url, {
        credentials: "include",
        headers: {
            "accept": "application/json, text/javascript, */*; q=0.01",
            "x-requested-with": "XMLHttpRequest",
        },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (!json || !Array.isArray(json.data)) throw new Error("Not logged in");
    return json;
}

async function syncInventory() {
    // Keyset pagination on ID: immune to server-side ordering instability,
    // which is what silently dropped rows for skip/take paging.
    const sortId = encodeURIComponent('[{"selector":"ID","desc":false}]');
    const first = await fetchInventory(`skip=0&take=500&requireTotalCount=true&sort=${sortId}`);
    const total = first.totalCount ?? first.data.length;
    let rows = [...first.data];
    let lastId = rows.length ? rows[rows.length - 1].ID : 0;
    let guard = 0;
    while (rows.length < total && guard++ < 80) {
        const filter = encodeURIComponent(`[["ID",">",${lastId}]]`);
        const page = await fetchInventory(`skip=0&take=500&sort=${sortId}&filter=${filter}`);
        if (!page.data.length) break;
        rows.push(...page.data);
        lastId = page.data[page.data.length - 1].ID;
    }
    // Fallback if the server refused the filter param
    if (rows.length < total) {
        console.warn(`[AQWE] keyset got ${rows.length}/${total}; falling back to skip/take`);
        rows = [];
        for (let skip = 0; skip < total; skip += 500) {
            const page = await fetchInventory(`skip=${skip}&take=500&sort=${sortId}`);
            rows.push(...page.data);
            if (!page.data.length) break;
        }
    }

    return storeRows(rows, total);
}

/* One storage path for every source of rows: the background's own fetch AND
   the content-script fallback (incognito sessions are invisible to this
   worker, but the account page's own fetch sees them fine). */
async function storeRows(rows, serverTotal) {
    const seen = new Set();
    const items = [];
    for (const r of rows) {
        if (r.ID != null) {
            if (seen.has(r.ID)) continue;
            seen.add(r.ID);
        }
        items.push({
            n: r.Name || "", q: r.Count || 1, t: r.Type || "",
            b: r.Bank === 1, c: r.Coins === 1, m: r.Member === 1,
            a: r.Added || "",   // acquire date - feeds the New indicator
        });
    }
    console.log(`[AQWE] inventory sync: server total ${serverTotal}, stored ${items.length}`);
    tmCount("syncOk");
    const bankCount = items.filter((i) => i.b).length;
    await api.storage.local.set({
        inventory: { items, total: items.length, serverTotal, bank: bankCount, at: Date.now() },
        inventoryError: null,
        goalProgress: {},
    });
    closeLoginTab();   // whichever path synced, the login page has done its job
    return { total: items.length, serverTotal, bank: bankCount };
}

async function trySync() {
    try {
        return { ok: true, ...(await syncInventory()) };
    } catch {
        // The API session can idle out server-side while the login cookie is
        // still perfectly good. One silent fetch of an authenticated page
        // re-mints it - then the API works again and no page ever opens.
        try {
            await fetch("https://account.aq.com/AQW/Inventory", { credentials: "include" }).catch(() => {});
            return { ok: true, ...(await syncInventory()) };
        } catch (err) {
            await api.storage.local.set({ inventoryError: String(err && err.message || err) });
            tmCount("syncFail");
            return { ok: false, error: String(err && err.message || err) };
        }
    }
}

/* Any page already open on account.aq.com - any window, incognito included -
   can sync in place through its content script. Ask them all before even
   thinking about opening a page. */
async function syncViaOpenTabs() {
    const tabs = await api.tabs.query({ url: "*://account.aq.com/*" }).catch(() => []);
    for (const t of tabs || []) {
        const res = await api.tabs.sendMessage(t.id, { type: "SYNC_HERE" }).catch(() => null);
        if (res && res.ok) return true;
    }
    return false;
}

/* If a sync fails, the popup asks us to open the Inventory page. It opens
   QUIETLY (active: false): when the session is alive there, the content
   script syncs and we close it before anyone notices; only when a real
   login is needed does the tab ask for focus (LOGIN_NEEDED below). */
async function openLoginTab() {
    const tab = await api.tabs.create({ url: "https://account.aq.com/AQW/Inventory", active: false });
    await api.storage.local.set({ loginTabId: tab.id });
}
async function closeLoginTab() {
    const { loginTabId } = await api.storage.local.get({ loginTabId: null });
    if (loginTabId == null) return;
    await api.storage.local.set({ loginTabId: null });
    api.tabs.remove(loginTabId).catch?.(() => {});
}
api.tabs.onRemoved.addListener(async (tabId) => {
    const { loginTabId } = await api.storage.local.get({ loginTabId: null });
    if (tabId === loginTabId) api.storage.local.set({ loginTabId: null });
});

/* ---------------- Server boost tracker (Artix calendar).
   Core boosts: Double XP / Class / Rep / Gold / Everything.
   Event boosts (e.g. Nulgath drop boosts) ride along as a second, orange card.
   Durations per the calendar's convention: weekday boosts 48 h, Friday 72 h. */

function boostEnd(start, rawEnd, kind) {
    let end = rawEnd ? new Date(rawEnd + "T00:00:00") : null;
    if (!end || isNaN(end)) {
        end = new Date(start);
        // Core doubles run 48 h (72 h from Friday); resource/event boosts are daily.
        end.setDate(end.getDate() + (kind === "event" ? 1 : start.getDay() === 5 ? 3 : 2));
    }
    return end;
}

async function fetchBoosts() {
    try {
        const res = await fetch(CALENDAR_URL);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const html = await res.text();
        const now = new Date();

        let core = null, event = null;
        const re = /title:\s*'([^']+)'[\s\S]{0,400}?start:\s*'([^']+)'/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const text = m[1].replace(/\\u[\dA-F]{4}/gi, (u) => String.fromCharCode(parseInt(u.slice(2), 16))).trim();
            const lower = text.toLowerCase();
            const start = new Date(m[2] + "T00:00:00");
            if (isNaN(start) || start > now) continue;

            const kind =
                lower.includes("double exp") ? "xp" :
                lower.includes("double class") ? "class" :
                lower.includes("double rep") ? "rep" :
                lower.includes("double gold") ? "gold" :
                lower.includes("double all") ? "all" :
                /boost/i.test(text) ? "event" : null;
            if (!kind) continue;

            const endM = html.slice(m.index, m.index + 400).match(/end:\s*'([^']+)'/);
            const end = boostEnd(start, endM && endM[1], kind);
            if (end <= now) continue;   // boost already over

            const entry = {
                kind,
                label: text.replace(/\s+\d{1,2}\.\d{1,2}\.\d{2,4}$/, "").trim(),
                ends: end.toLocaleDateString(undefined, { weekday: "long" }),
                start: +start,
            };
            if (kind === "event") {
                if (!event || entry.start > event.start) event = entry;
            } else {
                if (!core || entry.start > core.start) core = entry;
            }
        }
        const list = [core, event].filter(Boolean);
        await api.storage.local.set({ boost: { list, at: Date.now() } });
    } catch {
        /* keep the previous cache on failure */
    }
}

/* ---------------- Telemetry (docs/TELEMETRY.md): counters only, opt-in
   only, and only when a worker URL is configured above. One anonymous POST
   a week: version, browser family, theme, and the week's feature counters.
   Nothing identifying, nothing from account.aq.com, no IDs of any kind. */

async function sendTelemetry() {
    if (!TELEMETRY_URL) return;
    const st = await api.storage.local.get({ telemetry: null, tmCounts: {}, tmLastSend: 0, theme: "good" });
    if (!st.telemetry || !st.telemetry.enabled) return;
    if (Date.now() - st.tmLastSend < 6.5 * 864e5) return;   // one ping a week
    try {
        const res = await fetch(TELEMETRY_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                v: api.runtime.getManifest().version,
                b: navigator.userAgent.includes("Firefox") ? "firefox" : "chromium",
                theme: st.theme,
                counts: st.tmCounts,
            }),
        });
        if (res.ok) await api.storage.local.set({ tmCounts: {}, tmLastSend: Date.now() });
    } catch { /* next daily alarm retries */ }
}

/* count() for the background's own events (sync outcomes) - rare, so a
   plain read-modify-write is fine here. */
async function tmCount(key) {
    if (!TELEMETRY_URL) return;
    const st = await api.storage.local.get({ tmCounts: {} });
    st.tmCounts[key] = (st.tmCounts[key] || 0) + 1;
    await api.storage.local.set({ tmCounts: st.tmCounts });
}

/* ---------------- Scheduling: inventory every 4 h; boosts daily at local
   midnight (the calendar is day-granular) plus on every browser startup. */

function scheduleAlarms() {
    api.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MIN, delayInMinutes: 1 });
    const midnight = new Date();
    midnight.setHours(24, 0, 30, 0);   // next local midnight (+30 s of slack)
    api.alarms.create(BOOST_ALARM, { when: +midnight, periodInMinutes: 1440 });
    api.alarms.create(TELEMETRY_ALARM, { periodInMinutes: 1440, delayInMinutes: 20 });
}

api.runtime.onInstalled.addListener(async () => {
    scheduleAlarms();
    const cur = await api.storage.local.get({ theme: null, hoverMode: null });
    await api.storage.local.set({
        theme: cur.theme || "good",
        hoverMode: cur.hoverMode || "clean",
        telemetryAvailable: !!TELEMETRY_URL,   // the popup shows its consent line only when true
    });
    fetchBoosts();
    trySync();
});
api.runtime.onStartup.addListener(() => {
    scheduleAlarms();
    api.storage.local.set({ telemetryAvailable: !!TELEMETRY_URL });
    fetchBoosts();
    trySync();
});

api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) trySync();
    if (alarm.name === BOOST_ALARM) fetchBoosts();
    if (alarm.name === TELEMETRY_ALARM) sendTelemetry();
});

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "SYNC_NOW") {
        trySync().then(sendResponse);
        return true;
    }
    if (msg && msg.type === "STORE_INVENTORY") {
        if (Array.isArray(msg.rows) && msg.rows.length) {
            storeRows(msg.rows, msg.total ?? msg.rows.length)
                .then((r) => sendResponse({ ok: true, ...r }))
                .catch((e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
        } else {
            sendResponse({ ok: false, error: "no rows" });
        }
        return true;
    }
    if (msg && msg.type === "OPEN_LOGIN") {
        syncViaOpenTabs().then(async (viaTab) => {
            if (!viaTab) await openLoginTab();
            sendResponse({ ok: true, viaTab });
        });
        return true;
    }
    if (msg && msg.type === "LOGIN_NEEDED" && _sender && _sender.tab) {
        // Our quiet login tab found no session - now it earns the focus.
        api.storage.local.get({ loginTabId: null }).then(({ loginTabId }) => {
            if (_sender.tab.id === loginTabId) api.tabs.update(loginTabId, { active: true });
            sendResponse({ ok: true });
        });
        return true;
    }
    if (msg && msg.type === "REFRESH_BOOSTS") {
        fetchBoosts().then(() => sendResponse({ ok: true }));
        return true;
    }
    if (msg && msg.type === "FETCH_WIKI_PAGE") {
        // One scheme for every caller: CharPage links, Armory rows and the
        // goal pages all arrive as http://, and Firefox's extension pages
        // refuse insecure fetches (its default CSP upgraded them straight
        // into wikidot's https->http redirect and looped forever - see
        // manifest.firefox.json). https also means one cache key per page.
        const url = String(msg.url || "").replace(/^http:\/\//i, "https://");
        // Hover previews ask for the same pages over and over (Armory,
        // CharPage, goals). A small LRU keeps them hot: repeat hovers render
        // instantly and wikidot sees fewer requests.
        if (pageCache.has(url)) {
            const html = pageCache.get(url);
            pageCache.delete(url);
            pageCache.set(url, html);   // refresh LRU position
            sendResponse({ ok: true, html });
            return false;
        }
        fetch(url)
            .then((r) => (r.ok || r.status === 404 ? r.text() : Promise.reject(new Error("HTTP " + r.status))))
            .then((html) => {
                pageCache.set(url, html);
                if (pageCache.size > PAGE_CACHE_MAX) pageCache.delete(pageCache.keys().next().value);
                sendResponse({ ok: true, html });
            })
            .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
        return true;
    }
});
