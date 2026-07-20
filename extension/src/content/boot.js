/* AQW Wiki Enhanced - runs at document_start so the theme lands before first
   paint. Kills the light-mode flash on reload; the banner swap is pure CSS
   keyed off the same attribute, so it arrives just as early. */
"use strict";

const aqweApi = globalThis.browser ?? globalThis.chrome;
/* The theme, synchronously. chrome.storage is async and Firefox can paint
   before the promise lands - a white flash in Evil. The page's own
   localStorage mirrors the theme (wiki.js keeps it fresh), so the attribute
   goes on BEFORE the parser reaches the body; the storage read then
   confirms and corrects the mirror. Same trick as pages-boot.js. */
try {
    const aqweMirror = localStorage.getItem("aqwe-theme");
    if (aqweMirror === "evil" || aqweMirror === "good") {
        document.documentElement.dataset.aqweTheme = aqweMirror;
        document.documentElement.classList.add("aqwe");
    }
} catch { /* storage-less contexts just wait for the async read */ }
aqweApi.storage.local.get({ theme: "good" }).then((st) => {
    document.documentElement.dataset.aqweTheme = st.theme;
    document.documentElement.classList.add("aqwe");
    try { localStorage.setItem("aqwe-theme", st.theme); } catch { }
}).catch(() => {});   // orphaned after an extension reload - nothing to do
const aqweBanner = document.createElement("style");
aqweBanner.textContent =
    `html[data-aqwe-theme="evil"] #container-wrap { background-image: url("${aqweApi.runtime.getURL("assets/banner-evil.png")}") !important; }` +
    /* first-paint guard: the full Evil skin lives in wiki.css, but Firefox
       can paint a frame before extension css applies - these few surface
       rules keep that frame dark instead of white (values mirror wiki.css) */
    'html[data-aqwe-theme="evil"] body,' +
    'html[data-aqwe-theme="evil"] #container-wrap-wrap,' +
    'html[data-aqwe-theme="evil"] #content-wrap,' +
    'html[data-aqwe-theme="evil"] #main-content { background-color: #1B1C21; color: #E9E5DC; }';
document.documentElement.appendChild(aqweBanner);

/* The wiki's skin, guaranteed. Wikidot's own theme CSS dies often enough
   (its http @imports are mixed content on the https variants Firefox's
   HTTPS-First lands on, plus assorted CDN moods) that the extension ships
   a bundled copy and lays it down FIRST on every page, before the parser
   reaches the page's own <style>. Order is the trick: when Wikidot's
   sheets do load they sit later in the document and win every tie, so
   nothing is ever pinned to our snapshot - but when they die, the page
   still wears its own face from the very first paint. The css arrives as
   a JS string (src/data/wikidot-theme.js, loaded just before this script)
   because a fetch, however fast, is a race against first paint - and
   Firefox was losing it. Synchronous injection cannot flash. */
if (typeof AQWE_WIKIDOT_CSS === "string") {
    const aqweSkin = document.createElement("style");
    aqweSkin.id = "aqwe-skin-base";
    aqweSkin.textContent = AQWE_WIKIDOT_CSS;
    // before <head> exists this lands ahead of everything the parser will
    // add - the earliest possible spot in the cascade
    document.documentElement.insertBefore(aqweSkin, document.documentElement.firstChild);
}

/* The mixed-content guard. Wikidot @imports its theme CSS over plain http
   even when the page itself is served over https (Firefox's HTTPS-First
   lands people there; Wikidot's edge cache sometimes answers https with a
   200 instead of its usual 301 down to http). Browsers block those http
   imports as mixed content and the page renders as bare HTML.

   The fix mirrors every http:// stylesheet the page declares over https the
   moment the parser adds it - both CSS hosts serve https happily. Dynamic
   on purpose: the cloudfront version token in those URLs rotates, so a
   hardcoded list would rot. Runs from document_start so the skin is back
   before first paint; wiki.js keeps a late self-heal for anything missed. */
if (location.protocol === "https:") {
    const aqweMirrored = new Set();
    /* An absolute http import gets its https twin (both CSS hosts serve
       https). A RELATIVE import - the per-page modules like
       /local--code_/css:shops-table that give shop tables their real
       layout - can't be scheme-swapped: same-origin https 301s down to
       http and dies as mixed content. Those load from the wdfiles mirror,
       which serves every module as true text/css over https. */
    const aqweTwin = (href) => {
        if (/^http:\/\//i.test(href)) return href.replace(/^http:/i, "https:");
        if (href.startsWith("/") && !href.startsWith("//")) return "https://aqwwiki.wdfiles.com" + href;
        return null;
    };
    const aqweAdd = (href) => {
        const url = aqweTwin(href);
        if (!url || aqweMirrored.has(url)) return;
        aqweMirrored.add(url);
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = url;
        (document.head || document.documentElement).appendChild(link);
    };
    const aqweScanEl = (el) => {
        if (el.tagName === "STYLE") {
            for (const m of (el.textContent || "").matchAll(/@import\s+url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi)) {
                aqweAdd(m[1]);
            }
        } else if (el.tagName === "LINK" && /\bstylesheet\b/i.test(el.rel || "") &&
                   (el.getAttribute("href") || "").toLowerCase().startsWith("http://")) {
            aqweAdd(el.getAttribute("href"));
        }
    };
    const aqweSweep = (root) => {
        if (root.tagName === "STYLE" || root.tagName === "LINK") aqweScanEl(root);
        if (root.querySelectorAll) for (const el of root.querySelectorAll("style, link")) aqweScanEl(el);
    };
    const aqweMo = new MutationObserver((muts) => {
        for (const mu of muts) {
            // a <style>'s text can stream in after the element itself appears
            if (mu.type === "characterData") {
                const p = mu.target.parentElement;
                if (p && p.tagName === "STYLE") aqweScanEl(p);
                continue;
            }
            for (const n of mu.addedNodes) {
                if (n.nodeType === 3) {
                    const p = n.parentElement;
                    if (p && p.tagName === "STYLE") aqweScanEl(p);
                } else if (n.nodeType === 1) {
                    aqweSweep(n);
                }
            }
        }
    });
    aqweMo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    addEventListener("DOMContentLoaded", () => { aqweSweep(document.documentElement); aqweMo.disconnect(); }, { once: true });
}
