/* AQW Wiki Enhanced - popup controller. Everything lives here; no options page. */
"use strict";

const $ = (sel) => document.querySelector(sel);
const WIKI = "http://aqwwiki.wikidot.com";

const LINKS = {
    github: "https://github.com/60GHz/aqw-wiki-enhanced",
    donate: "https://ko-fi.com/60ghz",
};

document.getElementById("version").textContent = AQWE.api.runtime.getManifest().version;

let cachedInventory = null;

init();

async function init() {
    const st = await AQWE.storage.get({
        theme: "good", hoverMode: "clean",
        inventory: null, inventoryError: null, boost: null, goals: [],
        telemetryAvailable: false, telemetry: null,
    });
    cachedInventory = st.inventory;

    applyTheme(st.theme, false);
    paintHoverMode(st.hoverMode);
    paintInventory(st.inventory, st.inventoryError);
    paintBoost(st.boost);
    paintGoals(st.goals);
    paintNote(st.telemetryAvailable, st.telemetry);
    AQWE.count("popupOpen");

    // First open with nothing synced yet: try quietly, no tabs, no fuss.
    if (!st.inventory) {
        const res = await AQWE.send({ type: "SYNC_NOW" }).catch(() => null);
        if (res && res.ok) {
            const fresh = await AQWE.storage.get({ inventory: null });
            cachedInventory = fresh.inventory;
            paintInventory(fresh.inventory, null);
        }
    }
}

/* ---- Theme ---- */
function applyTheme(theme, persist = true) {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll("[data-theme-btn]").forEach((b) =>
        b.classList.toggle("active", b.dataset.themeBtn === theme));
    if (typeof themeSlider !== "undefined") themeSlider.paint();
    if (persist) AQWE.storage.set({ theme });
}
// theme buttons are wired through the shared slider (below)

/* ---- Inventory ---- */
function paintInventory(inv, err) {
    const dot = $("#inv-dot"), title = $("#inv-title"), meta = $("#inv-meta");
    if (inv && inv.items) {
        dot.classList.remove("err");
        // real data + a failed refresh = amber; the age figure says how stale
        dot.classList.toggle("stale", !!err);
        title.textContent = "Inventory Synced";
        const age = Math.round((Date.now() - inv.at) / 3600000 * 10) / 10;
        meta.innerHTML = `<strong>${inv.total.toLocaleString()} items</strong> · ${inv.bank.toLocaleString()} in bank · ${age} h ago`;
    } else if (err) {
        dot.classList.remove("stale");
        dot.classList.add("err");
        title.textContent = "Sync Failed";
        meta.textContent = "Waiting for your Manage Account login";
    }
}
$("#sync-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.classList.add("spin");
    let res = await AQWE.send({ type: "SYNC_NOW" }).catch(() => ({ ok: false, error: "No response" }));
    if (!res.ok) {
        // Escalation ladder: background retried with a session warm-up
        // already; next, any open account.aq.com page syncs in place (the
        // only route incognito has); the login page opens only when nothing
        // else could work - and closes itself after the sync lands.
        const login = await AQWE.send({ type: "OPEN_LOGIN" }).catch(() => null);
        if (login && login.viaTab) res = { ok: true };
    }
    btn.classList.remove("spin");
    const st = await AQWE.storage.get({ inventory: null, inventoryError: null });
    cachedInventory = st.inventory;
    paintInventory(st.inventory, res.ok ? null : (res.error || st.inventoryError));
});
/* A sync finishing in the background (the quiet login tab, an account
   visit) repaints the card while the popup is still open - the amber
   light clears itself. */
AQWE.api.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || (!ch.inventory && !ch.inventoryError)) return;
    AQWE.storage.get({ inventory: null, inventoryError: null }).then((st) => {
        cachedInventory = st.inventory;
        paintInventory(st.inventory, st.inventoryError);
    });
});
/* The one consent that exists (docs/TELEMETRY.md): shown only while a
   telemetry endpoint is configured AND the user hasn't answered. Same two
   lines as the note it replaces - the popup never moves a hair. */
