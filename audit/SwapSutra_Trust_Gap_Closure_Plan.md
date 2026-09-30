# SwapSutra — Trust Gap Closure Plan

**Status: planning only.** No code has been written or modified to produce this document. It follows directly from `audit/SwapSutra_Trust_Safety_Audit.md` and is scoped strictly to the 14 items requested — reputation, dispute flow, admin dispute console, transaction timeline, courier journey UI (P0), plus damage classification, deposit deduction, deposit lifecycle, trust notifications, in-product deposit explanation (P1), plus four validation checks. Nothing outside this list is addressed. Where the plan says "wiring," it means: an existing `appsscript.js` function and sheet already do the work — the gap is a missing dispatch call, UI component, or admin view, not new backend logic. Where it says "new build," the backend function does not exist today and needs to be designed, not just connected.

Three of the four validation items (11–13) were re-verified directly against the current code while writing this plan, and their answers are folded into the relevant item below rather than left open. Item 14 (live-deployment behaviour) cannot be executed from here — Apps Script does not run in this environment — and stays a validation task for you to run against the live deployment before or during Phase 1.

---

## P0-1 — Reader Reputation

**Existing backend support:** `getPublicReaderProfile` / `publicReaderProfileFromUserRow` (`appsscript.js:813-825`) already assembles a privacy-safe reader object and `getReaderDirectory` already lists readers. `createBookRating` (`appsscript.js:7546`) exists but rates a **book**, not a person, and has no completed-swap gate. `getApprovedBookCountsByOwner` (`appsscript.js:794`) is a working pattern for aggregating per-owner counts from the `Books`/`SwapRequests` sheets that a swap-count aggregator can copy directly. Swap completion state already exists as a status value (`Completed`) on `SwapRequests`/`Chats` (used by `isCompletedStatus`, `appsscript.js:1874`).

**Existing frontend support:** `ReaderProfileModal.tsx` and `ReaderDirectoryModal.tsx` (`src/components/`) already render the profile/directory UI and already call `getPublicReaderProfile`/`getReaderDirectory`. `rateBook` has a working submission call site (`src/App.tsx:10563`) that can serve as the template for a new counterparty-rating call.

**Existing DB/sheet support:** `Users` sheet (identity fields), `BookRatings` sheet (pattern to copy, not reuse directly — see below), `SwapRequests`/`Chats` (status = source of truth for "completed"). No sheet currently stores a per-person rating or a swap-count/on-time-return aggregate.

**What is missing:**
- A `ReaderRatings` sheet (new — do not overload `BookRatings`, which is book-scoped and unauthenticated against transaction completion) with columns: `id, swapId, raterEmail, ratedEmail, rating, comment, createdAt`.
- A `rateCounterparty` backend action, gated: caller must be `requesterEmail` or `ownerEmail` on a `Completed` swap, rating the *other* party, one rating per swap per direction (idempotency check against existing rows).
- A `completedSwapsCount` / `onTimeReturnRate` aggregator, added to `publicReaderProfileFromUserRow`'s output — on-time-return rate should only be computed and shown once due-date data is reliable (see P1-8/validation item 14 — do not ship a percentage built on data you haven't confirmed is trustworthy).
- Trust badges: a small, explicit rule table (e.g. "5+ completed swaps", "Verified phone") computed from the same aggregates — no new sheet needed, derived at read time.
- Frontend: rating prompt surfaced at swap completion (natural hook: the same moment `markOwnerFinalConfirmation`/completion status fires), and the new fields rendered on `ReaderProfileModal.tsx` and the directory cards in `ReaderDirectoryModal.tsx`.

**New build vs. wiring:** Mostly **new build** for the rating mechanism itself (new sheet, new gated action) — the profile/directory *display* is **wiring** (existing components, new fields appended to an existing response).

**Exact files/functions to change:**
- `appsscript.js`: add `rateCounterparty(data)`, add a `ReaderRatings` schema entry to `DB_SCHEMA`, extend `publicReaderProfileFromUserRow` and the `getPublicReaderProfile`/`getReaderDirectory` handlers to include `completedSwapsCount`, `avgRating`, `ratingCount`, `badges[]`.
- `src/App.tsx`: add a rating prompt trigger at swap completion; add a `rateCounterparty` fetch call.
- `src/components/ReaderProfileModal.tsx`, `src/components/ReaderDirectoryModal.tsx`: render the new fields.

