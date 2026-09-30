# SwapSutra — Trust, Safety & Marketplace Systems Audit

**Scope:** Read-only, code-level audit of `appsscript.js` (16,523 lines — the live backend), `src/App.tsx` (28,013 lines — the entire frontend, single file), `api/swapsutra.ts` / `server.ts` (the proxy layer), `src/components/*`, `pricing/` (a Supabase/Postgres valuation engine used via RPC from `appsscript.js`), and the `legal/` policy documents, checked against the trust model in the brief. No code was changed. No feature was marked implemented on the strength of a button, field, comment, or route alone — each claim below traces to a specific function, dispatch line, or frontend call site, cited by file and line number.

**How this audit was produced:** the repository already contains three prior audits (`audit/SwapSutra_Feature_Audit.md`, `SwapSutra_Phase2_Report.md`, `SwapSutra_Phase5_API_Snapshot.md`) from earlier sessions. Those were read and treated as a starting map, not as ground truth — the codebase has moved on since (a Campus Ambassador/referral backend, a Supabase pricing engine, and a full courier-journey ledger have all been added since those were written). Every finding below was re-verified directly against the current `appsscript.js` and `src/App.tsx` on disk. Two things are flagged explicitly as **NEEDS VALIDATION** where static reading could not fully confirm runtime behaviour (Google Apps Script cannot be executed from here).

---

## 1. Executive Summary

**Trust Readiness: 4.5 / 10.**

This is an unusual codebase to audit: the *backend* trust engineering is genuinely advanced — a server-side reference-value pricing engine that refuses to trust a user's typed price, a mutual 60%-of-value deposit calculator, a four-phase photographic condition-proof system with enforced minimum counts, and a full append-only courier/handover journey ledger with AWB tracking links for eight Indian couriers. Almost none of that second tier is reachable by a real user. The pattern repeats across the whole trust model: **the hard part (the backend rule) is built; the connecting part (the UI, the admin console, the notification) is not.** A new user with a ₹1,000 book today has almost no way to see any of this — they see a chat, a photo-upload button, and a deposit number with no explanation of what happens if it goes wrong.

The single most important number in this report: **there is no way for a real user to file a dispute.** `disputeSwapRequest` exists, is dispatched, notifies the admin, and updates status — but it has zero call sites in `src/App.tsx`. If a swap goes wrong today, a reader's only recourse is to email `swapsutra@gmail.com`, which the Exchange & Delivery Policy itself tells them to do — the in-app "raise it with us" the policy describes does not exist as a button anywhere in the product.

The reputation system the team suspected was missing is confirmed missing: `getPublicReaderProfile` deliberately returns only `name, area, genres, bio, memberSince, isActiveMember, booksListedCount` (`appsscript.js:813-825`) — no rating, no swap count, no on-time-return rate, no dispute history, anywhere a user can see it.

## 2. What Is Already Strong