function paintNote(available, choice) {
    const note = document.getElementById("note");
    if (!available || choice) return;   // the built-in note stays
    note.innerHTML = '<strong>Count anonymous usage?</strong> Plain weekly numbers. ' +
        'Never your items, account credentials or anything about you. <a id="tm-yes">Sure</a> · <a id="tm-no">No</a>';
    const decide = (enabled) => {
        AQWE.storage.set({ telemetry: { enabled, at: Date.now() } });
        note.innerHTML = "<strong>Everything else just works.</strong> Ownership badges, recipes and automatic inventory sync are built in.";
    };
    note.querySelector("#tm-yes").addEventListener("click", () => decide(true));
    note.querySelector("#tm-no").addEventListener("click", () => decide(false));
}

document.getElementById("github-link").href = LINKS.github;
document.getElementById("donate").addEventListener("click", (e) => {
    e.preventDefault();
    AQWE.api.tabs.create({ url: LINKS.donate });
});

/* ---- Server Boosts (core + event, max two compact cards) ----
   Full name when a card has the row to itself; when two share the row the
   "Boost" suffix goes (the bolt and the panel already say it) so nothing
   ever ellipsizes. Core names need no tooltip; event cards carry the
   calendar's actual name, because "Dage Boost" alone tells a newcomer
   nothing about what drops are doubled. */
const BOOST_META = {
    xp:    { name: "Double XP Boost",    short: "Double XP",    color: "var(--boost-xp)" },
    class: { name: "Double Class Boost", short: "Double Class", color: "var(--boost-class)" },
    rep:   { name: "Double Rep Boost",   short: "Double Rep",   color: "var(--boost-rep)" },
    gold:  { name: "Double Gold Boost",  short: "Double Gold",  color: "var(--boost-gold)" },
    all:   { name: "Double All Boost",   short: "Double All",   color: "var(--boost-all)" },
    event: { name: "Event Boost",        color: "var(--boost-event)" },
};
/* The Thursday resource boosts, matched by their calendar names. One grammar
   for every card: Double <Thing> Boost solo, Double <Thing> when two share
   the row. Core boosts explain themselves; the event cards say on hover
   exactly what gets doubled. */
const EVENT_KINDS = [
    // [match, solo name, two-card name, color, hover explanation]
    [/unidentified\s*34/i, "Uni 34/35", "Uni 34/35", "var(--boost-uni)", "Double Rewards from Unidentified 34 & 35 Quests"],
    [/essences?\s*(\+|and|&)\s*totems?/i, "Nulgath", "Nulgath", "var(--boost-event)", "Double Rewards from Essence & Totem Quests"],
    [/legion\s*token/i, "Dage", "Dage", "var(--boost-dage)", "Double Rewards from Legion Token Quests & Dark Unicorn Rib Drops"],
    [/dungeon/i, "Dungeon", "Dungeon", "var(--boost-dungeon)", "Double Rewards from Dungeon Drops"],
    [/void\s*aura/i, "Void Aura", "Void Aura", "var(--boost-void)", "Double Rewards from Void Aura Quests"],
];
function eventMeta(label) {
    for (const [re, thing, brief, color, tip] of EVENT_KINDS)
        if (re.test(label)) return { name: "Double " + thing + " Boost", short: "Double " + brief, color, tip };
    return { name: label, color: "var(--boost-event)" };
}
function paintBoost(boost) {
    const row = $("#boost");
    const list = (boost && boost.list) || [];
    if (!list.length) return;
    row.classList.add("show");
    row.innerHTML = "";
    const bolt = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4.5 13.5H11L9.5 22 19 10h-6.5z"/></svg>';
    for (const b of list.slice(0, 2)) {
        const meta = b.kind === "event" ? eventMeta(b.label) : (BOOST_META[b.kind] || BOOST_META.event);
        const name = list.length > 1 && meta.short ? meta.short : meta.name;
        const card = document.createElement("div");
        card.className = "boost-card";
        card.style.color = meta.color;
        card.style.background = `color-mix(in srgb, ${meta.color} 11%, transparent)`;
        card.style.borderColor = `color-mix(in srgb, ${meta.color} 38%, transparent)`;
        card.innerHTML =
            `<span class="b-ico" style="background: color-mix(in srgb, ${meta.color} 16%, transparent)">${bolt}</span>` +
            `<span class="b-copy"><span class="b-name"></span><span class="sub">${list.length > 1 ? "ends " + b.ends : "Live on all servers"}</span></span>` +
            (list.length === 1 ? `<span class="b-ends">ends ${b.ends}</span>` : "");
        card.querySelector(".b-name").textContent = name;
        if (meta.tip) card.title = meta.tip;
        row.appendChild(card);
    }
}

