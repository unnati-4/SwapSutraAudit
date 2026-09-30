# SwapSutra — Feature Audit & Launch Readiness Matrix

*Prepared as Phase 1 of the launch-readiness build. Scope: full read-only audit of `src/App.tsx`, `appsscript.js`, `src/components/*`, `src/services/*`, `src/index.css`, PWA files, against the product spec. No code was changed to produce this document.*

## How to read this

Every sub-feature is scored A–F:

- **A** — fully implemented and working
- **B** — implemented but broken or incomplete
- **C** — UI exists, backend is missing
- **D** — backend exists, UI is missing
- **E** — completely missing
- **F** — not required for first launch

A note on method: this audit was produced by five parallel investigations across the codebase, then I personally re-verified the two highest-stakes claims by reading the actual source. One turned out to be **my own staging error** (corrected below, not a real bug). The other turned out to be a **real, confirmed, root-caused critical bug** (also below). Everything else reflects the investigations' grep/read evidence and hasn't been independently re-traced line-by-line — treat it as very well-informed, not infallible.

## Correction: the app is not broken by missing files

Two of the five reports flagged `src/App.tsx` as importing six files that "don't exist" (`ReadingRoom.tsx`, `DedicatedCurrentReadChat.tsx`, `NotificationCenter.tsx`, `NotificationSettings.tsx`, `notificationEngine.ts`, `webPushManager.ts`) plus `index.css`, `tailwind.config.js`, and the PWA `manifest.json`/`sw.js`. That was **wrong, and it was my mistake**: I only copied a subset of your project into my working folder before handing it to the audit agents, and left those files out. I've since pulled them in and confirmed all of them are real, substantial, and properly wired — `ReadingRoom.tsx` and `DedicatedCurrentReadChat.tsx` both make their own live API calls to your Apps Script backend, `NotificationCenter`/`NotificationSettings` are rendered and hooked up, and `manifest.json`/`sw.js` are a genuine (if unglamorous) service-worker precache setup. None of that is a launch blocker. I'm calling this out explicitly so you don't lose trust in the rest of the audit over it.

The one thing in that cluster that **is** a real, confirmed gap: `webPushManager.ts` uses a placeholder VAPID key (`BEl62iUYgUivxIkv69yViEuiBIa-KEY-SWAPSUTRA-PROD-VAPID-PUBLIC`, not a real generated key) and there's no backend action anywhere in `appsscript.js` to store or send a push subscription. Web push is wired on the frontend but has no real infrastructure behind it — rate this **E**, but low priority (email notifications already work independently).

## Confirmed critical bug: swap Accept/Decline/Cancel silently fail for real users

I traced this myself end-to-end because it sits at the hinge of the entire product. The current "Request to Swap" button (the one actually used by your book-detail modal) calls `createSwapRequest`, which writes rows into the `SwapRequests` sheet using headers `requesterEmail` / `ownerEmail` (among others). But `acceptSwapRequest`, `declineSwapRequest`, and `cancelSwapRequest` — the handlers behind your Swap Inbox's Accept/Decline/Cancel buttons — read the *same* sheet expecting an older column layout, `senderEmail` / `receiverEmail`. Because your header-repair helper (`ensureSheetHeaders`) only *appends* missing columns rather than reconciling them, the sheet now carries both column families side by side, and every row created by the current flow leaves `senderEmail`/`receiverEmail` blank. The authorization check in all three handlers (`normalizeEmail(row[receiverEmailIdx]) !== ownerEmail`) then always fails for a real, non-admin user.

**Net effect: a book owner can never legitimately accept, decline, or cancel a swap request through the app today.** The only reason this hasn't been noticed in testing is that the admin email (`swapsutra@gmail.com`) has an explicit bypass in the authorization check. This is priority #1 for Phase 2, full stop — the rest of the circulation tracker (proof upload, handover confirmation, disputes) is well-built but unreachable until this is fixed.

## Feature Audit Matrix

### Authentication (fixed earlier this session)

| Feature | Status | Evidence |
|---|---|---|
| Login/Sign Up choice before OTP | A | `LoginModal` choice step, App.tsx |
| Backend blocks OTP for unregistered emails | A | `sendOTP`/`verifyOTP` Users-sheet checks |
| Backend blocks duplicate Sign Up | A | `createSubscription` Users+Subscriptions check |

