/* AQW Wiki Enhanced - the Armory: your synced inventory in the game's own
   order, with search, rarity filters, acquire dates and hover previews.
   design/armory.html is the blessed spec; this mirrors it with real data. */
"use strict";

const WIKI = "http://aqwwiki.wikidot.com";
const PAGE = 400;
const NEW_MS = 7 * 864e5;   // acquired within a week (and not banked) = New

/* Game order: Misc types first, then the weapon types in the game's
   sequence, then Class, Armor, Helm, Cape, Pet, Ground, Necklace, House.
   The Misc TAB sits near the end of the bag bar; game-order sorting still
   puts Misc items first, exactly like the game. */
const MISC_TYPES = ["Note", "Resource", "Item", "Quest Item", "Boost", "Enhancement"];
const WEAPON_TYPES = ["Sword", "Axe", "Gauntlet", "Dagger", "HandGun", "Rifle", "Gun", "Whip", "Bow", "Mace", "Polearm", "Staff", "Wand"];
const HOUSE_SUBS = [["House Design", "House"], ["Wall Item Design", "Wall Item"], ["Floor Item Design", "Floor Item"]];
const CATS = {
    Misc: MISC_TYPES, Weapon: WEAPON_TYPES, Class: ["Class"], Armor: ["Armor"], Helm: ["Helm"],
    Cape: ["Cape"], Pet: ["Pet"], Ground: ["Ground"], Necklace: ["Necklace"],
    House: ["House", "Wall Item", "Floor Item"],
};
const TYPE_PREFER = {};
for (const t of ["Class", "Armor", "Helm", "Cape", "Sword", "Axe", "Gauntlet", "Dagger",
    "HandGun", "Rifle", "Gun", "Whip", "Bow", "Mace", "Polearm", "Staff", "Wand",
    "Pet", "Necklace", "Ground"]) TYPE_PREFER[t] = t.toLowerCase();
for (const t of ["House", "Wall Item", "Floor Item"]) TYPE_PREFER[t] = "house";
for (const t of ["Note", "Resource", "Item", "Quest Item", "Boost", "Enhancement"]) TYPE_PREFER[t] = "misc";
const TYPE_ORDER = [...MISC_TYPES, ...WEAPON_TYPES, "Class", "Armor", "Helm", "Cape", "Pet", "Ground", "Necklace", "House", "Wall Item", "Floor Item"];

/* Rarity -> color family (docs/rarities.md is the law). Order matters:
   rainbow and merch outrank the word-Rare test (Super Ultra Rare,
   Collector's Rare). The wiki names one tier several ways (Seasonal/
   Seasonal Item, Legendary/Legendary Item, Event/Event Item, Collector/
   Collector's Rare) - each pair shares a family, displayed verbatim. */
const RAINBOW = new Set(["Super Ultra Rare", "Super Mega Ultra Rare", "Benevolent", "Founder", "Custom Item"]);
// Kickstarter Backer alone keeps the slate violet: funded-the-game items,
// beyond IoDA, above the yellow merch tier. Infinity items are (for now)
// just the other game's normal items - they render neutral gray.
const INFINITY_TIER = new Set(["Kickstarter Backer"]);
const HARD = new Set(["Epic", "Expensive", "Impossible", "1% Drop", "5% Drop"]);
const CHANNEL = new Set(["Upgrade Pack", "Achievement Tracker", "Verification Shop"]);
const MERCH = new Set(["Collector", "Collector's Rare", "Promotional Item"]);
const SEASONAL = new Set(["Seasonal", "Seasonal Item"]);
function rarityFamily(r) {
    if (r === "God") return "rar-god";
    if (RAINBOW.has(r)) return "rar-rainbow";
    if (INFINITY_TIER.has(r)) return "rar-infinity";
    if (r === "Champion") return "rar-champion";
    if (r === "Artifact") return "rar-artifact";
    if (SEASONAL.has(r)) return "rar-seasonal";
    if (r === "Frostval Gifting") return "rar-frostval";
    if (r === "Legendary" || r === "Legendary Item") return "rar-prestige";
    if (HARD.has(r)) return "rar-hard";
    if (CHANNEL.has(r)) return "rar-channel";
    if (MERCH.has(r)) return "rar-merch";
    if (/(^|\s|-)rare(\s|$)/i.test(r) || r === "Limited Quantity" || r.startsWith("Limited Time")) return "rar-gone";
    return "";
}
/* The Tier order: rainbow above all; then Kickstarter
   Backer (funded-the-game, beyond IoDA, code-bearing); yellow merch sits
   beyond IoDA's reach too; cyan Frostval is the donation niche; green Rare
   is the fuel of the economy; then the farming chain red > gold > orange >
   purple > pink; blue shop tiers are purchasable; gray is everyday (AQW
   Infinity items live here now); unranked data sorts last. */