/* ---- Farm Goals: three rows, live progress, View All page ---- */
/* one ownership brain (common.js ownedIndex), rebuilt only when the
   inventory itself changes */
let _ownedIdx = null, _ownedSrc = null;
function ownedIdx() {
    if (_ownedSrc !== cachedInventory) {
        _ownedSrc = cachedInventory;
        _ownedIdx = AQWE.ownedIndex(cachedInventory && cachedInventory.items);
    }
    return _ownedIdx;
}
function bestRecipePct(doc, idx) {
    let best = null;
    for (const li of doc.querySelectorAll("#page-content ul > li")) {
        if (!/^Merge the following\b/i.test(li.textContent.trim())) continue;
        const ul = li.querySelector("ul");
        if (!ul) continue;
        let sum = 0, n = 0;
        for (const row of ul.children) {
            const a = row.querySelector("a");
            if (!a) continue;
            const need = parseInt(((row.textContent.match(/x\s*([\d,]+)/i) || [])[1] || "1").replace(/,/g, ""), 10);
            const rec = idx.get(a.textContent);
            const have = rec ? rec.qi + rec.qb : 0;
            sum += Math.min(have / need, 1);
            n++;
        }
        if (n) best = Math.max(best ?? 0, Math.round((sum / n) * 100));
    }
    return best;
}
async function goalPct(url, name) {
    if (name && ownedIdx().get(name)) return 100;
    const st = await AQWE.storage.get({ goalProgress: {} });
    const c = st.goalProgress[url];
    if (c && Date.now() - c.at < 6 * 3600e3) return c.pct;
    const res = await AQWE.send({ type: "FETCH_WIKI_PAGE", url: WIKI + url }).catch(() => null);
    if (!res || !res.ok) return c ? c.pct : null;
    const doc = new DOMParser().parseFromString(res.html, "text/html");
    const pct = bestRecipePct(doc, ownedIdx());
    st.goalProgress[url] = { pct, at: Date.now() };
    await AQWE.storage.set({ goalProgress: st.goalProgress });
    return pct;
}
function paintGoals(goals) {
    const box = $("#goals");
    const cnt = $("#goal-count");
    cnt.textContent = goals.length ? `View All (${goals.length})` : "";
    cnt.onclick = (e) => {
        e.preventDefault();
        AQWE.api.tabs.create({ url: AQWE.api.runtime.getURL("src/popup/goals.html") });
    };
    if (!goals.length) {
        box.innerHTML = '<div class="goal-empty"><span class="ge-star">☆</span><div><strong>No goals yet.</strong><br>Star any item on the wiki and it lands here with live progress.</div></div>';
        return;
    }
    box.innerHTML = "";
    for (const g of goals.slice(0, 3)) {
        const row = document.createElement("div");
        row.className = "goal";
        const a = document.createElement("a");
        a.href = WIKI + g.url;
        a.target = "_blank";
        a.textContent = g.name;
        const bar = document.createElement("span");
        bar.className = "goal-bar";
        bar.innerHTML = "<span style='width:0%'></span>";
        const pct = document.createElement("span");
        pct.className = "goal-pct";
        pct.textContent = "";
        const del = document.createElement("button");
        del.textContent = "✕";
        del.title = "Remove goal";
        del.addEventListener("click", async () => {
            const st = await AQWE.storage.get({ goals: [] });
            const next = st.goals.filter((x) => x.url !== g.url);
            await AQWE.storage.set({ goals: next });
            paintGoals(next);
        });
        row.append(a, bar, pct, del);
        box.appendChild(row);
        goalPct(g.url, g.name).then((v) => {
            if (v == null) {
                bar.title = "No merge recipe on this page";
                pct.textContent = "N/A";   // the wiki's own idiom for "nothing to measure"
                return;
            }
            pct.textContent = v + "%";
            // two frames of zero first: the fill SWEEPS in every time, even
            // when the answer was cached and instant - the sweep is the brand
            requestAnimationFrame(() => requestAnimationFrame(() => {
                bar.firstChild.style.width = v + "%";
            }));
        });
    }
}

