"""
browser_partners_375.py — Playwright check at 375px (9 Oct 2026), against
the built site with a mocked backend:
  - the Library banner shows a partner banner (Sponsored + SwapSutra logo),
    and the shelf mixes in an ad and a mug; the order changes per visit
  - /partners: intro, email code with purpose "partner", type choice,
    the bookstore form with its agreement, errors shown from the server
  - an approved partner's dashboard: next steps, earnings, banner & ads with
    the ₹100 payment box; the buyer is never named
  - admin: Partners and Payment details tabs render
  - no horizontal scroll anywhere
Run: python3 spa.py dist 8977 & then BASE_URL=http://127.0.0.1:8977 python3 tests/browser_partners_375.py
"""
import json, os, sys
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:8977').rstrip('/')
SHOTS = os.environ.get('SHOTS', '')
DRV = "https://drive.google.com/thumbnail?id=DRIVEFILE0001&sz=w800"
BOOKS = [{"id": "B%d" % i, "title": "Book %d" % i, "author": "Author", "status": "Approved", "isbn": "", "ownerEmail": "o@e.com", "ownerId": "R%d" % i,
          "imageUrls": DRV, "frontCoverImage": DRV, "permanent_exchange": True, "available_for_swap": True, "genre": "Fiction", "condition": "Good"} for i in range(12)]
BOOKS.append({"id": "BOOS", "title": "Out Of Stock Title", "author": "Shop", "status": "Approved", "ownerEmail": "s@e.com", "ownerId": "RS", "imageUrls": DRV,
              "sell": True, "stock": 0, "sellerType": "bookstore", "sellerName": "Bookworms", "genre": "Fiction", "condition": "New"})
ADS = [
  {"id": "PB-1", "kind": "bookstore", "sponsor": "Bookworms", "headline": "Bookworms, Hazratganj", "tagline": "New and second-hand books", "imageUrl": DRV,
   "linkUrl": "https://www.google.com/maps/search/?api=1&query=26.85,80.94", "bookId": "", "ctaLabel": "Find the store", "placement": "banner", "partner": True},
  {"id": "AD-2", "kind": "author", "sponsor": "R. Writer", "headline": "Meet R. Writer this Sunday", "tagline": "", "imageUrl": DRV,
   "linkUrl": "https://example.com", "bookId": "", "ctaLabel": "", "placement": "shelf"},
]
MUGS = [{"id": "M1", "title": "Bookish Mug", "imageUrl": DRV, "price": 349, "category": "bookish", "description": "", "mrp": None, "currency": "INR",
         "availability": "", "sourceMarketplace": "Amazon", "sourceUrl": "https://amazon.in/x", "affiliateUrl": "", "vendor": "", "rating": None, "ratingCount": None, "ratingSource": ""}]
UPI = {"vpa": "swapsutra@okhdfcbank", "payee": "SwapSutra", "qrImageUrl": "", "useQrImage": False, "bank": {"accountName": "SwapSutra", "accountNumber": "1234567890", "ifsc": "HDFC0001234", "bankName": "HDFC"}}
PARTNER = {"id": "SS_PARTNER_1", "type": "bookstore", "typeLabel": "Bookstore", "email": "shop@e.com", "status": "APPROVED", "name": "Bookworms", "contactName": "Asha Owner",
  "phone": "9876543210", "about": "", "website": "", "instagram": "", "address": "12 MG Road", "city": "Lucknow", "pincode": "226001", "lat": 26.85, "lng": 80.94,
  "placeLabel": "Bookworms", "registeredName": "Asha Owner", "gstin": "", "panMasked": "AB•••••34F", "aadhaarLast4": "1234", "typeFields": {},
  "showBanner": True, "runAds": True, "bannerImageUrl": DRV, "bannerHeadline": "Bookworms, Hazratganj", "bannerTagline": "", "bannerStatus": "APPROVED", "bannerNote": "",
  "contractVersion": "bookstore-2026-10-09", "contractSignedName": "Asha Owner", "contractSignedAt": "2026-10-09T18:00:00Z", "currentContractVersion": "bookstore-2026-10-09",
  "commissionPlan": "free_first_year", "commissionFreeUntil": "2027-10-09T18:00:00Z", "commissionNow": 0, "approvedAt": "2026-10-09T18:00:00Z", "reviewNote": "",
  "submittedAt": "2026-10-09T17:00:00Z", "docs": [{"key": "aadhaar", "label": "Owner's Aadhaar (masked)", "at": ""}]}