- **Server-side fair valuation, correctly enforced.** `createBook`/`updateUserBook` explicitly discard any `mrp` the client sends and compute it server-side from an ISBN/genre price table (`resolveBookPrice`, `appsscript.js:16057+`), with a documented rationale at `appsscript.js:15724-15745` ("`mrp` used to be a free-text field the owner typed... createBook and updateBook both ignore any `mrp` in the payload"). This is precisely the anti-arbitrary-pricing goal in the brief, already live.
- **A genuine authenticity + evidence-tiered MRP model.** `authenticityStatus` (ORIGINAL/UNAUTHORISED/UNKNOWN) and `printedMrp` / `printedMrpEvidenceTier` / `printedMrpVerificationStatus` are real Books-sheet columns (`appsscript.js:4770-4776`), with a `MRP_ANCHORING_TIERS` guard (`appsscript.js:7038`) that stops a later edit from silently overwriting a value another party already verified.
- **Structured listing-level condition proof.** Four dedicated, separately-required media fields — `frontCoverImage`, `internalBookImage`, `internalBookVideo`, `backCoverImage` (`appsscript.js:4780-4785`) — replacing a single pipe-joined `imageUrls` blob specifically because, per the code's own comment, "a pipe-joined imageUrls list cannot answer 'is there a back cover'."
- **A real, enforced, four-phase handover proof system.** `owner_pre_handover` / `requester_received` / `requester_pre_return` / `owner_received_return`, each gated to the correct chat status and each with a minimum-evidence rule the UI actually enforces before letting the next stage proceed: 3 photos + 1 video for handover/pre-return, 2 photos + 1 video for the receiving confirmations (`src/App.tsx:5050-5051`, buttons disabled at `5293`, `5372`, `5417` until met).
- **A mutual, symmetric security deposit.** `computeMutualDeposit` (`appsscript.js:16216`) protects *both* sides of a two-way swap, not just the borrower — each party deposits 60% of the value of the book they're holding — a more complete model than the brief's one-directional description.
- **Membership gating is enforced server-side, not just in the UI**, per the Phase 2 fix confirmed present in the current file: `createBook` calls `isApprovedActiveMember` and applies a tiered cap (10 trial / 500 premium) before allowing a listing (`appsscript.js`, `createBook`).
- **Address privacy is deliberately engineered.** Delivery addresses live in their own sheet, never surfaced on a book card, profile or directory, and released only through `getDeliveryAddress`, which the code states enforces "exactly one other person, only while an accepted swap is in flight" (`appsscript.js:15122-15129`).
- **The legal policy documents are unusually honest.** The Refund & Security Deposit Policy explicitly discloses, in-page, that deposits are "not held in escrow" while the team completes an escrow transition, rather than making a promise the product can't keep (`legal/refund-and-security-deposit-policy.md:92-100`). This is good practice and should be preserved, not quietly dropped, when building the missing pieces below.

## 3. Critical Trust Gaps

1. **No way to file a dispute.** `disputeSwapRequest` is fully built server-side (creates a `SwapDisputes` row, flips swap status to `Disputed`, emails the admin) but is never called from `src/App.tsx`. There is no "Report a problem" button anywhere in the swap/chat UI.
2. **No admin dispute console.** `SwapDisputes` has no `resolveDispute`/`closeDispute` action, no evidence-attachment column, and no status beyond the `Open` it's created with. The only way to work a dispute today is to open the raw Google Sheet.
3. **No reputation signal anywhere a user can see it.** Confirmed missing on both the public reader profile and the reader directory.
4. **The courier/handover journey ledger is entirely unreachable by users.** `setSwapRoute`, `logJourneyEvent`, `getSwapJourney`, `saveDeliveryAddress`, `getDeliveryAddress` are dispatched in `doPost`/`doGet` (`appsscript.js:5252-5256`, `2262-2263`) but have **zero** call sites in `src/App.tsx`. This directly contradicts the Exchange & Delivery Policy, which instructs users to "Share the tracking number in the app" (`legal/exchange-and-delivery-policy.md:80`) — that field has no UI to type it into.
5. **Deposits are not actually held by the platform.** The refund/deposit policy itself says so (see §2) — money moves manually between readers or via a UTR reference SwapSutra never touches, and `markRefundIssued` is a single admin-toggled boolean with no calculation of partial vs. full deduction.
6. **`createBookRating` rates the book, not the transaction or the counterparty**, and is not gated to a verified, completed swap (`appsscript.js:7546`) — so it cannot function as a peer-trust signal even if surfaced.
7. **An undisclosed second database.** `swapDeposits`, `validate_and_record_listing` and `price_quote` are served via `supabaseRpc_()` calls to a Supabase/Postgres backend (`appsscript.js:2347-2354`, `16326`, `16423-16424`, `16479-16484`) sitting behind the pricing engine in `pricing/sql/*.sql`. This is an architecture deviation from the project's stated "Google Sheets is the sole database" rule and should be surfaced to the product owner even though fixing it is out of scope for this audit.

## 4. Features We Should Not Build Again

