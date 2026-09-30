# Implementation brief — status

**Updated 22 August 2026, after applying the changes.**

Everything below marked ✅ is **already in your working folder**. Nothing is
deployed — review, run it locally, then push when you're happy.

---

## ✅ Done — in your folder now

### 1. Six legal pages, live at real URLs

New file: **`src/components/LegalPages.tsx`** (~50KB).

Kept out of `App.tsx` deliberately — that file is already ~1MB and six
long-form documents inside it would make it materially harder to work in. The
pages reuse the exact markup and Tailwind classes of your old inline Privacy
page, so they render as though they were always there.

| Page | Route |
|---|---|
| Privacy Policy (rewritten, DPDP-shaped) | `/privacy` |
| Terms of Use | `/terms` |
| Exchange & Delivery | `/exchange-policy` |
| Refunds & Security Deposits | `/refund-policy` |
| Community Guidelines | `/community-guidelines` |
| Grievance Redressal | `/grievance` |

All six are in `GATE_ALLOWED_TABS`, so a logged-out visitor can read them.
That isn't optional: terms a visitor can't read before signing up aren't terms
they've agreed to, and Rule 3(2) needs the grievance contact publicly reachable.

### 2. A bug found along the way

`tabToRoute` mapped `privacy` to **`/rituals`**, and `/privacy` had no entry in
the routes table at all — so your Privacy Policy had **no URL of its own** and
couldn't be linked or cited. Fixed.

### 3. The consent checkboxes ✅

Both now point at the documents they name, instead of sending all links to
`/privacy`. The phantom **"Refund/Security Fee Policy"** label is gone,
replaced by a link to a page that actually exists. Terms of Use added to both.

### 4. Footer ✅

All six legal pages now link from the footer on every page, via `navigateTo`
so the URL updates and the pages are genuinely linkable.

### 5. Your legal name out of the public bundle ✅

`pn=Unnati%20Goyal` → `pn=SwapSutra` at all four UPI sites.

> ⚠️ **Partial fix.** The VPA `7534845373-3@ybl` still contains your personal
> phone number, and a collection QR is inherently visible to whoever pays it.
> That can only be fully fixed by collecting into a **business** account. It is
> another reason incorporation is now urgent rather than merely advisable.

### 6. Age gate — new signups ✅

**Frontend** (`src/App.tsx`): a required Date of Birth field on the sign-up
form, with a `max` attribute set 18 years back and a client-side check.

**Backend** (`appsscript.js`): new `validateAdultDateOfBirth()`, called from
`createSubscription()` **before any sheet write**, so an underage submission
never creates a row. It rejects blank, invalid, future and implausible dates.

Skipped for a genuine in-place upgrade — that account already exists, and
re-asking would lock out every member who registered before the gate existed.

**Evidence:** a new `ageConfirmedAdult` column on the Subscriptions sheet.
`ensureSheetHeaders()` appends missing headers automatically, so it
self-migrates on the next write — no manual sheet surgery.

> **Why a boolean and not the date of birth?** DPDP data-minimisation. The
> purpose is "evidence this account was age-gated". A stored DOB is more
> sensitive personal data and gives you no more protection than the
> declaration does.

---

## 🔴 Not done — needs you

### The deposit flow

You chose to keep holding deposits centrally, for a sound product reason:
a neutral party holding the money is what makes both sides feel safe.

**The legitimate version of that needs three things, in order:**

1. **Incorporate** — Pvt Ltd or OPC. This is now the blocking item.
2. **Current account** in the entity's name.
3. **Razorpay Route** or **Cashfree Easy Split** — marketplace escrow products
   built for exactly this. Platform collects, funds sit in regulated escrow,
   platform releases to the right party on a trigger.

Until then, the Refund page carries an **honest interim notice** telling readers
the deposit is not held in escrow. That notice is doing real work — it's the
difference between a disclosed limitation and a misrepresentation. **Remove it
the moment escrow is live, and not before.**

### Fill in the placeholders

`src/components/LegalPages.tsx` → the `LEGAL_DETAILS` object at the top. Every
placeholder across all six pages resolves there — one object, nine values.
See `PLACEHOLDERS.md`.

**The pages will render with `[SQUARE BRACKETS]` visible until you do this.**
That's deliberate — it's much better than shipping a plausible-looking wrong
value.

---

## Before you deploy

- [ ] `npm run lint` (`tsc --noEmit`) — I couldn't run it; the npm registry is
      blocked from my sandbox. **Please run it.** I verified structurally
      instead: bracket and JSX-tag balance, every route and render block wired,
      the gate ordering, and `node --check` on `appsscript.js`.
- [ ] `npm run dev` and click through all six pages, in light **and** dark mode
- [ ] Check them **logged out** — that's the case that matters most
- [ ] Fill in `LEGAL_DETAILS`
- [ ] Push `appsscript.js` to your Apps Script project and redeploy the Web App
- [ ] Test a signup with a DOB under 18 → should be refused **by the backend**,
      not just the form. Try calling the endpoint directly if you can.
- [ ] Test a signup with a valid DOB → should work as before
- [ ] Confirm an existing member can still upgrade without being asked for a DOB

---

## Still open, from the roadmap

| | Item | Phase |
|---|---|---|
| 🔴 | Incorporate — now blocking the deposit fix too | P1 |
| 🔴 | Reconcile every deposit currently outstanding | P0 |
| 🟠 | Rotate `JWT_SECRET` and `APPS_SCRIPT_API_KEY` if not already done | P0 |
| 🟠 | File the trademark **before** incorporating (₹4,500 vs ₹9,000 per class) | P1 |
| 🟠 | Advocate review of Terms clauses 14, 15, 16 | P1 |
| 🟡 | Written CA opinion on your GST position | P2 |
| 🟡 | Campus Ambassador agreements | P2 |