DASH = {"success": True, "email": "shop@e.com", "partner": PARTNER, "adFee": 100, "adMonths": 2, "commissionPercent": 2, "upi": UPI, "requiredDocs": {}, "contractVersions": {},
  "promotion": {"freeUntil": "2026-04-01T00:00:00Z", "paidUntil": "", "activeUntil": "2026-04-01T00:00:00Z", "active": False, "inFreePeriod": False, "fee": 100, "months": 2, "dueSoon": False, "pendingPayment": None},
  "adPayments": [], "earnings": {"months": [{"month": "2026-10", "gross": 300, "commission": 0, "net": 300, "paid": 0, "due": 300, "items": 1}], "total": {"gross": 300, "commission": 0, "net": 300, "paid": 0, "due": 300}},
  "orders": [{"swapId": "S1", "bookTitle": "Dune", "serviceType": "SELL", "amount": 300, "status": "Accepted", "createdAt": "2026-10-09T10:00:00Z", "nextStep": "step 7 — Pack and post the book", "step": 7, "urgent": True}],
  "books": [{"id": "BK1", "title": "Dune", "author": "Frank Herbert", "status": "Approved", "stock": 3, "sellPrice": 300}],
  "ads": [], "payoutAccount": None,
  "nextSteps": [{"key": "payout", "text": "Add the UPI ID your monthly payouts should go to.", "urgent": True}, {"key": "order_S1", "text": '"Dune": step 7 — Pack and post the book', "urgent": True},
                {"key": "promo_pay", "text": "Your free promotion has ended — pay ₹100 for 2 months to keep your banner and ads on SwapSutra.", "urgent": True}]}
state = {"calls": [], "bodies": {}, "dash": None}
def api(route):
    req = route.request; body = {}
    if req.method == 'POST':
        try: body = json.loads(req.post_data or '{}')
        except Exception: pass
    u = req.url; act = body.get('action') or (u.split('action=')[1].split('&')[0] if 'action=' in u else '')
    state["calls"].append(act); state["bodies"][act] = body
    if act == 'getBooks': return route.fulfill(json={"success": True, "data": BOOKS})
    if act == 'getSponsoredAds': return route.fulfill(json={"success": True, "items": ADS})
    if act == 'getMugProducts': return route.fulfill(json={"success": True, "items": MUGS})
    if act == 'sendOTP': return route.fulfill(json={"success": True})
    if act == 'verifyOTP': return route.fulfill(json={"success": True, "sessionToken": "tok", "role": "member"})
    if act == 'getMyPartner': return route.fulfill(json=state["dash"] or {"success": True, "email": "new@e.com", "partner": None, "adFee": 100, "adMonths": 2, "commissionPercent": 2, "upi": UPI})
    if act == 'submitPartnerApplication': return route.fulfill(json={"success": False, "errors": {"panNumber": "Enter the PAN number (like ABCDE1234F).", "doc_aadhaar": "Upload: Owner's Aadhaar (masked)."}, "message": "Please fix the highlighted fields."})
    if act == 'adminListPartners': return route.fulfill(json={"success": True, "items": [dict(PARTNER, status="PENDING", panNumber="ABCDE1234F", promotion=DASH["promotion"], payoutAccount=None,
        docs=[{"key": "pan", "label": "PAN", "url": "https://drive.google.com/file/d/X/view", "at": ""}])], "pendingPayments": [], "monthly": [], "commissionPercent": 2, "adFee": 100, "adMonths": 2})
    if act == 'getAdminPaymentSettings': return route.fulfill(json={"success": True, "upi": UPI, "updatedAt": "", "updatedBy": ""})
    if act == 'getAdminDashboardMetrics': return route.fulfill(json={"success": False, "message": "mocked"})
    if act == 'checkSubscription': return route.fulfill(json={"success": True, "isRegistered": True, "membershipStatus": "TRIAL"})
    return route.fulfill(json={"success": True, "data": []})
