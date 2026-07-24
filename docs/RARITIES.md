# AQW Rarity Taxonomy and the Armory's Rarity System

Source: the official May 27, 2026 [Design Notes](https://www.aq.com/gamedesignnotes/aqw-27may26-rarity-update-10360) rarity update. The wiki renders rarity as **free text**
on each item page ("Rarity: X"), so the dataset comes from our own crawl of that field (tools/scrape.py). Free text in, free text out: chips display the wiki's words verbatim,
colored by the mechanical family further below.

## What IoDA means

The Item of Digital Awesomeness lets a player claim nearly any item in the
game. Six exist right now:

- **Epic IoDA**: a 0.1% chance on any Wheel of Doom spin. Can be obtained once.
- **Golden IoDA**: earned through playtime, membership and AC milestones, or given as a reward.
- **Mythic IoDA**: comes with the $99.95 AC package, one per purchase.
- **Rhubarb IoDA**: once 181 of the Wheel's 182 rewards are collected, the Wheel Progress page in Manage Account offers a single one for 30,000 ACs.
- **Wicked IoDA**: merged from 1,000 Treasure Potions. A spin awards 1 potion, an itemless spin 2, and after 181/182 every spin pays 6. A daily spinner earns one WIoDA roughly every 5 to 6 months.
- **Bonus IoDA**: spending other IoDA types earns these back. The first six arrive one per spend, and after that one for every 3 IoDAs spent.

The Kickstarter Backer IoDA (**KBIoDA**) bypasses part of the exclusion
list and reaches items a standard IoDA cannot. In the table below, "IoDA"
means claimable with any of them, "KBIoDA only" means only the Kickstarter
variant reaches it, "excluded" means neither can. The official
[Wheel of Doom FAQ](https://www.aq.com/lore/guides/WheelOfDoomFAQ) carries
the full rules.

## Every rarity and its IoDA status

Every value our wiki crawl found, alphabetically. Where the wiki names one
tier two ways, both share a row.

| Rarity | What it means | IoDA |
|---|---|---|
| 1% Drop | drops at a flat 1% | IoDA |
| 5% Drop | drops at a flat 5% | IoDA |
| Achievement Tracker | playtime, membership and AC milestones | excluded |
| Artifact | iconic lore pieces | IoDA |
| Awesome | permanently available | IoDA |
| Benevolent | Kickstarter backers with a KB Ticket | KBIoDA only |
| Boss Drop | drops from bosses | IoDA |
| Champion | end-game items that must be earned | KBIoDA only |
| Collector / Collector's Rare | HeroMart merchandise items | KBIoDA only |
| Common | permanently available | IoDA |
| Crazy | one of the game's joke labels | IoDA |
| Custom Item | unique per-player items | excluded |
| Dumb | one of the game's joke labels | IoDA |
| Epic | moderate to hard to earn | IoDA |
| Event / Event Item | tied to live events | IoDA |
| Event Rare | no longer obtainable | IoDA |
| Expensive | costs a mountain of gold | IoDA |
| Founder | the 2008 early supporters | KBIoDA only |
| Frostval Gifting | Chilly's donation event | excluded |
| Hidden Secret | tucked away in the game | IoDA |
| Impossible | absurdly low drop odds | IoDA |
| Infinity | AQW Infinity items | IoDA |
| Junk | one of the game's joke labels | IoDA |
| Kickstarter Backer | Kickstarter rewards, come with codes | excluded |
| Legendary / Legendary Item | prestige tier, hard to earn | KBIoDA only |
| Limited Quantity / Limited Rare | limited-stock shops, gone when the stock runs out | IoDA |
| Limited Time | no longer obtainable | IoDA |
| Promotional Item | real-world retail promotions | IoDA |
| Rare | no longer obtainable | IoDA |
| Seasonal / Seasonal Item | returns on the calendar each year | IoDA |
| Seasonal Rare | no longer obtainable | IoDA |
| Secret | tucked away in the game | IoDA |
| Super Ultra Rare / Super Mega Ultra Rare | permanently unavailable | excluded |
| Ultra Rare | no longer obtainable | IoDA |
| Unknown | the true rarity is not determined yet | IoDA |
| Upgrade Pack | buying any package above $9.95 lets you pick one upgrade shop | excluded |
| Verification Shop | tower verification shops (Guardian / Dragonlord / StarLord) | excluded |
| Weird | permanently available | IoDA |

Placeholder and Unassigned exist as game labels but have never appeared
on the wiki. Misc-category items (Resources, Quest Items, Notes) carry no
rarity in the game and never wear a chip, whatever a page's field may
say. Past those, the field holds only a handful of hand-typed,
single-page mistakes (Rary, a doubled Rarity, Promo, New Collection
Chest, Limited Time Drop), and the crawl quietly straightens them out.
The lone N/A marks an item removed from the game outright and stays as
it is.

## The tiers, sorted by the Armory's hierarchy

Colors group by what a rarity mechanically IS. Tokens live in the theme,
both light and dark. Rainbow and the god sweep are static gradients built
from the palette's own hues. The Tier column is the Armory's Rarity sort.

| Tier | Family | Color | Rarities |
|---|---|---|---|
| 0 | god | holo sweep, gold frame | assigned at runtime to items with NO wiki page under any name variant: mod items, one-of-ones, pages the wiki staff missed |
| 1 | rainbow | 5-hue gradient | Super Ultra Rare, Benevolent, Founder, Custom Item |
| 2 | kickstarter | slate violet | Kickstarter Backer |
| 3 | merch | yellow | Collector, Promotional Item |
| 4 | frostval | cyan | Frostval Gifting |
| 5 | gone | dark green | Rare, Ultra Rare, Seasonal Rare, Event Rare, Limited Rare, Pseudo-Rare, Limited Time, Limited Quantity |
| 6 | champion | red | Champion |
| 7 | prestige | gold | Legendary |
| 8 | artifact | orange | Artifact |
| 9 | hard | purple | Epic, Expensive, Impossible, 1% Drop, 5% Drop |
| 10 | seasonal | pink | Seasonal |
| 11 | channel | blue | Upgrade Pack, Achievement Tracker, Verification Shop |
| 12 | neutral | gray | Awesome, Weird, Common, Crazy, Junk, Dumb, Secret, Hidden Secret, Boss Drop, Event, Infinity, Unknown, anything unrecognized |
| 13 | (no chip) | - | Misc-category items, unknown rarity, or a bare "Rarity" field the editor forgot to fill |

## Design rule

There is no official hierarchy across rarities. The taxonomy is half a
joke by design (Weird, Junk). So the Armory's rarity filter never ranks
them editorially. The tier order above exists only for the Rarity sort.

## Canonicalization and name resolution

**Game names win.** The wiki's alternates collapse at build time: Seasonal
Item → Seasonal, Legendary Item → Legendary, Event Item → Event,
Collector's Rare → Collector, Super Mega Ultra Rare → Super Ultra Rare.
The live wiki also suffixes the field with the word "Rarity" ("Rarity:
Awesome Rarity") and misspells freely ("Rariry", "Awsome", "Seaonal Item") -
tools/scrape.py strips and repairs all of it, so chips carry clean names.

**Name resolution mirrors the hover engine**: exact page first, then
base-name aliases for parenthetical titles (Unidentified 27 (Chameleon
Cape) answers for Unidentified 27), with collisions ranked by the canon
hierarchy. The two lists in hover.js and tools/scrape.py SUFFIX_PRIORITY
are the single source of truth for that order.

**One note from the field**: Super Mega Ultra Rare and Limited Rare still exist
in the game and on the wiki (the 2026 design notes said otherwise).
