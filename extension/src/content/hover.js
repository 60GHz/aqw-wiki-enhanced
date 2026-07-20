/* AQW Wiki Enhanced - shared hover preview engine (v4).
   Used on the wiki (direct fetch) and on account.aq.com CharPage (via background).

   Image rules:
   - Pair images ONLY when the page tabs are Male/Female (armors/classes).
   - New/Old and combat-animation tabs -> first (New/normal) tab only.
   - Class skill icons are never previews.
   - Sizing is per CATEGORY (from the fetched page's breadcrumbs), so a helm
     never looms over an armor and square capes match rectangular ones.

   Link resolution:
   - Seasonal year slugs ("...-10"): if the page is missing OR has no art,
     retry without the two trailing digits (four-digit years are left alone).
   - Disambiguation pages follow Non-AC > Legend > AC > 0 AC; a caller-supplied
     preference ("class" on CharPage class rows, "armor" otherwise) wins first. */
"use strict";

const AQWEHover = (mode0, fetchHtml, owned) => {
    let mode = mode0;
    const cache = new Map();
    let card = null, showTimer = null, token = 0;
    let mouse = { x: 0, y: 0 };
    document.addEventListener("mousemove", (e) => { mouse = { x: e.clientX, y: e.clientY }; });

    const BAD = ["/image-tags/", "acsmall", "aclarge", "raresmall", "legendsmall", "membersmall", "classes-skills", "skill"];
    const okImg = (src) => src && !BAD.some((w) => src.toLowerCase().includes(w));
    const notExist = (html) => html.includes("This page doesn't exist yet");

    const WEAPON_CATS = ["Axes", "Bows", "Daggers", "Gauntlets", "Guns", "HandGuns", "Maces", "Polearms", "Rifles", "Staffs", "Swords", "Wands", "Whips"];
    function categoryOf(doc) {
        const crumbs = [...doc.querySelectorAll("#breadcrumbs a")].map((a) => a.textContent.trim());
        const c = crumbs[2] || crumbs[1] || "";
        if (WEAPON_CATS.includes(c)) return "weapon";
        if (c === "Armors" || c === "Classes") return "armor";
        if (c.startsWith("Helmets")) return "helm";
        if (c.startsWith("Capes")) return "cape";
        if (c === "Houses" || c.startsWith("Wall") || c.startsWith("Floor")) return "house";
        return "other";
    }

    // Art always loads over https: pages fetched through the background come
    // back as wikidot's http flavor, and secure surfaces (account.aq.com,
    // the extension's own pages) would refuse or double-handle http images.
    const httpsImg = (src) => src.replace(/^http:\/\//i, "https://");
    function pickImages(doc) {
        const labels = [...doc.querySelectorAll(".yui-nav a em")].map((e) => e.textContent.trim().toLowerCase());
        const tab0 = doc.querySelector("#wiki-tab-0-0 img");
        const tab1 = doc.querySelector("#wiki-tab-0-1 img");
        const images = [];
        const malePair = labels.length >= 2 && /male/.test(labels[0]) && /male/.test(labels[1]);
        if (malePair) {
            if (tab0 && okImg(tab0.src)) images.push(httpsImg(tab0.src));
            if (tab1 && okImg(tab1.src)) images.push(httpsImg(tab1.src));
        } else if (tab0 && okImg(tab0.src)) {
            images.push(httpsImg(tab0.src));
        }
        if (!images.length) {
            const any = [...doc.querySelectorAll("#page-content img")].find((i) => okImg(i.src));
            if (any) images.push(httpsImg(any.src));
        }
        return images;
    }

    async function fetchDoc(url, depth, prefer) {
        let html = await fetchHtml(url);

        // Missing seasonal slugs retry without their year: trailing two
        // digits ("frostmoglin-on-your-back-10"), trailing four
        // ("maximillian-arctic-armor-2011"), or a LEADING year
        // ("2017-new-year-s-ball" -> new-year-s-ball). "Unidentified NN"
        // is a canonical name, never a year. "+10"-style enhancement pages
        // exist, so the retry only ever fires when the page is missing.
        const yearRetries = [];
        if (/-\d{2}$/.test(url) && !/-\d{3,}$/.test(url) && !/unidentified/i.test(url)) {
            yearRetries.push(url.replace(/-\d{2}$/, ""));
        }
        if (/-(19|20)\d{2}$/.test(url)) yearRetries.push(url.replace(/-\d{4}$/, ""));
        const lead = url.match(/^(https?:\/\/[^/]+\/)(19|20)\d{2}-(.+)$/);
        if (lead) yearRetries.push(lead[1] + lead[3]);
        for (const alt of yearRetries) {
            if (!notExist(html)) break;
            const retry = await fetchHtml(alt);
            if (!notExist(retry)) html = retry;
        }
        if (notExist(html)) return null;

        let doc = new DOMParser().parseFromString(html, "text/html");

        // Page exists but is an artless stub (some seasonal stubs) -> try
        // the year-stripped candidates for art too.
        if (yearRetries.length && !pickImages(doc).length) {
            for (const alt of yearRetries) {
                const retry = await fetchHtml(alt);
                if (notExist(retry)) continue;
                const doc2 = new DOMParser().parseFromString(retry, "text/html");
                if (pickImages(doc2).length) { doc = doc2; break; }
            }
        }

        // Disambiguation: follow the best variant (images are shared across them).
        const bodyText = doc.querySelector("#page-content")?.textContent || "";
        if (depth < 2 && /usually refers to/i.test(bodyText)) {
            // Any caller preference becomes its "(type)" token - (sword) under a
            // Sword section, (cape) under Cape... Pets and houses need synonyms.
            const PREFER_SPECIAL = {
                pet: ["(pet)", "(battle"],
                house: ["(house", "(floor", "(wall"],
            };
            const preferTokens = PREFER_SPECIAL[prefer] || (prefer ? ["(" + prefer + ")"] : ["(armor)"]);
            // The disambiguation hierarchy: Free Player > Non-Legend >
            // Merge > Quest > Non-AC > Legend > AC > 0 AC > Special >
            // Permanent > Temporary > Infinity. The free tiers lead, then
            // Legend (Non-AC can mean Legend), then the AC prices, then
            // 0 AC (born from a 10k AC chest), then the niches. Mirrored
            // in tools/scrape.py SUFFIX_PRIORITY - change both, then
            // rerun `py tools/scrape.py build`.
            const priority = [
                ...preferTokens,
                "(free player)", "(non-legend)", "(merge)", "(quest)",
                "(non-ac)", "(legend)", "(ac)", "(0 ac)", "(special",
                "(permanent)", "(temporary)", "(infinity)",
            ];
            const links = [...doc.querySelectorAll("#page-content a[href^='/']")];
            let pick = null;
            for (const t of priority) {
                pick = links.find((a) => a.textContent.toLowerCase().includes(t));
                if (pick) break;
            }
            pick = pick || links[0];
            if (pick) {
                const base = url.match(/^https?:\/\/[^/]+/)[0];
                return fetchDoc(base + pick.getAttribute("href"), depth + 1, prefer);
            }
        }
        return doc;
    }

    async function getData(url, prefer) {
        const key = (prefer || "") + "|" + url;
        if (cache.has(key)) return cache.get(key);
        const doc = await fetchDoc(url, 0, prefer);
        if (!doc) { cache.set(key, null); return null; }

        const images = pickImages(doc);
        const text = doc.querySelector("#page-content")?.textContent || "";
        const grab = (re) => (text.match(re) || [])[1]?.trim().slice(0, 110) || "";
        // Warm the art while the pointer is still settling: the download
        // overlaps the show timer instead of starting after it - this is
        // most of the "sometimes it takes a second".
        for (const src of images) { const im = new Image(); im.src = src; }
        const data = !images.length ? null : {
            images,
            category: categoryOf(doc),
            title: doc.querySelector("#page-title")?.textContent.trim() || "",
            fields: {
                rarity: grab(/Rarity:\s*([^\n]+)/),
                location: grab(/Locations?:\s*([^\n]+)/),
                price: grab(/Price:\s*([^\n]+)/),
                sellback: grab(/Sellback:\s*([^\n]+)/),
                desc: grab(/Description:\s*([^\n]+)/),
            },
        };
        cache.set(key, data);
        return data;
    }

    function remove() { card?.remove(); card = null; }

    function place() {
        if (!card) return;
        const pad = 18, W = card.offsetWidth, H = card.offsetHeight;
        let x = mouse.x + pad;
        if (x + W > innerWidth - 8) x = mouse.x - W - pad;
        let y = mouse.y - H / 3;
        y = Math.max(8, Math.min(y, innerHeight - H - 8));
        card.style.left = Math.max(8, x) + "px";
        card.style.top = y + "px";
    }

    function show(data) {
        remove();
        if (typeof AQWE !== "undefined" && AQWE.count) AQWE.count("hoverShow");
        card = document.createElement("div");
        card.className = "aqwe-hover ctg-" + data.category + (data.images.length > 1 ? " pair" : "");
        const imgs = data.images.map((src) => {
            const img = document.createElement("img");
            img.src = src;
            card.appendChild(img);
            return img;
        });
        if (mode === "detailed") {
            const f = data.fields, cap = document.createElement("div");
            cap.className = "aqwe-hover-cap";
            const own = owned ? owned(data.title) : null;
            const nameCls = own === "inv" ? " aqwe-name-inv" : own === "bank" ? " aqwe-name-bank" : "";
            const row = (k, v) => v ? `<div><span class="aqwe-f">${k}</span>${v}</div>` : "";
            cap.innerHTML = `<div class="aqwe-hover-name${nameCls}">${data.title}</div>` +
                row("Rarity", f.rarity) + row("Location", f.location) +
                row("Price", f.price + (f.sellback ? ` · Sellback: ${f.sellback}` : "")) +
                (f.desc ? `<div class="aqwe-hover-desc">${f.desc}</div>` : "");
            card.appendChild(cap);
        }
        card.style.visibility = "hidden";
        document.body.appendChild(card);
        Promise.all(imgs.map((i) => i.decode().catch(() => {}))).then(() => {
            if (!card) return;
            // One sizing system for every single-image card, calibrated
            // against a hand-graded set of real wiki art:
            // - portraits (r <= 0.85) keep their category heights;
            // - squares sit at their category's square size;
            // - wide art ramps SMOOTHLY from that size to 620px, reaching
            //   full width at r = 1.9. No more ratio cliff where a 2.4
            //   sword ballooned to 735 while a 1.9 gauntlet stayed clipped
            //   at the container's old 560 cap.
            // Upscaling caps at 2.2x so small sources never turn to mush.
            if (imgs.length === 1) {
                const img = imgs[0];
                const w = img.naturalWidth, h = img.naturalHeight;
                if (w && h) {
                    const r = w / h;
                    const SQUARE_W = { helm: 320, cape: 400, armor: 340, weapon: 400, house: 340, other: 320 };
                    const PORTRAIT_H = { helm: 320, cape: 410, armor: 430, weapon: 360, house: 380, other: 360 };
                    const WIDE_MAX = { helm: 440, cape: 620, armor: 560, weapon: 620, house: 620, other: 620 };
                    const base = SQUARE_W[data.category] || 320;
                    let cssW;
                    if (r <= 0.85) {
                        cssW = Math.round((PORTRAIT_H[data.category] || 360) * r);
                    } else if (r <= 1.15) {
                        cssW = base;
                    } else {
                        const peak = WIDE_MAX[data.category] || 620;
                        cssW = Math.round(base + (peak - base) * Math.min(1, (r - 1.15) / 0.75));
                        // Super-horizontal art tapers back from the peak: full
                        // width up to r = 2, then sliding down so a 2.4 sword
                        // sits near 585 and a 3:1 staff near 530 - bigger than
                        // the old clipped days, calmer than a full 620 band.
                        if (r > 2) cssW = Math.max(530, cssW - Math.round((r - 2) * 90));
                        // The eye reads AREA, not width: mid-wide art at the
                        // full ramp looks huge next to a "just right" sword.
                        // Weapons/capes cap at that sword card's area; grounds,
                        // pets and misc (the "other" bucket) at a touch less.
                        // Houses keep their full 620 - graded exactly
                        // right as they are.
                        if (data.category === "weapon" || data.category === "cape") {
                            cssW = Math.min(cssW, Math.round(Math.sqrt(160000 * r)));
                        } else if (data.category === "other") {
                            cssW = Math.min(cssW, Math.round(Math.sqrt(140000 * r)));
                        }
                    }
                    cssW = Math.min(cssW, Math.round(w * 2.2));   // blur guard
                    img.style.width = cssW + "px";
                    img.style.maxWidth = "none";
                    img.style.maxHeight = "none";
                }
            }
            place();
            card.style.visibility = "visible";
        });
    }

    /* One hover ZONE at a time. The zone is whatever element the resolver
       anchors the preview to - a wiki link, or a whole spreadsheet cell.
       Moving between children of the same zone (the IoDA cells wrap their
       names in selection links, leaving hoverable strips above and below)
       neither restarts nor tears down the card: no more show-hide flicker
       while the pointer crosses a row. */
    let currentAnchor = null;

    function endHover() {
        token++;
        clearTimeout(showTimer);
        remove();
        currentAnchor = null;
    }

    document.addEventListener("mouseout", (e) => {
        if (!currentAnchor) return;
        if (!currentAnchor.contains(e.target)) return;                       // not our zone
        if (e.relatedTarget && currentAnchor.contains(e.relatedTarget)) return;   // still inside it
        endHover();
    });

    function beginHover(anchorEl, target) {
        if (anchorEl === currentAnchor) return;   // same zone - the card is up or on its way
        currentAnchor = anchorEl;
        const my = ++token;
        const dataP = getData(target.url, target.prefer).catch(() => null);
        clearTimeout(showTimer);
        showTimer = setTimeout(async () => {
            const data = await dataP;
            if (data && my === token && anchorEl.matches(":hover")) show(data);
        }, 60);
    }

    return {
        setMode(m) { mode = m; },
        /* Plain-text targets (inventory spreadsheet cells and the like). */
        attachCells(resolver) {
            document.addEventListener("mouseover", (e) => {
                if (mode === "off") return;
                if (e.target.closest("a")) return;      // links are handled by attach()
                const target = resolver(e.target);
                if (target) beginHover(target.anchor || e.target, target);
            });
        },
        attach(linkFilter) {
            document.addEventListener("mouseover", (e) => {
                if (mode === "off") return;
                const a = e.target.closest("a");
                let target = a && linkFilter(a);
                if (!target) return;
                if (typeof target === "string") target = { url: target };
                beginHover(target.anchor || a, target);
            });
        },
    };
};