**Priority:** P0. **Risk of changing it:** Low — additive only; no existing read path is modified, only extended with new optional fields. **Dependencies:** None blocking; benefits from P0-4 (timeline) existing first so "completed" is unambiguous, but can ship independently since `Completed` status already exists.

**Recommended order:** Build after P0-2/P0-3 (dispute flow) exist, so a rating can eventually be suppressed/flagged pending an open dispute on that swap — not a hard blocker, but avoids a rated swap being disputed the next day with no linkage.

---

## P0-2 — User-Facing Dispute Flow

**Existing backend support:** `disputeSwapRequest` (`appsscript.js:12600`) already creates a `SwapDisputes` row, flips the swap's `status` to `Disputed`, and emails the admin. This is real, working logic — do not rewrite it, extend it.

**Existing frontend support:** None. Confirmed zero call sites for `disputeSwapRequest` in `src/App.tsx`.

**Existing DB/sheet support:** `SwapDisputes` sheet exists with headers `id, swapId, reporterEmail, reason, details, status, createdAt` (`appsscript.js:133`). No evidence/media column.

**What is missing:**
- A "Report a Problem" entry point inside the active/completed swap chat UI (natural home: alongside the existing dispute-adjacent Circulation Tracker UI in `CirculationTracker.tsx` / the swap-proof panel in `App.tsx` around the `SwapProofs` rendering block).
- Issue **categories** — `disputeSwapRequest` currently accepts free-text `reason`; needs a fixed enum (e.g. `NOT_RECEIVED`, `NOT_RETURNED`, `DAMAGED`, `CONDITION_MISMATCH`, `WRONG_BOOK`, `OTHER`) sent instead of/alongside free text, matching the categories your Exchange & Delivery Policy already describes in prose (`legal/exchange-and-delivery-policy.md:112-123`).
- Evidence **submission and linkage** — no media upload path into `SwapDisputes` today. The existing `uploadSwapProof`/`saveFileToDrive` pattern (`appsscript.js`, `uploadSwapProof`) is the correct one to reuse for this rather than building a new upload path.
- User-visible dispute **status** — nothing today renders `SwapDisputes.status` back to the reporter or the counterparty.

**New build vs. wiring:** **Partial wiring, partial new build.** The dispute-creation call and admin notification are wiring (call the existing action). The category enum, evidence linkage, and status-back-to-user are new build (existing action needs new parameters and new response shape; existing `uploadSwapProof` media-handling code is reused, not rebuilt).

**Exact files/functions to change:**
- `appsscript.js`: extend `disputeSwapRequest(data)` to accept `category` and `evidenceUrls[]` (reusing `saveFileToDrive`, the same helper `uploadSwapProof` already calls); add `category` and `evidenceUrls` columns to the `SwapDisputes` schema; add a `getDisputeStatus`/extend `getSwapTracking` or `getSwapJourney` response to include the linked dispute's current status.
- `src/App.tsx` / `src/components/CirculationTracker.tsx`: add the "Report a Problem" button, category picker, evidence upload (reusing the `handleUploadProof` pattern already in `App.tsx:4884`), and a status readout.

**Priority:** P0. **Risk of changing it:** Low-medium — `disputeSwapRequest` is being extended (new optional parameters), not rewritten, so existing behaviour (status flip, admin email) is preserved if the new fields are additive with sane defaults. **Dependencies:** Needs the `SwapDisputes` schema change to land before the admin console (P0-3) can display evidence/category, and before P0-4's timeline can show a dispute state.

**Recommended order:** Build immediately after confirming the schema addition doesn't break the admin's existing raw-sheet workflow (if anyone currently reads `SwapDisputes` by column position rather than by header name, appending columns is safe; inserting them is not — append only, matching the existing `ensureSheetHeaders`-appends-only convention already used elsewhere in this codebase).

---

## P0-3 — Admin Dispute Console

**Existing backend support:** None beyond `disputeSwapRequest`'s creation. No `resolveDispute`, `getDisputes`, or `listOpenDisputes` action exists. Reusable patterns: the admin-guard idiom used throughout (`isAuthorizedAdminEmail`, e.g. as used by `getSwapProofs`, `getArchivedChatsForAdmin`), and the `markRefundIssued`/`markOwnerFinalConfirmation` pattern of an admin action that both mutates a sheet and posts a `sendChatMessage` system message to both parties — reuse this exact pattern for dispute resolution notifications rather than inventing a new notification path.

