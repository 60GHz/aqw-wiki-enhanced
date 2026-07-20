#!/usr/bin/env python3
"""AQW Wiki Enhanced - dataset builder.

Three phases, all resumable, all polite (~4 requests/second aggregate,
exponential backoff on 429/5xx, honest User-Agent):

  py tools/scrape.py pages    -> tools/data-work/pages.jsonl
      Every page in the wiki's default namespace (title + slug), from
      system:list-all-pages (999 pages x 100 links, ~5 minutes).

  py tools/scrape.py rarity   -> tools/data-work/rarity.jsonl
      Visits every page from pages.jsonl and records its breadcrumbs and
      the "Rarity:" free text. Known item slugs (the shipped index) go
      first so the Armory's data lands early. ~7 hours for the full wiki;
      safe to stop and restart anytime - finished slugs are skipped.

  py tools/scrape.py build    -> extension/src/data/items-index.js
                                 extension/src/data/rarities.js
      items-index.js needs pages.jsonl; rarities.js uses whatever
      rarity.jsonl has so far (run build again as the crawl progresses).
"""
import json
import os
import random
import re
import sys
import threading
import time
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORK = os.path.join(ROOT, "tools", "data-work")
PAGES = os.path.join(WORK, "pages.jsonl")
RARITY = os.path.join(WORK, "rarity.jsonl")
INDEX_JS = os.path.join(ROOT, "extension", "src", "data", "items-index.js")
RARITIES_JS = os.path.join(ROOT, "extension", "src", "data", "rarities.js")

BASE = "http://aqwwiki.wikidot.com"
UA = "AQWWikiEnhanced-dataset/0.1 (open-source browser extension; by Chaos Eye)"
WORKERS = 3
DELAY = (1.3, 1.9)          # per-worker sleep between requests -> ~2 req/s total
                            # (gentle on wikidot AND on the user's own browsing -
                            # 4/s made live hover previews feel sluggish)
BACKOFFS = [5, 15, 45, 120]

write_lock = threading.Lock()
print_lock = threading.Lock()


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for i, backoff in enumerate([0] + BACKOFFS):
        if backoff:
            time.sleep(backoff)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code not in (429, 500, 502, 503, 504) or i == len(BACKOFFS):
                raise
        except Exception:
            if i == len(BACKOFFS):
                raise
    return None


def list_links(html):
    i = html.find("list-pages-box")
    if i < 0:
        return []
    seg = html[i:]
    j = seg.find('class="pager"')
    core = seg[:j] if j > 0 else seg
    return re.findall(r'<a href="/([^"#]+)">([^<]+)</a>', core)


# ---------------------------------------------------------------- pages
def phase_pages():
    os.makedirs(WORK, exist_ok=True)
    seen = set()
    results = {}

    def one(p):
        html = fetch(f"{BASE}/system:list-all-pages/p/{p}")
        links = list_links(html) if html else []
        results[p] = links
        time.sleep(random.uniform(*DELAY))
        if p % 50 == 0:
            with print_lock:
                print(f"  page {p} ({sum(len(v) for v in results.values())} links so far)", flush=True)
        return len(links)

    # find the true last page first
    first = fetch(f"{BASE}/system:list-all-pages")
    nums = [int(n) for n in re.findall(r"/system:list-all-pages/p/(\d+)", first)]
    last = max(nums) if nums else 1
    print(f"pages phase: {last} listing pages", flush=True)
    with ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(one, range(1, last + 1)))

    with open(PAGES, "w", encoding="utf-8") as f:
        for p in sorted(results):
            for slug, title in results[p]:
                if slug in seen:
                    continue
                seen.add(slug)
                f.write(json.dumps({"s": slug, "t": html_unescape(title)}, ensure_ascii=False) + "\n")
    print(f"pages phase done: {len(seen)} unique pages -> {PAGES}", flush=True)


# ---------------------------------------------------------------- rarity
def crumbs_of(html):
    m = re.search(r'<div id="breadcrumbs">(.*?)</div>', html, re.S)
    if not m:
        return []
    return [html_unescape(t) for t in re.findall(r"<a[^>]*>([^<]+)</a>", m.group(1))]


