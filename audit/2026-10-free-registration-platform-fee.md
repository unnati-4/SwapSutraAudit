# Free registration, platform fee, 20-book listing limit (Oct 2026)

## What changed

| | Before | After |
|---|---|---|
| Joining | 30-day trial, then ₹49/month | Free and permanent: name, email, phone, verified by email code |
| Exchanges | Free (deposit only on temporary swaps / rent / lend) | ₹10 platform fee from **each** reader on every swap, lend, rent and sell, paid by UPI QR after the owner accepts |
| Listings | 10 (trial) / 500 (₹49) | 20 free; ₹20 once, or coupon `BOOKSTORE2627`, for unlimited |

The platform fee rides on the existing SecurityFeePayments flow (QR → UTR + screenshot → admin approval → chat unlocks). The QR shows deposit + fee together; the sheet stores `depositAmount` and `platformFee` separately, so refunds only ever return the deposit. Exchanges created before `PLATFORM_FEE_START_ISO` keep the old rules, so no open chat gets locked.

Admins pause an account by setting its Subscriptions `adminStatus` to `Cancelled` — that is now the only way a registered reader stops being a member.

## Deploy

1. **Apps Script** — paste the new `appsscript.js`, then **Deploy → Manage deployments → edit → New version** (same deployment, so `APPS_SCRIPT_URL` doesn't change).
2. **Set the launch moment** — `PLATFORM_FEE_START_ISO` near the end of `appsscript.js` is `2026-10-06T00:00:00+05:30`. Change it to when this actually goes live, before deploying.
3. **Triggers** — delete the time-driven triggers for `checkExpiredSubscriptions` and `sendMembershipExpiryReminders`. Both are no-ops now, but there's no reason to keep running them.
4. **Vercel** — push the repo; the frontend builds as usual.

## Settings (Apps Script → Project Settings → Script Properties)

No redeploy needed to change these:

| Property | Default | Meaning |
|---|---|---|
| `PLATFORM_FEE_PER_PARTY` | `10` | ₹ per reader per exchange |
| `FREE_LISTING_LIMIT` | `20` | Free listings per reader |
| `LISTING_UNLOCK_FEE` | `20` | ₹ for unlimited listings |
| `LISTING_UNLOCK_COUPONS` | `BOOKSTORE2627` | Comma-separated codes that unlock unlimited listings |

## Admin

**Admin → Payments to verify** now has both queues: exchange payments (as before) and ₹20 listing unlocks, plus a line showing verified platform revenue.

## Policy decisions to confirm

The refund rules for the new fees (in-app Refunds page and `legal/refund-and-security-deposit-policy.md`) were drafted with this change:

- ₹10 fee refunded if the exchange is cancelled before the chat opens; not after.
- ₹20 unlock refunded if unverifiable, double-charged, or asked within 48 hours before a 21st listing.

## Tests

`tests/test_platform_fees.cjs` (61 checks, against the real `appsscript.js`). Tests that asserted the old ₹49 / trial / expiry behaviour were updated to the new rules, each with a dated comment.

---

# Round 2 (Oct 2026): exchange rules, routes, 21-day returns

## Rules (decided by the owner)

| Rule | Detail |
|---|---|
| Security deposit | Flat **65% of MRP** for swap (both readers), rent and lend. **None on a sale.** |
| Prices | The owner sets their own **selling price** and **monthly rent** (₹1–₹50,000). Rent is pre-filled with 10% of MRP as a suggestion. Older listings keep 10% of MRP. The catalogue band is now only a guide. |
| Swap match | Same condition, same type (Paperback / Hardcover / Budget copy = reprint), MRPs within **±10%**. Enforced in `createSwapRequest`; the swap form greys out non-matching books (`src/utils/swapMatch.ts`, kept equal by `tests/test_swap_match_mirror.cjs`). |
| Nearby | The reader picks 2 / 5 / 10 / 25 / 50 / 100 km (remembered on the device). |
| Route | 1) both payments verified → 2) either reader records **meet in person** (map pin + place name) or **courier** → 3) each book's timeline → 4) return. Nothing can be logged before a route is set. Addresses and phone numbers are released **only on courier**. In a swap both books are tracked (`counter` leg). |
| Chat pin | 📍 button sends a map pin (`shareChatLocation`), shown as a map card with Google Maps / OSM links. Typed numbers stay blocked. |
| Courier tracking | Courier company + tracking ID required to mark "posted"; links to the courier's own tracking page; step-by-step status. No live map (needs a paid courier API). |
| Returns | Rent, lend and **temporary** swap (both books). On its way back (handed over, or posted with tracking ID) within **21 days** of reaching the borrower. **+7 or +14** days if the other reader agrees, **14 max**, only before the deadline. Late → the borrower's deposit is **forfeited to the owner**. Posted in time = on time, even if the courier is slow. |
| Notifications | In-app + email at start, 7 / 3 / 1 days left, last day, forfeit. WhatsApp too once configured (below). |

The stage machine used to treat 21 days as a *waiting period* before a return could be logged. It now treats it as the **deadline** (`returnStage.dueAt`).

## Deploy checklist

1. Upload the files (zip) to GitHub; Vercel rebuilds. `package.json` now includes `leaflet`.
2. Paste the new `appsscript.js` into Apps Script → **Deploy → Manage deployments → edit → New version**.
3. In the Apps Script editor, run **`installReturnDeadlineTrigger`** once (Run ▶). It checks deadlines every hour.
4. Admin → **Payments to verify** now also lists **late returns**: pay the owner by UPI, then click *I have paid the owner*.
5. WhatsApp (optional): Meta WhatsApp Business account + an approved template with two body variables ({{1}} title, {{2}} message). Script Properties: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE` (and `WHATSAPP_TEMPLATE_LANG`, default `en`). Off until set.

## Tests

`tests/test_returns_and_swaps.cjs` (59), `tests/test_swap_match_mirror.cjs` (19, incl. 1,350 rule combinations). Tests asserting the old 60% / band-limited price / fixed rent were updated with dated comments.
