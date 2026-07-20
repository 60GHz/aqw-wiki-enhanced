# Telemetry

Status: the worker runs at
`https://aqwe-telemetry.60ghz.workers.dev/` (Cloudflare free tier, KV
binding COUNTS) and `TELEMETRY_URL` in `extension/src/background.js`
carries it. Emptying that constant is the single switch that puts the
whole system back to sleep: no consent line, nothing sent, ever.

## Principles (unchanged, now enforced in code)

1. **Opt-in, not opt-out.** The popup's built-in note becomes a one-time
   consent line ("Count anonymous usage? Plain weekly numbers. Never your
   items, account credentials or anything about you. Sure · No") only while an endpoint is configured
   and the user hasn't answered. Same two lines, same height - the popup
   never moves. Either answer restores the normal note forever.
2. **Nothing personal, ever.** One POST a week: version, browser family
   (chromium/firefox), theme (good/evil) and the week's counters. No IDs
   of any kind, no item names, no URLs, nothing from account.aq.com. The
   worker validates that counts are numbers and drops everything else.
3. **Aggregate over trace.** Counters, not events. The worker stores one
   anonymous blob per ping (90-day TTL) and `GET /stats` aggregates a week
   on demand - numbers you can publish as-is.

## What is counted (client, `AQWE.count`)

| Counter | Meaning |
|---|---|
| popupOpen | popup openings |
| search / tagSearch | searches run, by mode |
| armoryOpen | Armory openings |
| goalAdd | Farm Goals starred |
| hoverShow | preview cards actually shown |
| syncOk / syncFail | background sync outcomes |
| cssRescue | wiki CSS healed (a dead import re-attached or the banner restored - early warning) |
| srcFail | a recipe source fetch/parse failed (a spike means the wiki's markup moved) |

Counting is local and free; consent gates only the weekly SEND. The
buffered helper lives in common.js (one storage write per quiet spell,
never one per hover).

## Verify it yourself

The entire server side is one small file: [tools/telemetry-worker.js](../tools/telemetry-worker.js). It accepts plain number counters, stores one
anonymous blob per weekly ping with a 90-day expiry, and aggregates on
demand. Nothing else exists to audit. Forks running their own endpoint will
find the deploy steps in the worker's own header comment.