def rarity_of(html):
    # the group must START with visible text - otherwise the lone space
    # before a <span> "matches" and swallows the strikethrough fallback
    m = re.search(r"Rarity:\s*</strong>\s*([^<\s][^<\n]*)", html)
    if not m:
        # some editors close the strong before the colon: <strong>Rarity</strong>: X
        m = re.search(r"Rarity\s*</strong>\s*:\s*([^<\s][^<\n]*)", html)
    if not m:
        m = re.search(r"<strong>\s*Rarity:\s*([^<\s][^<\n]*)</strong>", html)
    if m and m.group(1).strip():
        return html_unescape(m.group(1)).strip()
    # Retired tiers get struck through and the live one written beside them:
    # "Rarity: <span style=..line-through..>Artifact</span> Legendary Item".
    # Drop the struck spans, keep whatever text remains.
    m = re.search(r"Rarity:\s*</strong>(.{0,300}?)(?:<br|</p|<strong|\n)", html, re.S)
    if not m:
        return ""
    seg = m.group(1)
    seg = re.sub(r"<(?:strike|s|del)[^>]*>.*?</(?:strike|s|del)>", " ", seg, flags=re.S)
    seg = re.sub(r"<span[^>]*line-through[^>]*>.*?</span>", " ", seg, flags=re.S)
    seg = re.sub(r"<[^>]+>", " ", seg)
    return html_unescape(re.sub(r"\s+", " ", seg)).strip()


def title_of(html):
    m = re.search(r'<div id="page-title">\s*(.*?)\s*</div>', html, re.S)
    return html_unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip() if m else ""


def phase_rarity():
    if not os.path.exists(PAGES):
        sys.exit("run the pages phase first")
    done = set()
    if os.path.exists(RARITY):
        with open(RARITY, encoding="utf-8") as f:
            for line in f:
                try:
                    done.add(json.loads(line)["s"])
                except Exception:
                    pass
    all_slugs = []
    with open(PAGES, encoding="utf-8") as f:
        for line in f:
            s = json.loads(line)["s"]
            if ":" not in s and s not in done:
                all_slugs.append(s)

    # the shipped item index goes first - the Armory needs those rarities
    priority = set()
    if os.path.exists(INDEX_JS):
        with open(INDEX_JS, encoding="utf-8") as f:
            priority = set(re.findall(r'","([a-z0-9-]+)"\]', f.read()))
    all_slugs.sort(key=lambda s: (s not in priority, s))
    print(f"rarity phase: {len(all_slugs)} pages to visit ({len(done)} already done)", flush=True)

    out = open(RARITY, "a", encoding="utf-8")
    counter = {"n": 0}

    def one(slug):
        try:
            html = fetch(f"{BASE}/{slug}")
        except Exception as e:
            html = None
            with print_lock:
                print(f"  ! {slug}: {e}", flush=True)
        rec = {"s": slug}
        if html:
            rec["t"] = title_of(html)
            rec["c"] = "|".join(crumbs_of(html))
            r = rarity_of(html)
            if r:
                rec["r"] = r
        else:
            rec["missing"] = 1
        with write_lock:
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            counter["n"] += 1
            if counter["n"] % 200 == 0:
                out.flush()
                with print_lock:
                    print(f"  {counter['n']}/{len(all_slugs)} visited", flush=True)
        time.sleep(random.uniform(*DELAY))

    try:
        with ThreadPoolExecutor(WORKERS) as ex:
            list(ex.map(one, all_slugs))
    finally:
        out.close()
    print("rarity phase done", flush=True)


