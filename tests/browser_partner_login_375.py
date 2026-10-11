"""
browser_partner_login_375.py (11 Oct 2026) — against the real backend
(tests/e2e/bridge.cjs): a library verifies its email on /partners and
never sees the reader "activate membership" popup; after the admin
approves it, signing in on /partners again opens the partner dashboard.
Run: python3 spa.py dist 8977 &  node tests/e2e/bridge.cjs 8990 &
     python3 tests/browser_partner_login_375.py
"""
import json, os, sys, urllib.request
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:8977').rstrip('/'); BR = os.environ.get('BRIDGE_URL', 'http://127.0.0.1:8990').rstrip('/')
R = []
def check(label, cond): R.append(bool(cond)); print(('PASS  ' if cond else 'FAIL  ') + label)
def bridge(route):
    req = route.request
    r = urllib.request.Request(req.url.replace(BASE, BR), data=(req.post_data.encode() if req.post_data else None), method=req.method,
        headers={k: v for k, v in req.headers.items() if k.lower() in ('content-type', 'authorization')})
    try:
        with urllib.request.urlopen(r) as resp: body = resp.read(); code = resp.status
    except urllib.error.HTTPError as e: body = e.read(); code = e.code
    route.fulfill(status=code, body=body, headers={'content-type': 'application/json'})
def otp(email): return json.load(urllib.request.urlopen(BR + '/__otp?email=' + email))['otp']
def api(body, token=None):
    h = {'content-type': 'application/json'}
    if token: h['authorization'] = 'Bearer ' + token
    return json.load(urllib.request.urlopen(urllib.request.Request(BR + '/api/swapsutra', data=json.dumps(body).encode(), headers=h, method='POST')))
EMAIL = 'gomti.library@gmail.com'
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
def sign_in(pg):
    pg.goto(BASE + '/partners'); pg.wait_for_timeout(1800)
    pg.fill('[data-testid="partner-verify"] input[type="email"]', EMAIL); pg.click('text=Send code'); pg.wait_for_timeout(1200)
    pg.fill('[data-testid="partner-verify"] input[aria-label="Code"]', otp(EMAIL)); pg.click('text=Verify'); pg.wait_for_timeout(3500)
with sync_playwright() as pw:
    b = pw.chromium.launch(); errs = []
    ctx = b.new_context(viewport={'width': 375, 'height': 812}); pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/api/**', bridge)
    sign_in(pg)
    check('A new partner who verifies on /partners sees the type choice', pg.locator('[data-testid="partner-type-pick"]').count() == 1)
    pg.wait_for_timeout(1500)
    check('...and never the reader "activate membership" popup', pg.get_by_text("You're almost inside the reader circle").count() == 0)
    pg.goto(BASE + '/library'); pg.wait_for_timeout(2500)
    check('...not even after moving to another page', pg.get_by_text("You're almost inside the reader circle").count() == 0)
    # Apply and get approved (through the API, the form itself is covered elsewhere).
    api({'action': 'sendOTP', 'email': EMAIL, 'purpose': 'partner'})
    tok = api({'action': 'verifyOTP', 'email': EMAIL, 'otp': otp(EMAIL), 'purpose': 'partner'})['sessionToken']
    app = api({'action': 'submitPartnerApplication', 'type': 'library', 'name': 'Gomti Reading Library', 'contactName': 'Ramesh Gupta', 'phone': '9876501234', 'about': 'Community library',
               'address': '14 Gomti Nagar', 'city': 'Lucknow', 'pincode': '226010', 'lat': 26.85, 'lng': 80.99, 'placeLabel': 'Gomti', 'registeredName': 'Ramesh Gupta', 'panNumber': 'ABCDE1234F',
               'aadhaarLast4': '4321', 'showBanner': True, 'runAds': True, 'typeFields': {'libraryType': 'Community'}, 'docs': {'aadhaar': PNG, 'pan': PNG, 'businessProof': PNG}, 'agree': True,
               'signedName': 'Ramesh Gupta', 'contractVersion': 'library-2026-10-11', 'payout': {'upiId': 'gomti@okhdfcbank', 'payeeName': 'Ramesh Gupta'}}, tok)
    api({'action': 'sendOTP', 'email': 'swapsutra@gmail.com'})
    atok = api({'action': 'verifyOTP', 'email': 'swapsutra@gmail.com', 'otp': otp('swapsutra@gmail.com')})['sessionToken']
    ok = api({'action': 'adminReviewPartner', 'id': app.get('id'), 'decision': 'approve'}, atok)
    check('The application is received and approved', app.get('success') and ok.get('success'))
    ctx.close()
    ctx = b.new_context(viewport={'width': 375, 'height': 812}); pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.route('**/api/**', bridge)
    pg.goto(BASE + '/library'); pg.wait_for_timeout(1500)
    pg.get_by_role('button', name='Join', exact=True).first.click(); pg.wait_for_timeout(500)
    sign_in(pg)
    check('Later, signing in on /partners with the same email opens the partner dashboard', pg.get_by_text('Gomti Reading Library').count() > 0 and pg.locator('[data-testid="partner-verify"]').count() == 0)
    check('no page errors', not errs)
    b.close()
print('%d passed, %d failed' % (sum(R), len(R) - sum(R))); sys.exit(0 if all(R) else 1)
