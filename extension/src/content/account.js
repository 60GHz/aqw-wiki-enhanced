/* AQW Wiki Enhanced - account.aq.com companion.
   Whenever the user is on the account site (so the session is certainly alive),
   ask the background to refresh the inventory. No buttons, no UI.

   If the background cannot see the session - incognito windows keep their
   cookies away from the worker - this page can: a content-script fetch runs
   with the page's own cookie jar. So on failure we sync from here (same
   keyset pagination) and hand the rows to the background to store. The
   background can also ask us directly (SYNC_HERE) when the popup's refresh
   fails, so an already-open account tab syncs without any page opening. */
"use strict";

async function aqweSelfSync() {
    try {
        const fetchPage = async (params) => {
            const r = await fetch(`https://account.aq.com/myapi/inventory/InventoryData?${params}&_=${Date.now()}`, {
                credentials: "include",
                headers: {
                    "accept": "application/json, text/javascript, */*; q=0.01",
                    "x-requested-with": "XMLHttpRequest",
                },
            });
            if (!r.ok) throw new Error("HTTP " + r.status);
            const json = await r.json();
            if (!json || !Array.isArray(json.data)) throw new Error("Not logged in");
            return json;
        };
        const sortId = encodeURIComponent('[{"selector":"ID","desc":false}]');
        const first = await fetchPage(`skip=0&take=500&requireTotalCount=true&sort=${sortId}`);
        const total = first.totalCount ?? first.data.length;
        const rows = [...first.data];
        let lastId = rows.length ? rows[rows.length - 1].ID : 0;
        let guard = 0;
        while (rows.length < total && guard++ < 80) {
            const filter = encodeURIComponent(`[["ID",">",${lastId}]]`);
            const page = await fetchPage(`skip=0&take=500&sort=${sortId}&filter=${filter}`);
            if (!page.data.length) break;
            rows.push(...page.data);
            lastId = page.data[page.data.length - 1].ID;
        }
        const res = await AQWE.send({ type: "STORE_INVENTORY", rows, total });
        return !!(res && res.ok);
    } catch {
        return false;   // not logged in here either - the popup copy says what to do
    }
}

AQWE.api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "SYNC_HERE") {
        aqweSelfSync().then((ok) => sendResponse({ ok }));
        return true;
    }
});

(async () => {
    const res = await AQWE.send({ type: "SYNC_NOW" }).catch(() => null);
    if (res && res.ok) return;
    const ok = await aqweSelfSync();
    // If this page was opened quietly by the extension and there is no
    // session to read, a human has to log in - ask for the spotlight.
    if (!ok) AQWE.send({ type: "LOGIN_NEEDED" });
})();
