"""
browser_e2e_new_user_375.py (11 Oct 2026, final launch check) — the built
site at 375px against the REAL backend logic (tests/e2e/bridge.cjs runs
appsscript.js behind an /api/swapsutra shaped like production):
  sign up → email code → list a book with a photo → a second reader finds
  it and asks to buy → the owner accepts → the owner records the condition
  video in the in-app recorder (fake camera) → the buyer reaches the room
  from Chat → pays (UTR + screenshot) → the admin approves in Payments →
  the owner's room moves on to packing.
Run: python3 spa.py dist 8977 &  node tests/e2e/bridge.cjs 8990 &
     python3 tests/browser_e2e_new_user_375.py
"""
import json, os, sys, re, struct, tempfile, zlib, urllib.request
from playwright.sync_api import sync_playwright
BASE='http://127.0.0.1:8977'; BR='http://127.0.0.1:8990'
SC=tempfile.mkdtemp() + '/'
SH=os.environ.get('SHOTS', SC)
if not SH.endswith('/'): SH += '/'
def _png(w, h):
    raw = b''.join(b'\x00' + bytes([150, 60, 80]) * w for _ in range(h))
    def ch(t, d): c = struct.pack('>I', len(d)) + t + d; return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')
open(SC + 'cover.png', 'wb').write(_png(300, 450))
BASE=os.environ.get('BASE_URL', BASE).rstrip('/'); BR=os.environ.get('BRIDGE_URL', BR).rstrip('/')
RESULTS=[]
def check(label, cond):
    RESULTS.append(bool(cond)); print(('PASS  ' if cond else 'FAIL  ') + label)
def bridge(route):
    req = route.request
    url = req.url.replace(BASE, BR)
    r = urllib.request.Request(url, data=(req.post_data.encode() if req.post_data else None), method=req.method,
        headers={k: v for k, v in req.headers.items() if k.lower() in ('content-type', 'authorization')})
    try:
        with urllib.request.urlopen(r) as resp: body = resp.read(); code = resp.status
    except urllib.error.HTTPError as e: body = e.read(); code = e.code
    route.fulfill(status=code, body=body, headers={'content-type': 'application/json'})
def otp(email): return json.load(urllib.request.urlopen(BR + '/__otp?email=' + email))['otp']
def rows(sheet): return json.load(urllib.request.urlopen(BR + '/__rows?sheet=' + sheet))
def page(b, errs, w=375):
    ctx = b.new_context(viewport={'width': w, 'height': 800})
    p = ctx.new_page(); p.on('pageerror', lambda e: errs.append(str(e))); p.route('**/api/**', bridge)
    return p
def signup(p, name, email, phone):
    p.goto(BASE + '/'); p.wait_for_timeout(1500)
    p.get_by_role('button', name='Join', exact=True).first.click(); p.wait_for_timeout(600)
    p.get_by_text('Sign Up', exact=True).first.click(); p.wait_for_timeout(600)
    p.fill('input[name=name]', name); p.fill('input[name=email]', email); p.fill('input[name=phone]', phone)
    p.get_by_role('button', name='JOIN SWAPSUTRA').click(); p.wait_for_timeout(2000)
    p.locator('input[autocomplete="one-time-code"]:visible').first.fill(otp(email))
    p.get_by_role('button', name='Verify & Sign In').click(); p.wait_for_timeout(3500)
