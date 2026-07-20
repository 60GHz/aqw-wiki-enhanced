/* AQW Wiki Enhanced - shared helpers (content scripts + popup) */
"use strict";

const AQWE = (() => {
    const api = globalThis.browser ?? globalThis.chrome;

    const TYPE_SUFFIX_RE = /\s*\((Class|Armor|Helm|Cape|Weapon|Pet|Battle Pet|Misc|Necklace|Ground|Sword|Dagger|Axe|Mace|Polearm|Staff|Wand|Bow|Gun|HandGun|Rifle|Whip|Gauntlet|House|House Item|Floor Item|Wall Item|Quest Item|Item|Resource|Note|Boost|0 AC|AC|Non-AC|Legend|Non-Legend|Member|Merge|Rare|Special Offer|Special|Permanent|Temporary|Free Player|Quest|Infinity|VIP|Monster|Skill|Enhancement)\)\s*$/i;

    /** Normalize an item name for cross-source matching (wiki <-> inventory).
        HOT PATH: the Armory and the wiki layer key thousands of names, and
        NFKC is by far the most expensive step - pure-ASCII names (nearly
        all of them) skip it and the non-ASCII quote/dash repairs entirely. */
    function normalizeName(name) {
        let s = String(name || "");
        if (/[^\x00-\x7F]/.test(s)) {
            // escapes, never literal unicode in regex source: a mis-decoded
            // load (any non-UTF-8 embedding) turns literals into broken ranges
            s = s.normalize("NFKC").replace(/[\u2018\u2019\u02bc\u00b4]/g, "'").replace(/[\u2013\u2014\u2212]/g, "-");
        }
        s = s.replace(/`/g, "'");
        // wiki names stack suffixes ("BladeMaster (Class) (0 AC)") - peel
        // until none remain, or the second one blocks the match
        let prev;
        do { prev = s; s = s.replace(TYPE_SUFFIX_RE, ""); } while (s !== prev);
        return s
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    /** Item name -> aqwwiki slug. Wikidot's own rules, in order:
        accented letters TRANSLITERATE ("Cocar da Legião" is cocar-da-legiao,
        "Dançarinos" keeps its c) - then every run of anything else becomes a
        single hyphen, so "(Un)Lucky Cat Hoodie" stays un-lucky-cat-hoodie. */
    function nameToSlug(name) {
        let s = String(name || "").toLowerCase();
        if (/[^\x00-\x7F]/.test(s)) {
            s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        }
        return s
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    /* A tab that outlives an extension reload keeps its old content script,
       and every API call from it rejects with "Extension context invalidated".
       Nothing useful can happen in that orphan - fail silent: get() answers
       with the caller's own defaults, set() and send() become no-ops. */
    /** normalizeName WITHOUT the type-suffix strip - for items whose real
        in-game name carries the parenthetical, like "Shadow Orb (Rare)". */
    function normalizeFull(name) {
        let s = String(name || "");
        if (/[^\x00-\x7F]/.test(s)) {
            s = s.normalize("NFKC").replace(/[\u2018\u2019\u02bc\u00b4]/g, "'").replace(/[\u2013\u2014\u2212]/g, "-");
        }
        return s.replace(/`/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
    }

    /** The ownership index: your inventory's copies, resolvable against the
        wiki's decorated names. One brain for the wiki layer, the popup
        search and the goal math.

        The wiki writes variant suffixes after a name (and stacks them:
        "BladeMaster (Class) (0 AC)"); the game's own names carry at most
        (Rare). Every trailing parenthetical is peeled and answered:
        - (Legend) needs a Legend-tagged copy (the API's Member flag);
          (Non-Legend) and (Free Player) need an untagged one.
        - (AC) and (0 AC) need an untagged copy ONLY when the name also
          has a (Legend) page (the shipped AQWE_LEGEND_PAGES set): there
          the Legend copy lights the Legend page and the price pages stay
          honestly dark - the ShadowFire pair. Where no Legend page
          exists, the pair is split by PRICE alone (DoomKnight (AC) and
          (0 AC) - ex-member classes carry the flag with no Legend page
          to catch it), so the flag says nothing and everything lights.
          (Non-AC) means bought with gold and CAN itself be Legend, so it
          never gates.
        - type suffixes ((Sword), (Pet), (Misc)...) answer to the copy's
          own API type - a copy has exactly one type, so this gate is
          safe. One API quirk: a literal "Misc" type ALWAYS means a
          Ground item, so the (Ground) gate accepts it and the (Misc)
          gate does not.
        - (Rare) matches only copies actually NAMED with it, and a bare
          link never lights because of a (Rare)-named copy.
        - numbered page variants ((1), (2)) all match: the inventory sees
          one name for both.
        - anything else ((Special), (Merge), (Quest)...) is wiki-side
          bookkeeping the inventory cannot see - no gating, any copy
          lights it (Blood Ancient (AC) and (Merge) both light from one
          Legend-tagged copy: no Legend page exists, and which variant
          you bought is unknowable, so the name match wins).
        A bare, suffix-free link carries no variant information at all: any
        non-(Rare) copy lights it. Spacing around "+" is ignored on both
        sides: the wiki spells the same item "Hat+ Locks" on its page and
        "Hat + Locks" in lists. */
    const WEAPON_TYPES = ["Sword", "Axe", "Gauntlet", "Dagger", "HandGun", "Rifle", "Gun", "Whip", "Bow", "Mace", "Polearm", "Staff", "Wand"];
    const TYPE_GATES = {};
    for (const t of [...WEAPON_TYPES, "Class", "Armor", "Helm", "Cape", "Pet", "Necklace", "Ground", "House", "Resource", "Note"]) {
        TYPE_GATES[t.toLowerCase()] = new Set([t]);
    }
    TYPE_GATES["battle pet"] = new Set(["Pet"]);
    TYPE_GATES["gun"] = new Set(["Gun", "HandGun", "Rifle"]);
    TYPE_GATES["weapon"] = new Set(WEAPON_TYPES);
    // API LAW (Atahan-confirmed): a literal "Misc" type from the inventory
    // API is ALWAYS a Ground item - the Misc category's real members
    // (Note, Resource, Item, Quest Item, Boost, Enhancement) each report
    // their own type string. House pieces report exactly House, Floor
    // Item or Wall Item.
    TYPE_GATES["misc"] = new Set(["Item", "Quest Item", "Resource", "Note", "Boost", "Enhancement"]);
    TYPE_GATES["item"] = TYPE_GATES["misc"];
    TYPE_GATES["ground"] = new Set(["Ground", "Misc"]);
    TYPE_GATES["house"] = new Set(["House"]);
    TYPE_GATES["house item"] = new Set(["Floor Item", "Wall Item", "House"]);
    TYPE_GATES["floor item"] = new Set(["Floor Item"]);
    TYPE_GATES["wall item"] = new Set(["Wall Item"]);

    function ownedIndex(items) {
        const tighten = (s) => s.replace(/\s*\+\s*/g, "+");
        const keyOf = (s) => tighten(normalizeName(String(s || "").replace(/\s*\(\d+\)\s*$/, "")));
        const map = new Map();
        for (const it of items || []) {
            const raw = String(it.n || "").replace(/\s+x\d+$/i, "");
            const key = keyOf(raw);
            const full = tighten(normalizeFull(raw));
            let entry = map.get(key);
            if (!entry) { entry = []; map.set(key, entry); }
            let c = entry.find((x) => x.full === full && x.t === it.t && x.m === !!it.m);
            if (!c) {
                c = { full, t: it.t || "", m: !!it.m, rare: /\(rare\)$/.test(full), qi: 0, qb: 0 };
                entry.push(c);
            }
            if (it.b) c.qb += it.q; else c.qi += it.q;
        }
        const legendSet = (typeof AQWE_LEGEND_PAGES !== "undefined" && AQWE_LEGEND_PAGES)
            ? new Set(AQWE_LEGEND_PAGES.split("|")) : null;
        function get(rawText) {
            const key = keyOf(rawText);
            const entry = map.get(key);
            if (!entry) return null;
            let full = tighten(normalizeFull(rawText));
            const sfxs = [];
            let m;
            while ((m = full.match(/\s*\(([^()]+)\)$/))) {
                full = full.slice(0, m.index);
                sfxs.push(m[1].trim());
            }
            const wantsRare = sfxs.includes("rare");
            let copies = entry.filter((c) => c.rare === wantsRare);
            for (const sfx of sfxs) {
                if (sfx === "legend") copies = copies.filter((c) => c.m);
                else if (sfx === "non-legend" || sfx === "free player") copies = copies.filter((c) => !c.m);
                else if (sfx === "ac" || sfx === "0 ac") {
                    // the flag arbitrates only when a Legend page exists to
                    // catch the Legend copy; a price pair alone says
                    // nothing about the lock
                    if (legendSet && legendSet.has(key)) copies = copies.filter((c) => !c.m);
                } else if (TYPE_GATES[sfx]) {
                    const ok = TYPE_GATES[sfx];
                    copies = copies.filter((c) => ok.has(c.t));
                }
            }
            if (!copies.length) return null;
            let qi = 0, qb = 0;
            for (const c of copies) { qi += c.qi; qb += c.qb; }
            return { qi, qb };
        }
        return { size: map.size, get };
    }

    const storage = {
        get: (keys) => api.storage.local.get(keys).catch(() =>
            (keys && typeof keys === "object" && !Array.isArray(keys)) ? { ...keys } : {}),
        set: (obj) => api.storage.local.set(obj).catch(() => {}),
    };

    const send = (msg) => api.runtime.sendMessage(msg).catch(() => ({ ok: false, error: "No response" }));
    const assetUrl = (path) => api.runtime.getURL(path);

    /* Telemetry counters (docs/TELEMETRY.md): numbers only, ever. count()
       buffers increments and flushes once things go quiet, so a hover
       spree costs one storage write, not thirty. Whether anything ever
       LEAVES the machine is decided elsewhere: the background sends the
       week's counters only when the user said yes AND a TELEMETRY_URL is
       configured. Counting locally is free and always safe. */
    let tmBuffer = null, tmTimer = 0;
    function count(key, n = 1) {
        if (!tmBuffer) tmBuffer = {};
        tmBuffer[key] = (tmBuffer[key] || 0) + n;
        clearTimeout(tmTimer);
        tmTimer = setTimeout(async () => {
            const buf = tmBuffer;
            tmBuffer = null;
            const st = await storage.get({ tmCounts: {} });
            for (const k of Object.keys(buf)) st.tmCounts[k] = (st.tmCounts[k] || 0) + buf[k];
            storage.set({ tmCounts: st.tmCounts });
        }, 1500);
    }

    return { api, normalizeName, normalizeFull, nameToSlug, ownedIndex, storage, send, assetUrl, count };
})();