def drive(route): return route.fulfill(body=b'', headers={"content-type": "image/jpeg"})
ok = fail = 0
def ck(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1; print('PASS:', label)
    else: fail += 1; print('FAIL:', label, detail)
def no_hscroll(pg): return pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
def shot(pg, name):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name + '.png'), full_page=True)
SPLASH = "try{sessionStorage.setItem('swapsutraSplashShown','true');}catch(e){}"
with sync_playwright() as p:
    b = p.chromium.launch()
    # A. Library
    ctx = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
    ctx.add_init_script(SPLASH)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + pg.url + ' ' + str(getattr(e, 'stack', ''))[:400]))
    pg.route("**/api/swapsutra**", api); pg.route("https://drive.google.com/**", drive)
    pg.goto(BASE + '/library'); pg.wait_for_timeout(2500)
    banner = pg.locator('[data-testid="library-banner"]')
    ck('Library: the partner banner shows', banner.count() == 1 and 'Bookworms, Hazratganj' in banner.inner_text())
    ck('...marked Sponsored, with the SwapSutra logo', 'sponsored' in banner.inner_text().lower() and pg.locator('.ss-adbanner__logo').count() == 1)
    ck('Shelf: an ad stands between the books', pg.locator('.ss-shelf [data-testid="sponsored-ad"]').count() >= 1)
    ck('Shelf: a mug stands between the books', pg.locator('.ss-shelf [data-testid="shelf-mug"]').count() >= 1)
    ck('An out-of-stock partner book is not on the shelf', 'Out Of Stock Title' not in pg.locator('.ss-shelf').inner_text() and pg.locator('[aria-label^="Out Of Stock Title"]').count() == 0)
    order1 = pg.eval_on_selector_all('.ss-shelf > .ss-shelf__book:not(.ss-shelf__book--empty)', 'els => els.map(e => e.getAttribute("aria-label") || e.textContent).join("|")')
    ck('Library: no horizontal scroll', no_hscroll(pg))
    shot(pg, 'library')
    orders = set([order1])
    for _ in range(3):
        pg.goto(BASE + '/library'); pg.wait_for_timeout(1800)
        orders.add(pg.eval_on_selector_all('.ss-shelf > .ss-shelf__book:not(.ss-shelf__book--empty)', 'els => els.map(e => e.getAttribute("aria-label") || e.textContent).join("|")'))
    ck('Each visit shuffles the shelf', len(orders) > 1)
    # B. /partners signed out
    pg.goto(BASE + '/partners'); pg.wait_for_timeout(2000)
    ck('/partners: the intro and the email step show', pg.locator('[data-testid="partners-page"]').count() == 1 and pg.locator('[data-testid="partner-verify"]').count() == 1)
    ck('/partners: no horizontal scroll', no_hscroll(pg))
    shot(pg, 'partners-intro')
    pg.fill('[data-testid="partner-verify"] input[type="email"]', 'new@e.com'); pg.click('text=Send code'); pg.wait_for_timeout(500)
    ck('The code is asked for with purpose "partner"', state["bodies"].get('sendOTP', {}).get('purpose') == 'partner')
    pg.fill('[data-testid="partner-verify"] input[aria-label="Code"]', '123456'); pg.click('text=Verify'); pg.wait_for_timeout(1500)
    ck('Verified: the partner type choice shows', pg.locator('[data-testid="partner-type-pick"]').count() == 1)
    pg.click('.pp-type:has-text("Bookstore")'); pg.wait_for_timeout(500)
    ck('The bookstore form shows with its own agreement', pg.locator('[data-testid="partner-register-form"]').count() == 1 and 'Bookstore Partner Agreement' in pg.locator('[data-testid="partner-register-form"]').inner_text())
    ft = pg.locator('[data-testid="partner-register-form"]').inner_text()
    ck('...with an alternative mobile number and email (optional)', 'Alternative mobile number (optional)' in ft and 'Alternative email (optional)' in ft)
    ck('...which says shipping and delivery are the partner\'s responsibility', "Shipping and delivery are the partner's responsibility" in pg.locator('[data-testid="partner-contract"]').inner_text())
    ck('Form: who can buy or rent from you (all of India, or nearby with a distance)', pg.locator('[data-testid="partner-service-area"]').count() == 1
       and 'Readers all over India' in pg.locator('[data-testid="partner-service-area"]').inner_text())
    ck('Form: no horizontal scroll', no_hscroll(pg))
    shot(pg, 'partners-form')
    # 13 Oct 2026: online-only and unregistered bookstores
    form = pg.locator('[data-testid="partner-register-form"]')
    ck('A shop needs its address; no online-link field yet', form.locator('text=Full address *').count() == 1 and pg.locator('input[name="storeLink"]').count() == 0)
    pg.click('[data-testid="partner-sellsFrom"] label:has-text("Online only")'); pg.wait_for_timeout(300)
    ck('Online only: no address or map pin needed, the online link is asked', form.locator('text=Full address *').count() == 0
       and pg.locator('input[name="storeLink"]').count() == 1 and 'City you ship from' in form.inner_text() and 'Google location (optional)' in form.inner_text())
    ft1 = form.inner_text()
    ck('Online-only bookseller: only the Aadhaar — no PAN, no registration question, no other documents',
       pg.locator('[data-testid="partner-aadhaar-only"]').count() == 1 and 'PAN number' not in ft1 and "Owner's PAN card" not in ft1
       and pg.locator('[data-testid="partner-registered"]').count() == 0 and 'Any other document' not in ft1 and 'Shop registration / GST certificate' not in ft1
       and "Owner's Aadhaar" in ft1)
    pg.click('[data-testid="partner-sellsFrom"] label:has-text("Both")'); pg.wait_for_timeout(300)
    pg.click('[data-testid="partner-registered"] label:has-text("Not registered")'); pg.wait_for_timeout(300)
    ft2 = form.inner_text()
    ck('Not registered: a photo with the books and a declaration instead of the business proof',
       'A photo of you with your books' in ft2 and pg.locator('[data-testid="partner-declare"]').count() == 1 and 'printed books need no GST' in ft2
       and 'GSTIN' not in ft2 and 'optional — it speeds up approval' in ft2)
    ck('Still no horizontal scroll', no_hscroll(pg))
    shot(pg, 'partners-form-online-unregistered')
    pg.click('[data-testid="partner-registered"] label:has-text("Registered")'); pg.click('[data-testid="partner-sellsFrom"] label:has-text("A shop readers can visit")'); pg.wait_for_timeout(300)
    pg.click('text=Send my application'); pg.wait_for_timeout(600)
    ck('Where SwapSutra pays the partner is asked (UPI or bank), before anything is sent', pg.locator('[data-testid="partner-payout"]').count() == 1
       and pg.locator('[data-testid="partner-payout"] [role="alert"]').count() >= 1 and 'submitPartnerApplication' not in state["calls"])
    pg.fill('input[name="payoutUpiId"]', 'bookworms@okhdfcbank'); pg.fill('input[name="payoutPayeeName"]', 'Asha Owner')
    pg.click('text=Send my application'); pg.wait_for_timeout(800)
    ck('...and sent with the application', state["bodies"].get('submitPartnerApplication', {}).get('payout', {}).get('upiId') == 'bookworms@okhdfcbank')
    ck('Server errors are shown next to the fields', pg.locator('.pp-error:has-text("PAN number")').count() >= 1 and pg.locator('.pp-error:has-text("Aadhaar")').count() >= 1)
    ctx.close()
    # C. approved partner dashboard
    state["dash"] = DASH
    ctx = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
    ctx.add_init_script(SPLASH + "try{localStorage.setItem('swapsutraUserEmail','shop@e.com');localStorage.setItem('swapsutraSessionToken','tok');}catch(e){}")
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + pg.url + ' ' + str(getattr(e, 'stack', ''))[:400]))
    pg.route("**/api/swapsutra**", api); pg.route("https://drive.google.com/**", drive)
    pg.goto(BASE + '/partners'); pg.wait_for_timeout(2500)
    d = pg.locator('[data-testid="partner-dashboard"]')
    ck('Approved partner: the dashboard shows', d.count() == 1)
    ck('...with what to do next', 'Add the UPI ID' in d.inner_text() and 'Pack and post the book' in d.inner_text())
    ck('...and earnings', '₹300' in d.inner_text())
    ck('Dashboard: no horizontal scroll', no_hscroll(pg))
    shot(pg, 'partner-dashboard')
    pg.click('.pp-tabs >> text=Banner & ads'); pg.wait_for_timeout(500)
    ck('Banner & ads: the ₹100 payment box with SwapSutra\'s UPI', pg.locator('[data-testid="upi-pay-box"]').count() == 1 and 'swapsutra@okhdfcbank' in pg.locator('[data-testid="upi-pay-box"]').inner_text())
    ck('...and the banner preview with the SwapSutra logo', pg.locator('[data-testid="partner-banner-preview"] .pp-banner__logo').count() == 1)
    ck('Banner & ads: no horizontal scroll', no_hscroll(pg))
    shot(pg, 'partner-promo')
    pg.click('.pp-tabs >> text=Books & stock'); pg.wait_for_timeout(300)
    ck('Books & stock: copies can be changed', pg.locator('input[aria-label="Copies of Dune"]').count() == 1)
    ck('The buyer is never named on the dashboard', 'req@' not in pg.content())
    # 14 Oct 2026: all of India, or only nearby
    pg.click('.pp-tabs >> text=Account'); pg.wait_for_timeout(400)
    reach = pg.locator('[data-testid="partner-reach"]')
    ck('Account: who can buy or rent — all of India by default', reach.count() == 1 and 'readers all over India' in reach.inner_text())
    reach.locator('label:has-text("Only readers near me")').click(); pg.wait_for_timeout(200)
    reach.locator('select[name="serviceRadiusKm"]').select_option('25')
    reach.locator('button:has-text("Save")').click(); pg.wait_for_timeout(600)
    sent = state["bodies"].get('updatePartnerProfile', {})
    ck('..."Only readers near me, within 25 km" is saved', sent.get('serviceArea') == 'nearby' and sent.get('serviceRadiusKm') == 25, str(sent))
    ck('Account: no horizontal scroll', no_hscroll(pg))
    ctx.close()
    # D. admin consoles
    ctx = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
    ctx.add_init_script(SPLASH + "try{localStorage.setItem('swapsutraUserEmail','swapsutra@gmail.com');localStorage.setItem('swapsutraSessionToken','tok');localStorage.setItem('swapsutraUserRole','admin');}catch(e){}")
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + pg.url + ' ' + str(getattr(e, 'stack', ''))[:400]))
    pg.route("**/api/swapsutra**", api); pg.route("https://drive.google.com/**", drive)
    pg.goto(BASE + '/management'); pg.wait_for_timeout(2500)
    if pg.locator('button:has-text("Partners")').count():
        pg.locator('button:has-text("Partners")').first.click(); pg.wait_for_timeout(1500)
        ck('Admin → Partners: the application with approve options', pg.locator('[data-testid="admin-partners"]').count() == 1 and 'commission-free' in pg.locator('[data-testid="admin-partners"]').inner_text())
        shot(pg, 'admin-partners')
        pg.locator('button:has-text("Payment details")').first.click(); pg.wait_for_timeout(1500)
        ck('Admin → Payment details: the form with the current UPI ID', pg.locator('[data-testid="admin-payment-settings"]').count() == 1 and pg.locator('[data-testid="admin-payment-settings"] input').first.input_value() == 'swapsutra@okhdfcbank')
        ck('Admin: no horizontal scroll', no_hscroll(pg))
        shot(pg, 'admin-payment')
    else:
        ck('Admin console opened', False, 'management tabs not found')
    ck('No page errors', not errs, errs[:3])
    b.close()
print('\n%d passed, %d failed' % (ok, fail))
sys.exit(1 if fail else 0)
