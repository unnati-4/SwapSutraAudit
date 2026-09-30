# SwapSutra — Phase 2 Report: 3 Priority Fixes

*Covers the 3 priorities you selected, in the order you specified. All changes are in the `appsscript.js` and `src/App.tsx` files already saved to your project folder.*

## Priority 1 — Swap Accept/Decline/Cancel bug (fixed)

**Root cause:** Two column-naming schemes exist side by side in the `SwapRequests` sheet. The live "Request to Swap" flow (`createSwapRequest`) writes `requesterEmail` / `ownerEmail`. But `acceptSwapRequest`, `declineSwapRequest`, and `cancelSwapRequest` were still reading the old `senderEmail` / `receiverEmail` columns, which are blank on every row created today. Because `ensureSheetHeaders` only appends missing columns and never reconciles them, this drift was invisible until you tried to actually accept/decline/cancel as a real (non-admin) user — the authorization check always failed.

**Fix:** Added one helper, `resolveSwapRequestParties(headers, row)`, that reads either column name and returns a single normalized `{requesterEmail, ownerEmail, requestedBookId}`. Applied it inside `acceptSwapRequest`, `declineSwapRequest`, `cancelSwapRequest`, and `getSwapRequests` (the last one also filters correctly now, so the Swap Inbox lists requests it was silently hiding before). No schema changes, no data migration — this only changes how existing rows are read.

**Tested:** Isolated Node.js unit tests against both column-naming variants confirmed: the owner can now accept/decline, the requester can cancel, a stranger is still correctly blocked, and the admin bypass still works. (Full functional confirmation — actually clicking Accept/Decline/Cancel in the running app — still needs you to deploy the updated Apps Script and try it against a real swap request, since I can't run your live Sheets/Script project from here.)

## Priority 2 — Book-listing membership/premium gate (fixed)

**Root cause:** `createBook` had no membership check at all. Anyone who could call the API directly (not just people using the UI) could list books regardless of trial/subscription status — the flat "10 listings" cap was the only limit, and it applied to everyone equally, so `isApprovedPremiumMember` (already written, never used) had no effect anywhere.

**Fix:** `createBook` now calls `isApprovedActiveMember` first and rejects with a clear `MEMBERSHIP_REQUIRED` error if the caller has no active trial or Chapters subscription. It then checks `isApprovedPremiumMember` to set a *tiered* cap: 10 listings for trial members, 500 for Chapters/premium members. This is the first place in the codebase where premium status actually changes behavior.

**Tested:** Verified server-side logically (non-member blocked, trial member blocked at 10, premium member allowed to 500) via the same isolated-function testing approach used for Priority 1. This is enforced in Apps Script, not just the frontend, so it can't be bypassed by calling the API directly.

## Priority 3 — Public reader profile + reader directory (built)

This was structurally absent before — "profile" only meant *your own* profile; there was no way to see another reader or browse the community.

**Backend (2 new read-only `doGet` actions):**
- `getPublicReaderProfile?email=...` — returns one reader's public profile.
- `getReaderDirectory?q=...&excludeEmail=...` — returns up to 60 readers, searchable by name/area/genre, sorted by most recently joined, excluding the caller and the admin account.

Both deliberately expose only `email, name, area, genres, bio, memberSince, isActiveMember, booksListedCount` — phone number and payment/billing status are never included in either response. Book counts exclude removed/inactive listings.

**Frontend:**
- A "View this reader's profile" link on every book detail page (for books you don't own), opening the new `ReaderProfileModal`.
- A "Discover Readers Near You" entry point on the Library/Browse tab, opening the new `ReaderDirectoryModal` — a searchable grid of reader cards, each opening that reader's profile on click.

**Tested:** 22 isolated unit tests covering the exact backend logic — book-count aggregation (removed/inactive correctly excluded), the privacy field allowlist (confirmed phone/paymentStatus never leak into the response), case-insensitive email lookup, not-found handling, admin/no-name/self exclusion from the directory, and search-by-name/area/genre — all passing. Also ran a full TypeScript syntax check (`tsc --noEmit`) on the updated `App.tsx` and a Node syntax check on `appsscript.js` — both clean, no errors introduced by any of the three changes. Not yet tested: clicking through the actual UI in a running deployment, since that requires your live Apps Script + Sheets environment.

## What's NOT done (explicitly out of scope for this pass)

Per your instruction to stop after these 3, I did not touch anything else from the audit, including:
- No visibility/privacy toggle for profile fields (I defaulted to a minimal, privacy-safe field set instead — there's no way for a reader to add *more* than that yet).
- The stale "List up to 3 books" marketing copy (should say up to 10 for trial now) — a one-line text fix, flagged but not made since it wasn't one of the 3 approved items.
- Everything else in the Phase 2 recommended order from the audit: genre/category field on books, Rent/Sell's fate, Campus Ambassador Program, mobile bottom nav bar — none of these were started.

## Deployment note

Both files are saved back to your project folder (`appsscript.js` and `src/App.tsx`). You'll need to redeploy the Apps Script project (or push a new version) for the backend changes to take effect, and rebuild/redeploy the frontend for the reader profile/directory feature to appear.

Ready for you to review, test against your live environment, and tell me what's next.
