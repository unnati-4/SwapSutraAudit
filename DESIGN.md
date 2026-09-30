# DESIGN.md — SwapSutra

## Product

SwapSutra is a premium, reader-first, hyperlocal book-sharing community in India.
Neighbours lend and swap physical books with each other, protected by a refundable
security fee held in escrow and a 21-day borrow period.

It must feel like a **reading space**, not a marketplace, a SaaS dashboard or a
social feed. The emotional register is: literary, warm, spacious, trustworthy,
community-owned. Calm over loud. Craft over conversion.

Primary platform for this design: **the website on phone browsers** (about
360–430px wide, portrait), scaling up to tablet and desktop.

---

## Design system

Design system version 4.0, internally named the **"dusty rose feather"
cozy-reader palette**. Every colour decision lives in a token. Nothing is
hard-coded. There is one light look. There is no dark mode.

### Typography

| Role | Family | Notes |
|---|---|---|
| Headings, display, book titles | **Cormorant Garamond** (fallback Playfair Display), serif | Light-to-semibold weights 300–700. This serif carries the literary feeling — use it generously and at large sizes. |
| Body, UI, labels, buttons | **Plus Jakarta Sans** (fallback Inter), sans-serif | Weights 300–800. |

Italic Cormorant (300–500) is available and appropriate for pull-quotes and
book epigraphs.

### Colour tokens

```
Page background        --bg-page            #F9F6F0   Soft Cream
Page background alt    --bg-page-alt        #F2EBE1
Card surface           --bg-surface         #FFFFFF   Clean White
Inset surface          --bg-surface-inset   #F2EBE1
Inverted panel         --bg-inverse         #1E1B18   (dark footer / hero strip on a light page)

Text primary           --text-primary       #4A3B32   Deep Espresso Brown   9.9:1
Text secondary         --text-secondary     #4A3B32   (same ink as primary, by design)
Text muted             --text-muted         #7C6E65   Warm Taupe            4.6:1
Text accent            --text-accent        #8E4A59   Dusty Mauve           6.0:1

Border default         --border-default     #E5DDD3
Border strong          --border-strong      #D6C9BC
Border subtle          --border-subtle      rgba(74,59,50,0.10)

Primary button         bg #8E4A59  fg #FFFFFF   hover #7A3E4B    6.4:1
Outline button         border #8E4A59  fg #8E4A59  hover fill #8E4A59 / #FFFFFF
Input                  bg #FFFFFF  fg #4A3B32  border #D6C9BC  placeholder #7C6E65
Focus ring             rgba(142,74,89,0.20)

Shadow soft            0 4px 20px rgba(74,59,50,0.06)
Shadow card            0 8px 32px rgba(74,59,50,0.08)
Shadow modal           0 24px 70px rgba(74,59,50,0.14)
```

### Static brand colours

```
brand-offwhite   #F9F6F0     brand-beige       #F2EBE1
brand-brown      #4A3B32     brand-softbrown   #7C6E65
brand-gold       #8E4A59     brand-gold-muted  #A85D6D
brand-border     #E5DDD3
```

### Shape and space

- Corner radii ladder: `6px` chips and small controls · `12–14px` inputs and
  tight cards · `16–22px` content cards · `24–32px` sheets, modals and hero
  panels · `999px` pills, avatars and status chips.
- Cards are white on the cream page, separated
  by a 1px token border **and** a soft shadow — never by shadow alone.
- Spacing is generous. Long-form reading surfaces get more vertical room than a
  typical app. Do not compress to fit more above the fold.
- Book covers use a `2/3` aspect ratio with a `14px` radius.

### Accessibility

WCAG AA is built into the palette, not patched on. Body text ≥ 4.5:1, large and
UI elements ≥ 3:1, in **both** modes. Every ratio above is measured. Do not
introduce colours outside these tokens, and never place `--text-muted` on
`--bg-surface-inset` without rechecking.

---

## Voice and content

- Book-cover imagery is the main visual. Illustration is warm and hand-drawn,
  never corporate flat-vector.
- Indian context throughout: Indian book titles and authors, Indian names,
  Indian cities and neighbourhoods, `₹` amounts.
- Copy is plain, warm and specific. "Returns in 9 days", not "Status: active".
- No gamification confetti, no vanity metrics, no engagement-bait. Streaks and
  reading stats are quiet and personal.

---

## Navigation

Bottom tab bar with five tabs: **Home · Discover · Swaps · Community · Profile**.
Detail and form screens use a sticky bottom action bar. Primary actions sit in
the thumb zone. Filters, pickers and confirmations are bottom sheets, not
centre modals.

---

## The thing the design must get right: the swap lifecycle

Every swap moves through a fixed sequence, and the UI's most important job is
making the current state, the next action, and what is still locked legible at a
glance:

```
A requests → B accepts → security fee shown → correct payer sees the QR →
payment submitted → admin verifies → chat unlocks → handover evidence →
both confirm → 21-day reading period → return → return evidence →
both confirm → fee released / deducted / disputed → completed → rating
```

Requirements this places on the design system:

- A **stepper** pattern with three visual states: done (ticked, muted), current
  (expanded card with the action), and locked (greyed with a small padlock).
- **Status chips** in a consistent set: neutral, awaiting, action-needed (amber),
  success (green-leaning but warm), disputed (accent rose).
- **Dual-confirmation** pattern: two named rows with tick / clock states.
- **Photo-evidence** pattern: capture frame, thumbnail strip, condition checklist.
- **Locked-feature** pattern: blurred content with a centred lock badge and a
  one-line reason — used for chat before payment, and for premium-only features.

## Membership

Two tiers: **Community** (free) and **Verified Premium Reader**. Premium-only
features are never hidden — they are shown in a locked state with a clear
benefit and an upgrade path. Free users must never see premium affordances as
available.

## Trust and safety

Verification badges, book-condition labels, photo evidence, dual confirmations,
security-fee status, disputes and ratings are load-bearing UI, not decoration.
They should be visible wherever a user is deciding whether to trust someone.