**Existing frontend support:** None. No admin view of `SwapDisputes` exists anywhere in `src/App.tsx`'s admin/management tab.

**Existing DB/sheet support:** `SwapDisputes` (needs the P0-2 schema extension), `SwapRequests` (status), and — once P1-7 lands — a deposit-deduction record to reference.

**What is missing:**
- `getDisputes` / `getOpenDisputes` action (admin-guarded, same pattern as `getSwapProofs`) returning disputes joined with swap details and evidence.
- `resolveDispute` action: admin sets a decision, a resolution note, and — where relevant — a deposit outcome (full refund / partial / forfeit, referencing P1-7's structured record rather than a free-text amount).
- Notifications to both parties on resolution — reuse `sendChatMessage` + (once P1-9 lands) a real `createNotification` call, not just a chat message.
- An admin UI panel — the existing admin/management tab in `App.tsx` (where `getSwapProofs`, `getArchivedChatsForAdmin` etc. already render) is the correct home, not a new page.
- Audit trail on the resolution itself — who resolved it, when, what the previous status was — the `SwapJourney` ledger's append-only, actor+timestamp pattern (`appsscript.js:15138-15168`) is the exact right model to copy for this (a `DisputeEvents` sub-log), not a new design.

**New build vs. wiring:** **New build** for the resolution workflow and admin UI panel (nothing exists to wire); **wiring/reuse** for the admin-auth pattern, the notification pattern, and the audit-log pattern, all of which are copied from existing code rather than invented.

**Exact files/functions to change:**
- `appsscript.js`: add `getOpenDisputes(data)`, `resolveDispute(data)`; add `DisputeEvents` (or extend `SwapJourney`'s pattern) for the resolution audit trail; dispatch both in `doGet`/`doPost` next to the existing circulation-ledger dispatch block (`appsscript.js:5252-5256`).
- `src/App.tsx`: new admin panel section (alongside the existing admin tabs), rendering `getOpenDisputes`, evidence, a decision form, calling `resolveDispute`.

**Priority:** P0. **Risk of changing it:** Low — entirely additive; touches no existing dispatch path. **Dependencies:** Hard dependency on P0-2 (evidence/category schema) landing first.

**Recommended order:** Immediately after P0-2. This is the highest-leverage single build in the plan — it turns "backend-only" dispute creation into something a business can actually run on.

---

## P0-4 — Visible Transaction Timeline

**Existing backend support:** All the underlying data already exists, spread across four places: `SwapRequests` (request/acceptance/status), `getDepositQuote`/`computeMutualDeposit` (deposit), `SwapProofs`/`uploadSwapProof` (pre-handover/receiving/pre-return/return-received proof, four phases), `markHandedOver` (handover confirmation), and — once wired per P0-5 — `SwapJourney`/`getSwapJourney` (courier/in-person journey, dispatch, transit, delivered). Nothing here needs new backend logic; it needs one aggregating read.

**Existing frontend support:** Each piece renders separately today (swap request card, the `CirculationTracker.tsx` proof panel, the chat's system messages for handover/refund/final-confirmation) — there is no single component that reads all of them and renders one ordered list.

**Existing DB/sheet support:** Fully sufficient once P0-5 makes `SwapJourney` populated — no new sheet required.

**What is missing:** A single `getSwapTimeline(swapId)` aggregating action that reads `SwapRequests` + `SwapProofs` + `SwapJourney` (+ `SwapDisputes` once P0-2/3 land) and returns one ordered event list; and one frontend timeline component that renders it, replacing the need to infer status from scattered chat messages.

**New build vs. wiring:** **Wiring/aggregation**, not new logic — every event this displays is already computed and stored somewhere; this item's only job is to read it all in one place and lay it out in order. The one genuinely new piece is the aggregation function itself, which is thin (a merge-and-sort over existing reads).

**Exact files/functions to change:**
- `appsscript.js`: add `getSwapTimeline(data)`, calling into the existing `getSwapJourney`, a proofs reader (same query `getSwapProofs` already does, scoped to one swap), and the swap row itself. Dispatch it in `doGet`.
- `src/App.tsx` / new `src/components/SwapTimeline.tsx`: one component, used wherever a swap is open (chat view, swap detail).

**Priority:** P0. **Risk of changing it:** Very low — read-only aggregation, cannot corrupt any existing data. **Dependencies:** Best built *after* P0-5 (courier UI) so the journey events it displays actually exist; can be stubbed/built in parallel and simply show fewer events until P0-5 lands.

**Recommended order:** Build the aggregation function early (it's cheap and safe), but treat the *visual completeness* of the timeline as dependent on P0-5.

---

## P0-5 — Courier Journey UI

**Existing backend support:** This is the most complete "backend-only" system in the codebase. `setSwapRoute` (method: in_person/courier, `appsscript.js:15380`), `logJourneyEvent`/`appendJourneyEvent` (append-only event log, role-checked via `SENDER_EVENTS`/`RECEIVER_EVENTS` so only the party currently holding the book can report sender-side events, `appsscript.js:15167-15168`), `getSwapJourney` (`appsscript.js:15527`), the `COURIERS` table and `courierTrackingUrl()` builder for 8 named couriers (`appsscript.js:15175-15193`), and address handling (`saveDeliveryAddress`/`getDeliveryAddress`, privacy-scoped to the two parties of an accepted swap) are all implemented and already dispatched in `doPost`/`doGet` (`appsscript.js:5252-5256`, `2262-2263`).

**Existing frontend support:** **None.** Zero call sites for `setSwapRoute`, `logJourneyEvent`, `getSwapJourney`, `saveDeliveryAddress`, `getDeliveryAddress` anywhere in `src/App.tsx`. This is pure wiring work.

**Existing DB/sheet support:** `SwapJourney`, `DeliveryAddresses` sheets, both with headers already defined (`JOURNEY_HEADERS`, `ADDRESS_HEADERS`, `appsscript.js:15133-15141`).

**What is missing:** Everything on the frontend only:
- A "how is this book travelling" step (in-person vs. courier) at or after handover, calling `setSwapRoute`.
- A delivery-address form calling `saveDeliveryAddress`, and a reveal of the counterparty's address (via `getDeliveryAddress`, which already enforces the one-swap-in-flight privacy rule) only where a courier method is chosen.
- A courier-name + AWB entry form calling `logJourneyEvent` with event `dispatched`, surfacing `courierTrackingUrl()`'s output as a clickable link immediately after.
- Read-only journey display (packed → handed over/dispatched → in transit → out for delivery → delivered → received) calling `getSwapJourney`, respecting the existing `SENDER_EVENTS`/`RECEIVER_EVENTS` split so the UI only offers the buttons each party is actually allowed to press.
- Alignment with the **already-shipped legal copy**: `legal/exchange-and-delivery-policy.md:80` tells users today to "share the tracking number in the app" — this build makes that sentence true rather than false.

**New build vs. wiring:** **Pure wiring.** No new backend function is needed for the core flow — every action listed above already exists, is dispatched, and is documented in the code's own comments as ready for exactly this purpose (`appsscript.js:15102-15130`).

**Exact files/functions to change:**
- `src/App.tsx` (or a new `src/components/SwapJourney.tsx`, consistent with the existing `CirculationTracker.tsx` pattern): calls to `setSwapRoute`, `logJourneyEvent`, `getSwapJourney`, `saveDeliveryAddress`, `getDeliveryAddress`.
- No `appsscript.js` changes required unless a gap surfaces during wiring (e.g. a missing GET wrapper) — check `doGet`/`doPost` dispatch coverage for each action before assuming a change is needed; per the earlier snapshot, `getSwapJourney`/`getDeliveryAddress` are already dispatched from both.

**Priority:** P0. **Risk of changing it:** Very low — this is additive frontend work calling already-guarded, already-tested-by-design backend actions; it cannot regress anything because nothing today depends on these actions being unused. **Dependencies:** None — can be built in parallel with P0-2/3. Feeds directly into P0-4's timeline.

**Recommended order:** Build in parallel with P0-2/3; this is the single highest ratio of user-visible trust gained to engineering risk in the entire plan, since it is 100% wiring against code that was already written, reviewed (per its own extensive in-code documentation), and is sitting idle.

---

## P1-6 — Structured Damage Classification

**Existing backend support:** None as a selectable field. The categories exist only as prose in `legal/exchange-and-delivery-policy.md:102-108` ("ordinary wear" vs. "damage": torn/missing pages, water damage, broken binding, staining, unauthorized writing, lost book).

**Existing frontend support:** None.

**Existing DB/sheet support:** `SwapProofs` has no severity/category column; `SwapDisputes` (once extended per P0-2) will have a `category` field but that's issue-type, not damage-severity specifically.

**What is missing:** An enum (`NONE`, `MINOR_WEAR`, `MODERATE_DAMAGE`, `MAJOR_DAMAGE`, `MISSING_PAGES`, `WATER_DAMAGE`, `LOST`) captured at the return-condition-confirmation step (`owner_received_return` phase of `uploadSwapProof`), directly encoding the policy's own "ordinary wear vs. damage" distinction instead of leaving it to a chat argument.

**New build vs. wiring:** **New build** (new field, new enum, new UI selector at an existing upload step) but small — it attaches to an upload flow (`uploadSwapProof`) that already exists and already fires at the right moment.

**Exact files/functions to change:** `appsscript.js`: add `damageCategory` to the `SwapProofs` schema, accepted by `uploadSwapProof` for the `owner_received_return` phase. `src/App.tsx`: add the category selector to the existing return-proof upload UI (near `src/App.tsx:5393-5417`).

**Priority:** P1. **Risk:** Low — additive field on an existing, working upload action. **Dependencies:** Should land before P1-7 (deposit deduction), which needs a reason code to point at.

---

## P1-7 — Structured Partial/Full Deposit Deduction with Reason

**Existing backend support:** `markRefundIssued` (`appsscript.js`) exists but is a single admin-toggled boolean with no amount or reason field.

**Existing frontend support:** None beyond the admin trigger for the boolean.

**Existing DB/sheet support:** `Chats` sheet carries `refundIssued`/`refundIssuedAt`. No column for deducted amount or reason.

**What is missing:** A deduction record (`deductionAmount`, `deductionReason`, referencing P1-6's damage category or P0-3's dispute resolution where one exists) instead of a bare boolean; this should be the natural output of `resolveDispute` (P0-3) when a dispute involves a deposit, and a simpler admin-entered version for the no-dispute "book just came back damaged, both parties agreed" case.

**New build vs. wiring:** **New build**, but small — extends `markRefundIssued`'s existing sheet-write pattern rather than replacing it.

**Exact files/functions to change:** `appsscript.js`: extend `markRefundIssued(data)` to accept `deductionAmount`/`deductionReason`/`fullAmount`; add these columns to `Chats` (or, cleaner, a dedicated `DepositLedger` sheet using the same `id, swapId, ...` convention as `SwapDisputes`/`SwapJourney`). `src/App.tsx`: extend the admin refund UI to capture these instead of a single "mark issued" click.

**Priority:** P1. **Risk:** Low-medium — changing `markRefundIssued`'s signature; keep the boolean behaviour as the default when no deduction fields are sent, so any existing caller keeps working. **Dependencies:** Benefits from P0-3 and P1-6 existing first, but can be built as a standalone admin tool before either if sequencing requires it.

---

## P1-8 — Deposit Lifecycle/Status Visibility

**Existing backend support:** `depositStateFromJourney` (`appsscript.js:15608`) already computes an advisory deposit state (`none`, `held`, `held_dispute`, etc.) from the journey ledger — this is exactly the right function to surface, not rebuild.

**Existing frontend support:** None — this function's output has no frontend consumer today (consistent with the rest of the journey ledger being unwired).

**Existing DB/sheet support:** Sufficient once `SwapJourney` is populated (P0-5).

**What is missing:** Only a UI element showing `depositStateFromJourney`'s output — this is a **direct beneficiary of P0-4's timeline** and should likely be a field on it (e.g., "Deposit: ₹1,200 — held") rather than a separate screen.

**New build vs. wiring:** **Pure wiring** — the computation already exists.

**Exact files/functions to change:** `appsscript.js`: ensure `depositStateFromJourney`'s result is included in `getSwapTimeline`'s (P0-4) response. `src/App.tsx`: render it in the timeline component.

**Priority:** P1. **Risk:** Very low. **Dependencies:** P0-4, P0-5.

---

## P1-9 — Trust-Event Notifications Instead of Chat-Only

**Existing backend support:** `createNotification(userEmail, type, title, message, relatedId, options)` (`appsscript.js:619`) is a generic, working function — used only 16 times across the whole app today (`swap_accepted`, `swap_declined`, `book_request_response`, dispute-to-admin, a few SLA nudges). `markHandedOver`, `markRefundIssued`, `markOwnerFinalConfirmation` all currently call `sendChatMessage` only, not `createNotification` — meaning these events don't reach the Notification Center or push.

**Existing frontend support:** `NotificationCenter.tsx` and `NotificationSettings.tsx` already render whatever `getNotifications` returns — no frontend change needed for new notification types to appear, they will show up automatically once created.

**Existing DB/sheet support:** `Notifications` sheet already exists and is the correct target — no schema change needed.

**What is missing:** Additional `createNotification(...)` calls at the existing points in `markHandedOver`, `markRefundIssued`, `markOwnerFinalConfirmation`, `setSwapRoute`/`logJourneyEvent` (once P0-5 lands), and `resolveDispute` (P0-3) — each of these functions already knows who the two parties are and already fires a `sendChatMessage`; this item is "also call `createNotification` right next to the existing `sendChatMessage` call," not a new subsystem.

**New build vs. wiring:** **Pure wiring** — reusing an existing, generic function at points that already have all the data needed to call it.

**Exact files/functions to change:** `appsscript.js`: add one `createNotification(...)` line inside each of `markHandedOver`, `markRefundIssued`, `markOwnerFinalConfirmation`, and (once built) `setSwapRoute`/`logJourneyEvent`/`resolveDispute`.

**Priority:** P1. **Risk:** Very low — additive call, does not change any existing return value or control flow. **Dependencies:** None for the three existing functions; depends on P0-3/P0-5 existing for the new ones.

---

## P1-10 — In-Product Explanation of Security Deposit / Refund Rules

**Existing backend support:** `getDepositQuote` already returns the computed amount and rate (`appsscript.js:16256-16267`, includes `ratePercent`). `LegalPages.tsx` already renders the full Refund & Security Deposit Policy at `/refund-policy`.

**Existing frontend support:** The deposit amount is shown once, in the main swap modal (`src/App.tsx:10352`), with no link to the policy explaining what happens to it. The RENT/SELL service-request modal (`src/App.tsx:27700+`) doesn't show a deposit figure or explanation at all, per the code confirmed in the P1-13 validation below.

**Existing DB/sheet support:** N/A — this is presentation only.

**What is missing:** A short inline explanation ("This deposit is refundable within 48 hours of a confirmed return — see full policy") next to every place a deposit figure is shown, linking to the existing `/refund-policy` route rather than duplicating its text.

**New build vs. wiring:** **Wiring** — links an existing route into existing UI; no new content to write beyond one or two sentences, since the authoritative text already lives in `LegalPages.tsx`.

**Exact files/functions to change:** `src/App.tsx`: add the explanatory line + link near the deposit display at `~10352`, and add a deposit figure (once P0-5/timeline exist, sourced from `getDepositQuote`) to the RENT service-request modal, which currently shows none.

**Priority:** P1. **Risk:** Very low — presentation only. **Dependencies:** None.

---

## Validation Items

### P1-11 — Does book condition affect server-side reference valuation?

**Verified: No.** Re-read `resolveBookPrice` (`appsscript.js`, full function) directly for this plan: it takes `isbn`, `genre`, `format`, `edition` — condition is not a parameter anywhere in the function or in `computeMutualDeposit`'s call into it. A "Poor" condition book and a "Very Good" condition book of identical ISBN/format/edition receive an identical resolved value and identical deposit requirement today. This is a confirmed gap, not a documentation error. Recommended fix (design only, not built here): a condition-based multiplier applied to `resolveBookPrice`'s output before it reaches `computeMutualDeposit` — additive, does not change the ISBN/genre lookup logic itself.

### P1-12 — Does authenticity status affect valuation/eligibility?

**Verified: Yes, correctly.** `computeMutualDeposit`'s inner `valueOf()` helper explicitly returns `null` for any book where `bookAuthenticity(book) === 'UNAUTHORISED'` (`appsscript.js`, `computeMutualDeposit`), with an explicit code comment: "An unauthorised copy is not valued at all... refusing to value it is the same act as refusing to trade it." This is a real, working eligibility gate — no action needed, and it should be listed under "features that already work" (see Section C below), not treated as a gap.

### P1-13 — Are permanent swap and temporary borrowing flows correctly distinguished?

**Verified: Partially — by design for SWAP, but inconsistent across service types.** For `serviceType: 'SWAP'`, permanent vs. temporary is a deliberate, working design: a single `swapPreference` field (`'Permanent'` / `'Temporary'`), gated against the book's own `permanentExchange`/`temporaryExchange` availability flags before the request can even be submitted (`src/App.tsx:11761-11764`), and the server reads that same field to decide behaviour (`appsscript.js:7645`). This is correctly built — do not touch it.

However, temporary borrowing also exists as a *separate* `serviceType: 'LEND'` in the backend (with its own due-date and no-deposit-for-the-lender logic, `appsscript.js:7705`, `16241`), and this path has **no frontend entry point at all** — confirmed no call site anywhere creates a request with `serviceType: 'LEND'`; it appears only in read-side display ternaries that will never match. Separately, `RENT` is now a real, working request flow (confirmed fixed since the earlier feature audit — `handleCreateServiceRequest`, `src/App.tsx:11838`, submits a genuine `createSwapRequest` call with `serviceType: 'RENT'`, not a toast as previously flagged), but its modal never shows a deposit figure or references `getDepositQuote` at all, unlike the SWAP modal.

**Net:** the SWAP permanent/temporary distinction is sound and needs no change. LEND is orphaned backend logic that either needs a frontend entry point or should be formally retired in favour of RENT, which now works — this is a product decision, not something to silently leave ambiguous. RENT's missing deposit-quote display is folded into P1-10 above.

### P1-14 — Live deployment behaviour of previously "NEEDS VALIDATION" items

Cannot be executed from this environment (no way to run the live Apps Script deployment or Google Sheets from here). What was re-confirmed by static reading for this plan: `resolveSwapRequestParties` (the Accept/Decline/Cancel column-mismatch fix) is used consistently across `acceptSwapRequest`, `declineSwapRequest`, `cancelSwapRequest`, `getSwapRequests`, and the circulation-ledger loader (`appsscript.js` — 6 call sites confirmed), which is strong evidence the fix is complete in the source. This still needs a live click-through test — accept, decline, and cancel a real (non-admin) swap request in the deployed app — before this item can be closed. Recommend this as the literal first task of Phase 1, since every other P0 item assumes swap acceptance works.

---

## A. P0 Implementation Checklist

1. [ ] **Validate live deployment**: confirm Accept/Decline/Cancel works for a real non-admin owner in the actual deployed app (item 14) — do this first, it's a precondition for testing everything else.
2. [ ] Wire courier journey UI: route selection, address exchange, courier/AWB entry, tracking link display, journey event log (P0-5) — pure frontend wiring against existing `setSwapRoute`/`logJourneyEvent`/`getSwapJourney`/`saveDeliveryAddress`/`getDeliveryAddress`.
3. [ ] Extend `disputeSwapRequest` with `category` + `evidenceUrls` (reusing `saveFileToDrive`); add "Report a Problem" UI (P0-2).
4. [ ] Build `getOpenDisputes` + `resolveDispute` + admin console panel, including a `DisputeEvents` audit log modeled on `SwapJourney`'s pattern (P0-3).
5. [ ] Build `getSwapTimeline` aggregator + `SwapTimeline.tsx` component (P0-4) — build the function early, layer in journey events as P0-5 lands.
6. [ ] Build `ReaderRatings` sheet + `rateCounterparty` action, gated to completed swaps; extend `publicReaderProfileFromUserRow` with `completedSwapsCount`/`avgRating`/badges; surface in `ReaderProfileModal.tsx`/`ReaderDirectoryModal.tsx` (P0-1).

## B. P1 Implementation Checklist

7. [ ] Add `damageCategory` enum to the return-proof upload step (P1-6).
8. [ ] Extend `markRefundIssued` with structured `deductionAmount`/`deductionReason` (P1-7).
9. [ ] Surface `depositStateFromJourney`'s existing output in the new timeline (P1-8).
10. [ ] Add `createNotification` calls alongside the existing `sendChatMessage` calls in `markHandedOver`, `markRefundIssued`, `markOwnerFinalConfirmation`, and the new P0-3/P0-5 functions (P1-9).
11. [ ] Add deposit-policy explanatory text/link near every deposit figure, and add a deposit figure to the RENT modal (P1-10).
12. [ ] Product decision + follow-through: retire or ship a frontend entry point for `serviceType: 'LEND'` (from validation item 13).
13. [ ] Design (not build, per this plan's scope) a condition-based valuation multiplier for `resolveBookPrice` (from validation item 11).

## C. Features That Should NOT Be Touched (already work)

- Server-side reference-value pricing engine (`resolveBookPrice`) and its refusal to trust a client-submitted `mrp`.
- Authenticity-based trade eligibility (`bookAuthenticity(book) === 'UNAUTHORISED'` blocking valuation) — verified correct in this plan, don't "fix" it.
- The mutual, two-sided security deposit calculator (`computeMutualDeposit`, `DEPOSIT_RATE = 0.6`).
- The four-phase condition-proof upload system (`uploadSwapProof`, `SwapProofs`) and its enforced minimum photo/video counts.
- Structured listing-level condition media (`frontCoverImage`/`backCoverImage`/`internalBookImage`/`internalBookVideo`).
- The permanent-vs-temporary `swapPreference` distinction within `serviceType: 'SWAP'` — sound design, confirmed working.
- Membership gating on book listing (`isApprovedActiveMember` in `createBook`).
- Address privacy scoping (`getDeliveryAddress` releasing an address only to the other party of an in-flight accepted swap).
- The RENT request flow (`handleCreateServiceRequest` → `createSwapRequest` with `serviceType: 'RENT'`) — confirmed genuinely fixed since the earlier audit; do not re-flag it as "toast only."
- `resolveSwapRequestParties` — the Accept/Decline/Cancel fix — pending only the live-deployment click-through in item 14, not a code change.

## D. Potential Regression Risks

- **`SwapDisputes` schema change (P0-2):** append new columns (`category`, `evidenceUrls`), never insert or reorder — this codebase's own convention (`ensureSheetHeaders` appends-only) exists precisely because reordering columns has broken reads before (see the original Accept/Decline/Cancel bug). Follow the existing convention exactly.
- **`markRefundIssued` signature change (P1-7):** must keep working with zero new arguments (default to the existing boolean-only behaviour) since it's already a live, working admin action — do not require the new fields.
- **`SwapProofs` schema change (P1-6):** additive column only; do not touch the existing `phase` enum or the minimum-count enforcement logic in `hasEnoughProof` (`src/App.tsx:5050-5051`).
- **Rating system (P0-1):** must not write into the existing `BookRatings` sheet — a shared sheet between book-ratings and person-ratings risks the same "two column families in one sheet" failure mode that caused the original Accept/Decline/Cancel bug. Use a separate `ReaderRatings` sheet.
- **Notification volume (P1-9):** adding `createNotification` calls at every trust event risks notification fatigue if not paired with sensible defaults in `NotificationSettings.tsx` — worth a quick check that users can mute non-critical categories before this ships broadly.
- **LEND retirement (P1-item from validation 13):** if the decision is to retire `serviceType: 'LEND'` rather than build a frontend for it, confirm no historical rows already exist with that serviceType before removing any backend branch that reads it — dead code that is still read by an old row is not safe to delete outright.

## E. Minimum Changes Required to Make SwapSutra Visibly Trustworthy

If only a small subset of this plan can ship first, this is the smallest set that changes what a new user with a ₹1,000 book actually *sees*:

1. **Courier journey UI (P0-5)** — pure wiring, lowest risk, makes an already-written legal promise true.
2. **"Report a Problem" button + basic evidence upload (P0-2, minimum viable: category + one photo, skip the full evidence gallery for v1)** — closes the single most dangerous gap (no recourse today).
3. **A visible transaction timeline (P0-4)**, even a simple version showing request → accept → handover → return → complete without the journey/deposit-state enrichment — turns an opaque chat thread into something that looks like a managed process.
4. **Completed-swap count on the reader profile/directory (a slice of P0-1)** — the cheapest, highest-visibility piece of reputation; a full rating system can follow once this is live.

These four, in this order, are the minimum set that changes a new user's first impression from "this is a chat app with a photo uploader" to "this is a platform that tracks and stands behind the exchange."
