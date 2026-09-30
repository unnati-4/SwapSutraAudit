# Fill these in before publishing

**Nine values, one place.** Open `src/components/LegalPages.tsx` and edit the
`LEGAL_DETAILS` object at the top — every placeholder across all six pages
resolves from it. Nothing else needs touching.

The pages render with `[SQUARE BRACKETS]` visible until you do this. That is
deliberate: a visible gap is far better than a plausible-looking wrong value.

## The nine

| # | Placeholder | What it needs | My suggestion |
|---|---|---|---|
| 1 | `[DD Month 2026]` | The date you publish | Whatever day you actually ship it |
| 2 | `[ENTITY OR PROPRIETOR NAME]` | Who legally operates SwapSutra | Your full legal name today; the company name after P1 incorporation |
| 3 | `[GRIEVANCE OFFICER NAME]` | A real person's name | You. It is allowed, it is normal at your stage, and the role is required to be filled |
| 4 | `[GRIEVANCE EMAIL]` | A monitored address | `grievance@swapsutra.in` — worth setting up so it survives you handing the role over |
| 5 | `[CORRESPONDENCE ADDRESS]` | A postal address | See the warning below ⚠️ |
| 6 | `[CITY]` | Jurisdiction for disputes | The city you actually live in — that is where you could realistically defend a claim |
| 7 | `[EMAIL PROVIDER]` | Who sends your OTP and notification emails | Currently Google/Gmail via Apps Script, unless you have changed it |
| 8 | `[REGION]` | Where that provider processes data | "Global" for Google |
| 9 | Route paths | `/terms`, `/privacy`, `/exchange-policy`, `/refund-policy`, `/community-guidelines`, `/grievance` | Match whatever you name the tabs in `App.tsx` |

---

## ⚠️ About the address

The IT Rules require a contact address for the Grievance Officer. There is no way around publishing one.

**Do not publish your home address.** Once it is on a public website it is scraped, permanent, and attached to your name — on a platform whose whole premise is that strangers meet in person.

Better options, roughly in order:

1. **A registered office service** — ₹1,000–₹3,000/year, gives you a usable commercial address, and you will want one for incorporation in P1 anyway. Cleanest answer.
2. **A co-working space address**, if you use one.
3. **A P.O. Box** or India Post box number.
4. **A family business or professional address**, with permission.

If none of those is possible right now, publish the city and state with an email address, ship the page today, and replace it with a proper address within the month. An incomplete address is a fixable gap. **No grievance page at all is the actual problem.**

---

## ⚠️ Two things to remove from the code first

Neither is a placeholder — both are live data that should not be public.

**1. The UPI string** in `src/App.tsx` — ✅ **partly done.** Your legal name is
out (`pn=SwapSutra` now, at all four sites). But the VPA `7534845373-3@ybl`
still contains your personal phone number, and a collection QR is inherently
visible to whoever pays it. Only a **business account** fixes this properly —
another reason incorporation is now urgent.

**2. Rotate the credentials** your own `.env.example` says were once committed — `JWT_SECRET` and `APPS_SCRIPT_API_KEY` — if that has not already been done, and confirm the repository is private.

---

## Before you hit publish

- [ ] All nine values replaced, no `[` left anywhere — `grep -rn "\[" legal/` should come back clean of placeholders
- [ ] Dates are the real publication date
- [ ] Route paths match your actual tabs
- [ ] Every cross-link between documents resolves
- [ ] The consent checkboxes point at the right documents, not all at `/privacy`
- [ ] The Grievance Officer email exists and someone is reading it
- [ ] You have read the Refund Policy yourself and it describes **what actually happens** — if deposits still route to a personal UPI, it does not, and you must not publish it yet
