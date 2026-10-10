"""
browser_mascot_banner.py — Playwright check (10 Oct 2026) of the animated
banners, against the built site with a mocked backend:
  - Library: the walking book comes forward, walks right and unrolls the
    banner (enter → walk → unfold → show); with ads it shows the ad
    (Sponsored), with no ads it features a book from the shelves
  - Mugs page: the walking mug unrolls a featured mug; with no mugs live it
    invites a mug idea
  - reduced motion: the banner is open and still from the start
  - no horizontal scroll at 375px; no page errors
Run: python3 spa.py dist 8977 & then BASE_URL=http://127.0.0.1:8977 python3 tests/browser_mascot_banner.py
"""
import json, os, sys
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:8977').rstrip('/')
SHOTS = os.environ.get('SHOTS', '')
DRV = "https://drive.google.com/thumbnail?id=DRIVEFILE0001&sz=w800"
BOOKS = [{"id": "B%d" % i, "title": "Book number %d" % i, "author": "Author %d" % i, "status": "Approved", "isbn": "97801434%05d" % i, "ownerEmail": "o@e.com",
          "ownerId": "R%d" % i, "imageUrls": DRV, "permanent_exchange": True, "genre": "Fiction", "condition": "Good"} for i in range(10)]
ADS = [{"id": "AD-1", "kind": "bookstore", "sponsor": "Bookworms", "headline": "Bookworms, Hazratganj", "tagline": "New and second-hand books",
        "imageUrl": DRV, "linkUrl": "https://example.com", "bookId": "", "ctaLabel": "", "placement": "both", "partner": True}]
MUGS = [{"id": "M1", "title": "Bookish Mug", "imageUrl": DRV, "price": 349, "category": "bookish", "description": "", "mrp": None, "currency": "INR",
         "availability": "", "sourceMarketplace": "Amazon", "sourceUrl": "https://amazon.in/x", "affiliateUrl": "", "vendor": "", "rating": None, "ratingCount": None, "ratingSource": ""}]
state = {"ads": ADS, "mugs": MUGS}
ok = fail = 0
def check(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1; print('PASS:', label)
    else: fail += 1; print('FAIL:', label, detail)
def api(route):
    req = route.request; body = {}
    if req.method == 'POST':
        try: body = json.loads(req.post_data or '{}')
        except Exception: pass
    u = req.url; act = body.get('action') or (u.split('action=')[1].split('&')[0] if 'action=' in u else '')
    if act == 'getBooks': return route.fulfill(json={"success": True, "data": BOOKS})
    if act == 'getSponsoredAds': return route.fulfill(json={"success": True, "items": state["ads"]})
    if act == 'getMugProducts': return route.fulfill(json={"success": True, "items": state["mugs"]})
    return route.fulfill(json={"success": True, "data": []})
def img(route):
    # a 1x1 png for every picture
    return route.fulfill(content_type='image/png', body=bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
        '1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2b3b1e80000000049454e44ae426082'))
def page(b, w=375, reduce=False):
    ctx = b.new_context(viewport={'width': w, 'height': 800}, reduced_motion='reduce' if reduce else 'no-preference')
    p = ctx.new_page(); errs = []
    p.on('pageerror', lambda e: errs.append(str(e)))
    p.route('**/api/**', api); p.route('**/*script.google.com/**', api)
    p.route('**/drive.google.com/**', img); p.route('**/books.google.com/**', img); p.route('**/covers.openlibrary.org/**', img)
    return ctx, p, errs
def no_hscroll(p): return p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
def phases(p, sel, ms=5000):
    return p.evaluate('''([sel, ms]) => new Promise(res => { const seen = []; const t0 = performance.now();
      const tick = () => { const el = document.querySelector(sel); const ph = el && el.getAttribute('data-phase');
        if (ph && seen[seen.length-1] !== ph) seen.push(ph); if (performance.now() - t0 > ms) return res(seen); requestAnimationFrame(tick); }; tick(); })''', [sel, ms])
