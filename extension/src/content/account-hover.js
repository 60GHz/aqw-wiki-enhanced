/* AQW Wiki Enhanced - hover previews on account.aq.com.
   Covers the character page plus every inventory spreadsheet:
   Inventory, InventorySponsor, InventoryAwesome, InventoryAwesomeUse, BuyBack,
   WheelProgress. Wiki pages are fetched through the background (cross-origin). */
"use strict";

(async () => {
    const st = await AQWE.storage.get({ hoverMode: "clean", theme: "good", inventory: null });
    document.documentElement.dataset.aqweTheme = st.theme;

    const owned = new Map();
    if (st.inventory && Array.isArray(st.inventory.items)) {
        for (const it of st.inventory.items) {
            const k = AQWE.normalizeName(it.n.replace(/\s+x\d+$/i, ""));
            const p = owned.get(k);
            if (!p || (p.b && !it.b)) owned.set(k, { b: it.b });
        }
    }
    const lookup = (title) => {
        const r = owned.get(AQWE.normalizeName(title));
        return r ? (r.b ? "bank" : "inv") : null;
    };

    const hover = AQWEHover(st.hoverMode, async (url) => {
        const res = await AQWE.send({ type: "FETCH_WIKI_PAGE", url });
        if (!res || !res.ok) throw new Error(res && res.error || "fetch failed");
        return res.html;
    }, lookup);

    /* CharPage: real wiki links, section-aware. The page renders each inventory
       card as <div class="card-header">Sword</div> + a body of item links, and
       every item span carries its type verbatim: <span class="item Sword">.
       That type decides which variant a disambiguation page resolves to -
       (Sword) under Sword, (Cape) under Cape, and so on for every section. */
    const TYPE_PREFER = {};
    for (const t of ["Class", "Armor", "Helm", "Cape", "Sword", "Axe", "Gauntlet", "Dagger",
        "HandGun", "Rifle", "Gun", "Whip", "Bow", "Mace", "Polearm", "Staff", "Wand",
        "Pet", "Necklace", "Ground"]) TYPE_PREFER[t] = t.toLowerCase();
    for (const t of ["House", "Wall", "Floor"]) TYPE_PREFER[t] = "house";

    function sectionKind(a) {
        const span = a.querySelector("span.item");
        const token = span && [...span.classList].find((c) => c !== "item" && TYPE_PREFER[c]);
        if (token) return TYPE_PREFER[token];
        const head = a.closest(".card-body")?.parentElement?.querySelector(".card-header");
        const headType = head && head.textContent.trim().split(/\s+/)[0];
        if (headType && TYPE_PREFER[headType]) return TYPE_PREFER[headType];
        // Equipped-item links and older layouts: walk back to the nearest heading
        let el = a;
        for (let depth = 0; depth < 6 && el; depth++, el = el.parentElement) {
            let sib = el.previousElementSibling;
            for (let hop = 0; hop < 6 && sib; hop++, sib = sib.previousElementSibling) {
                if (!/^H[1-6]$/.test(sib.tagName) && !/head|title/i.test(sib.className || "")) continue;
                const t = sib.textContent.trim();
                const hit = Object.keys(TYPE_PREFER).find((k) => new RegExp("\\b" + k + "\\b", "i").test(t));
                if (hit) return TYPE_PREFER[hit];
                if (/item/i.test(t)) return "armor";
            }
        }
        return "armor";
    }
    hover.attach((a) => {
        const href = a.href || "";
        if (!href.includes("aqwwiki.wikidot.com/") || href.includes("system:")) return null;
        return { url: href, prefer: sectionKind(a) };
    });

    /* Inventory spreadsheets: the cells carry plain item names, no links.
       Selectors cover the DevExtreme grid plus the older table layouts that
       AQWikiTools and AqwDoIhave targeted (InventoryAwesome, BuyBack, Wheel). */
    const CELLS = [
        "tr.dx-data-row td:first-child",
        "#listinvFull tbody td:first-child",
        "#wheel tbody td:first-child",
        "table.table-bordered tbody td:first-child",
        "#listinvBuyBk2 tbody td:nth-child(2)",
    ].join(", ");

    /* Every grid names its columns differently (the IoDA select grid, the
       BuyBack table and Awesome Items all shuffle them), so the Type column
       is found by its own header instead of a hardcoded index. DevExtreme
       keeps headers in a sibling table inside the same .dx-datagrid. */
    const typeIdxCache = new WeakMap();   // table -> Type column index (or -1)
    function typeColIndex(td) {
        const table = td.closest("table");
        if (!table) return -1;
        if (typeIdxCache.has(table)) return typeIdxCache.get(table);
        const dx = table.closest(".dx-datagrid");
        const headRow = (dx && dx.querySelector(".dx-header-row")) ||
            table.querySelector("thead tr") || table.rows[0];
        let idx = headRow ? [...headRow.cells].findIndex((c) => /^\s*type\b/i.test(c.textContent)) : -1;
        // the classic Inventory grid layout, should its header ever hide from us
        if (idx === -1 && td.closest("tr.dx-data-row")) idx = 2;
        typeIdxCache.set(table, idx);
        return idx;
    }

    /* The row's type, two ways: the column whose header says Type, and -
       because IoDA, BuyBack and Awesome Items each shuffle their columns
       and hide their headers differently - any sibling cell whose EXACT
       text is a type we know. Type words are distinctive ("Sword", "Pet",
       "Floor Item"); nothing else in a row reads like one. */
    function rowTypePrefer(td) {
        const row = td.closest("tr");
        if (!row) return null;
        const idx = typeColIndex(td);
        if (idx >= 0 && row.cells[idx]) {
            const word = row.cells[idx].textContent.trim().split(/\s+/)[0];
            if (TYPE_PREFER[word]) return TYPE_PREFER[word];
        }
        for (const cell of row.cells) {
            if (cell === td) continue;
            const t = cell.textContent.trim();
            if (TYPE_PREFER[t]) return TYPE_PREFER[t];
            if (/^(Wall|Floor) Item$/i.test(t)) return "house";
        }
        return null;
    }

    function cellTarget(el) {
        const td = el.closest(CELLS);
        if (!td) return null;
        const base = td.textContent.trim().replace(/\s+x[\d,]+$/i, "");
        if (!base || base.length > 90) return null;
        return { url: "https://aqwwiki.wikidot.com/" + AQWE.nameToSlug(base), prefer: rowTypePrefer(td), anchor: td };
    }

    hover.attachCells(cellTarget);

    /* The IoDA selection grid (InventoryAwesomeUse) is the same spreadsheet,
       except the names are selection links - so the cell handler skips them
       and the wiki-link handler ignores them. Resolve those links through
       their cell instead: previews appear, the click still selects. */
    hover.attach((a) => {
        const href = a.href || "";
        if (href.includes("aqwwiki.wikidot.com/")) return null;   // handled above
        return cellTarget(a);
    });

    AQWE.api.storage.onChanged.addListener((ch, area) => {
        if (area !== "local") return;
        if (ch.hoverMode) hover.setMode(ch.hoverMode.newValue);
        if (ch.theme) document.documentElement.dataset.aqweTheme = ch.theme.newValue;
    });
})();
