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
