# SwapSutra Daily Push Strategy (27 Sep 2026, updated 28 Sep: English, festive calendar, Gemini, on by default)

**Goal:** everyone who opens SwapSutra in a browser, or has the app installed, gets 3–4 short, specific pushes a day (the way Swiggy and GIVA do). They should pull people back to **list a book** or **open the shelf**.

## 1. Who gets them

| Audience | How they join | What they get |
|---|---|---|
| **Visitors (not signed in)** | Automatic: the browser's own "Allow notifications?" box opens on their first tap | They are saved as a guest device and get the generic, data-driven copy. |
| **Members** | Same | Copy uses their name, pincode, shelf and gaps. |
| **Visitor who signs in later** | Automatic | The guest device becomes theirs. |

**On by default, no switch in the app (28 Sep).**

- There is no settings screen, no on/off toggle and no "Enable push" button.
- A reader who wants notifications off turns them off in their browser or phone settings. The push service then retires that device.
- Browsers require the person's own "Allow"; no website can turn notifications on without it, and the box only opens after a tap. So we open it on the first tap, at most once a day, until they decide.
- A "Block" is final: the browser will not let us ask again.

## 2. The four daily slots (IST)

| Time | Theme | The hook (built from real data) | Opens |
|---|---|---|---|
| **9:00** | ☀️ Fresh on the shelf | A new book near your pincode, a festival greeting, the number of new books today, or today's pick | The book / Library |
| **13:00** | 📚 List a book (the conversion slot) | One of: a missing back-cover photo on your listing; a festival nudge (*"🪔 Diwali cleaning has begun: found old books? List them in 30 seconds"*); *"2 readers are looking for 'X'"* (Wanted shelf); a first-listing nudge; a nudge to add one more book | Listing form / Profile / Wanted |
| **18:00** | ☕ Community | An upcoming meetup ("tomorrow"/"on Sunday"), *"12 conversations in the Café today"*, or a conversation starter | Events / Café |
| **21:00** | 🌙 Tonight's pick | A festival-night wish, a live book (never your own), or *"How many pages did you read today?"* for the tracker streak | Book / Tracker |

All copy is in **English**.

### Indian festive calendar
The calendar is built into the code (Sep 2026 – Dec 2027) and includes Navratri, Dussehra, Karwa Chauth, Dhanteras, Diwali, Bhai Dooj, Children's Day, Chhath, Gurpurab, Christmas, New Year, Lohri, Sankranti/Pongal, Republic Day, Vasant Panchami, Shivaratri, Eid, Holi, Ugadi, Baisakhi, Ram Navami, World Book Day, National Reading Day, Independence Day, Rakhi, Ganesh Chaturthi, Teachers' Day and Onam.

- **Before a festival** ("coming up"), the lunch push uses a listing hook: Diwali cleaning → list old books; gifting (Bhai Dooj, Rakhi, Christmas) → gift a book; Navratri → 9 nights, 9 stories.
- **On the day**, the morning and night pushes carry the wish.
- **Moon-dated festivals (Eid)** are only greeted on the day, never counted down.

### Gemini writes the lines
- Once a day, Gemini (using the same `GEMINI_API_KEY` Quill uses, on Vercel) writes the four slot lines in English for that day's festival and numbers.
- Readers' names and emails are never sent to Gemini; `{name}` is filled in on our side.
- Every line is checked: length, no links, no invented offers, a valid target page.
- If Gemini is down or its answer fails the checks, the built-in lines are used, so a push always goes out, **even with no books listed**.
- Admin can switch Gemini off, or "Rewrite today with Gemini".

Rules the copy follows:

- A reader never sees their own book or their own Wanted request.
- Variants rotate by reader and by day, so the same line does not repeat daily.
- Every slot has a fallback line, so a slot still sends on a day with no new data.

## 3. Guardrails

- **Maximum 4 per day.** Each slot sends once. The trigger is idempotent, so if it fires twice in the same hour it does not send twice.
- **Daytime only.** Admin-chosen hours must fall between 8:00 and 22:00 IST; hours outside that are rejected.
- **Emails and the in-app bell are untouched.** These are push only.
- **Dead phones are cleaned up.** When the push service returns 410, that device's row is retired.
- **Pause.** One button in Admin.

## 4. Measuring it

Admin → Dashboard → **Daily book updates** shows:

- members and visitors reached, devices, and switched-off devices;
- today's 4 pushes as a member and as a visitor would see them;
- sent and taps per slot for the last 7 days;
- a "Send me this now" test button, a pause button, and an hours editor.

A tap is counted through `?ss_push=<slot>`. Compare this with the Listing funnel on the same dashboard: form opens after the 13:00 push are the number that matters.

**Suggested tests for weeks 1–2:**

- If lunch taps are low, try 12:30 or 14:00.
- If many devices get retired in a week (people blocking in the browser), drop to 3 slots (9, 13, 20).

## 5. Go-live checklist

1. Deploy a **new Apps Script version** (new code).
2. In the Apps Script editor, run **`installGrowthTriggers`** once. It adds `runDailyEngagementPush` (hourly) and keeps the other four triggers.
3. Confirm these are already set; they are the same ones the badge and @mention pushes use (plus `GEMINI_API_KEY`, already there for Quill; optional `GEMINI_PUSH_MODEL` to pick a model):
   - Script Properties `PUSH_RELAY_URL` and `PUSH_RELAY_SECRET`
   - Vercel `PUSH_RELAY_SECRET`, `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`
4. Deploy the website (Vercel).
5. Admin → Dashboard → Daily book updates → **Send me this now**, to check it on your phone.

**iPhone note (30 Sep):** SwapSutra is no longer an installable app (PWA). Apple allows web push only for sites added to the Home Screen, so iPhone users no longer get pop-ups; Android and desktop browsers still do.