with sync_playwright() as pw:
    b = pw.chromium.launch()
    errors = []
    # Library with an ad
    ctx, p, errs = page(b)
    p.goto(BASE + '/library'); p.wait_for_selector('[data-testid="library-banner"]', timeout=20000)
    p.locator('[data-testid="library-banner"]').scroll_into_view_if_needed()
    seen = phases(p, '[data-testid="library-banner"]', 4500)
    check('Library: the book comes forward, walks right, then unrolls the banner', all(x in seen for x in ['enter', 'walk', 'unfold', 'show']) and seen.index('enter') < seen.index('walk') < seen.index('unfold') < seen.index('show'), seen)
    lb = p.locator('[data-testid="library-banner"]')
    check('...the walking book is drawn', lb.locator('.ss-mascot--book .ss-mascot__svg, .ss-mascot__svg').count() >= 1 and 'ss-mascot--book' in (lb.get_attribute('class') or ''))
    check('...and the banner shows the ad, marked Sponsored', 'Bookworms, Hazratganj' in lb.inner_text() and 'sponsored' in lb.inner_text().lower())
    box = p.locator('[data-testid="library-banner"] .ss-mascot__char').bounding_box(); sbox = p.locator('[data-testid="library-banner"] .ss-mascot__stage').bounding_box()
    check('...the book ends at the right-hand side', box and sbox and box['x'] + box['width'] > sbox['x'] + sbox['width'] - 4, (box, sbox))
    check('Library banner: no horizontal scroll', no_hscroll(p))
    if SHOTS: lb.screenshot(path=os.path.join(SHOTS, 'library_banner_ad_375.png'))
    errors += errs; ctx.close()
    # Library with no ad: a featured book
    state["ads"] = []
    ctx, p, errs = page(b, 1280)
    p.goto(BASE + '/library'); p.wait_for_selector('[data-testid="library-banner"]', timeout=20000)
    p.locator('[data-testid="library-banner"]').scroll_into_view_if_needed(); p.wait_for_timeout(600)
    if SHOTS: p.locator('[data-testid="library-banner"]').screenshot(path=os.path.join(SHOTS, 'library_banner_walk_1280.png'))
    p.wait_for_function('document.querySelector(\'[data-testid="library-banner"]\').getAttribute("data-phase") === "show"', timeout=8000)
    t = p.locator('[data-testid="library-banner"]').inner_text()
    check('No ad running: the banner features a book from the shelves', 'Featured book' in t and 'Book number' in t and 'Sponsored' not in t, t[:120])
    if SHOTS: p.locator('[data-testid="library-banner"]').screenshot(path=os.path.join(SHOTS, 'library_banner_book_1280.png'))
    p.locator('[data-testid="library-banner"] .ss-mascot__cloth').click(); p.wait_for_timeout(500)
    check('...tapping it opens that book', p.locator('text=Book number').count() > 1)
    errors += errs; ctx.close()
    # Mugs page
    ctx, p, errs = page(b)
    p.goto(BASE + '/mugs'); p.wait_for_selector('[data-testid="mugs-banner"]', timeout=20000)
    p.locator('[data-testid="mugs-banner"]').scroll_into_view_if_needed()
    seen = phases(p, '[data-testid="mugs-banner"]', 4500)
    mb = p.locator('[data-testid="mugs-banner"]')
    check('Mugs: the walking mug unrolls the banner', 'ss-mascot--mug' in (mb.get_attribute('class') or '') and seen[-1:] == ['show'] and 'walk' in seen, seen)
    check('...featuring a mug', 'Featured mug' in mb.inner_text() and 'Bookish Mug' in mb.inner_text())
    check('Mugs banner: no horizontal scroll', no_hscroll(p))
    if SHOTS: mb.screenshot(path=os.path.join(SHOTS, 'mugs_banner_375.png'))
    errors += errs; ctx.close()
    state["mugs"] = []
    ctx, p, errs = page(b, 375, reduce=True)
    p.goto(BASE + '/mugs'); p.wait_for_selector('[data-testid="mugs-banner"]', timeout=20000)
    mb = p.locator('[data-testid="mugs-banner"]')
    check('Reduced motion: the banner is open and still at once', mb.get_attribute('data-phase') == 'show')
    check('No mugs yet: it invites a mug idea', 'Mugs are coming soon' in mb.inner_text() and 'Create your mug' in mb.inner_text())
    errors += errs; ctx.close()
    check('No page errors', not errors, errors[:3])
    b.close()
print(f'\n{ok} passed, {fail} failed')
sys.exit(1 if fail else 0)