const TIER_RANK = {
    "rar-god": -1,   // above everything - see loadItems for how one is born
    "rar-rainbow": 0, "rar-infinity": 1, "rar-merch": 2, "rar-frostval": 3,
    "rar-gone": 4, "rar-champion": 5, "rar-prestige": 6, "rar-artifact": 7,
    "rar-hard": 8, "rar-seasonal": 9, "rar-channel": 10, "": 11,
};
/* The same patience the hover engine has: exact name first, then the
   seasonal year strips - trailing two digits (Reign Doggy 11), trailing
   four (Maximillian Arctic Armor 2011), leading four (2017 New Year's
   Ball). "+10" enhancement names never match (the space guard), and
   Unidentified NN is a real name, not a year. */
function nameCandidates(k, full) {
    const out = [];
    if (full && full !== k) out.push({ k: full, year: false });   // literal name first
    out.push({ k, year: false });
    const m2 = k.match(/^(.*\S) \d{2}$/);
    if (m2 && !/unidentified/i.test(k)) out.push({ k: m2[1], year: true });
    const m4 = k.match(/^(.*\S) (?:19|20)\d{2}$/);
    if (m4) out.push({ k: m4[1], year: true });
    const lead = k.match(/^(?:19|20)\d{2} (.*)$/);
    if (lead) out.push({ k: lead[1], year: true });
    return out;
}
const BOOST_NAME_RE = /boost!?(\s*\(|\s*$)|\((?:\d+\s*min|\d+\s*hrs?)\)/i;

const BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8V7a6 6 0 0 1 12 0v1"/><path d="M4 8h16l-1.3 12a2 2 0 0 1-2 1.8H7.3a2 2 0 0 1-2-1.8z"/></svg>';
const BANK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18M5 10V7l7-4 7 4v3M6 10v8M10 10v8M14 10v8M18 10v8M4 21h16"/></svg>';
const STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>';

let items = [];             // {n, q, t, b, c, m, a} straight from the sync
let scope = "all", cat = "All", type = null, order = "game", onlyNew = false, shown = PAGE;
const rarityOn = new Set();

/* Computed ONCE: Object.keys over the 47k-entry rarity map costs ~3ms per
   call - inside the row loop that was 1.2s per render. The dataset never
   changes while the page lives. */
const RARITY_DB = (typeof AQWE_RARITIES !== "undefined") && Object.keys(AQWE_RARITIES).length > 0;
const rarityKnown = () => RARITY_DB;
// Banking an item is acknowledging it - the New mark's job is done.
const isNew = (it) => !it.b && it.ts && (Date.now() - it.ts) <= NEW_MS;

/* PERFORMANCE CONTRACT: AQWE.normalizeName runs exactly once per item, right
   here. Renders, sorts, counts and hover lookups all read the precomputed
   fields (it.k = key, it.r = rarity) - the page stays instant at any
   inventory size. Never call normalizeName inside render paths. */
let ownedMap = new Map();   // normalized name -> "inv" | "bank" (hover lookups)
function loadItems(inv) {
    const raw = (inv && Array.isArray(inv.items)) ? inv.items : [];
    const wikiTypes = (typeof AQWE_WIKI_TYPES !== "undefined") ? AQWE_WIKI_TYPES : {};
    const rarities = (typeof AQWE_RARITIES !== "undefined") ? AQWE_RARITIES : {};
    const known = (typeof AQWE_WIKI_NAMES !== "undefined" && AQWE_WIKI_NAMES)
        ? new Set(AQWE_WIKI_NAMES.split("|")) : null;
    // an item acquired after the dataset was built may simply be NEWER
    // than the crawl - absence from the name list proves nothing about
    // it, so the God tier waits for the next refresh (+1 day of slack)
    const dataAt = (typeof AQWE_RARITIES_AT !== "undefined") ? +new Date(AQWE_RARITIES_AT) + 864e5 : 0;
    ownedMap = new Map();
    items = raw.map((it) => {
        const k = AQWE.normalizeName(it.n);
        // API LAW: a literal "Misc" type is ALWAYS a Ground item (the Misc
        // category's real members report their own types). The wiki's own
        // category still wins whenever it knows better.
        let t = wikiTypes[k] || (it.t === "Misc" ? "Ground" : it.t);
        // Boost items carry their own uniform - "... Boost! (20 min)" - but
        // the API files them as plain Items; the name says otherwise.
        if (t !== "Boost" && MISC_TYPES.includes(t) && BOOST_NAME_RE.test(it.n)) t = "Boost";
        if (!it.b) ownedMap.set(k, "inv");
        else if (!ownedMap.has(k)) ownedMap.set(k, "bank");
        const cat = Object.keys(CATS).find((c) => CATS[c].includes(t)) || "Misc";
        // Misc items have NO rarity in the game; a same-named page from
        // another category (Shadow Orb the pet) must never bleed onto them.
        let r = "", linkName = it.n;
        if (cat !== "Misc") {
            const full = AQWE.normalizeFull(it.n);
            const cands = nameCandidates(k, full);
            // context beats the alias: a Sword-typed item asks the (Sword)
            // page before the shared base name (Oblivion Blade of Nulgath)
            const typed = k + " (" + t.toLowerCase() + ")";
            if (typed !== full) cands.splice(full !== k ? 1 : 0, 0, { k: typed, year: false });
            for (const c of cands) {
                if (rarities[c.k]) {
                    // A yearly variant IS the no-longer-obtainable release:
                    // whatever the base page says, the year makes it
                    // Seasonal Rare.
                    r = c.year ? "Seasonal Rare" : rarities[c.k];
                    if (c.k !== k && c.k !== full) linkName = c.k;
                    break;
                }
            }
            // No rarity anywhere AND no page under any candidate name:
            // mod items, one-of-ones, pages the wiki staff forgot - GOD.
            if (!r && known && !cands.some((c) => known.has(c.k)) &&
                (!dataAt || !it.a || +new Date(it.a) <= dataAt)) r = "God";
        }
        const f = r ? rarityFamily(r) : "";
        return {
            ...it, t, k, r, f, cat,
            slug: AQWE.nameToSlug(linkName),              // year variants link home
            tr: r ? TIER_RANK[f] : 12,                    // tier sort rank
            nl: it.n.toLowerCase(),                       // search + sort key
            ti: TYPE_ORDER.indexOf(t),                    // game-order rank
            ts: it.a ? +new Date(it.a) : 0,               // acquire timestamp
        };
    });
}
/* plain code-unit compare - localeCompare is 50-100x slower and was the
   last thing between a keystroke and an instant render */
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

function pool() {
    const needle = document.getElementById("q").value.trim().toLowerCase();
    return items.filter((it) =>
        (scope === "all" || (scope === "bank") === !!it.b) &&
        (cat === "All" || it.cat === cat) &&
        (!type || it.t === type) &&
        (!onlyNew || isNew(it)) &&
        (!needle || it.nl.includes(needle)));
}

function render() {
    const list = document.getElementById("list");
    const base = pool();
    const rows = rarityOn.size ? base.filter((it) => rarityOn.has(it.r)) : base.slice();
    const sorters = {
        game: (a, b) => a.ti - b.ti || cmp(a.nl, b.nl),
        name: (a, b) => cmp(a.nl, b.nl),
        tier: (a, b) => a.tr - b.tr || cmp(a.r, b.r) || cmp(a.nl, b.nl),
        newest: (a, b) => b.ts - a.ts || cmp(a.nl, b.nl),
        oldest: (a, b) => a.ts - b.ts || cmp(a.nl, b.nl),
    };
    rows.sort(sorters[order]);

    list.innerHTML = "";
    if (!items.length) {
        list.innerHTML =
            '<div class="empty"><span class="e-ico">' + STAR + "</span><div><strong>Nothing here yet.</strong> " +
            "Sync your inventory from the popup and every item you own lands on this page.</div></div>";
    } else if (!rows.length) {
        list.innerHTML = '<div class="empty"><div>Nothing matches.</div></div>';
    }
    let count = 0;
    for (const it of rows) {
        if (++count > shown) break;
        const row = document.createElement("div");
        row.className = "row";
        const grow = document.createElement("div");
        grow.className = "grow";
        const a = document.createElement("a");
        a.href = WIKI + "/" + it.slug;
        a.target = "_blank";
        a.dataset.t = it.t;   // hover previews resolve variants by type
        a.textContent = it.n;
        grow.appendChild(a);
        if (it.q > 1) grow.insertAdjacentHTML("beforeend", `<span class="qty">x${it.q.toLocaleString()}</span>`);
        if (isNew(it)) grow.insertAdjacentHTML("beforeend", '<span class="tag new">New</span>');
        if (it.c) grow.insertAdjacentHTML("beforeend", '<span class="tag ac">AC</span>');
        if (it.m) grow.insertAdjacentHTML("beforeend", '<span class="tag legend">Legend</span>');
        row.appendChild(grow);
        row.insertAdjacentHTML("beforeend", `<span class="type"></span>`);
        row.lastChild.textContent = it.t;
        const r = it.r;
        const rarCol = document.createElement("span");
        rarCol.className = "rar-col" + (rarityKnown() ? "" : " hidden");
        if (r) {
            const chip = document.createElement("span");
            chip.className = "rarity " + it.f;
            chip.textContent = r;
            rarCol.appendChild(chip);
        }
        row.appendChild(rarCol);
        row.insertAdjacentHTML("beforeend",
            `<span class="pill ${it.b ? "bank" : "inv"}">${it.b ? BANK + "Bank" : BAG + "Inventory"}</span>`);
        list.appendChild(row);
    }
    if (rows.length > shown) {
        const more = document.createElement("button");
        more.className = "more";
        more.textContent = `Show more (${(rows.length - shown).toLocaleString()} left)`;
        more.addEventListener("click", () => { shown += PAGE; render(); });
        list.appendChild(more);
    }

    // The stat describes what you are LOOKING AT - it follows every filter,
    // and each scope tells what its own view cannot say for itself: All
    // splits the bag, Inventory counts the fresh drops, Bank appraises
    // its vault in AC and Legend items.
    const nTotal = `<strong>${rows.length.toLocaleString()} items</strong>`;
    let stat;
    if (scope !== "all") {
        const acN = rows.filter((i) => i.c).length;
        const legendN = rows.filter((i) => i.m).length;
        stat = `${nTotal} · ${acN.toLocaleString()} AC tagged · ${legendN.toLocaleString()} Legend tagged`;
    } else {
        const bank = rows.filter((i) => i.b).length;
        const fresh = rows.filter(isNew).length;
        stat = `${nTotal} · ${bank.toLocaleString()} in bank · ${fresh} new this week`;
    }
    document.getElementById("stat").innerHTML = stat;
    paintRarity(base);
}

/* ---- sub-type slider (Weapon / Misc / House get the game's sub-order) ---- */
function subDefs() {
    if (cat === "Weapon") return WEAPON_TYPES.map((t) => [t, t]);
    if (cat === "Misc") return MISC_TYPES.map((t) => [t, t]);
    if (cat === "House") return HOUSE_SUBS;
    return [];
}
function paintSubs() {
    const wrap = document.getElementById("subwrap");
    const bar = document.getElementById("subs");
    const defs = subDefs();
    if (!defs.length) {
        // collapse with the old buttons still inside - no empty-bar flash;
        // the next open rebuilds them anyway
        wrap.classList.remove("open");
        return;
    }
    for (const b of [...bar.querySelectorAll("button")]) b.remove();
    const all = document.createElement("button");
    all.textContent = "All";
    all.dataset.t = "";
    all.className = type ? "" : "active";
    bar.appendChild(all);
    for (const [label, t] of defs) {
        const b = document.createElement("button");
        b.textContent = label;
        b.dataset.t = t;
        if (type === t) b.classList.add("active");
        bar.appendChild(b);
    }
    wrap.classList.add("open");
    subSlider.paint();
}

/* ---- rarity popover: All + alphabetical, counts from the current view.
        The whole control stays hidden until the rarity dataset ships. ---- */
function paintRarity(base) {
    document.getElementById("rarity-wrap").classList.toggle("hidden", !rarityKnown());
    if (!rarityKnown()) return;
    if (!base) base = pool();
    const counts = new Map();
    for (const it of base) {
        if (it.r) counts.set(it.r, (counts.get(it.r) || 0) + 1);
    }
    const listEl = document.getElementById("rarity-list");
    listEl.innerHTML = "";
    // "All" holds the checkmark whenever no rarity is chosen; choosing one
    // hands it over, clearing hands it back.
    const allLab = document.createElement("label");
    const allCb = document.createElement("input");
    allCb.type = "checkbox";
    allCb.checked = rarityOn.size === 0;
    allCb.addEventListener("change", () => { rarityOn.clear(); render(); });
    allLab.append(allCb, document.createTextNode("All"));
    allLab.insertAdjacentHTML("beforeend", `<span class="cnt">${base.length}</span>`);
    listEl.appendChild(allLab);
    [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([r, n]) => {
        const lab = document.createElement("label");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = rarityOn.has(r);
        cb.addEventListener("change", () => { cb.checked ? rarityOn.add(r) : rarityOn.delete(r); render(); });
        lab.append(cb, document.createTextNode(r));
        lab.insertAdjacentHTML("beforeend", `<span class="cnt">${n}</span>`);
        listEl.appendChild(lab);
    });
    paintChips();
}
function paintChips() {
    const rc = document.getElementById("rarity-chip");
    rc.classList.toggle("gold-on", rarityOn.size > 0);
    rc.innerHTML = rarityOn.size ? `Rarity<span class="n">${rarityOn.size}</span>` : "Rarity";
    document.getElementById("new-chip").classList.toggle("gold-on", onlyNew);
}

/* ---- wiring ---- */
document.getElementById("q").addEventListener("input", () => { shown = PAGE; render(); });
document.getElementById("order").addEventListener("change", (e) => { order = e.target.value; shown = PAGE; render(); });
document.getElementById("new-chip").addEventListener("click", () => { onlyNew = !onlyNew; shown = PAGE; render(); });
document.getElementById("rarity-chip").addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("rarity-pop").classList.toggle("open");
});
document.getElementById("rarity-pop").addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", () => document.getElementById("rarity-pop").classList.remove("open"));
document.getElementById("rarity-clear").addEventListener("click", () => { rarityOn.clear(); render(); });

