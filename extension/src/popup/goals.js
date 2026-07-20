/* AQW Wiki Enhanced - Farm Goals page: reorder by drag, live progress bars. */
"use strict";

const WIKI = "http://aqwwiki.wikidot.com";
const list = document.getElementById("list");
let goals = [], inventoryMap = null;

init();

function setTheme(theme) {
    // data-theme drives this page's tokens; data-aqwe-theme drives hover.css
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.aqweTheme = theme;
    try { localStorage.setItem("aqwe-theme", theme); } catch {}   // pre-paint mirror
}

async function init() {
    const st = await AQWE.storage.get({ theme: "good", hoverMode: "clean", goals: [], inventory: null });
    setTheme(st.theme);
    goals = st.goals;
    inventoryMap = AQWE.ownedIndex(st.inventory && st.inventory.items);
    render();
    goals.forEach((g) => fillProgress(g.url));

    /* Hover previews on goal names - same engine as everywhere else */
    const hover = AQWEHover(st.hoverMode, async (url) => {
        const res = await AQWE.send({ type: "FETCH_WIKI_PAGE", url });
        if (!res || !res.ok) throw new Error(res && res.error || "fetch failed");
        return res.html;
    }, (title) => (inventoryMap.get(title) ? "inv" : null));
    hover.attach((a) => {
        const href = a.href || "";
        return href.includes("aqwwiki.wikidot.com/") ? { url: href } : null;
    });

    AQWE.api.storage.onChanged.addListener((ch, area) => {
        if (area !== "local") return;
        if (ch.theme) setTheme(ch.theme.newValue);
        if (ch.hoverMode) hover.setMode(ch.hoverMode.newValue);
    });
}

function render() {
    list.innerHTML = "";
    if (!goals.length) {
        list.innerHTML = '<p class="empty">No goals yet. Star any item on the wiki to add one.</p>';
        return;
    }
    goals.forEach((g, i) => {
        const card = document.createElement("div");
        card.className = "card";
        card.dataset.url = g.url;
        card.innerHTML =
            `<span class="handle" draggable="true" title="Drag to reorder">⋮⋮</span>` +
            `<span class="num">${i + 1}</span>` +
            `<span class="copy"><a href="${WIKI + g.url}" target="_blank"></a>` +
            `<span class="meter"><span class="bar"><span style="width:0%"></span></span><span class="pct"></span></span></span>` +
            `<button class="del" title="Remove goal">✕</button>`;
        card.querySelector("a").textContent = g.name;
        card.querySelector(".del").addEventListener("click", async () => {
            goals = goals.filter((x) => x.url !== g.url);
            await AQWE.storage.set({ goals });
            render();
            goals.forEach((x) => fillProgress(x.url, true));
        });
        wireDrag(card);
        list.appendChild(card);
    });
}

/* ---- drag to reorder (spring animation via CSS transitions) ---- */
let dragCard = null;
function wireDrag(card) {
    const handle = card.querySelector(".handle");
    handle.addEventListener("dragstart", (e) => {
        dragCard = card;
        card.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setDragImage(card, 20, 20);
    });
    handle.addEventListener("dragend", async () => {
        card.classList.remove("dragging");
        dragCard = null;
        // persist the new order + renumber
        const order = [...list.querySelectorAll(".card")].map((c) => c.dataset.url);
        goals.sort((a, b) => order.indexOf(a.url) - order.indexOf(b.url));
        await AQWE.storage.set({ goals });
        [...list.querySelectorAll(".num")].forEach((n, i) => (n.textContent = i + 1));
    });
    card.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!dragCard || dragCard === card) return;
        const r = card.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        list.insertBefore(dragCard, before ? card : card.nextSibling);
    });
}

/* ---- progress: best merge recipe on the goal's page vs your inventory ---- */
async function fillProgress(url, force) {
    const el = list.querySelector(`.card[data-url="${CSS.escape(url)}"]`);
    if (!el) return;
    const pct = await goalPct(url, force, true);
    if (pct == null) {
        el.querySelector(".pct").textContent = "N/A";
        el.querySelector(".meter").title = "No merge recipe on this page";
        return;
    }
    el.querySelector(".pct").textContent = pct + "%";
    requestAnimationFrame(() => requestAnimationFrame(() => {
        el.querySelector(".bar span").style.width = pct + "%";
    }));
}

async function goalPct(url, force, name) {
    if (name) {
        const g = goals.find((x) => x.url === url);
        if (g && inventoryMap.get(g.name)) return 100;
    }
    const st = await AQWE.storage.get({ goalProgress: {} });
    const c = st.goalProgress[url];
    if (!force && c && Date.now() - c.at < 6 * 3600e3) return c.pct;
    const res = await AQWE.send({ type: "FETCH_WIKI_PAGE", url: WIKI + url }).catch(() => null);
    if (!res || !res.ok) return c ? c.pct : null;
    const doc = new DOMParser().parseFromString(res.html, "text/html");
    const pct = bestRecipePct(doc, inventoryMap);
    st.goalProgress[url] = { pct, at: Date.now() };
    await AQWE.storage.set({ goalProgress: st.goalProgress });
    return pct;
}

function bestRecipePct(doc, ownedMap) {
    let best = null;
    for (const li of doc.querySelectorAll("#page-content ul > li")) {
        if (!/^Merge the following/i.test(li.textContent.trim())) continue;
        const ul = li.querySelector("ul");
        if (!ul) continue;
        let sum = 0, n = 0;
        for (const row of ul.children) {
            const a = row.querySelector("a");
            if (!a) continue;
            const need = parseInt(((row.textContent.match(/x\s*([\d,]+)/i) || [])[1] || "1").replace(/,/g, ""), 10);
            const rec = ownedMap.get(a.textContent);
            const have = rec ? rec.qi + rec.qb : 0;
            sum += Math.min(have / need, 1);
            n++;
        }
        if (n) best = Math.max(best ?? 0, Math.round((sum / n) * 100));
    }
    return best;
}