### Membership & access control

| Feature | Status | Evidence |
|---|---|---|
| Trial/premium/expired status computed (frontend + backend) | A | `userTier` memo; `computeSubscriptionStatus`, `checkExpiredSubscriptions` |
| Chat gated by membership server-side | A | `requireApprovedMember` in `sendChatMessage` |
| Book requests gated by membership server-side | A | `isApprovedActiveMember` in `createBookRequest`/`createSwapRequest` |
| Book **listing creation** gated by membership server-side | **B** | `createBook` has no membership check at all — only a flat cap of 10 listings, reachable by anyone who can call the API |
| Trial vs. Premium actually enforced differently anywhere | **D** | `isApprovedPremiumMember` is defined but never called — no feature is actually premium-only server-side beyond "approved member or not" |

### User profile & reader identity

| Feature | Status | Evidence |
|---|---|---|
| Name, email, phone, area, bio, genres | A | Users sheet + `EditProfile` form, matching fields |
| Profile photo | **C** | Referenced in a frontend type, rendered for event members, but no Users-sheet column and no upload control |
| Public/private visibility control | **E** | No visibility field anywhere in Users schema |
| Public reader-profile page (view *another* reader) | **E** | Only "my own profile" exists — no reader directory or public profile route |

### Books: listing & discovery

| Feature | Status | Evidence |
|---|---|---|
| List a book (title, author, condition, photos, description, location) | A | `createBook`, real Drive photo upload via `saveFileToDrive` |
| Swap / Lend / Rent / Sell modes + permanent/temporary | A | `bookAvailabilityFlags`, full schema |
| Genre/category field on a book | **E** | No genre column in `getBookHeaders()` at all — genre browsing is structurally impossible today |
| Search by title/author | A | client-side filter |
| Nearby/location discovery | A | real haversine radius filter |
| View listing owner's reader profile from a listing | **E** | No link exists (also blocked by the missing public profile page above) |
| Initiate Swap from a listing | A | wired to request flow |
| Initiate Rent / Sell from a listing | **C** | "Express Rent/Buy Interest" only shows a toast — no request is ever created, despite the backend having real `RENT`/`SELL` logic (deposit, due date, amount) sitting unused |

### Swap & circulation