/* sliding, draggable + clickable segmented controls - the signature */
function initSlider(container, commit) {
    const ind = container.querySelector(".ind");
    const btns = () => [...container.querySelectorAll("button")];
    const move = (b) => { ind.style.left = b.offsetLeft + "px"; ind.style.width = b.offsetWidth + "px"; };
    const paint = () => {
        const b = btns().find((x) => x.classList.contains("active"));
        if (b) { ind.style.opacity = 1; requestAnimationFrame(() => move(b)); }
        else ind.style.opacity = 0;
    };
    let dragging = false, startX = 0, moved = false, downBtn = null;
    container.addEventListener("pointerdown", (e) => {
        dragging = true; moved = false; startX = e.clientX;
        downBtn = e.target.closest("button");
        container.classList.add("dragging");
        container.setPointerCapture(e.pointerId);
    });
    container.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        if (Math.abs(e.clientX - startX) > 3) moved = true;
        if (!moved) return;
        const r = container.getBoundingClientRect();
        ind.style.left = Math.max(2, Math.min(e.clientX - r.left - ind.offsetWidth / 2, r.width - ind.offsetWidth - 2)) + "px";
    });
    container.addEventListener("pointerup", () => {
        if (!dragging) return;
        dragging = false;
        container.classList.remove("dragging");
        let btn = null;
        if (!moved) {
            btn = downBtn;                              // plain click (capture retargets e.target)
        } else {
            const c = ind.offsetLeft + ind.offsetWidth / 2;
            btn = btns().reduce((best, b) =>
                Math.abs(b.offsetLeft + b.offsetWidth / 2 - c) < Math.abs(best.offsetLeft + best.offsetWidth / 2 - c) ? b : best);
        }
        if (btn) {
            btns().forEach((x) => x.classList.toggle("active", x === btn));
            commit(btn);
        }
        paint();
    });
    paint();
    return { paint };
}
const scopeSlider = initSlider(document.getElementById("scope"), (b) => { scope = b.dataset.v; shown = PAGE; render(); });
const catSlider = initSlider(document.getElementById("cats"), (b) => {
    cat = b.dataset.v;
    type = null;
    shown = PAGE;
    paintSubs();
    render();
});
const subSlider = initSlider(document.getElementById("subs"), (b) => {
    type = b.dataset.t || null;
    shown = PAGE;
    render();
});