def list_book(p, title, author, isbn, mrp, sell=None, rent=None):
    p.get_by_role('button', name='ENTER ISBN').click(); p.wait_for_timeout(400)
    p.locator('input[placeholder="e.g. 978-0-06-112008-4"]:visible').last.fill(isbn)
    p.get_by_role('button', name='FIND BOOK').click(); p.wait_for_timeout(1500)
    f = p.locator('form:has(input[name=title])')
    f.locator('input[name=title]').fill(title); f.locator('input[name=author]').fill(author)
    f.locator('input[name=copyType]').first.check(force=True); p.wait_for_timeout(200)
    if sell: f.locator('input[name=readingSell]').check(force=True)
    if rent: f.locator('input[name=readingRent]').check(force=True)
    p.wait_for_timeout(300)
    f.locator('select[name=condition]').select_option('Good'); f.locator('select[name=genre]').select_option('Fiction')
    f.locator('input[name=area]').fill('Hazratganj'); f.locator('input[name=pincode]').fill('226001')
    f.locator('input[name=mrp]').fill(str(mrp))
    if sell and f.locator('input[name=sellPrice]').count(): f.locator('input[name=sellPrice]').fill(str(sell))
    if rent and f.locator('input[name=rentPrice], input[name=rentPerMonth]').count(): f.locator('input[name=rentPrice], input[name=rentPerMonth]').first.fill(str(rent))
    f.locator('input[type=file]').first.set_input_files(SC + 'cover.png'); p.wait_for_timeout(1200)
    f.locator('input[name=copyTypeDeclaration]').check(force=True)
    bad = f.evaluate('''f => Array.from(f.querySelectorAll('input,select,textarea')).filter(e => !e.checkValidity()).map(e => e.name + ':' + e.validationMessage)''')
    if bad: print('INVALID', bad)
    f.locator('button[type=submit]').click(); p.wait_for_timeout(4000)
    t = p.locator('[role=alert], [role=status]').all_inner_texts(); check('listed: ' + title, any('live in the Library' in x for x in t))
    for lbl in ["I'LL DO THIS LATER", "I’LL DO THIS LATER"]:
        if p.get_by_role('button', name=lbl).count(): p.get_by_role('button', name=lbl).first.click(); p.wait_for_timeout(300)
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    errs = []
    m = page(b, errs)
    signup(m, 'Meera Sharma', 'meera@gmail.com', '9876543210')
    list_book(m, 'The Alchemist', 'Paulo Coelho', '9780062315007', 350, sell=250)
    a = page(b, errs)
    signup(a, 'Arjun Verma', 'arjun@gmail.com', '9812345678')
    if a.get_by_role('button', name='CANCEL').count(): a.get_by_role('button', name='CANCEL').first.click(); a.wait_for_timeout(500)
    a.goto(BASE + '/library'); a.wait_for_timeout(2500)
    a.screenshot(path=SH + '10-arjun-library.png')
    card = a.get_by_text('The Alchemist').first
    check('the second reader sees the book in the Library', card.count() > 0)
    card.click(); a.wait_for_timeout(2000)
    a.screenshot(path=SH + '11-book.png')
    a.get_by_role('button', name=re.compile('add to cart', re.I)).first.click(); a.wait_for_timeout(800)
    a.screenshot(path=SH + '12-cart-menu.png')
    print('menu', [x.inner_text().strip()[:40] for x in a.locator('button:visible, [role=menuitem]:visible').all()][:14])
    a.get_by_text(re.compile('^Buy', re.I)).first.click(); a.wait_for_timeout(1200)
    a.screenshot(path=SH + '13-buy-modal.png')
    print('modal buttons', [x.inner_text().strip()[:40] for x in a.locator('button:visible').all()][:10])
    a.locator('input[type=checkbox]:visible').last.check(force=True)
    a.get_by_role('button', name=re.compile('send buy interest', re.I)).first.click(); a.wait_for_timeout(3000)
    print('toast', a.locator('[role=alert], [role=status]').all_inner_texts()[:2])
    a.screenshot(path=SH + '14-after-request.png')
    check('the buy request reaches the backend', [(r['serviceType'], r['status']) for r in rows('SwapRequests')] == [('SELL', 'Pending')])
    # Meera answers
    m.goto(BASE + '/cart'); m.wait_for_timeout(2500)
    m.screenshot(path=SH + '15-meera-cart.png', full_page=True)
    m.get_by_role('button', name=re.compile('Waiting on you', re.I)).first.click(); m.wait_for_timeout(1500)
    m.screenshot(path=SH + '16-waiting.png', full_page=True)
    acc = m.get_by_role('button', name=re.compile('^accept', re.I))
    check('the owner sees Accept', acc.count() == 1)
    acc.first.click(); m.wait_for_timeout(3500)
    print('toast', m.locator('[role=alert], [role=status]').all_inner_texts()[:2])
    m.screenshot(path=SH + '17-after-accept.png')
    print('url', m.url)
    print('SwapRequests', [(r['serviceType'], r['status']) for r in rows('SwapRequests')])
    m.get_by_role('button', name=re.compile('record', re.I)).first.click(); m.wait_for_timeout(2500)
    m.screenshot(path=SH + '20-recorder.png')
    m.get_by_role('button', name=re.compile('start recording', re.I)).click(); m.wait_for_timeout(4500)
    m.screenshot(path=SH + '21-recording.png')
    print('rec btns', [x.inner_text().strip()[:30] for x in m.locator('[role=dialog] button:visible, button:visible').all() if x.inner_text().strip()][:8])
    m.get_by_role('button', name=re.compile('stop|done|finish', re.I)).first.click(); m.wait_for_timeout(2500)
    m.screenshot(path=SH + '22-recorded.png')
    print('after stop', [x.inner_text().strip()[:30] for x in m.locator('button:visible').all() if x.inner_text().strip()][:8])
    up = m.get_by_role('button', name=re.compile('use this video', re.I))
    if up.count(): up.first.click(); m.wait_for_timeout(5000)
    m.screenshot(path=SH + '23-uploaded.png')
    print('toast', m.locator('[role=alert], [role=status]').all_inner_texts()[:2])
    check('the condition video is recorded in the app and stored', [(v['kind'], v['leg']) for v in rows('ExchangeVideos')] == [('QUALITY', 'outbound')])
    a.goto(BASE + '/library'); a.wait_for_timeout(2000)
    a.get_by_role('button', name='Chat', exact=True).first.click(); a.wait_for_timeout(2500)
    a.screenshot(path=SH + '24a-arjun-chat.png')
    a.get_by_test_id('cafe-exchange-chats').click(); a.wait_for_timeout(2000)
    a.screenshot(path=SH + '24c-arjun-cart-chats.png')
    a.get_by_text('The Alchemist').first.click(); a.wait_for_timeout(3000)
    a.screenshot(path=SH + '24-arjun-room.png')
    a.screenshot(path=SH + '24b-arjun-room-full.png', full_page=True)
    a.fill('input[placeholder="UTR / transaction reference"]', '412345678901')
    a.locator('input[type=file]').first.set_input_files(SC + 'cover.png'); a.wait_for_timeout(500)
    pb = a.get_by_role('button', name=re.compile('i have paid|submit|send payment|paid', re.I))
    print('pay btns', pb.all_inner_texts()[:3]); pb.first.click(); a.wait_for_timeout(3000)
    print('toast', a.locator('[role=alert], [role=status]').all_inner_texts()[:2])
    a.screenshot(path=SH + '25-arjun-paid.png')
    check('the buyer\'s payment is sent for verification', [(f['payerRole'], f['adminStatus']) for f in rows('SecurityFeePayments')] == [('requester', 'ADMIN_PENDING')])
    # Admin approves from the admin console
    ad = page(b, errs, 1280)
    ad.goto(BASE + '/'); ad.wait_for_timeout(1500)
    ad.get_by_role('button', name='Join', exact=True).first.click(); ad.wait_for_timeout(500)
    ad.get_by_text('Login', exact=True).first.click(); ad.wait_for_timeout(500)
    ad.locator('input[type=email]:visible').first.fill('swapsutra@gmail.com')
    ad.get_by_role('button', name=re.compile('send|code|continue', re.I)).first.click(); ad.wait_for_timeout(2000)
    ad.locator('input[autocomplete="one-time-code"]:visible').first.fill(otp('swapsutra@gmail.com'))
    ad.get_by_role('button', name='Verify & Sign In').click(); ad.wait_for_timeout(3500)
    ad.screenshot(path=SH + '26-admin.png')
    ad.goto(BASE + '/management'); ad.wait_for_timeout(3000)
    ad.get_by_role('button', name=re.compile('^Payments$', re.I)).first.click(); ad.wait_for_timeout(3000)
    ad.screenshot(path=SH + '27-admin-payments.png', full_page=True)
    ad.get_by_role('button', name=re.compile('^review$', re.I)).first.click(); ad.wait_for_timeout(1500)
    ad.screenshot(path=SH + '27b-admin-review.png', full_page=True)
    apb = ad.get_by_role('button', name='Approve', exact=True)
    print('approve btns', apb.count())
    apb.first.click(); ad.wait_for_timeout(3000)
    check('the admin approves it from Payments', [(f['payerRole'], f['adminStatus']) for f in rows('SecurityFeePayments')] == [('requester', 'ADMIN_APPROVED')])
    # Meera continues: packing + handover + route etc. visible in her room
    m.goto(BASE + '/cart'); m.wait_for_timeout(2500)
    m.screenshot(path=SH + '27c-meera-cart.png')
    print('meera cart', [x.inner_text().strip()[:30] for x in m.locator('button:visible').all() if x.inner_text().strip()][:24])
    m.get_by_role('button', name=re.compile('Chats', re.I)).first.click(); m.wait_for_timeout(1500)
    m.get_by_test_id('cart-chat').first.click(); m.wait_for_timeout(3000)
    m.screenshot(path=SH + '28-meera-room-after-pay.png')
    check('the owner\'s room moves on to the packing video', m.get_by_text('Packaging video').count() > 0)
    check('no page errors', not errs)
    b.close()
print('%d passed, %d failed' % (sum(RESULTS), len(RESULTS) - sum(RESULTS)))
sys.exit(0 if all(RESULTS) else 1)
