# SwapSutra — Legal Pack

Drafted 22 August 2026. Six user-facing documents plus two working files.

**Nothing here is publishable as-is.** Fill in `PLACEHOLDERS.md` first — nine values,
one find-and-replace.

---

## The documents

| File | Route | Status before this pack |
|---|---|---|
| `terms-of-use.md` | `/terms` | **Did not exist** |
| `privacy-policy.md` | `/privacy` | Existed, but was not a privacy notice |
| `exchange-and-delivery-policy.md` | `/exchange-policy` | Buried inside the privacy page |
| `refund-and-security-deposit-policy.md` | `/refund-policy` | **Did not exist** — despite users ticking a box saying they'd read it |
| `community-guidelines.md` | `/community-guidelines` | **Did not exist** |
| `grievance-redressal.md` | `/grievance` | **Did not exist** — and is legally required |

## Working files

| File | What it's for |
|---|---|
| `PLACEHOLDERS.md` | The nine values to fill in, plus two things to remove from the code |
| `IMPLEMENTATION-BRIEF.md` | Exact code changes to wire these in — specified, not applied |

---

## Read this before publishing

**The Refund & Security Deposit Policy describes a peer-to-peer deposit model** —
the borrower pays the owner directly and the owner refunds the owner. That is the
recommended fix for the RBI payment-aggregator exposure, but **it is not what your
code does today**. Today, deposits route to a personal UPI address and an admin
marks them refunded.

**Do not publish that document until the code matches it.** A refund policy that
describes something other than what actually happens is worse than no policy —
it's a written misrepresentation. Change 1 in the implementation brief comes first.

Everything else can be published as soon as the placeholders are filled.

---

## What these are and are not

Drafted to be usable at your stage — a live consumer platform, pre-incorporation,
small user base. They're specific to Indian law and to what your codebase actually
does, not generic templates.

They are **not a substitute for review by an advocate**. Get that review in P1,
before revenue scales. Point the reviewer at:

- **Terms of Use clauses 14, 15 and 16** — disclaimers, dispute mediation, and the
  liability cap. That's where a template is always weakest and where your exposure
  is most concentrated.
- **The whole Refund & Security Deposit Policy**, once you've decided how deposits
  will work.
- **Privacy Policy §4 and §6** — consent basis and the Gemini disclosure.

I am not a lawyer. This is a well-researched starting point that puts you
dramatically closer to compliant than you are today, and a clear brief for the
professional who signs off on it.

---

## Priority order

1. 🔴 **Grievance Redressal** — legally required, missing, free, takes an afternoon
2. 🔴 **Terms of Use** — without it you have no intermediary safe harbour
3. 🔴 **Refund & Security Deposit Policy** — *after* the deposit code change
4. 🟠 **Privacy Policy** — the current one doesn't meet DPDP requirements
5. 🟠 **Community Guidelines** — required by Rule 3(1)(a), and genuinely useful
6. 🟡 **Exchange & Delivery Policy** — mostly exists already; needs its own home