/* ---- boot: real data, hover previews, live sync ---- */
function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.aqweTheme = theme;   // hover.css follows
    try { localStorage.setItem("aqwe-theme", theme); } catch {}   // pre-paint mirror
    scopeSlider.paint(); catSlider.paint(); subSlider.paint();
}

init();
async function init() {
    const st = await AQWE.storage.get({ theme: "good", hoverMode: "clean", inventory: null });
    setTheme(st.theme);
    loadItems(st.inventory);
    paintSubs();
    render();

    const ownedState = (title) => ownedMap.get(AQWE.normalizeName(title)) || null;
    const hover = AQWEHover(st.hoverMode, async (url) => {
        const res = await AQWE.send({ type: "FETCH_WIKI_PAGE", url });
        if (!res || !res.ok) throw new Error(res && res.error || "fetch failed");
        return res.html;
    }, ownedState);
    hover.attach((a) => {
        const href = a.href || "";
        if (!href.includes("aqwwiki.wikidot.com/")) return null;
        // Same rule as the CharPage: the row's type picks the wiki variant -
        // Shadow Orb under Misc previews (Misc), under Pet previews (Pet).
        return { url: href, prefer: TYPE_PREFER[a.dataset.t] || null };
    });

    AQWE.api.storage.onChanged.addListener((ch, area) => {
        if (area !== "local") return;
        if (ch.theme) setTheme(ch.theme.newValue);
        if (ch.hoverMode) hover.setMode(ch.hoverMode.newValue);
        if (ch.inventory) {   // the popup's sync button refreshes this page live
            loadItems(ch.inventory.newValue);
            shown = PAGE;
            render();
        }
    });
}