# ---------------------------------------------------------------- build
def normalize_keep(name):
    """normalize_name WITHOUT the type-suffix strip - for items whose real
    in-game name carries the parenthetical (Shadow Orb (Rare))."""
    s = unicodedata.normalize("NFKC", name or "")
    s = re.sub(r"[\u2018\u2019\u02bc`\u00b4]", "'", s)
    s = re.sub(r"[\u2013\u2014\u2212]", "-", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def normalize_name(name):
    """Mirror of AQWE.normalizeName in extension/src/common.js - keep in sync."""
    s = unicodedata.normalize("NFKC", name or "")
    s = re.sub(r"[‘’ʼ`´]", "'", s)
    s = re.sub(r"[–—−]", "-", s)
    s = re.sub(
        r"\s*\((Class|Armor|Helm|Cape|Weapon|Pet|Battle Pet|Misc|Necklace|Ground|Sword|Dagger|Axe|Mace|Polearm|Staff|Wand|Bow|Gun|HandGun|Rifle|Whip|Gauntlet|House|House Item|Floor Item|Wall Item|Quest Item|Item|Resource|Note|Boost|0 AC|AC|Non-AC|Legend|Non-Legend|Member|Merge|Rare|Special Offer|Special|Permanent|Temporary|Free Player|Quest|Infinity|VIP|Monster|Skill|Enhancement)\)\s*$",
        "", s, flags=re.I)
    # wiki names stack suffixes ("BladeMaster (Class) (0 AC)") - peel until
    # none remain, mirroring the JS loop
    prev = None
    while prev != s:
        prev = s
        s = re.sub(
            r"\s*\((Class|Armor|Helm|Cape|Weapon|Pet|Battle Pet|Misc|Necklace|Ground|Sword|Dagger|Axe|Mace|Polearm|Staff|Wand|Bow|Gun|HandGun|Rifle|Whip|Gauntlet|House|House Item|Floor Item|Wall Item|Quest Item|Item|Resource|Note|Boost|0 AC|AC|Non-AC|Legend|Non-Legend|Member|Merge|Rare|Special Offer|Special|Permanent|Temporary|Free Player|Quest|Infinity|VIP|Monster|Skill|Enhancement)\)\s*$",
            "", s, flags=re.I)
    return re.sub(r"\s+", " ", s).strip().lower()


def html_unescape(s):
    import html as h
    return h.unescape(s)


# The wiki's Rarity field is hand-typed and it shows: suffixes ("Awesome
# Rarity", with typos and stray periods), spelling drift ("Awsome", "Seaonal
# Item"), and 15 pages that just say "Rarity" (= the editor forgot; treated
# as unknown). Canonical spellings win; unrecognized values pass verbatim.
RARITY_SUFFIX_WORDS = {"rarity", "rariry", "raity", "rariy", "rarity."}
RARITY_CANON = [
    "Awesome", "Weird", "Common", "Crazy", "Junk", "Dumb", "Unknown", "Rare",
    "Ultra Rare", "Super Mega Ultra Rare", "Super Ultra Rare", "Limited Rare",
    "Event Rare", "Seasonal Rare", "Pseudo-Rare", "Seasonal", "Seasonal Item",
    "Legendary", "Legendary Item", "Epic", "Champion", "Artifact", "Expensive",
    "Impossible", "1% Drop", "5% Drop", "Boss Drop", "Secret", "Hidden Secret",
    "Event", "Event Item", "Collector", "Collector's Rare", "Promotional Item",
    "Upgrade Pack", "Kickstarter Backer", "Achievement Tracker",
    "Verification Shop", "Limited Quantity", "Frostval Gifting", "Benevolent",
    "Founder", "Custom Item", "Infinity", "Limited Time",
]
RARITY_TYPOS = {
    "awsome": "Awesome", "awessome": "Awesome", "collecter": "Collector",
    "seaonal item": "Seasonal Item", "season item": "Seasonal Item",
    "super ultra": "Super Ultra Rare", "super ultra mega rare": "Super Mega Ultra Rare",
    # one-off editor mistakes, confirmed by hand against the items that
    # carry them (docs/RARITIES.md lists each one below its table)
    "rary": "Rare", "rarity": "Rare", "promo": "Promotional Item",
    "new collection chest": "Rare", "limited time drop": "Limited Time",
}
_canon_by_fold = {c.casefold(): c for c in RARITY_CANON}


# The game shows one name per tier; the wiki drifted into alternates.
# The rule: display the GAME name everywhere.
GAME_NAMES = {
    "Super Mega Ultra Rare": "Super Ultra Rare",
    "Collector's Rare": "Collector",
    "Legendary Item": "Legendary",
    "Seasonal Item": "Seasonal",
    "Event Item": "Event",
}


def clean_rarity(r):
    r = r.strip().rstrip(".")
    words = r.split()
    if words and words[-1].casefold() in RARITY_SUFFIX_WORDS:
        words = words[:-1]
    r = " ".join(words).strip()
    if not r:
        return ""
    fold = r.casefold()
    r = _canon_by_fold.get(fold) or RARITY_TYPOS.get(fold) or r
    return GAME_NAMES.get(r, r)


def phase_build():
    if os.path.exists(PAGES):
        entries = []
        with open(PAGES, encoding="utf-8") as f:
            for line in f:
                rec = json.loads(line)
                if ":" in rec["s"] or rec["s"].startswith("_"):
                    continue
                entries.append((rec["t"], rec["s"]))
        entries.sort(key=lambda e: e[0].casefold())
        body = ",".join(json.dumps([t, s], ensure_ascii=False) for t, s in entries)
        with open(INDEX_JS, "w", encoding="utf-8") as f:
            f.write(f"/* AQW Wiki Enhanced - full page index ({len(entries)} pages: items, NPCs,\n"
                    f"   monsters, quests, shops, locations), scraped {time.strftime('%Y-%m-%d')}\n"
                    f"   by tools/scrape.py from system:list-all-pages */\n"
                    '"use strict";\n'
                    f"const AQWE_ITEMS = [{body}];\n")
        print(f"built {INDEX_JS}: {len(entries)} entries", flush=True)

        # Which base names have a (Legend)-suffixed page. The ownership
        # index gates (AC)/(0 AC) links by the Member flag ONLY for these
        # names: where a Legend page exists, the Legend-tagged copy lights
        # it and the price pages stay dark; a price pair alone (DoomKnight
        # (AC)/(0 AC)) says nothing about the lock, so everything lights.
        legend_js = os.path.join(ROOT, "extension", "src", "data", "legend-pages.js")
        legend_bases = sorted({
            re.sub(r"\s*\+\s*", "+", normalize_name(t))
            for t, s in entries
            if re.search(r"\(Legend\)", t, re.I)
        })
        with open(legend_js, "w", encoding="utf-8", newline="\n") as f:
            f.write(f"/* AQW Wiki Enhanced - names that have a (Legend)-suffixed wiki page\n"
                    f"   ({len(legend_bases)} names), generated by tools/scrape.py from the\n"
                    f"   page index. AQWE.ownedIndex gates (AC)/(0 AC) ownership by the\n"
                    f"   Member flag only for these - see common.js. */\n"
                    '"use strict";\n'
                    f'const AQWE_LEGEND_PAGES = {json.dumps("|".join(legend_bases), ensure_ascii=False)};\n')
        print(f"built {legend_js}: {len(legend_bases)} legend-paired names", flush=True)

        # What arrived since the previous build - a reviewable list, so a
        # monthly refresh can be spot-checked page by page before release.
        known_path = os.path.join(WORK, "known-names.txt")
        prev = set()
        if os.path.exists(known_path):
            with open(known_path, encoding="utf-8") as f:
                prev = {line.rstrip("\n") for line in f}
        names = [t for t, s in entries]
        fresh = [n for n in names if n not in prev]
        if prev and fresh:
            report = os.path.join(WORK, "new-since-last-build.txt")
            with open(report, "w", encoding="utf-8") as f:
                f.write("\n".join(fresh) + "\n")
            print(f"{len(fresh)} pages new since the last build -> {report}", flush=True)
        elif prev:
            print("no new pages since the last build", flush=True)
        with open(known_path, "w", encoding="utf-8") as f:
            f.write("\n".join(names) + "\n")

    if os.path.exists(RARITY):
        # Name collisions are resolved with the SAME hierarchy the hover
        # preview uses on disambiguation pages: an exact page first, then
        # SUFFIX_PRIORITY below (the canon lives there and in hover.js -
        # never restate the order in prose, it drifts), then anything else
        # (numbered variants like "(1)" tie-break alphabetically, so the
        # first one wins - matching what the preview shows). Titles with
        # any parenthetical also alias their base name, which is how
        # "Unidentified 27 (Chameleon Cape)" answers for "Unidentified 27"
        # and "Ancient Turret (House Item)" for "Ancient Turret".
        SUFFIX_PRIORITY = ["free player", "non-legend", "merge", "quest",
                           "non-ac", "legend", "ac", "0 ac",
                           "special offer", "special",
                           "permanent", "temporary", "infinity"]

        def suffix_rank(sfx):
            f = sfx.strip().lower()
            for i, pfx in enumerate(SUFFIX_PRIORITY):
                if f.startswith(pfx):
                    return i
            return len(SUFFIX_PRIORITY)

        paren_re = re.compile(r"^(.*?)\s*\(([^()]*)\)\s*$")
        cands = {}
        typemap = {}
        with open(RARITY, encoding="utf-8") as f:
            for line in f:
                rec = json.loads(line)
                crumbs = (rec.get("c") or "").split("|")
                title = rec.get("t") or rec["s"].replace("-", " ")
                key = normalize_name(title)
                # The account API types some items loosely - Grounds and
                # house pieces arrive as "Misc". The wiki category knows.
                if "Grounds" in crumbs:
                    typemap[key] = "Ground"
                elif "Floor Items" in crumbs:
                    typemap[key] = "Floor Item"
                elif "Wall Items" in crumbs:
                    typemap[key] = "Wall Item"
                elif "Houses" in crumbs:
                    typemap[key] = "House"
                r = clean_rarity(rec.get("r") or "")
                if not r:
                    continue
                not_item = 0 if "Items" in crumbs else 1
                fold = title.casefold()
                cands.setdefault(key, []).append((0, not_item, 0, fold, r))
                fullkey = normalize_keep(title)
                if fullkey != key:
                    # the page's literal name outranks every alias
                    cands.setdefault(fullkey, []).append((-1, not_item, 0, fold, r))
                m = paren_re.match(title)
                if m:
                    base = normalize_name(m.group(1))
                    if base and base != key:
                        cands.setdefault(base, []).append(
                            (1, not_item, suffix_rank(m.group(2)), fold, r))
        rmap = {k: min(v)[4] for k, v in cands.items()}
        body = ",".join(f"{json.dumps(k, ensure_ascii=False)}:{json.dumps(v, ensure_ascii=False)}"
                        for k, v in sorted(rmap.items()))
        tbody = ",".join(f"{json.dumps(k, ensure_ascii=False)}:{json.dumps(v, ensure_ascii=False)}"
                         for k, v in sorted(typemap.items()))
        # Every page name the wiki has (bases of parentheticals included):
        # the Armory's God tier = an item that matches NONE of these.
        names = set()
        if os.path.exists(PAGES):
            with open(PAGES, encoding="utf-8") as f:
                for line in f:
                    rec = json.loads(line)
                    if ":" in rec["s"]:
                        continue
                    t = rec["t"]
                    n = normalize_name(t)
                    if n:
                        names.add(n)
                    m = paren_re.match(t)
                    if m:
                        b = normalize_name(m.group(1))
                        if b:
                            names.add(b)
        nbody = "|".join(sorted(names)).replace("\\", "")
        with open(RARITIES_JS, "w", encoding="utf-8") as f:
            f.write(f"/* AQW Wiki Enhanced - rarity map ({len(rmap)} names), scraped\n"
                    f"   {time.strftime('%Y-%m-%d')} by tools/scrape.py from each page's Rarity field.\n"
                    f"   Keys are AQWE.normalizeName(item name); collisions resolved by the\n"
                    f"   hover hierarchy; wiki alternates renamed to the game's own tier names.\n"
                    f"   AQWE_WIKI_TYPES corrects the account API's loose typing (Grounds\n"
                    f"   arrive as Misc). AQWE_WIKI_NAMES holds every page name - an item\n"
                    f"   matching none of them earns the God tier. */\n"
                    '"use strict";\n'
                    # the build date guards the God tier: an item acquired
                    # AFTER this crawl may simply be newer than the dataset,
                    # so absence from the name list proves nothing about it
                    f'const AQWE_RARITIES_AT = "{time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(RARITY)))}";\n'
                    f"const AQWE_RARITIES = {{{body}}};\n"
                    f"const AQWE_WIKI_TYPES = {{{tbody}}};\n"
                    f"const AQWE_WIKI_NAMES = {json.dumps(nbody, ensure_ascii=False)};\n")
        print(f"built {RARITIES_JS}: {len(rmap)} rarities, {len(typemap)} type fixes, "
              f"{len(names)} known names", flush=True)


def phase_repair():
    """Refetch item pages recorded without a rarity - the old extractor
    could not read struck-through tiers. Rewrites rarity.jsonl in place."""
    recs = []
    with open(RARITY, encoding="utf-8") as f:
        for line in f:
            recs.append(json.loads(line))
    # misc-type items legitimately have no Rarity field - only equippable
    # categories are worth refetching
    EQUIP = ("Armors", "Classes", "Helmets", "Capes", "Pets", "Battle",
             "Grounds", "Necklaces", "Housing", "Floor Items", "Wall Items",
             "Houses", "Axes", "Bows", "Daggers", "Gauntlets", "Guns",
             "HandGuns", "Maces", "Polearms", "Rifles", "Staffs", "Swords",
             "Wands", "Whips")
    todo = [i for i, rec in enumerate(recs)
            if "Items" in (rec.get("c") or "") and not rec.get("r")
            and any(e in (rec.get("c") or "") for e in EQUIP)]
    print(f"repair phase: {len(todo)} item pages to refetch", flush=True)
    counter = {"n": 0}

    def one(i):
        rec = recs[i]
        try:
            html = fetch(f"{BASE}/{rec['s']}")
        except Exception:
            html = None
        if html:
            r = rarity_of(html)
            if r:
                rec["r"] = r
        with write_lock:
            counter["n"] += 1
            if counter["n"] % 200 == 0:
                print(f"  {counter['n']}/{len(todo)} repaired", flush=True)
        time.sleep(random.uniform(*DELAY))

    with ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(one, todo))
    tmp = RARITY + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for rec in recs:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    os.replace(tmp, RARITY)
    print("repair phase done", flush=True)


if __name__ == "__main__":
    phase = sys.argv[1] if len(sys.argv) > 1 else ""
    if phase == "pages":
        phase_pages()
    elif phase == "rarity":
        phase_rarity()
    elif phase == "repair":
        phase_repair()
    elif phase == "build":
        phase_build()
    else:
        sys.exit(__doc__)