| Feature | Status | Evidence |
|---|---|---|
| Create a swap request | A | `createSwapRequest` |
| **Accept / Decline / Cancel a swap request** | **B — critical, confirmed** | column-name mismatch, see above; broken for all non-admin owners |
| Chat between requester and owner | A | `sendChatMessage`, `Chats` sheet |
| Condition/photo proof at handover | A | `uploadSwapProof`, 4-phase proof model |
| Handover confirmation & stage tracking | A | `markHandedOver`; real terms are `Active → Handed Over → Returned → Completed → Archived` (use these exact terms, not "Requested/Arranging Handover" — that terminology doesn't exist in the code) |
| Dispute filing, refunds, final confirmation | A | `disputeSwapRequest`, `markRefundIssued`, `markOwnerFinalConfirmation` |
| Peer/transaction rating | **B** | `createBookRating` rates the *book*, not the transaction or the other reader, and isn't gated to a verified completed swap |
| Lend as a distinct flow | **D** | backend models it (`serviceType==='LEND'`), no distinct frontend entry point |

### Reading Space, Reading Circles, community feed, notifications

*(Corrected after the staging fix above — all of these files are real and wired.)*

| Feature | Status | Evidence |
|---|---|---|
| Currently Reading / TBR / Completed / Favourites / Bookshelf | A | `getReadingSpace`/`upsertReadingSpaceBook`, rendered in profile |
| Reading Log / activity journey | A | `getReadingJourney`, rendered |
| Reading Streak | **B** | Local-device login-streak in `localStorage`, not a real synced reading-activity streak — resets on a new device |
| Per-item public/private visibility in Reading Space | **E** | No visibility flag in the schema |
| Reading Circles (create/join/leave/end/archive around a book) | A | full action set, all called from the app |
| Circle discovery/search | **B** | `searchCurrentReadCircles` exists server-side with zero frontend call sites — dead action |
| Circle name/description as a themed group (vs. auto book-keyed thread) | **B** | circles are auto-created from book title + author, no custom name/description field, so it's closer to a per-book chat than a themed discussion group |
| Circle chat UI | A | `DedicatedCurrentReadChat.tsx`, properly wired via props |
| Reading Room (community feed: posts, reactions, comments, recommendations) | A | `ReadingRoom.tsx`, self-contained, calls its own backend actions, rendered in the tab bar |
| In-app notification center + settings | A | rendered, real backend actions behind them |
| Voice notes in chat | **E** | `VoiceRecorder.tsx` exists on disk but is never imported anywhere — pure orphaned scaffolding |
| Web push notifications | **E** | placeholder VAPID key, no backend subscription storage/send action (email notifications work fine independently) |

### Events, newsletter, coupons, Campus Ambassador

| Feature | Status | Evidence |
|---|---|---|
| Events: list, details, registration, gallery, host-enquiry, notify-me | A | one of the most complete areas in the app |
| Admin: who registered for a given event | **D** | only an aggregate count shown; full registrant records exist in the sheet but there's no list view |
| Newsletter: create/schedule/send/subscribers | A | full admin tool |
| On-site community content (beyond email) | **E** | community storytelling only reaches subscribers via email; nothing published back to the site |
| Coupons: create/validate/apply | A | functional end-to-end |
| Coupon admin UI polish | **B** | works, but via raw browser `prompt()`/`alert()` dialogs, not a real form |
| Pricing configurable (not hardcoded) | A | driven by `appSettings.standardFee`, not hardcoded |
| **Campus Ambassador Program** | **E — ground-up build** | zero matches anywhere in either file for "ambassador" or "campus" — no application form, no dashboard, no referral code, no sheet. This needs to be built from scratch, not patched. |

### Mobile, homepage, design system

| Feature | Status | Evidence |
|---|---|---|
| Mobile navigation | **B** | full-screen hamburger drawer covering the right items, but no persistent bottom tab bar — every nav action costs an extra tap versus the spec's expectation |
| Responsive breakpoint coverage overall | A | heavy `sm:`/`md:` usage (119/193 occurrences) |
| A handful of ungoverned 2-column grids | **B** | ~13 spots use bare `grid-cols-2` with no mobile override — likely cramped at 320–375px |
| Modals mobile-safe | A | spot-checked subscription and listing modals, both properly capped/scrollable |
| Homepage value proposition | A | clear hero, dual CTA, short scannable "how it works" steps — quoted headline: *"Find readers who love the same stories as you."* |
| Book-listing & subscription forms on mobile | A | properly single-column on small screens |
| Dark/night mode | A | real, working, persisted theme system |
| Touch target sizing | A | predominantly `py-3`/`py-4` |
| PWA (manifest + service worker) | A | both real and present (see correction above) |

## Recommended Phase 2 order

Given the one-month timeline and the goal of 100–500 genuine readers, I'd sequence the critical fixes like this:

1. **Fix the swap Accept/Decline/Cancel column mismatch.** This is the single highest-leverage fix in the whole audit — it's a few lines in three functions, and it unblocks the entire circulation system you already built well.
2. **Gate book-listing creation server-side** by membership status, closing the API-bypass hole.
3. **Ship a public reader profile + reader directory**, even a simple one — this is the actual "community" value prop and is currently structurally absent.
4. **Add a genre/category field to books** and wire it into search/filter — needed for real discovery at 100+ listings.
5. **Decide Rent/Sell's fate for launch**: either wire "Express Interest" into the real request flow that already exists server-side, or explicitly relabel them "Coming Soon" so they don't feel broken.
6. **Campus Ambassador Program v1** — scoped small: an application form + a Sheet + a simple referral code, not a full dashboard, given it's a from-scratch build.
7. **Mobile bottom nav bar** — highest-impact mobile change given the drawer-only pattern today.

Items I'd explicitly *not* touch before launch: reading streak sync, web push, voice notes, on-site community content beyond the newsletter, and coupon-admin UI polish — none of these block a genuine, trustworthy first launch.