These already exist, are wired end-to-end, and only need finishing, not rebuilding:

- The four-phase condition-proof upload system (`uploadSwapProof` / `SwapProofs`) and its minimum-evidence gating.
- The server-side reference-value pricing engine (ISBN table → genre fallback → authenticity/format/edition adjustment).
- The mutual security-deposit calculator (`computeMutualDeposit`, `getDepositQuote`).
- The courier-tracking-URL builder for 8 Indian couriers (`COURIERS`, `courierTrackingUrl`) — it just needs a UI.
- The append-only journey-event vocabulary (`JOURNEY_EVENTS`, `SENDER_EVENTS`/`RECEIVER_EVENTS` role split) — a sound design for an audit trail, currently unused.
- `disputeSwapRequest`'s backend half (creation + admin email) — it needs a UI button and an admin resolution workflow, not a rewrite.
- Public reader profile / reader directory (`getPublicReaderProfile`, `getReaderDirectory`) — the privacy-safe field allowlist is good; it just needs trust fields added to it.
- The Campus Ambassador/referral backend (`enrollAmbassador`, `getAmbassadorStanding`, `getAmbassadorLeaderboard`, `validateReferralCode`) — built, but the frontend "Apply" button sends readers to an external Google Form instead of this API (`src/App.tsx:6054`).

## 5. Missing Features (genuinely absent, not just unwired)

- Any reader-facing reputation metric (rating, swap count, on-time-return rate, dispute record, badges).
- An admin dispute-resolution workflow (decision, evidence review, deposit outcome, resolution notification).
- Automatic partial/full deposit-deduction calculation tied to a damage classification.
- An objective damage-severity rubric in code (minor/major/missing pages/water damage/etc. exist only as prose in the legal policy, not as a selectable field anywhere in `SwapProofs` or `SwapDisputes`).
- Overdue-return automation beyond the general SLA/liquidity nudge job (no due-date reminder → escalation chain specific to rentals was found).
- A payment/escrow integration of any kind (confirmed: no Razorpay/Stripe/Cashfree code anywhere in `appsscript.js`; all payment is UTR + screenshot + manual admin approval).
- A structured "why was my deposit reduced" ledger entry visible to the user (only a free-text chat message).

## 6. Partially Implemented Features (need completion, not a rebuild)

- **Handover proof** — excellent at the photo-count level, but not tied to the courier journey ledger, so an in-transit book has proof of packing but no proof of transit or delivery.
- **Notifications** — the `Notification`-record system (in-app bell + push) only fires for a handful of events (`swap_accepted`, `swap_declined`, `book_request_response`, a dispute-to-admin email, and SLA nudges — 16 call sites total for `createNotification` across the whole app). Handover, deposit, and return events instead post a chat message via `sendChatMessage`, which does not appear in the Notification Center or trigger push.
- **Deposit quote** — computed correctly server-side, but only one frontend call site (`src/App.tsx:10352`), meaning it likely only surfaces at one point in the swap flow, not consistently wherever a deposit amount is shown.
- **Campus Ambassador** — a real backend growth module exists but the visible "Apply" flow bypasses it entirely via an external form.

## 7. Recommended Trust Architecture (no code)

The building blocks already exist; they need to be connected into one visible spine per transaction:

**Request → Acceptance → Deposit shown & acknowledged → Structured handover proof (existing) → Handover confirmed (existing) → Journey/tracking entry (existing backend, needs UI) → Delivery/receipt confirmed → Possession period → Return proof (existing) → Return received & condition compared → Deposit outcome (full / partial / disputed, with a stated reason) → Deposit released or dispute opened → If disputed: evidence + admin decision + resolution notice → Completion, with the outcome feeding the counterparty's public trust record.**

The critical architectural move is not new backend logic — it's exposing the courier ledger and the dispute system in the UI, and writing every one of those transitions into a single per-swap timeline component the user can actually see (the ledger schema for this, `SwapJourney`, already exists and is unused).

## 8. Reader Reputation System — Recommendation

