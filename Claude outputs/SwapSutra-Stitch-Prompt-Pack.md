# SwapSutra Mobile App — Stitch AI Prompt Pack

**How to use:** Paste **Prompt 0** first (Stitch's theme/design-system prompt). Then generate each of the
16 screens with its own prompt, one at a time, in the order given. Stitch keeps the theme across
generations in the same project.

**Mode:** Use Stitch's *Experimental* mode for screens 5, 9, 11, 13 (complex/dense). *Standard* is fine
for the rest and is much faster.

---

## PROMPT 0 — Design system / theme (paste this FIRST)

```
Design system for a mobile app called SwapSutra — a warm, literary, reader-first book-sharing
community for India. The feel is a quiet independent bookshop, not a SaaS dashboard: calm,
premium, generous whitespace, paper-like warmth. Absolutely no neon, no gradients, no tech-blue,
no generic startup look.

COLOR — Day mode (default):
- Page background #F9F6F0 (soft cream), alternate section background #F2EBE1
- Cards / surfaces #FFFFFF, inset surfaces #F2EBE1
- Primary text #4A3B32 (deep espresso brown), muted text #7C6E65 (warm taupe)
- Brand accent #8E4A59 (dusty mauve) — primary buttons, active tabs, links
- Primary button: #8E4A59 background, #FFFFFF text, hover #7A3E4B
- Outline button: 1px #8E4A59 border, #8E4A59 text, transparent fill
- Borders #E5DDD3 (default), #D6C9BC (strong)
- Inputs: white fill, #D6C9BC border, #7C6E65 placeholder, focus ring rgba(142,74,89,0.2)
- Dark inverted panels (footer/hero strips) #1E1B18

COLOR — Night mode (must be designed too):
- Page #1E1B18, cards #2A2522, raised #332C28
- Text #F0E9E2, muted #A39B94, accent #D08C9D (soft dusty rose)
- Primary button #D08C9D background with #1E1B18 text
- Borders rgba(208,140,157,0.22)

TYPE:
- Headings: "Cormorant Garamond" serif, weight 500, generous line height, slightly tight tracking
- Body / UI / buttons: "Plus Jakarta Sans", weights 400–600
- Small labels: uppercase, 10–11px, letter-spacing 0.12em, weight 700, muted color

SHAPE & DEPTH:
- Cards: 16–24px radius, very soft shadow 0 8px 32px rgba(74,59,50,0.08), 1px warm border
- Buttons and chips: fully rounded (pill) for filters/tags, 12–16px radius for primary CTAs
- Modals: bottom sheets on mobile, 24px top radius

APP SHELL (every screen):
- Top bar 56px: left = screen title in Cormorant serif, right = notification bell with dot + avatar
- Bottom tab bar 5 items, 48px tall, icon + 10px label, active item in accent color:
  Home · Library · Reading Room · Events · Profile
- Floating helper button bottom-left: a small quill/feather icon ("Quill", the in-app guide)

ICONS: thin-stroke line icons, 1.5px weight, rounded caps. Book, feather, cup, circle-of-people motifs.
IMAGERY: book covers as portrait 2:3 cards with soft shadow. Real-feeling Indian reader names
(Ananya, Kabir, Meera, Rohan, Ishita) and Indian cities (Pune, Bengaluru, Jaipur, Kochi).
CURRENCY: Indian Rupee ₹.
```

---

## SCREEN 1 — Login / Sign Up

```
Mobile Login & Sign Up screen for SwapSutra.

Layout: cream page, centered. Top third: SwapSutra wordmark in Cormorant Garamond serif with a small
feather mark, and the line "A quiet place for readers to share books." Below it a segmented control
with two options: "Log in" and "Sign up".

LOG IN state: single email input with label "Your email", full-width mauve primary button
"Send verification code", and small muted helper text "New here? Create an account first — we'll
never create one for you automatically."

SIGN UP state: a short form — Full name, Email, Phone (with +91 prefix), City, and an optional
"Referral code" field with an "Apply" link. A checkbox row: "I agree to the Community Guidelines and
Privacy Policy" with the two phrases as mauve links. Primary button "Create my account".

OTP state (show as a third variant): six large individual code boxes with a warm border, a
"Resend in 0:42" muted countdown, "Verify & continue" primary button, and a text link
"Use a different email".

ERROR variants to include as small inline banners under the form:
- amber banner: "We couldn't find an account with this email. Please sign up first."
- amber banner: "This email is already registered. Please log in instead."

Bottom: tiny muted footer "Made for readers in India".
```

---

## SCREEN 2 — Onboarding + Home / Discover

```
Mobile Home screen for SwapSutra, with a first-run onboarding overlay variant.

HOME (scrolling feed of warm cards, cream background):
1. Greeting header: "Good evening, Ananya" in Cormorant serif + a small day/night toggle pill.
2. Trial ribbon (dismissible, emerald tint): "🌱 21 days left in your free trial · then ₹49/mo" with a
   "Become a member" link.
3. "Currently reading" card: book cover thumbnail, title/author, a thin progress bar at 62%, and a
   "Log progress" ghost button. Beside it a small streak badge "12-day streak 🔥".
4. Horizontal scroller "New in the Library": portrait book cover cards, each with title, author, a
   condition chip ("Like New"), and an intent chip in mauve ("Swap", "Lend", "Rent ₹40", "Sell ₹180").
5. "Waiting on you" card: an incoming swap request — avatar, "Kabir wants to swap 'The God of Small
   Things'", with "View" and "Decline" buttons.
6. Two-up tiles: "Reader's Café — 4 new posts" and "Upcoming Circles — Thu 8pm".
7. "Books around you" strip: a small map-ish card, "9 readers within 5 km in Pune", CTA "Explore".
8. Quiet section "Quill's note" — an italic serif one-liner in a parchment inset card.

ONBOARDING OVERLAY variant: a dimmed screen with a soft-focus spotlight and a small quill character
card in the lower-left saying "Let me show you around — first, your Reading Space." with
"Next" and "Skip tour" buttons and 4 progress dots.
```

---

## SCREEN 3 — Book Listing (list your book)

```
Mobile "List a book" form screen for SwapSutra, presented as a full-page form with a step feel.

Top: title "Share a book" in Cormorant serif + muted subtitle "Every listing is reviewed before it
goes live."

Section A — Find the book: a large dashed-border upload/scan card with a camera icon reading
"Scan the ISBN barcode", and beneath it a text link "Enter ISBN manually" and a "Search by title"
input. Show a filled result state: fetched cover thumbnail, title, author, publisher, year, with a
small green check chip "Details found" and a "Not this book?" link.

Section B — Condition: 4 selectable pill cards — New, Like New, Good, Well-loved — and a photo
uploader row with 3 square slots (one filled with a book photo, two empty with a + icon) labelled
"Add condition photos (min 2)".

Section C — How would you like to share it? Four toggle cards with icons and short descriptions:
Swap, Lend, Rent, Sell. Rent and Sell expand to show a ₹ amount input; Lend expands to show a
"Lending period" stepper in days. A small mauve inset shows an auto-calculated line:
"Suggested security deposit ₹150" with an info icon.

Section D — Pickup city / area input and a "Available from" date field.

Sticky bottom bar: outline "Save draft" + primary "Submit for review".

Also design a compact status list variant showing the user's listings with status chips:
"In Review" (amber), "Approved" (green), "Rejected" (rose, with a reason line).
```

---

## SCREEN 4 — Book Detail

```
Mobile Book Detail screen for SwapSutra.

Hero: large portrait cover centered on a soft cream-to-white panel, with a subtle shadow. Behind it a
very faint blurred version of the cover as a wash. Title in Cormorant serif, author in muted sans,
plus small chips: genre, language, condition ("Like New"), and intent ("Available to swap").

Under the hero: a horizontal photo strip of 3 owner-uploaded condition photos, tappable.

Owner card: avatar, name "Meera S.", a 5-star rating with "4.9 · 23 swaps", location "2.4 km away ·
Pune", a verified-member check badge, and a ghost button "View reader profile".

Terms card (inset, parchment): rows for Intent, Security deposit ₹150, Lending period 21 days,
Courier/handover note. A small mauve link "How swaps stay safe".

Description: a few lines of the owner's own note in italic serif, then the book blurb in body text.

"Also on their shelf": small horizontal scroller of 4 more covers.

Sticky bottom action bar: outline heart "Save to TBR" icon button + full-width primary
"Request this book". Include a locked variant of the bar for non-members: greyed button with a small
lock and the line "Join SwapSutra to request books · ₹49/mo".
```

---

## SCREEN 5 — Swap Request & Swap Flow (most complex — use Experimental mode)

```
Mobile Swap Flow screen for SwapSutra — a single screen that shows the full lifecycle of one swap.

Top: a compact header showing the two books being exchanged side by side with a ↔ icon between
them, and both readers' avatars.

Below it a VERTICAL TIMELINE / state machine with 7 steps, each a row with a circular status marker
(filled mauve = done, ringed = current, hollow grey = upcoming), a step title, timestamp, and an
expandable detail area:
1. Request sent — "You asked Meera for 'The God of Small Things'" · a message the requester wrote
2. Accepted — accept/decline buttons shown in the CURRENT state variant
3. Security deposit held — shows ₹150, a "Deposit held safely" shield line, status chip "Verified"
4. Condition proof — a 2x2 grid of before-photos from each side, "Upload your proof" dashed slot
5. Handover — a large 6-digit handover code in a parchment card, "Share this code only at handover",
   plus a "Confirm I handed over the book" primary button
6. In circulation — a card showing "Due back in 14 days", a due date, and a "Request extension" link
7. Returned & closed — a rating prompt with 5 large tappable stars and a short "Leave a note" field

Persistent bottom area: a two-button row — outline "Message Meera" (opens chat) and a quiet text
link in muted rose "Report a problem" (dispute).

Also design an expanded DISPUTE sheet variant: title "Report a problem", radio options (Book not
received / Condition mismatch / Not returned / Other), a description textarea, a photo upload row,
and a primary "Submit report" button with the line "Our team reviews reports within 24 hours."
```

---

## SCREEN 6 — Message Center

```
Mobile Message Center for SwapSutra, with a list view and an open conversation view.

LIST VIEW: search field at top, then a segmented filter row: All · Swaps · Book Requests · Circles.
Conversation rows: avatar with a small book-cover badge overlapping its corner, reader name in
serif, last message preview truncated, right-aligned time, and an unread count pill in mauve.
Rows tied to an active swap show a thin mauve left edge and a tiny chip like "Swap · in circulation".
Include an empty state: a line drawing of two cups and the line "No conversations yet. Start with a
book you love." Note in muted text at the bottom of a swap thread row: "SwapSutra admin is included
in swap chats for your safety."

CONVERSATION VIEW: top bar with avatar, name, and a context strip beneath showing the book cover +
title + status chip "Awaiting handover" and a "View swap" link.
Message bubbles: incoming = white card with warm border; outgoing = soft mauve tint (#8E4A59 at 10%)
with espresso text. Show a photo message, a voice-note bubble with a waveform and duration, and a
system message centered in small muted caps: "HANDOVER CODE SHARED".
Composer: rounded input with a + attachment button, emoji button, mic button, and a mauve send
button. Above the composer a tiny amber safety line: "Never share OTPs or UPI PINs."
```

---

## SCREEN 7 — User Profile / Reading Journey

```
Mobile Profile screen for SwapSutra with a horizontally scrollable sub-tab bar.

Header: circular avatar with a thin mauve ring, name in Cormorant serif, city, a member-since line,
a verified badge, and three stat columns — Books shared · Swaps done · Rating. Right side: a small
settings gear and a "Share profile" icon.

Sub-tabs (pill row, scrollable): Overview · My Books · Journey · Achievements · Requests ·
Book Requests · Chats · Insights · Membership · Coupons · Settings.

Show the OVERVIEW tab filled in:
- "Reading streak" card: 12 days, a 7-dot week row with filled/hollow dots, and a small flame.
- "This year" card: books read count, pages, and a soft bar chart of 12 months in mauve tints.
- "Reading log" list: 3 recent entries — cover thumb, title, "finished 4 Sept", a 4-star rating and a
  one-line note in italic serif.
- "Achievements" horizontal strip: circular badge medallions in warm gold/mauve with names like
  "First Swap", "Ten Books Shared", "Circle Host", one greyed out and locked.
- "Insights" preview card (for people who list books): small stat row — Views, Requests, Accept rate.

Also design an ADMIN variant of the sub-tab row for admin users, adding: Approvals · Disputes ·
Security Fees · Events · Subscribers · Pricing — and one admin panel example: a "Listing approvals"
table-style list with book, lister, submitted date, and Approve / Reject buttons per row.
```

---

## SCREEN 8 — Notifications + Settings

```
Mobile Notifications & Settings screen for SwapSutra — one screen with two top tabs:
"Notifications" and "Settings".

NOTIFICATIONS tab: a "Mark all read" text link, then grouped sections "Today" / "Earlier".
Each row: a small circular icon tinted by type (swap = mauve book, circle = people, event = calendar,
system = feather), a title in medium weight, a supporting line, a relative timestamp, and unread rows
carrying a faint cream-to-white tint and a small dot. Swipe-to-dismiss affordance hinted on one row.
Empty state: "All quiet. We'll let you know when a reader reaches out."

SETTINGS tab: grouped inset list cards with section captions in small uppercase muted letters:
- Appearance: a Day / Night / System segmented control (make the visual difference obvious)
- Notifications: toggle rows for Swap updates, Messages, Reading circles, Events, Newsletter
- Account: Edit profile, Phone & email, Blocked readers, Change city
- Membership: a row showing "Reader Pass · renews 4 Oct · ₹49/mo" with a "Manage" chevron
- Legal: Community Guidelines, Privacy Policy, Terms, Refund Policy, Unsubscribe from newsletter
- Danger zone: "Log out" in muted rose and "Delete account" as a quiet text link

Keep every toggle in the mauve accent when on, warm grey when off.
```

---

## SCREEN 9 — Community (Reader's Café)

```
Mobile Community feed for SwapSutra, called "Reader's Café" — a warm, slow social feed. NOT a
Twitter/Instagram clone: bookish, calm, generous spacing.

Top: a Stories row — circular avatars with a thin mauve gradient ring, first item is "Your story"
with a + badge. Below it a pill filter row: All · Thoughts · Quotes · Poems · Recommendations ·
Reviews.

Post cards (white, 20px radius, soft shadow), show these four variants in the feed:
1. QUOTE post — a large pull-quote set in Cormorant Garamond italic on a parchment inset panel, with
   the book title and author beneath in small caps.
2. PHOTO post — a shelfie image with rounded corners and a caption below.
3. AUDIO post — a poem read aloud: a waveform strip with a play button, duration, and the poem title.
4. RECOMMENDATION post — a mini book card embedded inside the post with cover, title, and a
   "Find this book" mauve link.

Every card footer: a reaction row of small emoji chips with counts (📖 12 · 🕯️ 4 · ❤️ 9), a comment
count, and a share icon. Author line at the top of each card: avatar, name, city, and time, in a
single quiet row.

Floating compose button (bottom-right, above the tab bar) in mauve with a feather icon. Also design
the COMPOSE sheet: a large textarea with the placeholder "What are you reading, thinking, feeling?",
a row of attachment buttons (image, video, audio-record, quote-block, tag a book), and a
"Share with the Café" primary button.
```

---

## SCREEN 10 — Reading Circles

```
Mobile Reading Circles screen for SwapSutra.

Top tabs: "My Circles" and "Discover".

MY CIRCLES: cards showing the circle's current book cover on the left, circle name in serif,
"12 readers · reading Chapter 7", a stacked avatar row of 4 members with a "+8", a last-activity line
"Kabir posted 20m ago", and an unread pill. Active circles carry a thin mauve left edge.

DISCOVER: a search field and genre filter chips, then circle cards with cover, name, a one-line
description, member count, pace ("2 chapters a week"), a starting date, and a "Join" outline button.
One card shows a "Full" greyed state and one shows "Starts 12 Sept" in amber.

Bottom of the screen: a wide dashed-border card "Start your own circle" with a feather icon and a
short line "Pick a book, set a pace, invite readers."

Also design the CREATE CIRCLE sheet: fields for Book (with a search-and-pick control showing a chosen
cover), Circle name, Description textarea, Pace selector, Start date, Max readers stepper, and a
Public/Invite-only toggle, ending in a "Open the circle" primary button.
```

---

## SCREEN 11 — Reading Circle Discussion

```
Mobile group discussion screen for one SwapSutra reading circle — this layout is reused for every
circle.

Sticky header: back arrow, the book's cover as a small thumbnail, circle name in Cormorant serif,
and "14 readers" as a tappable line that opens the member list. Right: an overflow menu.

Under the header a slim progress strip: "The circle is on Chapter 7 of 24" with a thin mauve
progress bar and a "Your progress" marker dot slightly behind it.

Message area: grouped chat with the sender's avatar on the left and their name in small caps above
the first bubble in a run. Include:
- a normal text message
- a message quoting a passage: an inset parchment block with a left mauve rule and the page number
- a SPOILER message: a blurred/obscured bubble with a small eye icon and the label "Spoiler — tap to
  reveal"
- a reaction row under one message with small emoji chips
- a centered system line in muted caps: "MEERA JOINED THE CIRCLE"
- a pinned banner at the top of the thread: "This week: chapters 6–8. Please tag spoilers."

Composer: rounded input, a "Spoiler" toggle chip sitting just above it, attachment and send buttons.

Also design the MEMBER LIST sheet: avatars, names, cities, a small "host" crown chip on one, each
row's reading progress as a tiny bar, and a "Leave circle" quiet rose link at the bottom.
```

---

## SCREEN 12 — Events & Gallery

```
Mobile Events screen for SwapSutra (online meetups and in-person gatherings).

Top tabs: "Upcoming" · "Past & Gallery".

UPCOMING: event cards with a landscape cover image, a date block overlay (day number in large serif,
month in caps), title, a format chip ("Online" or "Pune · Koregaon Park"), time, host name with
avatar, and an attendee avatar stack. Primary button per card: "Register" — with a second card
showing the registered state: a green check chip "You're going" and a "Add to calendar" link. One
card shows "Notify me" as an outline button for an event with registrations not yet open.

PAST & GALLERY: a masonry photo grid of event photographs with rounded corners; tapping opens a
lightweight lightbox variant with a caption and event name. Above the grid, a horizontal row of past
event chips to filter the grid.

Bottom: an inset card "Host a gathering with us" with a short line and an outline button
"Send an enquiry". Design that ENQUIRY sheet too: Name, Organisation, City, Preferred date, Format
(Online / In person), Expected readers, Message textarea, and a "Send enquiry" primary button.
```

---

## SCREEN 13 — Reading Space / Library (use Experimental mode)

```
Mobile screen for SwapSutra that holds two things under one roof, as two top tabs:
"The Library" (discover other people's books) and "My Space" (your own shelves).

THE LIBRARY tab:
- a search field with a barcode-scan icon on the right
- a scrollable filter chip row: Near me · Genre · Condition · Swap · Lend · Rent · Sell, with one
  chip shown active in mauve and a "Filters" button showing a count badge "2"
- a small toggle between grid and list view
- a 2-column grid of portrait book cards: cover, title, author, a condition chip, an intent chip, and
  a tiny distance line "1.8 km · Kabir"
- a "readers near you" inline strip after the first 6 results: horizontal avatar cards with name,
  city, books-shared count and a "View shelf" link
- a guest/locked variant: the grid partially faded toward the bottom behind a soft cream scrim with a
  card reading "You're browsing as a guest — join to see the full shelf" and a mauve
  "Join SwapSutra" button

MY SPACE tab: a segmented control — Reading now · TBR · Finished · Listed · Favourites.
Show the TBR state: a reorderable list with drag handles, cover thumb, title, author, a "Find a copy"
mauve link on books nobody has listed yet, and a swipe-to-remove hint. A header line above the list
reads "14 books waiting" in serif, with an "Add a book" outline button.
```

---

## SCREEN 14 — Book Requests

```
Mobile "Book Requests" screen for SwapSutra — where readers post books they're looking for and others
offer copies.

Top tabs: "Looking for" (the community feed) and "My requests".

LOOKING FOR: a search field, then request cards. Each card: a faint placeholder cover with a dashed
border and a small "?" (nobody has listed it yet) or the real cover if matched, the title and author
in serif, the requester's avatar and name, city and distance, a preferred-intent chip row
("Happy to swap or rent"), a posted time, and a response count "3 readers responded".
Primary action per card: an outline button "I have this book".

MY REQUESTS: rows showing the requested book, a status chip — "Open" (mauve), "3 offers" (green),
"Fulfilled" (grey) — and an expandable offers list beneath one row showing responders as avatar rows
with name, rating, distance, and Accept / Decline buttons.

Floating compose button: "Request a book". Design that sheet: an ISBN/title search with a picked
result preview, a "Why do you want it?" short textarea, intent checkboxes (Swap / Borrow / Rent /
Buy), a max-budget ₹ field that appears only when Rent or Buy is ticked, a city field, and a
"Post request" primary button.

Empty state for My requests: a line-art empty shelf with "No requests yet — ask the community for
that book you can't find."
```

---

## SCREEN 15 — Membership & Payment

```
Mobile Membership & Payment screen for SwapSutra. Design it as a 3-step flow on one screen with a
small step indicator (Plan → Pay → Status).

STEP 1 — Choose your plan: two plan cards stacked.
- "Reader Pass" — ₹49 / month, listed benefits with small check icons (list & request unlimited
  books, join circles, message readers, attend events). Show a mauve "Most readers choose this" ribbon.
- "Chapters Patron" — a higher monthly patronage amount, framed warmly as supporting the community,
  with an extra benefit or two.
Above them a soft emerald strip: "You're on a free trial — 21 days left." Below them a coupon row:
an input with the placeholder "Have a coupon?" and an "Apply" button, plus a green applied state
showing "READER10 applied · ₹5 off" with an x to remove.

STEP 2 — Pay by UPI: a large white card holding a crisp UPI QR code, the UPI ID in monospace with a
copy icon, the amount in large serif "₹49", and a row of small UPI app buttons (GPay / PhonePe /
Paytm) labelled "Open in your UPI app". Then an upload area: a dashed card "Upload payment
screenshot (JPG/PNG, under 3 MB)" showing a filled thumbnail state, and a "UTR / Reference number"
input. Primary button "Submit for verification".
A quiet trust panel beneath: shield icons with the lines "Payments go directly through UPI",
"SwapSutra never asks for your UPI PIN, bank password or card details", and "Screenshots are used
only for manual verification".

STEP 3 — Status: a centered card with a soft clock illustration, "Under review", the line
"Manual UPI activation is verified within 12–24 hours", the submitted amount and reference, and a
"Back to Home" outline button. Also design the approved variant: a green check, "You're a member",
renewal date, and a "Manage membership" link.
```

---

## SCREEN 16 — Help, Rituals & Ambassador

```
Mobile Help & Community screen for SwapSutra with three top tabs: "Help" · "Rituals" · "Ambassador".

HELP tab: a warm intro line, then large contact cards — Email us (with the address), WhatsApp us
(with a green WhatsApp mark), and Response time "usually within a day". Below, a "Common questions"
accordion with 5 collapsed rows and one expanded showing an answer paragraph. At the bottom a
"Write to us" form: subject dropdown, message textarea, and a "Send message" primary button.

RITUALS tab: this is SwapSutra's explainer, and it should feel like a beautifully typeset page rather
than a help doc. Sections:
- "The Ritual of Swapping" — a 4-step vertical illustration flow with feather-line icons:
  Request → Agree → Handover with proof → Return & rate
- "Community Invariants" — 5 short principles as parchment cards, each a serif line with a small
  icon (Care for the book · Be on time · Tag spoilers · Speak kindly · Keep it in the community)
- "Financial Transparency" — a simple breakdown card showing where the ₹49 goes, as labelled
  horizontal bars in warm tints
- "How SwapSutra keeps every swap safe" — proof at every handover, security deposit, admin in chat,
  dispute review

AMBASSADOR tab: a hero card "Bring SwapSutra to your campus" with a warm illustration, three benefit
tiles (build your campus reading circle, free Reader Pass, founder mentorship), a short "What
ambassadors do" list, and an application form: Name, College, City, Year of study, Why you, and an
"Apply to be an ambassador" primary button. Below, a small strip of current ambassadors as avatars
with college names.
```

---

# Part 2 — Wiring the Stitch export to your existing backend

Stitch gives you screens, not a connected app. Once you export (Figma or HTML/code), the frontend has
to talk to the **existing Google Apps Script** endpoint — do **not** introduce a new backend or database.

## Contract

All calls go to the single Apps Script Web App URL as `POST` with a JSON body containing an `action`
field (this is the pattern already used in `src/App.tsx`). Reuse the existing helper rather than
writing a new fetch layer.

## Action map per screen

| Screen | Actions to wire |
|---|---|
| 1 Login / Sign Up | `lookup`, `sendOTP`, `verifyOTP`, `registerFreeReader`, `validateReferralCode`, `logout` |
| 2 Home | `getUserProfile`, `getBooks`, `getSwapRequests`, `getEvents`, `getReadersCafe`, `getReadingJourney`, `getAppSettings` |
| 3 Book Listing | `lookupIsbn`, `catalogueLookup`, `getBookGenres`, `getBookPrice`, `getDepositQuote`, `createBook`, `updateUserBook`, `removeUserBook` |
| 4 Book Detail | `getBooks`, `getPublicReaderProfile`, `getDepositQuote`, `rateBook` |
| 5 Swap Flow | `createSwapRequest`, `getSwapRequests`, `getSecurityFeeStatus`, `uploadSwapProof`, `getSwapProofs`, `markOwnerFinalConfirmation`, `rateBook` |
| 6 Messages | `getUserChats`, `getChatMessages`, `sendChatMessage`, `deleteChatMessage`, `markAsRead` |
| 7 Profile | `getUserProfile`, `updateUserProfile`, `getReadingJourney`, `logReaderActivity`, `getUserBookRequests`, `checkSubscription`, `getMembershipCoupons` |
| 8 Notifications / Settings | `getNotifications`, `markNotificationRead`, `markNotificationsReadBulk`, `clearNotification`, `clearAllNotifications`, `subscribeNewsletter` |
| 9 Community | `getReadersCafe`, `getCafeStories`, `postCafeStory`, `markCafeStoryViewed`, `getCafeStoryViewers`, `deleteCafeStory`, `toggleCafeReaction`, `createTestimonial`, `getTestimonials` |
| 10 Circles | `getCurrentReadCircles`, `addCurrentRead`, `joinCurrentReadCircle`, `leaveCurrentReadCircle`, `archiveCurrentReadCircle`, `endCurrentReadCircle` |
| 11 Circle Discussion | `getCircleMessages`, `addCircleMessage`, `deleteCircleMessage` |
| 12 Events | `getEvents`, `registerEvent`, `subscribeEventNotify`, `unsubscribeEventNotify`, `submitHostEnquiry` |
| 13 Reading Space / Library | `getBooks`, `getBookGenres`, `upsertReadingSpaceBook`, `getReaderDirectory`, `getPublicReaderProfile` |
| 14 Book Requests | `getBookRequestFeed`, `createBookRequest`, `respondToBookRequest`, `getBookRequestResponses`, `cancelBookRequest`, `getUserBookRequests` |
| 15 Membership & Payment | `checkSubscription`, `createSubscription`, `getMembershipCoupons`, `getBookPrice` |
| 16 Help / Rituals / Ambassador | `createSupportMessage`, `getAppSettings`, `submitHostEnquiry` |
| Admin (inside 7) | `getAdminDashboardMetrics`, `getPendingMembershipApprovals`, `manageMembershipApproval`, `approveSubscription`, `getHostEnquiries`, `updateHostEnquiryStatus`, `getEventSubscribers`, `createEvent`/`updateEvent`/`deleteEvent`, `getNewsletters`, `previewNewsletter`, `sendNewsletter`, `getArchivedChatsForAdmin`, `updateAdminNotes` |

## Non-negotiables while wiring

1. **Auth stays backend-validated.** The screen order is Login → `lookup` → (exists) `sendOTP` →
   `verifyOTP`. If `lookup` says the user doesn't exist, the OTP call must be blocked and the UI must
   route to Sign Up. `verifyOTP` must never create an account. Sign Up runs `lookup` first and blocks
   on duplicates. Every one of these checks must also hold server-side in Apps Script — the mobile UI
   is not the gate.
2. **Membership gating is server-checked.** `checkSubscription` drives the locked states (locked
   request button on screen 4, faded library on screen 13, gate modal). Never let a client flag alone
   unlock a premium action.
3. **Google Sheets stays the database.** Apps Script stays the API. Nothing in the mobile app talks to
   any other store.
4. **Reuse, don't re-derive.** Field names, status enums (`In Review` / `Approved` / `Rejected`), the
   swap state machine steps, deposit quote logic and tier names (`Reader Pass`, `Chapters Patron`,
   `free` / `premium` / `expired`) already exist — mirror them exactly so the same Sheet rows serve
   both web and mobile.

## Suggested build order

Screens 1 → 2 → 13 → 4 → 3 → 5 → 6 → 7 → 15, then 9 → 10 → 11 → 12 → 14 → 8 → 16.
That order gets a working swap loop (find a book → request → chat → hand over → rate) in the first
pass, and treats community, events and content as the second pass.