/* ---- Sliding, draggable segmented controls (theme + hover previews) ---- */
function initSlider(container, ind, commit) {
    const btns = () => [...container.querySelectorAll("button")];
    const move = (b) => { ind.style.left = b.offsetLeft + "px"; ind.style.width = b.offsetWidth + "px"; };
    const paint = () => {
        const b = btns().find((x) => x.classList.contains("active"));
        if (b) requestAnimationFrame(() => move(b));
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
    container.addEventListener("pointerup", (e) => {
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
        if (btn) commit(btn); else paint();             // snaps with the spring
    });
    return { paint };
}
const themeSlider = initSlider($("#theme-switch"), $("#theme-ind"), (b) => applyTheme(b.dataset.themeBtn));
const hoverSlider = initSlider($("#hover-seg"), $("#seg-ind"), (b) => {
    paintHoverMode(b.dataset.mode);
    AQWE.storage.set({ hoverMode: b.dataset.mode });
});
function paintHoverMode(mode) {
    document.querySelectorAll("#hover-seg button").forEach((b) =>
        b.classList.toggle("active", b.dataset.mode === mode));
    hoverSlider.paint();
}

/* ---- Search: whole-wiki suggestions, or the Search-by-Tag builder ---- */
const input = $("#search"), suggest = $("#suggest");
let tagMode = false;
const tagToggle = $("#tag-toggle");
function applyTagMode(on) {
    tagMode = on;
    tagToggle.classList.toggle("on", on);
    input.placeholder = on ? "Search by tag · rare category:Pets" : "Search items, monsters, locations";
}
AQWE.storage.get({ tagMode: false }).then((st) => applyTagMode(st.tagMode));
tagToggle.addEventListener("click", (e) => {
    e.preventDefault();
    applyTagMode(!tagMode);
    AQWE.storage.set({ tagMode });
    input.value = "";
    suggest.classList.remove("open");
    input.focus();
});

/* The official tool's category list and URL algorithm (decoded from its source). */
const AQWE_CATS = ["All", "Armors", "Capes & Back Items", "Classes", "Enhancements", "Grounds", "Helmets & Hoods", "Houses", "Floor Items", "Wall Items", "Misc. Items", "Use Items", "Necklaces", "Pets", "Battle Pets", "Axes", "Bows", "Daggers", "Gauntlets", "Guns", "HandGuns", "Maces", "Polearms", "Rifles", "Staffs", "Swords", "Wands", "Whips", "Cutscene Scripts", "Events", "Factions", "Locations", "Mini-Games", "Monsters", "NPCs", "Quests", "Shops", "Hair Shops", "Merge Shops", "Wars", "Book of Lore Badges", "Character Page Badges"];
/* Order values read the way the official tool writes them - the bar shows
   order:Newest First, the URL builder maps case-blind to the wiki key. */
const AQWE_ORDERS = [["Name", "title"], ["Newest First", "created_at desc"], ["Oldest First", "created_at"], ["Newest Updated", "updated_at desc"], ["Oldest Updated", "updated_at"], ["Random", "random"]];
const FILTER_KEYS = ["category:", "order:", "gender:", "per:"];
const KEY_RE = /\b(category|cat|order|gender|per):/gi;

/* No quotes anywhere: a key's value runs until the next key or the end. */
function parseTagQuery(q) {
    const marks = [];
    KEY_RE.lastIndex = 0;
    let m;
    while ((m = KEY_RE.exec(q))) marks.push({ key: m[1].toLowerCase(), start: m.index, valStart: KEY_RE.lastIndex });
    const out = { tag: (marks.length ? q.slice(0, marks[0].start) : q).trim().toLowerCase() || null,
                  cat: null, order: null, per: null, gender: null, marks };
    marks.forEach((mk, i) => {
        const end = i + 1 < marks.length ? marks[i + 1].start : q.length;
        mk.val = q.slice(mk.valStart, end).trim();
        mk.end = end;
        if (mk.key === "category" || mk.key === "cat") out.cat = mk.val;
        else if (mk.key === "order") out.order = mk.val.toLowerCase();
        else if (mk.key === "per") out.per = mk.val;
        else if (mk.key === "gender") out.gender = mk.val.toLowerCase();
    });
    return out;
}

/* ---- manual tags typed after the filters ----
   The grammar says a key's value runs to the end of the line, so a tag
   typed after per:25 would otherwise drown inside that value. The moment a
   stray token is a complete valid tag (a space follows it), it teleports
   into the tag zone and the caret follows; while it is still being typed,
   the suggestions treat it as a tag fragment. */
const VALID_VALUE = {
    category: (v) => AQWE_CATS.some((c) => c.toLowerCase() === v.toLowerCase()),
    cat: (v) => VALID_VALUE.category(v),
    order: (v) => AQWE_ORDERS.some(([k]) => k.toLowerCase() === v.toLowerCase()),
    gender: (v) => ["m", "f", "male", "female"].includes(v.toLowerCase()),
    per: (v) => /^\d+$/.test(v),
};
function validPrefixLen(key, tokens) {
    const check = VALID_VALUE[key === "cat" ? "category" : key];
    if (!check) return 0;
    for (let n = tokens.length; n >= 1; n--) {
        if (check(tokens.slice(0, n).join(" "))) return n;
    }
    return 0;
}
function reflowStrayTags(q) {
    const parsed = parseTagQuery(q);
    const last = parsed.marks[parsed.marks.length - 1];
    if (!last) return null;
    const val = q.slice(last.valStart);
    if (!/\s$/.test(val)) return null;                 // token still being typed
    const tokens = val.trim().split(/\s+/).filter(Boolean);
    const keep = validPrefixLen(last.key, tokens);
    if (!keep || tokens.length <= keep) return null;
    const strays = tokens.slice(keep);
    const pool = (typeof AQWE_TAGS !== "undefined") ? AQWE_TAGS : [];
    const movable = strays.filter((t) => pool.includes(t.replace(/^[+-]/, "").toLowerCase()));
    if (!movable.length) return null;
    const leftover = strays.filter((t) => !movable.includes(t));
    const zone = q.slice(0, parsed.marks[0].start).trimEnd();
    const newZone = (zone ? zone + " " : "") + movable.join(" ") + " ";
    const keysPart = q.slice(parsed.marks[0].start, last.valStart) + tokens.slice(0, keep).join(" ");
    const tail = leftover.length ? " " + leftover.join(" ") : "";
    return { value: newZone + keysPart + tail, caret: newZone.length };
}

function buildTagUrl(q) {
    const { tag, cat, order, per, gender } = parseTagQuery(q);
    const orderVal = (AQWE_ORDERS.find(([k]) => k.toLowerCase() === order) || [null, "title"])[1];
    const perVal = per && +per >= 1 && +per <= 250 ? Math.floor(+per) : 50;
    const parent = !cat || /^all$/i.test(cat) ? "-=" : cat.replace(/ /g, "%20");
    return WIKI + "/search-items-by-tag" + (gender === "f" || gender === "female" ? "-f" : "") +
        "/parent/" + parent +
        "/tags/" + encodeURIComponent(((tag || "") + " -_index -_redirect").trim()) +
        "/perPage/" + perVal +
        "/order/" + encodeURIComponent(orderVal);
}

function paintTagSuggestions(q, atZone) {
    const parsed = parseTagQuery(q);
    const active = parsed.marks.length ? parsed.marks[parsed.marks.length - 1] : null;
    const endsOpen = !atZone && active && active.end === q.length && !/\s$/.test(q);   // cursor inside the last key's value
    const used = new Set(parsed.marks.map((mk) => (mk.key === "cat" ? "category" : mk.key) + ":"));
    const replaceActive = (text) => {
        input.value = q.slice(0, active.start) + text + " ";
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        input.scrollLeft = input.scrollWidth;   // the view follows the caret
        input.dispatchEvent(new Event("input"));
    };
    let options = [];
    // A tag being typed beyond a filter's finished value suggests as a tag;
    // picking one completes it and the input handler teleports it home.
    let strayFrag = null;
    if (endsOpen && active) {
        const toks = active.val.trim().split(/\s+/).filter(Boolean);
        const keep = validPrefixLen(active.key, toks);
        if (keep && toks.length > keep) strayFrag = toks[toks.length - 1];
    }
    if (strayFrag !== null) {
        const fPrefix = /^[+-]/.test(strayFrag) ? strayFrag[0] : "";
        const fCore = strayFrag.replace(/^[+-]/, "").toLowerCase();
        // tags already sitting in the zone never re-suggest, here either
        const zoneDone = (parsed.marks.length ? q.slice(0, parsed.marks[0].start) : q)
            .split(/\s+/).filter(Boolean).map((t) => t.replace(/^[+-]/, "").toLowerCase());
        const zoneUsed = new Set(zoneDone);
        const keyOpts = fPrefix ? [] : FILTER_KEYS.filter((kk) => !used.has(kk) && kk.slice(0, -1).startsWith(fCore))
            .map((kk) => [kk.slice(0, -1), "add filter", () => {
                input.value = q.slice(0, q.length - strayFrag.length) + kk;
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
                input.scrollLeft = input.scrollWidth;
                input.dispatchEvent(new Event("input"));
            }]);
        const sPool = (typeof AQWE_TAGS !== "undefined") ? AQWE_TAGS : [];
        const sTop = (typeof AQWE_TOP_TAGS !== "undefined") ? AQWE_TOP_TAGS : [];
        const fragTags = [...sTop.filter((t) => t.includes(fCore)), ...sPool.filter((t) => t.includes(fCore) && !sTop.includes(t))]
            .filter((t) => !zoneUsed.has(t))
            .map((t) => [t, "tag", () => {
                input.value = q.slice(0, q.length - strayFrag.length) + fPrefix + t + " ";
                input.focus();
                input.dispatchEvent(new Event("input"));
            }]);
        options = [...keyOpts, ...fragTags];
    } else if (endsOpen && (active.key === "category" || active.key === "cat")) {
        // the WHOLE list, always - the dropdown scrolls, and a category
        // nobody sees is a category nobody uses
        const frag = active.val.toLowerCase();
        options = AQWE_CATS.filter((c) => c.toLowerCase().includes(frag))
            .map((c) => [c, "category", () => replaceActive("category:" + c)]);
    } else if (endsOpen && active.key === "order") {
        options = AQWE_ORDERS.filter(([k]) => k.toLowerCase().startsWith(active.val.toLowerCase()))
            .map(([k]) => [k, "order", () => replaceActive("order:" + k)]);
    } else if (endsOpen && active.key === "gender") {
        options = ["Male", "Female"].filter((g) => g.toLowerCase().startsWith(active.val.toLowerCase()))
            .map((g) => [g, "gender", () => replaceActive("gender:" + g)]);
    } else if (endsOpen && active.key === "per") {
        options = ["25", "50", "75", "100", "250"].filter((n) => n.startsWith(active.val))
            .map((n) => [n, "per page", () => replaceActive("per:" + n)]);
    } else {
        // Tag zone. Tags stack (space-separated; + means AND, - excludes), so
        // suggestions follow the TOKEN being typed - its +/- prefix stripped
        // for matching, kept on insert - and keep coming after every finished
        // tag. Filter keys appear at token boundaries only, above the tags,
        // because each key is one-shot while tags repeat.
        const zone = parsed.marks.length ? q.slice(0, parsed.marks[0].start) : q;
        const rest = q.slice(zone.length);
        const tokens = zone.split(/\s+/).filter(Boolean);
        // The token being typed is the one at the CARET - once filters
        // exist, new tags are typed mid-line ahead of them, so the zone's
        // end says nothing about what the user is writing.
        const caret = Math.min(input.selectionStart ?? zone.length, zone.length);
        const upToCaret = zone.slice(0, caret);
        const beforeTokens = upToCaret.split(/\s+/).filter(Boolean);
        const typing = (/\s$/.test(upToCaret) || !beforeTokens.length) ? "" : beforeTokens[beforeTokens.length - 1];
        const done = typing ? tokens.filter((t, i) => i !== beforeTokens.length - 1) : tokens;
        const prefix = /^[+-]/.test(typing) ? typing[0] : "";
        const frag = typing.replace(/^[+-]/, "").toLowerCase();
        const usedTags = new Set(done.map((t) => t.replace(/^[+-]/, "").toLowerCase()));

        if (!typing && (done.length || parsed.marks.length)) {
            options = FILTER_KEYS.filter((k) => !used.has(k)).map((k) => [k.slice(0, -1), "add filter", () => {
                input.value = q.trimEnd() + " " + k;
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
                input.scrollLeft = input.scrollWidth;
                input.dispatchEvent(new Event("input"));
            }]);
        }
        // Typing a filter's name by hand offers the filter itself, above the
        // tags - picking it swaps the fragment for the key. The fragment
        // sits at the CARET, not the end (after a tag teleport the user
        // types ahead of the filters) - cut it exactly there, then let the
        // key land where filters live: at the end of the line.
        if (typing && !prefix) {
            const tfrag = typing.toLowerCase();
            options = FILTER_KEYS.filter((kk) => !used.has(kk) && kk.slice(0, -1).startsWith(tfrag))
                .map((kk) => [kk.slice(0, -1), "add filter", () => {
                    const left = (q.slice(0, caret - typing.length) + q.slice(caret))
                        .replace(/\s+/g, " ").trim();
                    input.value = left + (left ? " " : "") + kk;
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                    input.scrollLeft = input.scrollWidth;
                    input.dispatchEvent(new Event("input"));
                }]);
        }
        // The whole vocabulary stays reachable: top tags lead, the rest follow,
        // and the dropdown scrolls - six rows visible, the seventh peeking.
        const pool = (typeof AQWE_TAGS !== "undefined") ? AQWE_TAGS : [];
        const top = (typeof AQWE_TOP_TAGS !== "undefined") ? AQWE_TOP_TAGS : [];
        const tagOpts = [...top.filter((t) => t.includes(frag)), ...pool.filter((t) => t.includes(frag) && !top.includes(t))]
            .filter((t) => !usedTags.has(t))
            .map((t) => [t, "tag", () => {
                const before = done.join(" ");
                const zoneNew = (before ? before + " " : "") + prefix + t + " ";
                // Two-step write so the VIEW follows the caret: set the tag
                // zone alone (view lands at its end), then splice the filters
                // back in behind the caret - setRangeText does not scroll.
                input.value = zoneNew;
                input.focus();
                input.setSelectionRange(zoneNew.length, zoneNew.length);
                input.scrollLeft = input.scrollWidth;
                if (rest) input.setRangeText(rest, zoneNew.length, zoneNew.length, "start");
                input.dispatchEvent(new Event("input"));
            }]);
        options = [...options, ...tagOpts];
    }
    for (const [label, kind, act] of options.slice(0, 700)) {
        const a = document.createElement("a");
        a.href = "#";
        a.innerHTML = `<span></span><span class="tag-chip">${kind}</span>`;
        a.firstChild.textContent = label;
        a.addEventListener("pointerdown", (e) => e.preventDefault());   // no focus steal
        a.addEventListener("click", (e) => { e.preventDefault(); act(); });
        suggest.appendChild(a);
    }
    suggest.classList.toggle("open", options.length > 0);
}

/* Whole-wiki suggestions from the bundled 47k-item index (the wiki's own
   search backend is offline, so local is both faster and the only option). */
function itemSuggest(qLower) {
    const starts = [], contains = [];
    for (const entry of AQWE_ITEMS) {
        const n = entry[0].toLowerCase();
        if (n.startsWith(qLower)) starts.push(entry);
        else if (n.includes(qLower)) contains.push(entry);
        if (starts.length >= 25) break;
    }
    const results = [...starts, ...contains].slice(0, 25);
    suggest.innerHTML = "";
    const idx = ownedIdx();
    for (const [name, slug] of results) {
        const a = document.createElement("a");
        a.href = WIKI + "/" + slug;
        a.target = "_blank";
        // the suggestion is a wiki page TITLE, suffixes and all - the index
        // peels them and gates Legend/type variants against your copies
        const isOwned = !!idx.get(name);
        a.innerHTML = `<span></span>${isOwned ? '<span class="own">Owned ✓</span>' : ""}`;
        a.firstChild.textContent = name;
        a.addEventListener("pointerdown", (e) => e.preventDefault());
        suggest.appendChild(a);
    }
    if (!results.length) {
        const none = document.createElement("a");
        none.href = `${WIKI}/${AQWE.nameToSlug(input.value.trim())}`;
        none.target = "_blank";
        none.textContent = `Try the page "${AQWE.nameToSlug(input.value.trim())}"`;
        suggest.appendChild(none);
    }
    suggest.classList.add("open");
}

input.addEventListener("input", () => {
    let q = input.value;
    suggest.innerHTML = "";
    if (tagMode) {
        // Typing a new tag right where the filters begin glues it onto the
        // key ("legcategory:") and the key drowns - give the fragment its
        // separating space back the instant it happens, caret staying put.
        const caret0 = input.selectionStart ?? q.length;
        if (/(^|\s)\S+$/.test(q.slice(0, caret0)) && /^(category|cat|order|gender|per):/i.test(q.slice(caret0))) {
            q = q.slice(0, caret0) + " " + q.slice(caret0);
            input.value = q;
            input.setSelectionRange(caret0, caret0);
        }
        // a finished valid tag typed after the filters teleports home,
        // caret and view following it
        const moved = reflowStrayTags(q);
        if (moved) {
            const head = moved.value.slice(0, moved.caret);
            const rest = moved.value.slice(moved.caret);
            input.value = head;
            input.focus();
            input.setSelectionRange(head.length, head.length);
            input.scrollLeft = input.scrollWidth;
            if (rest) input.setRangeText(rest, head.length, head.length, "start");
            q = input.value;
        }
        // While the caret sits in the tag zone (as it does right after a
        // teleport), suggestions answer for the zone even though the string
        // ends in per:25 territory.
        const marks0 = parseTagQuery(q).marks[0];
        const caretInZone = !marks0 || input.selectionStart <= marks0.start;
        paintTagSuggestions(q, !!moved || caretInZone);
        suggest.scrollTop = 0;             // fresh matches always enter at the top
        return;
    }
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) { suggest.classList.remove("open"); return; }
    itemSuggest(needle);
    suggest.scrollTop = 0;
});
/* Tag mode greets the click with the vocabulary itself - top tags first,
   everything else scrollable below, no typing needed to discover a tag. */
