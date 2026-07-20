/* AQW Wiki Enhanced - wiki content script.
   Type-aware enhancement of aqwwiki.wikidot.com (see design/page-types.md). */
"use strict";

(async () => {
    const html = document.documentElement;
    var sourceQueue = [];  // filled by the recipe builder, drained by the source loader
    const state = await AQWE.storage.get({
        theme: "good",            // ships Good; Evil is one click away
        hoverMode: "clean",
        inventory: null,
        goals: [],
    });

    /* ---------------- 1. Theme + the mixed-content self-heal ---------------- */

    html.dataset.aqweTheme = state.theme;
    html.classList.add("aqwe");

    /* boot.js lays the bundled skin under everything at document_start, so
       the page can never render bare. This late pass exists for FRESHNESS
       and telemetry: any of the page's own @imports that died (mixed
       content on the https variants, CDN hiccups) gets re-attached over
       https - live CSS beats the bundle's snapshot - and the death is
       counted, our early warning that Wikidot's sheets are failing in the
       wild. */
    try {
        let dead = 0;
        const twin = (href) => {
            if (/^http:\/\//i.test(href)) return href.replace(/^http:/i, "https:");
            const path = href.startsWith("/") ? href
                : (href.match(/^https?:\/\/aqwwiki\.wikidot\.com(\/.*)$/i) || [])[1];
            return path ? "https://aqwwiki.wdfiles.com" + path : null;
        };
        for (const ss of document.styleSheets) {
            let rules = null;
            try { rules = ss.cssRules; } catch { continue; }   // cross-origin = it loaded fine
            if (!rules) continue;
            for (const rule of rules) {
                if (rule.type !== CSSRule.IMPORT_RULE || rule.styleSheet !== null) continue;
                const url = twin(rule.href || "");
                dead++;
                if (!url || document.querySelector(`link[href="${CSS.escape(url)}"]`)) continue;
                const link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = url;
                document.head.appendChild(link);
            }
        }
        if (dead) AQWE.count("cssRescue");
    } catch { /* the theme layer must never break the page */ }

    /* The Good banner's last line of defense. Its rule lives in a css
       module the page imports INSIDE live-theme, where none of the DOM
       scans can ever watch it die - and on Firefox's https variants it
       sometimes does, silently. Mechanism-independent heal: if the banner
       area computes to no image at all, load the module straight from the
       wdfiles mirror (the only host serving it as true text/css on both
       schemes) - it duplicates a healthy page's own rule at worst, so it
       can neither flash nor fight the cascade. Under EVIL the wiki's rule
       hides behind boot.js's !important override and its health can't be
       read at all - preload the module anyway, so switching to Good shows
       the banner in the same frame instead of after a fetch (or never,
       when the page's own import was dead). */
    const BANNER_CSS = "https://aqwwiki.wdfiles.com/css:banner/code/1";
    function healBanner() {
        try {
            if (document.querySelector(`link[href="${BANNER_CSS}"]`)) return;
            const cw = document.getElementById("container-wrap");
            const evil = html.dataset.aqweTheme === "evil";
            if (!evil && (!cw || getComputedStyle(cw).backgroundImage !== "none")) return;
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = BANNER_CSS;
            document.head.appendChild(link);
            if (!evil) AQWE.count("cssRescue");   // a real rescue, not a preload
        } catch { /* never break the page over a banner */ }
    }
    healBanner();


    /* ---------------- 2. Page anatomy ---------------- */

    const crumbs = [...document.querySelectorAll("#breadcrumbs a")].map((a) => a.textContent.trim());
    const isItemPage = crumbs[1] === "Items";
    // shop pages: wiki.css shrink-wraps the tab box to its table. Shop
    // crumbs read "AQWorlds Wiki > World > Shops" - same lesson as the
    // quest gate, never trust a fixed crumb position.
    if (crumbs.includes("Shops")) html.classList.add("aqwe-shops");
    const pageTitleEl = document.querySelector("#page-title");
    const pageContent = document.querySelector("#page-content");

    /* ---------------- 3. Ownership badges ---------------- */

    /* Ownership answers through the shared index (common.js): copies keyed
       by their stripped names, every trailing wiki suffix peeled and gated -
       (Legend) by the Member flag, type suffixes by the copy's API type,
       (Rare) by the copy's real name, currency suffixes never. The popup's
       search and goal math read the very same brain. */
    const ownedIdx = AQWE.ownedIndex(state.inventory && state.inventory.items);
    const ownedFor = (t) => ownedIdx.get(t);

    const BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8V7a6 6 0 0 1 12 0v1"/><path d="M4 8h16l-1.3 12a2 2 0 0 1-2 1.8H7.3a2 2 0 0 1-2-1.8z"/></svg>';
    const BANK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18M5 10V7l7-4 7 4v3M6 10v8M10 10v8M14 10v8M18 10v8M4 21h16"/></svg>';

    function badge(el, rec) {
        const inBank = rec.qi === 0;
        el.classList.add(inBank ? "aqwe-bank" : "aqwe-owned");
        const glyph = document.createElement("span");
        glyph.className = "aqwe-glyph";
        glyph.title = inBank
            ? (rec.qb > 1 ? `In your bank (x${rec.qb})` : "In your bank")
            : (rec.qi > 1 ? `In your inventory (x${rec.qi})` : "In your inventory");
        glyph.innerHTML = inBank ? BANK : BAG;
        el.appendChild(glyph);
    }

    const isTagHref = (href) => (href || "").includes("system:page-tags");
    if (ownedIdx.size && pageContent) {
        for (const link of pageContent.querySelectorAll("a[href^='/'], a[href*='aqwwiki.wikidot.com/']")) {
            if (link.closest("#breadcrumbs, .page-tags") || link.querySelector("img")) continue;
            if (isTagHref(link.getAttribute("href"))) continue; // tags are not ownable
            const rec = ownedFor(link.textContent);
            if (rec) badge(link, rec);
        }
        if (pageTitleEl && !location.pathname.includes("system:")) {
            const rec = ownedFor(pageTitleEl.textContent);
            if (rec) badge(pageTitleEl, rec);
        }
    }

    /* ---------------- 4. Farm Goal star (item pages only) ---------------- */

    if (isItemPage && pageTitleEl) {
        const name = pageTitleEl.childNodes[0]?.textContent.trim() || pageTitleEl.textContent.trim();
        const star = document.createElement("button");
        star.className = "aqwe-goal-star";
        star.type = "button";
        const isSet = () => state.goals.some((g) => g.url === location.pathname);
        const paint = () => {
            star.classList.toggle("set", isSet());
            star.title = isSet() ? "Remove from Farm Goals" : "Add to Farm Goals";
            star.textContent = isSet() ? "★" : "☆";
        };
        star.addEventListener("click", async () => {
            if (isSet()) {
                state.goals = state.goals.filter((g) => g.url !== location.pathname);
            } else {
                state.goals.push({ name, url: location.pathname, at: Date.now() });
                AQWE.count("goalAdd");
            }
            await AQWE.storage.set({ goals: state.goals });
            paint();
        });
        paint();
        pageTitleEl.appendChild(star);
    }

    /* ------- 5. Ownership panels: recipes AND quest requirements -------
       One builder, one brand: the same status icons, meter and quantities
       serve "Merge the following:" lists on item pages and every tab's
       "Items Required:" list on quest pages. */

    const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
    const MINUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"><path d="M5 12h14"/></svg>';
    const CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    const COIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.6"/></svg>';
    // the quest-space icons: a clock for what only exists during the quest
    // (round face reads clean at 10px, nothing like the cross), a folded
    // page for what the wiki explains in its own note beneath
    const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.6V12l3.1 1.9"/></svg>';
    const PAGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4.5 4.5V21H7z"/><path d="M14 3v4.5h4.5"/></svg>';
    // an empty ring: literally nothing inside - N/A's own shape, and
    // nothing like the bank minus
    const NONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><circle cx="12" cy="12" r="8.4"/></svg>';

    function matsFromList(ul) {
        const mats = [];
        for (const li of ul.children) {
            // a NORMAL material begins with its own link; a TEMPORARY quest
            // item begins with plain text ("Ice Cubes x1") and explains
            // itself in the nested lines beneath. The anchor must come from
            // the li's OWN line (nested lists removed): "Earth Elemental
            // Destroyed" dropped by "Earth Elemental (1)" defeats any
            // starts-with comparison against a nested monster link.
            const own = li.cloneNode(true);
            own.querySelectorAll("ul").forEach((u) => u.remove());
            const ownText = own.textContent.replace(/\s+/g, " ").trim();
            const a = own.querySelector("a[href^='/']");
            const isLinked = a && ownText.startsWith(a.textContent.trim().slice(0, 12));
            if (isLinked) {
                const name = a.textContent.trim();
                const qtyMatch = (li.textContent.match(/x\s*([\d,]+)/i) || [])[1];
                const need = qtyMatch ? parseInt(qtyMatch.replace(/,/g, ""), 10) : 1;
                const rec = ownedFor(name) || { qi: 0, qb: 0 };
                mats.push({ name, href: a.getAttribute("href"), need, qi: rec.qi, qb: rec.qb });
                continue;
            }
            // Gold is a real merge cost with no page and no balance we can
            // read - it gets its own row and stays out of the meter
            const gm = ownText.match(/^([\d,]+)\s+Gold$/i);
            if (gm) {
                mats.push({ name: "Gold", gold: true, need: parseInt(gm[1].replace(/,/g, ""), 10), qi: 0, qb: 0 });
                continue;
            }
            // a DECORATED linked material: the line carries a real link but
            // does not start with it - quest pages write unidentified items
            // as 'Unidentified 13: "The Contract of Nulgath" x1' with the
            // link on the quoted page name. The row keeps the wiki's words
            // around the link; ownership answers to the line's own names
            // (the full line, the part before the colon - that is the
            // in-game name - then the linked title).
            if (a && !/Dropped by/i.test(ownText)) {
                const full = ownText.replace(/\s*x\s*[\d,]+\s*$/i, "").trim();
                const label = a.textContent.trim();
                let before = "", after = "", past = false;
                for (const n of own.childNodes) {
                    if (!past && n.nodeType === 1 && n.matches && n.matches("a[href^='/']")) { past = true; continue; }
                    if (past) after += n.textContent || "";
                    else before += n.textContent || "";
                }
                before = before.replace(/\s+/g, " ").trimStart();
                after = after.replace(/\s*x\s*[\d,]+\s*$/i, "").replace(/\s+/g, " ").trimEnd();
                const qtyMatch = (li.textContent.match(/x\s*([\d,]+)/i) || [])[1];
                const need = qtyMatch ? parseInt(qtyMatch.replace(/,/g, ""), 10) : 1;
                let rec = { qi: 0, qb: 0 };
                for (const cand of [full, (full.split(":")[0] || "").trim(), label]) {
                    const r = cand && ownedFor(cand);
                    if (r) { rec = r; break; }
                }
                mats.push({ name: label, href: a.getAttribute("href"), need, qi: rec.qi, qb: rec.qb, before, after });
                continue;
            }
            // stacking notes are a property, not part of the name - they
            // move to the title's muted suffix
            const stacksM = ownText.match(/\(\s*Stacks up to\s*([\d,]+)[^)]*\)/i);
            const name = ownText.replace(/\(\s*Stacks up to[^)]*\)/i, " ")
                .replace(/Dropped by[\s\S]*/i, "")
                .replace(/x\s*[\d,]+\s*$/i, "")
                .replace(/\s+/g, " ").trim();
            if (!name) continue;
            // "Items Required: N/A" means the quest asks for nothing - the
            // panel still builds (every tab wears the same face), with one
            // quiet row saying so
            if (/^N\/A$/i.test(name)) {
                mats.push({ name: "N/A", na: true, need: 0, qi: 0, qb: 0 });
                continue;
            }
            // each nested line speaks for itself: "Dropped by <a>" lines
            // carry the monsters, anything else is the wiki's own words on
            // how the item is obtained ("Go to Screen 2")
            const ways = [], dropLinks = [];
            for (const li2 of li.querySelectorAll(":scope > ul > li")) {
                const as = [...li2.querySelectorAll("a[href^='/']")];
                if (as.length && /Dropped by/i.test(li2.textContent)) {
                    for (const d of as) dropLinks.push([d.textContent.trim(), d.getAttribute("href")]);
                } else if (as.length) {
                    // the note keeps ALL its words - "Click on the arrows
                    // around DragonPlane" stays a sentence, and DragonPlane
                    // stays a link inside it
                    const parts = [];
                    for (const n of li2.childNodes) {
                        if (n.nodeType === 1 && n.matches && n.matches("a[href^='/']")) {
                            parts.push(["a", n.textContent.trim(), n.getAttribute("href")]);
                        } else {
                            const t = (n.textContent || "").replace(/\s+/g, " ");
                            if (t.trim()) parts.push(["t", t]);
                        }
                    }
                    if (parts.length) ways.push({ k: "Note", parts });
                } else {
                    const t = li2.textContent.replace(/\s+/g, " ").trim();
                    if (t) ways.push({ k: "Note", text: t.slice(0, 90) });
                }
            }
            // "Dropped by" written inline in the item's own line still counts
            if (!dropLinks.length && !ways.length && /Dropped by/i.test(ownText)) {
                for (const d of own.querySelectorAll("a[href^='/']")) dropLinks.push([d.textContent.trim(), d.getAttribute("href")]);
            }
            const monsters = [];
            if (dropLinks.length) {
                ways.unshift({ k: "Drop", links: dropLinks, inline: 3, more: 0 });
                for (const [, h] of dropLinks) if (!monsters.includes(h)) monsters.push(h);
            }
            const qtyMatch = (li.textContent.match(/x\s*([\d,]+)/i) || [])[1];
            const need = qtyMatch ? parseInt(qtyMatch.replace(/,/g, ""), 10) : 1;
            // temporary items never reach the account inventory, so no
            // ownership lookup: a same-named real item would only lie here
            mats.push({ name, href: null, need, qi: 0, qb: 0, temp: true, ways, monsters, stacks: stacksM ? stacksM[1] : null });
        }
        return mats;
    }

    function buildPanel(mats, ul, title, unit, withSources, extra) {
        // each material weighs the same, so one x800 stack can't drown the
        // rest; banked copies count toward the meter exactly like Farm
        // Goals count them - the row's gold minus still says "in the bank".
        // Gold and temporary rows stay OUT of the math: neither a gold
        // balance nor a temp inventory is ever readable, and an unknowable
        // row must not hold the bar under 100. A recipe with NOTHING
        // trackable shows no meter at all - a 0% bar would be a verdict
        // we have no right to give.
        let sum = 0, tracked = 0;
        for (const m of mats) {
            if (m.gold || m.temp || m.na) continue;
            tracked++;
            sum += Math.min((m.qi + m.qb) / m.need, 1);
        }
        const pct = tracked ? Math.round((sum / tracked) * 100) : 0;

        // the head counts MATERIALS - an N/A row is the absence of one
        const matCount = mats.filter((m) => !m.na).length;
        const panel = document.createElement("div");
        panel.className = "aqwe-recipe";
        panel.innerHTML =
            `<div class="aqwe-recipe-head"><span>` +
            (matCount ? `<span class="aqwe-sub"> · ${matCount} ${unit}${matCount > 1 ? "s" : ""}</span>` : "") +
            (extra ? `<span class="aqwe-sub"> · </span>` : "") +
            `</span>` +
            (tracked ? `<span class="aqwe-meter"><span class="aqwe-bar"><span style="width:${pct}%"></span></span>${pct}%</span>` : "") +
            `</div>`;
        const headSpan = panel.querySelector(".aqwe-recipe-head > span");
        headSpan.prepend(title);
        if (extra) {
            // the wiki's own yield ("makes 30 Tainted Gems"), quietly
            const y = document.createElement("span");
            y.className = "aqwe-sub";
            y.textContent = extra;
            headSpan.appendChild(y);
        }
        for (const m of mats) {
            // Gold and temporary items: an icon instead of a verdict - the
            // row says what the quest will ask for without pretending to
            // know a balance or a temp inventory nobody can read. The
            // temporary nature reads as a quiet suffix on the title (chips
            // stay reserved for the eye-catching, actionable facts).
            if (m.gold || m.temp || m.na) {
                const row = document.createElement("div");
                row.className = "aqwe-recipe-row " + (m.gold ? "gold" : m.na ? "na" : "temp");
                const st = document.createElement("span");
                st.className = "aqwe-st " + (m.gold ? "gold" : m.na ? "na" : "temp");
                const dropTemp = m.temp && m.monsters && m.monsters.length;
                st.innerHTML = m.gold ? COIN : m.na ? NONE : dropTemp ? CLOCK : PAGE;
                st.title = m.gold ? "Gold can't be tracked"
                    : m.na ? "Nothing required"
                    : dropTemp ? "Temporary items can't be tracked"
                    : "See the note below";
                const name = document.createElement("span");
                name.textContent = m.name;
                // all-caps ink sits a pixel low in Segoe UI's box - the only
                // all-caps title we ever render gets an optical lift
                if (m.na) name.className = "aqwe-na-name";
                // only monster drops are truly Temporary Items - a note row
                // is an objective (walk somewhere, click something), so its
                // page icon and note speak for themselves
                const subText = (dropTemp ? " · Temporary Item" : "")
                    + (m.stacks ? ` · Stacks up to ${m.stacks}` : "");
                if (subText) {
                    const sub = document.createElement("span");
                    sub.className = "aqwe-mat-sub";
                    sub.textContent = subText;
                    name.appendChild(sub);
                }
                const chips = document.createElement("span");
                chips.className = "aqwe-kinds";
                const qty = document.createElement("span");
                qty.className = "aqwe-qty";
                // gold is an amount, a temp item is a count (x5 echoes the
                // wiki's own notation), and N/A carries no number at all
                qty.textContent = m.gold ? m.need.toLocaleString() : m.na ? "" : "x" + m.need.toLocaleString();
                row.append(st, name, chips, qty);
                panel.appendChild(row);
                if (m.ways && m.ways.length) sourceQueue.push({ row, chips, need: m.need, have: 0, ways: m.ways, monsters: m.monsters });
                continue;
            }
            const total = m.qi + m.qb;
            const row = document.createElement("div");
            row.className = "aqwe-recipe-row " + (m.qi >= m.need ? "ok" : total >= m.need ? "part" : "no");
            const st = document.createElement("span");
            st.className = "aqwe-st " + (m.qi >= m.need ? "ok" : total >= m.need ? "bank" : "no");
            st.innerHTML = m.qi >= m.need ? CHECK : total >= m.need ? MINUS : CROSS;
            st.title = m.qi >= m.need ? "Ready to merge"
                : total >= m.need ? "Withdraw from bank to merge"
                : "Not enough";
            // a decorated line keeps the wiki's own words around the link
            // ('Unidentified 13: "The Contract of Nulgath"'); the ownership
            // tint goes on the inner anchor, the glyph closes the title
            let link, tintEl;
            if (m.before !== undefined) {
                link = document.createElement("span");
                if (m.before) link.append(m.before);
                tintEl = document.createElement("a");
                tintEl.href = m.href;
                tintEl.textContent = m.name;
                link.appendChild(tintEl);
                if (m.after) link.append(m.after);
            } else {
                link = document.createElement(m.href ? "a" : "span");
                if (m.href) link.href = m.href;
                link.textContent = m.name;
                tintEl = link;
            }
            if (total > 0) {
                tintEl.classList.add(m.qi > 0 ? "aqwe-owned" : "aqwe-bank");
                const glyph = document.createElement("span");
                glyph.className = "aqwe-glyph";
                glyph.title = m.qi > 0 ? "In your inventory" : "In your bank";
                glyph.innerHTML = m.qi > 0 ? BAG : BANK;
                link.appendChild(glyph);
            }
            const chips = document.createElement("span");
            chips.className = "aqwe-kinds";
            const qty = document.createElement("span");
            qty.className = "aqwe-qty";
            qty.textContent = `${total.toLocaleString()} / ${m.need.toLocaleString()}`;
            row.append(st, link, chips, qty);
            panel.appendChild(row);
            if (withSources && m.href) sourceQueue.push({ row, chips, href: m.href, need: m.need, have: total });
        }
        ul.parentElement.insertBefore(panel, ul);
        ul.classList.add("aqwe-raw-recipe");
    }

    if (isItemPage && pageContent) {
        // resource pages phrase it "Merge the following to make 30 Tainted
        // Gems:" - the prefix is the gate, and the yield is worth showing
        const recipeLists = [];
        for (const li of pageContent.querySelectorAll("ul > li")) {
            const t = li.textContent.trim();
            if (/^Merge the following\b/i.test(t) && li.querySelector("ul")) {
                const ym = t.match(/^Merge the following to make ([^:\n]+):/i);
                recipeLists.push({ ul: li.querySelector("ul"), makes: ym ? ym[1].trim() : null });
            }
        }
        recipeLists.forEach(({ ul, makes }, idx) => {
            const mats = matsFromList(ul);
            if (!mats.length) return;
            buildPanel(mats, ul, recipeLists.length > 1 ? "Recipe " + (idx + 1) : "Recipe", "Material", true, makes);
        });
    }

    /* Quest pages: each tab is its own quest with its own requirements -
       every "Items Required:" list becomes the same ownership panel, so
       farming progress reads at a glance without leaving the quest. */
    if (crumbs.includes("Quests") && pageContent) {   // quests crumb as World » Quests
        for (const rs of [...pageContent.querySelectorAll("strong")].filter((el) => /^Items Required:?$/i.test(el.textContent.trim()))) {
            const scope = rs.closest("p") || rs.parentElement;
            let ul = null;
            for (let sib = scope && scope.nextElementSibling, i = 0; sib && i < 3; i++, sib = sib.nextElementSibling) {
                if (sib.tagName === "UL") { ul = sib; break; }
                if (sib.tagName === "P" && sib.querySelector("strong")) break;
            }
            if (!ul) continue;
            const mats = matsFromList(ul);
            if (mats.length) buildPanel(mats, ul, "Recipe", "Material", true);
        }
    }

    /* ---- Recipes v5: every way an item is obtained, in one glance ----
       Each material row grows a source block listing ALL its obtain ways in
       the fixed order Price > Drop > Quest > Merge > Gift, then Location
       last. Merge lines carry quantities (the two-branch view: reading
       NSOD you see Void Aura x200 inside Necrotic Sword's Blade). A Daily
       Quest / Weekly Quest chip sits by the name - read from the quest
       page's own note - and drop-rate chips exist ONLY when the material's
       wiki page states a rate. Results persist for a day, so a refresh
       paints every line instantly with zero fetches. */

    const SRC_V = 11, SRC_TTL = 24 * 3600e3, SRC_CAP = 400;   // bump on EVERY parser change - stale caches masked v5.1 entirely

    /* one open popover at a time; any outside click or scroll puts it away
       (fixed positioning would drift against a scrolling page) */
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".aqwe-more-wrap")) {
            document.querySelectorAll(".aqwe-pop.open").forEach((p) => p.classList.remove("open"));
        }
    });
    addEventListener("scroll", () => {
        document.querySelectorAll(".aqwe-pop.open").forEach((p) => p.classList.remove("open"));
    }, { passive: true });

    function renderSources(item, data) {
        const { row, chips } = item;
        if (!row.isConnected || row.dataset.aqweSrc) return;
        row.dataset.aqweSrc = "1";
        if (data.cadence) {
            const c = document.createElement("span");
            c.className = "aqwe-kind quest";
            c.textContent = data.cadence === "weekly" ? "Weekly Quest" : "Daily Quest";
            chips.appendChild(c);
        }
        if (data.rate) {
            const rb = document.createElement("span");
            rb.className = "aqwe-rate";
            rb.textContent = data.rate + " drop";
            chips.appendChild(rb);
        }
        if (!data.ways.length) return;
        const src = document.createElement("div");
        src.className = "aqwe-src";
        const makeLine = (w, inlineN) => {
            const d = document.createElement("div");
            const k = document.createElement("span");
            k.className = "aqwe-src-kind k-" + w.k.toLowerCase();
            k.textContent = w.k;
            d.appendChild(k);
            // a parts line is a sentence with links living inside it
            // ("Click on the arrows around DragonPlane") - rendered in the
            // wiki's own order, nothing to demote
            if (w.parts) {
                for (const p of w.parts) {
                    if (p[0] === "a") {
                        const a = document.createElement("a");
                        a.href = p[2];
                        a.textContent = p[1];
                        d.appendChild(a);
                    } else {
                        const s = document.createElement("span");
                        s.className = "aqwe-src-plain";
                        s.textContent = p[1];
                        d.appendChild(s);
                    }
                }
                return d;
            }
            const links = w.links || [];
            const inline = Math.min(links.length, inlineN);
            links.slice(0, inline).forEach(([label, url, qty], i) => {
                if (i) d.append(" · ");
                if (url) {
                    const a = document.createElement("a");
                    a.href = url;
                    a.textContent = label;
                    d.appendChild(a);
                } else {
                    // pageless costs like "750,000 Gold" are CONTENT, not
                    // meta - they wear the links' ink, just without the link
                    const s = document.createElement("span");
                    s.className = "aqwe-src-plain";
                    s.textContent = label;
                    d.appendChild(s);
                }
                if (qty) d.append(" " + qty);   // plain text: the quantity stays quiet, like "+N more"
            });
            // the rest live one click away, in a card cut from the same cloth
            const hidden = links.slice(inline);
            const extra = hidden.length + (w.more || 0);
            if (extra > 0) {
                const wrap = document.createElement("span");
                wrap.className = "aqwe-more-wrap";
                const btn = document.createElement("a");
                btn.href = "#";
                btn.className = "aqwe-more";
                btn.textContent = `+${extra} more`;
                const pop = document.createElement("span");
                pop.className = "aqwe-pop";
                for (const [label, url, qty] of hidden) {
                    const line = document.createElement("span");
                    if (url) {
                        const a = document.createElement("a");
                        a.href = url;
                        a.textContent = label;
                        line.appendChild(a);
                    } else {
                        const s = document.createElement("span");
                        s.className = "aqwe-src-plain";
                        s.textContent = label;
                        line.appendChild(s);
                    }
                    if (qty) line.append(" " + qty);
                    pop.appendChild(line);
                }
                if (w.more) {
                    const note = document.createElement("span");
                    note.className = "aqwe-pop-note";
                    note.textContent = `and ${w.more} more on the page`;
                    pop.appendChild(note);
                }
                btn.addEventListener("click", (e) => {
                    e.preventDefault();
                    const wasOpen = pop.classList.contains("open");
                    document.querySelectorAll(".aqwe-pop.open").forEach((p) => p.classList.remove("open"));
                    if (!wasOpen) {
                        // fixed positioning at the button: no panel edge can
                        // clip it, and it flips up when the viewport runs out
                        const r = btn.getBoundingClientRect();
                        pop.classList.add("open");
                        const ph = pop.offsetHeight;
                        pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 12) + "px";
                        pop.style.top = (r.bottom + 6 + ph > innerHeight - 8 ? r.top - ph - 6 : r.bottom + 6) + "px";
                    }
                });
                wrap.append(btn, pop);
                d.append(" ", wrap);
            }
            if (w.text) {
                if (inline) d.append(" · ");
                // field values (a price, a note, a gifting NPC) are content
                // too - same ink as the links, only the meta stays muted
                const s = document.createElement("span");
                s.className = "aqwe-src-plain";
                s.textContent = w.text;
                d.appendChild(s);
            }
            // the visible answer to "how long will this take": the quest line
            // itself says it, quietly, from the tab's own reward count
            if (w.k === "Quest" && data.cadence && data.questYield && item.need > item.have) {
                const runs = Math.ceil((item.need - item.have) / data.questYield);
                const unit = data.cadence === "weekly" ? "week" : "day";
                d.append(` · ${runs} ${unit}${runs > 1 ? "s" : ""} left`);
            }
            return d;
        };
        const counts = data.ways.map((w) => Math.min((w.links || []).length, w.inline || (w.links || []).length));
        data.ways.forEach((w, i) => src.appendChild(makeLine(w, counts[i])));
        row.after(src);
        // ONE line each, dynamically: whatever wraps sheds links into its
        // popover until the line (with its +N more) fits - nothing hidden,
        // nothing folded mid-name
        data.ways.forEach((w, i) => {
            let d = src.children[i];
            let n = counts[i];
            let h = d.getBoundingClientRect().height;
            while (h > 26 && n > 1) {
                n--;
                const nd = makeLine(w, n);
                src.replaceChild(nd, d);
                d = nd;
                h = d.getBoundingClientRect().height;
            }
        });
    }

    /* One material page -> serializable obtain data (cache-friendly).
       Wikidot's field grammar is messier than it looks: several fields
       share one <p> separated by <br> ("Location: Ultra Dage <br>
       Price: N/A (Reward from the 'X' quest)"), long lists hide behind
       + Show collapsibles, and "Dropped by" lives inline in the price,
       in its own line, or as list items. Everything below reads a field
       as ITS OWN segment: the nodes after its <strong>, split into lines
       at <br>, ending at the next <strong>. */
    function parseMaterial(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const content = doc.querySelector("#page-content");
        const ways = [];
        const data = { ways, cadence: null, rate: null, questHref: null };
        if (!content) return data;
        const text = content.textContent || "";
        const strongs = [...content.querySelectorAll("strong")];
        // keep up to 30 links (the rest of a 115-location dropdown stays a
        // count); `inline` says how many sit in the line itself - everything
        // beyond opens from the "+N more" popover
        const linkArr = (anchors, inline) => ({
            links: anchors.slice(0, 30).map((a) => [a.textContent.trim(), a.getAttribute("href")]),
            inline,
            more: Math.max(0, anchors.length - 30),
        });

        /* the field's own lines: text + anchors per <br>-separated line,
           stopping at the next field's <strong> */
        const segLines = (strongEl) => {
            const lines = [];
            if (!strongEl) return lines;
            let cur = { text: "", anchors: [] };
            const push = () => {
                if (cur.text.trim() || cur.anchors.length) lines.push({ text: cur.text.trim(), anchors: cur.anchors });
                cur = { text: "", anchors: [] };
            };
            for (let n = strongEl.nextSibling; n; n = n.nextSibling) {
                if (n.nodeType === 1 && n.tagName === "STRONG") break;
                if (n.nodeType === 1 && n.tagName === "BR") { push(); continue; }
                if (n.nodeType === 3) { cur.text += n.textContent; continue; }
                if (n.nodeType === 1) {
                    cur.text += n.textContent;
                    if (n.matches("a[href^='/']")) cur.anchors.push(n);
                    else cur.anchors.push(...n.querySelectorAll("a[href^='/']"));
                }
            }
            push();
            return lines;
        };
        /* the list belonging to a field, seeing through + Show collapsibles */
        const listAfter = (strongEl) => {
            const scope = strongEl && (strongEl.closest("p") || strongEl.parentElement);
            let sib = scope && scope.nextElementSibling;
            for (let i = 0; sib && i < 3; i++, sib = sib.nextElementSibling) {
                if (sib.tagName === "UL") return sib;
                if (sib.classList && sib.classList.contains("collapsible-block")) {
                    const ul = sib.querySelector(".collapsible-block-content ul");
                    if (ul) return ul;
                }
                if (sib.tagName === "P" && sib.querySelector("strong")) break;   // next field
            }
            return null;
        };

        /* a + Show dropdown whose FOLD LABEL is the field's heading - on
           heavy pages "Reward from the following quests:" is the folded
           text itself, with no <strong> anywhere. Fold labels pad their
           words with no-break spaces - collapse whitespace before matching. */
        const collapsibleByLabel = (re) => {
            const cb = [...content.querySelectorAll(".collapsible-block")].find((b) => {
                const f = b.querySelector(".collapsible-block-folded");
                return f && re.test(f.textContent.replace(/\s+/g, " "));
            });
            return cb ? cb.querySelector(".collapsible-block-content ul") : null;
        };

        // ---- The Price section IS the obtain section. Everything between
        // Price: and the next field - the inline lines AND the list under
        // it - carries the value, Dropped by, quest rewards and gifting.
        const priceS = strongs.find((el) => /^Price:/.test(el.textContent.trim()));
        // the list under the paragraph belongs to Price only when Price is
        // the paragraph's LAST field - otherwise the page's notes list
        // ("Stacks up to 3. Used to merge...") would masquerade as a price
        const priceP = priceS && (priceS.closest("p") || priceS.parentElement);
        const priceIsLast = priceS && priceP && [...priceP.querySelectorAll("strong")].pop() === priceS;
        const priceUl = priceIsLast ? listAfter(priceS) : null;
        const priceEntries = [
            ...segLines(priceS),
            ...(priceUl ? [...priceUl.children].map((li) => ({
                text: li.textContent.replace(/\s+/g, " ").trim(),
                anchors: [...li.querySelectorAll("a[href^='/']")],
                li,   // keeps the nesting readable for the quest branch
            })) : []),
        ];
        let priceVal = "";
        const dropAnchors = [], priceQuestAnchors = [];
        let giftText = null;
        let giftAnchors = null;
        for (const line of priceEntries) {
            if (!line.text) continue;
            if (/^(Stacks up to|Used (?:to|in)\b|Previously called|Also see)/i.test(line.text)) continue;   // notes, never prices
            if (/^(Merge the following|OR$)/i.test(line.text)) continue;   // the recipe list rides inside some price sections
            if (/Dropped by/i.test(line.text)) { dropAnchors.push(...line.anchors); continue; }
            if (/gifting|Friendship/i.test(line.text)) {
                // the NPCs are linked right in the line - "Mi · Yulgar" says
                // it all; the trailing Friendships link is the mechanic, not
                // a giver
                giftAnchors = line.anchors.filter((a) => !/friendship/i.test(a.textContent));
                giftText = line.text.slice(0, 90);
                continue;
            }
            // Quests under the price: a heading li nests the real list, and
            // within each quest line only the FIRST link is the quest - the
            // second is a variant parenthetical ((Mini King Klunk) and kin)
            if (/Reward from .{0,80}quest/i.test(line.text)) {
                const sub = line.li && line.li.querySelector(":scope > ul");
                if (sub) {
                    for (const li2 of sub.children) {
                        const a2 = li2.querySelector("a[href^='/']");
                        if (a2) priceQuestAnchors.push(a2);
                    }
                } else if (line.anchors[0]) {
                    priceQuestAnchors.push(line.anchors[0]);
                }
                continue;
            }
            if (!priceVal) priceVal = line.text.split("(")[0].trim();
        }

        // ---- Quest: the dedicated list (plain or behind + Show) wins with
        // its full count; otherwise whatever the price section linked
        let questWay = null;
        const rw = strongs.find((el) => /Reward from the following quest/i.test(el.textContent));
        const questUl = (rw && listAfter(rw)) || collapsibleByLabel(/Reward from the following quest/i);
        if (questUl) {
            const anchors = [...questUl.children].map((li) => li.querySelector("a")).filter(Boolean);
            if (anchors.length) {
                questWay = { k: "Quest", ...linkArr(anchors, 2) };
                data.questHref = anchors[0].getAttribute("href");
                data.questName = anchors[0].textContent.trim();
            }
        }
        if (!questWay && priceQuestAnchors.length) {
            questWay = { k: "Quest", ...linkArr(priceQuestAnchors, 2) };
            data.questHref = priceQuestAnchors[0].getAttribute("href");
            data.questName = priceQuestAnchors[0].textContent.trim();
        }

        // ---- Merge: EVERY recipe (pages offer alternatives joined by OR),
        // each with the quantities its components demand - the qty travels
        // as its own field so the UI can render it quietly
        const mergeWays = [];
        const mergeLis = [...content.querySelectorAll("ul > li")].filter((li) => /^Merge the following\b/i.test(li.textContent.trim()));
        mergeLis.forEach((li, i) => {
            const list = li.querySelector("ul");
            if (!list) return;
            const parts = [...list.querySelectorAll(":scope > li")].map((li2) => {
                const a = li2.querySelector("a");
                const q = (li2.textContent.match(/x\s*([\d,]+)/i) || [])[1];
                if (a) return [a.textContent.trim(), a.getAttribute("href"), q ? "x" + q : ""];
                // a linkless component is still a cost - "750,000 Gold"
                // has no page, but the merge will not happen without it
                const t = li2.textContent.replace(/\s+/g, " ").trim();
                return t ? [t.slice(0, 40), null, ""] : null;
            }).filter(Boolean);
            if (parts.length) {
                // two Merge lines simply read as the alternatives they are
                mergeWays.push({ k: "Merge", links: parts.slice(0, 30), inline: 4, more: Math.max(0, parts.length - 30) });
            }
        });

        const giftFallback = (text.match(/Reward from ([A-Z][\w' -]{2,25}?) for increasing your Friendship/) || [])[1];

        // ---- Location: the field's OWN lines only (the price line that
        // shares the paragraph can never leak in), each line's LAST anchor
        // is the place; list form (collapsible-aware) when the line is bare
        let locWay = null;
        const locS = strongs.find((el) => /^Locations?:/.test(el.textContent.trim()));
        if (locS) {
            let entryAnchors = segLines(locS).filter((l) => l.anchors.length).map((l) => l.anchors);
            if (!entryAnchors.length) {
                const ul = listAfter(locS) || collapsibleByLabel(/locations?:/i);
                if (ul) {
                    // a li may carry a NESTED list ("Alina's Wedding (Shop)"
                    // holding the actual places) - each nested li is its own
                    // entry, and the parent's own line stands only when it
                    // has no children
                    entryAnchors = [];
                    for (const li of ul.children) {
                        const sub = li.querySelector(":scope > ul");
                        if (sub) {
                            for (const li2 of sub.children) {
                                const a2 = [...li2.querySelectorAll("a[href^='/']")];
                                if (a2.length) entryAnchors.push(a2);
                            }
                        } else {
                            const a1 = [...li.querySelectorAll("a[href^='/']")];
                            if (a1.length) entryAnchors.push(a1);
                        }
                    }
                }
            }
            const seen = new Set(), places = [];
            for (const anchors of entryAnchors) {
                const place = anchors[anchors.length - 1];
                if (place && !seen.has(place.getAttribute("href"))) {
                    seen.add(place.getAttribute("href"));
                    places.push(place);
                }
            }
            if (places.length) locWay = { k: "Location", ...linkArr(places, 3) };
        }

        // ---- Drop rate: only what the wiki itself states, verbatim percent
        const rateM = text.match(/(\d+(?:\.\d+)?\s*%)[^.\n]{0,40}\bdrop/i) || text.match(/\bdrop rate[^.\n]{0,30}?(\d+(?:\.\d+)?\s*%)/i);
        if (rateM) data.rate = rateM[1].replace(/\s+/g, "");

        // The fixed order: Price > Drop > Quest > Merge > Gift, Location last.
        // A real price always shows; N/A only when it is the whole story.
        const hasGift = (giftAnchors && giftAnchors.length) || giftText || giftFallback;
        const hasOther = dropAnchors.length || questWay || mergeWays.length || hasGift;
        if (priceVal && (/\d/.test(priceVal) || !hasOther)) ways.push({ k: "Price", text: priceVal.slice(0, 40) });
        if (dropAnchors.length) ways.push({ k: "Drop", ...linkArr(dropAnchors, 3) });
        if (questWay) ways.push(questWay);
        ways.push(...mergeWays);
        if (giftAnchors && giftAnchors.length) ways.push({ k: "Gift", ...linkArr(giftAnchors, 3) });
        else if (hasGift) ways.push({ k: "Gift", text: (giftFallback || giftText.replace(/^Reward from\s*/i, "")).slice(0, 80) });
        if (locWay) ways.push(locWay);
        return data;
    }

    /* Sources load ON SIGHT, not on page load. The old fixed budget (20
       fetches, front of the queue first) starved every deep material on
       mega quest pages - Artix alone lists 165, so anything past the first
       tabs never learned its sources. Now every row waits in an
       IntersectionObserver and fetches only when the user can actually see
       it (hidden tabs never fire; opening one does). Wikidot serves at
       most what gets read, cache hits paint just ahead of the eye, and
       the one-line fitter finally measures rows that are really visible. */
    async function startSourceQueue() {
        const store = (await AQWE.storage.get({ recipeSrc: {} })).recipeSrc;
        const now = Date.now();

        let saveTimer = 0;
        const saveSoon = () => {   // batch the store writes behind the fetches
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                const keys = Object.keys(store);
                if (keys.length > SRC_CAP) {
                    keys.sort((a, b) => store[a].at - store[b].at);
                    for (const k of keys.slice(0, keys.length - SRC_CAP)) delete store[k];
                }
                AQWE.storage.set({ recipeSrc: store });
            }, 2000);
        };

        const fetchText = async (href) => {
            const res = await fetch(location.origin + href, { credentials: "omit" });
            if (!res.ok && res.status !== 404) throw new Error("HTTP " + res.status);
            return res.text();
        };

        /* The quest's own page knows its cadence ("once per week"), but
           multi-quest pages hold MANY quests in tabs - only the note inside
           THIS quest's tab (matched by name; tab panes pair with nav labels
           in document order, even across wikidot's colliding tab ids) plus
           the page's intro above the tabs may speak for it. No match, no chip. */
        const addCadence = async (data, matName) => {
            try {
                const qdoc = new DOMParser().parseFromString(await fetchText(data.questHref), "text/html");
                const qc = qdoc.querySelector("#page-content") || qdoc.body;
                const navs = [...qc.querySelectorAll(".yui-nav a")];
                let scopeText = null;
                if (!navs.length) {
                    scopeText = qc.textContent;   // single-quest page
                } else if (data.questName) {
                    const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
                    const panes = [...qc.querySelectorAll("[id^='wiki-tab-']")].filter((el) => /^wiki-tab-\d+-\d+$/.test(el.id));
                    const i = navs.findIndex((a) => norm(a.textContent) === norm(data.questName));
                    if (i >= 0 && panes[i]) {
                        let pre = "";
                        for (const child of qc.children) {
                            if (child.classList && (child.classList.contains("yui-navset") || child.querySelector(".yui-navset"))) break;
                            pre += " " + child.textContent;
                        }
                        scopeText = pre + " " + panes[i].textContent;
                    }
                }
                if (scopeText) {
                    const qt = scopeText.replace(/\s+/g, " ");
                    if (/once (?:per|a) week/i.test(qt)) data.cadence = "weekly";
                    else if (/once (?:per|a) day/i.test(qt)) data.cadence = "daily";
                    // the tab's rewards say how many per completion
                    // ("Items: Dage the Evil Insignia x5") - that
                    // feeds the "N runs left for you" math
                    if (data.cadence && matName) {
                        const esc = matName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        const y = qt.match(new RegExp(esc + "\\s*x\\s*(\\d+)", "i"));
                        if (y) data.questYield = parseInt(y[1], 10);
                    }
                }
            } catch { /* the material still renders */ }
        };

        /* one parse per page, shared by every row that needs it: the cache
           answers first, then any fetch already in the air, then the network */
        const inflight = new Map();
        const parsed = (href, matName) => {
            const e = store[href];
            if (e && e.v === SRC_V && now - e.at < SRC_TTL) return Promise.resolve(e.data);
            if (inflight.has(href)) return inflight.get(href);
            const p = (async () => {
                const data = parseMaterial(await fetchText(href));
                if (data.questHref && !data.cadence) await addCadence(data, matName);
                delete data.questHref;
                delete data.questName;
                store[href] = { v: SRC_V, at: Date.now(), data };
                saveSoon();
                return data;
            })();
            inflight.set(href, p);
            return p;
        };

        // four lanes, same as ever - enough to paint a recipe in a couple
        // of round trips without leaning on wikidot
        const tasks = [];
        let active = 0;
        const pump = () => {
            while (active < 4 && tasks.length) {
                active++;
                // failures stay silent for the reader but count for us: a
                // srcFail spike in telemetry means the wiki's markup moved
                tasks.shift()().catch(() => { AQWE.count("srcFail"); }).then(() => { active--; pump(); });
            }
        };
        const run = (item) => {
            tasks.push(async () => {
                if (item.href) {
                    const matName = ((item.row.querySelector("a") || {}).textContent || "").trim();
                    renderSources(item, await parsed(item.href, matName));
                } else {
                    // temporary item: its ways came straight from the quest
                    // list; the monsters' own pages say where to farm them
                    const data = { ways: item.ways.slice(), cadence: null, rate: null };
                    const seen = new Set(), places = [];
                    for (const h of item.monsters || []) {
                        try {
                            const lw = ((await parsed(h)).ways || []).find((w) => w.k === "Location");
                            for (const l of (lw && lw.links) || []) {
                                if (!seen.has(l[1])) { seen.add(l[1]); places.push(l); }
                            }
                        } catch { /* the drop line stands on its own */ }
                    }
                    if (places.length) data.ways.push({ k: "Location", links: places.slice(0, 30), inline: 3, more: Math.max(0, places.length - 30) });
                    renderSources(item, data);
                }
            });
            pump();
        };

        const rowItems = new Map();   // row element -> its queued items
        const io = ("IntersectionObserver" in window)
            ? new IntersectionObserver((entries) => {
                for (const en of entries) {
                    if (!en.isIntersecting) continue;
                    io.unobserve(en.target);
                    for (const it of rowItems.get(en.target) || []) run(it);
                }
            }, { rootMargin: "300px" })   // start a touch early - lines land before the eye does
            : null;
        for (const item of sourceQueue) {
            if (!io) { run(item); continue; }
            if (!rowItems.has(item.row)) rowItems.set(item.row, []);
            rowItems.get(item.row).push(item);
            io.observe(item.row);
        }
    }

    if (sourceQueue.length) {
        if ("requestIdleCallback" in window) requestIdleCallback(() => startSourceQueue(), { timeout: 1500 });
        else setTimeout(startSourceQueue, 400);
    }

    /* ---------------- 6. Hover previews (shared engine, same-origin fetch) ---------------- */

    const ownedLookup = (title) => {
        const r = ownedFor(title);
        return r ? (r.qi > 0 ? "inv" : "bank") : null;
    };
    const hover = AQWEHover(state.hoverMode, async (url) => {
        const res = await fetch(url, { credentials: "omit" });
        // 404 still carries the "doesn't exist" body the year-retry needs
        if (!res.ok && res.status !== 404) throw new Error("HTTP " + res.status);
        return res.text();
    }, ownedLookup);
    hover.attach((a) => {
        if (!pageContent || !pageContent.contains(a)) return null;
        const href = a.getAttribute("href") || "";
        if (!href.startsWith("/") || href.includes(":")) return null;
        return location.origin + href;
    });

    /* ---------------- 7. Live settings ---------------- */

    AQWE.api.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes.theme) {
            html.dataset.aqweTheme = changes.theme.newValue;
            try { localStorage.setItem("aqwe-theme", changes.theme.newValue); } catch { }   // boot.js pre-paint mirror
            // leaving Evil uncovers the wiki's own banner - make sure it exists
            if (changes.theme.newValue === "good") healBanner();
        }
        if (changes.hoverMode) hover.setMode(changes.hoverMode.newValue);
        if (changes.goals) state.goals = changes.goals.newValue || [];
    });
})();
