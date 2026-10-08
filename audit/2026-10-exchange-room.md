# Exchange Room, listing unlock for 3 months, Support QR — 8 Oct 2026

## What changed
- **One exchange room.** The chat window no longer has Chat / Condition / Stages / Timeline tabs. A steps panel sits above the chat (it can be hidden) and shows the 16 steps every exchange goes through — sale, rent, lend and swap. Every step also posts a line in the chat.
  1 Requested · 2 Accepted · 3 Condition video (before payment, 48 h) · 4 Payment or close (48 h after the video, else it closes automatically) · 5 Packaging video · 6 Meeting point or courier · 7 Place, or courier + tracking ID · 8 Handover video · 9 Sender marks delivered, receiver records the unboxing video and marks received (a buyer also ticks "happy" → seller payout) · 10 21 days · 11 7-days-left reminder in the chat · 12 Borrower may ask +7 (once, in 3 days), owner agrees; then return route · 13 Return packaging, condition and handover videos · 14 Returned + received · 15 Rate each other and SwapSutra (Google review offered) · 16 Room closes — hidden from both readers, kept in the sheets.
  Sale and permanent swap skip 10–14.
- The chat opens at acceptance (not after payment). The PII filter still blocks phone numbers and addresses; addresses are shown only on a courier route after payment.
- Deposits are queued for refund automatically when the exchange completes (Admin → Payouts, leg `refund:<role>`). Closing a request before the exchange queues a full refund of anything paid.
- Extensions: **+7 only, once**, asked by the reader who has the book in the 3 days after the 7-days-left reminder; the owner agrees.
- Listing more than 20 books: **₹20 for 3 months** (coupon still has no expiry). The popup appears once, after the 20th listing; afterwards the button is on Profile → Reading Space.
- A **Support SwapSutra** heart in the header shows the UPI QR with no amount.

## Deploy
1. Upload the changed files to GitHub (Vercel rebuilds the site).
2. Paste the new `appsscript.js` into Apps Script → Deploy → Manage deployments → Edit → **New version**.
3. Nothing new to schedule: the room's 48-hour clocks, reminders, refunds and auto-close run inside the existing hourly `runReturnDeadlines` trigger. (If it was never installed, run `installReturnDeadlineTrigger` once.)
4. New sheets create themselves: `PlatformFeedback` (SwapSutra ratings). Existing sheets gain no columns except `Chats.archivedAt/archivedReason/archivedBy` if missing.

Exchanges accepted before this deploy get their 48 hours from 9 Oct 2026, 00:00 IST.