input.addEventListener("focus", () => {
    if (tagMode && !suggest.classList.contains("open")) {
        suggest.innerHTML = "";
        paintTagSuggestions(input.value);
    }
});
/* Clicking anywhere else puts the suggestions away. */
document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".search-box")) suggest.classList.remove("open");
});

function runSearch() {
    if (!input.value.trim()) return;
    AQWE.count(tagMode ? "tagSearch" : "search");
    if (tagMode) {
        AQWE.api.tabs.create({ url: buildTagUrl(input.value) });
        return;
    }
    // Exact name -> its page. Anything else opens the literal slug, so an
    // ambiguous "deady" lands on the wiki's own disambiguation page instead
    // of whichever suggestion happened to sort first. Clicking a suggestion
    // is the way to pick a specific variant.
    const needle = input.value.trim().toLowerCase();
    const hit = AQWE_ITEMS.find((e) => e[0].toLowerCase() === needle);
    AQWE.api.tabs.create({ url: hit ? WIKI + "/" + hit[1] : WIKI + "/" + AQWE.nameToSlug(input.value.trim()) });
}
document.getElementById("search-go").addEventListener("click", runSearch);
input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
    if (e.key === "Tab" && suggest.classList.contains("open")) {
        const first = suggest.querySelector("a");
        if (first) { e.preventDefault(); first.click(); }
    }
});

/* Ctrl+K focuses the search bar */
document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.focus();
        input.select();
    }
});

$("#armory").addEventListener("click", (e) => {
    e.preventDefault();
    AQWE.count("armoryOpen");
    AQWE.api.tabs.create({ url: AQWE.api.runtime.getURL("src/armory/armory.html") });
});