Show, on the public reader profile and in the reader directory card:

- **Completed transactions count** (useful — a large, low-effort trust signal; sourced from swap status = Completed).
- **On-time return rate** (useful, but only once due-date tracking is real — misleading to show a percentage computed from data that isn't reliably captured today).
- **Member since / response time** (useful, already partly available via `memberSince`).
- **Dispute record** — show sparingly and carefully: a raw dispute *count* is easily gamed by a bad-faith counterparty filing false disputes, and would need an admin-adjudicated-and-upheld filter before it's fair to display. Recommend showing only *resolved-in-reader's-favour* vs *resolved-against* after moderation, never raw filed-count.
- **A star rating of the person**, not the book — `createBookRating` needs a sibling `rateCounterparty` action gated to a verified completed swap, one rating per swap per direction.
- **Trust badges** (e.g. "10 successful swaps", "Verified phone") are useful onboarding signals but should be earned from the same verified data, never self-declared.

What to avoid: a single blended "trust score" number invites gaming and hides which underlying signal changed; showing separate, labelled metrics is more honest and matches the brand's stated "transparent" positioning.

## 9. Pricing / Valuation Audit

The implementation is closer to the brief's intent than most of the rest of the trust model:

- **Original vs. pirated:** `authenticityStatus` field exists and is stored; **NEEDS VALIDATION** — could not confirm from static reading whether an unauthorised/unknown status actually suppresses or discounts the resolved reference price, or is purely informational.
- **Paperback vs. hardcover, edition:** `bookFormat`/`bookEdition` feed `resolveBookPrice`'s tier lookup (`hardcover`/`paperback`/`reprint` columns in `BookPrices`) — implemented.
- **Condition:** a condition field exists on every book (`Very Good`/`Good`/`Fair`/`Poor`) but **NEEDS VALIDATION** — the deposit/valuation call chain reviewed (`computeMutualDeposit` → `resolveBookPrice`) did not show condition as an input to the reference-price calculation; it may currently be display-only rather than reducing the reference value the way the brief describes.
- **Market/median value:** implemented via the ISBN-keyed `BookPrices` sheet with a genre-level fallback (`GenrePriceDefaults`) and a Supabase-backed `price_quote` RPC as a richer alternative source — genuinely more sophisticated than most peer-to-peer marketplaces attempt.
- **Prevention of arbitrary pricing:** implemented and enforced — the server ignores any client-submitted value.

Net: the valuation *engine* is strong; the gap is that a book's declared **condition** may not yet be discounting its reference value, which — if true — would mean two books of identical title/format/edition but very different condition get an identical deposit requirement. Worth a direct, code-level follow-up before relying on this scoring.

## 10. Trust Score (out of 10)

| Dimension | Score | Why |
|---|---|---|
| User trust | 4 | OTP/registration solid; zero visible trust signal about *other* users |
| Book trust | 7 | Structured photo/video proof + real valuation engine, strong |
| Transaction transparency | 4 | Deposit is quoted; no visible end-to-end timeline; journey ledger unused |
| Payment/deposit trust | 3 | No escrow, manual refund toggle, policy is honest about this but the gap is real |
| Dispute handling | 2 | No way to file one from the UI; no admin resolution workflow |
| Reputation | 1 | Confirmed absent everywhere a user can see |
| UX clarity | 4 | Condition-proof flow is well-guided; deposit/refund mechanics are not explained in-product |
| Admin control | 5 | Good visibility into proofs, subscriptions, chats; no dispute or deposit-ledger console |
| **Overall trust readiness** | **4.5** | Strong foundations, disconnected from the user |

## 11. Top 10 Changes, Ordered by Business Impact

1. Build the "Report a problem" button and wire it to `disputeSwapRequest` — the single largest trust hole, and the cheapest to close (the backend already works).
2. Build an admin dispute console: list `SwapDisputes`, attach evidence, record a decision, resolve, and notify both parties.
3. Surface the courier journey ledger in the UI (`setSwapRoute`, `logJourneyEvent`, `getSwapJourney`) so the Exchange & Delivery Policy's promises about in-app tracking become true.
4. Add a per-swap visible timeline component, built on the existing `SwapProofs`/`Chats`/(new) `SwapJourney` data.
5. Add a counterparty rating gated to verified completed swaps, and surface completed-swap count on the public profile/directory.
6. Confirm and, if needed, wire book condition into the reference-value/deposit calculation (Section 9).
7. Replace `markRefundIssued`'s boolean toggle with a structured full/partial-deduction record tied to a stated reason and (once built) the dispute outcome.
8. Extend the Notification system so deposit, handover, dispatch, delivery, due-date and refund events create real notifications/push, not only chat messages.
9. Reconnect the Campus Ambassador "Apply" button to the existing `enrollAmbassador` backend instead of an external form.
10. Resolve or formally document the Supabase dependency behind the pricing engine — either bring it fully into the Sheets architecture per project policy, or make the exception explicit and reviewed.

## 12. Implementation Plan

**Phase 1 — Critical (trust/safety, P0):** dispute filing UI + admin console (#1, #2); wire condition into valuation if confirmed missing (#6); confirm deposit money-flow is described accurately everywhere in-product, matching the legal policy's honesty.

**Phase 2 — Trust strengthening (P1):** journey ledger UI + visible transaction timeline (#3, #4); counterparty rating + reputation surfacing (#5); structured deposit deduction record (#7); notification coverage expansion (#8).

**Phase 3 — Scale (P2/P3):** Campus Ambassador reconnection (#9); Supabase architecture resolution (#10); trust badges; on-time-return-rate once due-date data is reliable.

---

## Detailed Feature Matrix

Status legend: **FULLY** = fully implemented & enforced · **PARTIAL** = incomplete/inconsistent · **UI-ONLY** · **BACKEND-ONLY** · **MISSING** · **NEEDS VALIDATION**

| Area | Feature | Status | Evidence | User Experience | Risk | Priority | Recommended Action |
|---|---|---|---|---|---|---|---|
| A | Registration blocks OTP for unregistered emails | FULLY | `sendOTP`/`verifyOTP` check the Users sheet before issuing/accepting an OTP | Login vs. Sign Up choice shown upfront | Low | P3 | None |
| A | Duplicate sign-up blocked | FULLY | `createSubscription` checks Users+Subscriptions before creating | Clear "already registered" message expected | Low | P3 | None |
| A | Reader rating (of a person) | MISSING | No `rateCounterparty`/reader-rating action anywhere in `appsscript.js`; `createBookRating` rates a book only (`appsscript.js:7546`) | Nothing shown | High — no way to assess a stranger | P0 | Build gated to completed swap |
| A | Successful swap count on profile | MISSING | `publicReaderProfileFromUserRow` returns only `email, name, area, genres, bio, memberSince, isActiveMember, booksListedCount` (`appsscript.js:813-825`) | Not visible | High | P0 | Add `completedSwapsCount` |
| A | Dispute history on profile | MISSING | Same as above; `SwapDisputes` never joined into profile data | Not visible | Medium | P1 | Add after dispute admin workflow exists |
| A | Trust badges | MISSING | No badge schema/logic found | Not visible | Low-Med | P2 | Build after reputation data exists |
| A | Premium vs. verification distinction | PARTIAL | `isApprovedPremiumMember` now drives listing cap tier (per Phase-2 fix); no separate "verified" concept beyond membership | User sees membership status only | Low | P2 | Consider a distinct verification flag |
| B | Book condition photo/video (listing) | FULLY | `frontCoverImage`, `internalBookImage`, `internalBookVideo`, `backCoverImage` dedicated columns (`appsscript.js:4780-4785`) | Structured 4-slot upload | Low | P3 | None |
| B | Authenticity (original vs. pirated) declaration | FULLY (capture) / NEEDS VALIDATION (enforcement) | `authenticityStatus` column exists (`appsscript.js:4770`) | Declared at listing | Medium | P1 | Confirm it affects price/visibility |
| B | Edition / format in pricing | FULLY | `bookFormat`/`bookEdition` feed `resolveBookPrice` tier lookup | Listing form captures both | Low | P3 | None |
| B | Condition affecting reference value | NEEDS VALIDATION | Condition field exists; not observed as an input to `resolveBookPrice`/`computeMutualDeposit` in the code paths reviewed | Deposit may not reflect visible wear | Medium | P1 | Verify and wire if absent |
| B | Prevention of arbitrary user pricing | FULLY | `createBook`/`updateUserBook` ignore client `mrp`; server resolves it (`appsscript.js:15724-15745`) | User sees a computed value, cannot type one | Low | P3 | None |
| C | Create swap request | FULLY | `createSwapRequest`, frontend-wired | Works | Low | P3 | None |
| C | Accept/Decline/Cancel swap | FULLY (per Phase-2 fix, NEEDS VALIDATION in production) | `resolveSwapRequestParties` shim now reads both column layouts (`appsscript.js`, comment at `resolveSwapRequestParties`) | Should work for real owners now | Medium until confirmed live | P1 | Confirm in the live deployment |
| C | Chat between requester/owner | FULLY | `sendChatMessage`/`Chats` sheet, admin included by design for safety (`appsscript.js:7466`) | Works | Low | P3 | None |
| C | Condition/photo proof at handover | FULLY | `uploadSwapProof`, 4-phase model, enforced minimums (`src/App.tsx:5050-5051`) | Clear, gated upload UI | Low | P3 | None |
| C | Handover confirmation & stage tracking | FULLY | `markHandedOver`; stages `Active → Handed Over → Returned → Completed → Archived` | Confirmed via button, posts a chat system message | Low | P3 | Also emit a Notification, not just a chat message |
| C | Dispute filing (user-facing) | MISSING | `disputeSwapRequest` has zero call sites in `src/App.tsx` | No button exists | **Critical** | **P0** | Build UI |
| C | Peer/transaction rating | PARTIAL | Rates the book, ungated to a completed swap (`appsscript.js:7546`) | Rating widget exists but doesn't build reputation | Medium | P1 | Add counterparty rating |
| D | Security deposit calculation | FULLY | `computeMutualDeposit`, `DEPOSIT_RATE = 0.6` (`appsscript.js:16202-16251`) | Quoted once in swap modal (`src/App.tsx:10352`) | Low | P2 | Surface consistently, explain in-product |
| D | Deposit held/escrowed | MISSING | No payment gateway/escrow code found anywhere; policy confirms manual arrangement (`legal/refund-and-security-deposit-policy.md:92-100`) | Money moves outside the platform | High | P0 (disclosure) / P2 (build) | Keep policy honest until escrow exists; prioritise per business plan |
| D | Deposit refund | PARTIAL | `markRefundIssued` is a manual admin boolean, no partial/full deduction logic (`appsscript.js`, `markRefundIssued`) | Opaque to user beyond a chat message | Medium | P1 | Structured deduction record |
| E | Handover photo/video, timestamp, sender/receiver confirm | FULLY | `SwapProofs` + `markHandedOver`, both directions gated by role | Clear | Low | P3 | None |
| E | In-person vs. courier selection | FULLY | `method !== 'in_person' && method !== 'courier'` validation (`appsscript.js:15389`) | Exists in `setSwapRoute` — but see below | — | — | See journey ledger UI gap |
| E | Courier name, AWB, tracking link | BACKEND-ONLY | `COURIERS`, `courierTrackingUrl`, `JOURNEY_HEADERS` fully built (`appsscript.js:15132-15193`); zero frontend call sites for `setSwapRoute`/`logJourneyEvent`/`getSwapJourney` | Not visible to any user | **High** — policy promises this, product doesn't deliver it | **P0** | Build UI |
| E | Delivery/receiving confirmation | PARTIAL | `received`/`delivered` are valid `JOURNEY_EVENTS` but the ledger they belong to is unreachable; the *proof-photo* receiving confirmation (`requester_received` phase) works independently | Confusing — two different "received" concepts, one works, one doesn't | Medium | P1 | Merge or clearly separate in UI |
| F | Visible per-swap timeline | MISSING | No timeline component found assembling `SwapProofs` + `Chats` status + `SwapJourney` into one view | User must infer status from chat scroll | High | P0 | Build |
| G | Deposit calculation/association/status | FULLY (calc) / PARTIAL (status) | Calculated and stored on the swap row; status only `Pending`/implicit, no explicit lifecycle enum found beyond `ownerDepositStatus: 'Pending'/'N/A'` | Minimal status visibility | Medium | P1 | Add explicit deposit state machine |
| G | Partial/full deduction, audit trail | MISSING | No deduction-amount field or reason-code column found on `Chats`/`SwapRequests` for deposits | Deduction reasons live only in free-text chat | Medium | P1 | Structured record |
| H | Objective damage-severity rubric in code | MISSING | Damage categories exist only as prose in `legal/exchange-and-delivery-policy.md:102-108`, not as a field in `SwapProofs`/`SwapDisputes` | Subjective, chat-argued outcomes | Medium | P1 | Encode the rubric as selectable fields |
| I | Dispute creation | BACKEND-ONLY | `disputeSwapRequest` works, unreachable from UI | See C above | Critical | P0 | Build UI |
| I | Evidence submission on a dispute | MISSING | `SwapDisputes` headers are `id, swapId, reporterEmail, reason, details, status, createdAt` — no media/evidence column (`appsscript.js:133`) | N/A | High | P0 | Add evidence linkage |
| I | Admin review/decision/resolution | MISSING | No `resolveDispute` action or status transition beyond `Open` found | N/A | High | P0 | Build admin workflow |
| J | Notification coverage of trust events | PARTIAL | Only 16 `createNotification` call sites total app-wide; deposit/handover/dispatch/delivery/due-date/return/refund mostly rely on chat system messages instead | User must be reading the chat to notice | Medium | P1 | Extend Notification system |
| K | Payment transparency (what's refundable, fee vs. deposit) | PARTIAL | Legal docs are clear and separate the two (Part A vs B); in-product explanation is thinner — deposit quote shown without a linked explanation of the refund rules | Reasonably clear if the user reads the policy page; not clear in the swap flow itself | Medium | P1 | Link/quote the policy at the point of deposit |
| L | UX trust: courier promise vs. reality | Gap identified | Policy tells users to "share the tracking number in the app" (`legal/exchange-and-delivery-policy.md:80`); no such field exists | A user following the policy's own instructions will find nothing to fill in | High | P0 | Build the UI or amend the copy immediately |
| M | Duplicate/fake accounts | NEEDS VALIDATION | OTP + email uniqueness checked; no device/phone-fingerprint dedupe logic observed | Could not confirm from static reading | Medium | P2 | Targeted follow-up |
| N | Admin: review proofs, subscriptions, chats | FULLY | `getSwapProofs`, `getArchivedChatsForAdmin`, `manageMembershipApproval`, all admin-guarded | Reasonable admin visibility | Low | P2 | Add dispute/deposit views (see #2) |
| N | Admin: dispute/deposit console | MISSING | See I | N/A | High | P0 | Build |
| O | Audit trail (who/what/when/prev-new/evidence) | PARTIAL | `SwapProofs` and the (unused) `SwapJourney` are well-designed append-only logs with actor+timestamp; most other sheets overwrite a single `status` column with no prior-value history | Admin cannot always reconstruct "what changed and when" outside proofs/journey | Medium | P1 | Extend the journey-ledger pattern to disputes/deposits |

---

*This report reflects the codebase as staged and read on 2026-09-03. `src/App-1.tsx` and `appsscript-1.js` appear to be earlier backup copies of the same files and were not separately audited; if they are still deployed anywhere, that should be confirmed before acting on this report.*
