"""
browser_mugs_375.py — Playwright check (30 Sep 2026) for /mugs and the
custom mug enquiry, against the built site with a mocked backend.
  - /mugs loads, the empty shelf says "Products coming soon" (no fake products)
  - live products render with source label, price, MRP only when given
  - the enquiry: 4 steps, inline validation, custom capacity, image type
    checks, review brief, success ONLY when the server returns an id,
    server errors shown, no horizontal scroll, full-screen on a phone,
    nothing below 11px.
Run: python3 ../spa.py dist 8962 &  then  python3 tests/browser_mugs_375.py
"""
import json, os, sys, base64
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
try:
    import fontroute
except Exception:
    fontroute = None
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:8962').rstrip('/')
SHOTS = os.environ.get('SHOTS', '')
state = {'products': [], 'submit': [], 'reply': None}
ok = fail = 0
def check(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1; print('PASS:', label)
    else: fail += 1; print('FAIL:', label, detail)

def api(route):
    req = route.request; u = req.url; body = {}
    if req.method == 'POST':
        try: body = json.loads(req.post_data or '{}')
        except Exception: pass
    act = body.get('action') or (u.split('action=')[1].split('&')[0] if 'action=' in u else '')
    if act == 'getMugProducts': return route.fulfill(json={'success': True, 'items': state['products']})
    if act == 'submitCustomMugEnquiry':
        state['submit'].append(body)
        return route.fulfill(json=state['reply'] or {'success': True, 'id': 'MUG-20260930-AB12C'})
    if act == 'getBooks': return route.fulfill(json=[])
    return route.fulfill(json={'success': True, 'data': []})

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')

JS_SMALL = """() => { let min=99; for (const el of document.querySelectorAll('body *')) {
  if (![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())) continue;
  const r=el.getBoundingClientRect(); if(!r.width||!r.height) continue;
  const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none'||el.closest('.mug-hp')) continue;
  min=Math.min(min, parseFloat(cs.fontSize)); } return min; }"""

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True)
    ctx.route('**/api/**', api)
    if fontroute: fontroute.install(ctx)
    ctx.add_init_script("try{sessionStorage.setItem('swapsutraSplashShown','true')}catch(e){}")
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)[:150]))
    pg.goto(BASE + '/mugs'); pg.wait_for_selector('[data-testid="mugs-page"]', timeout=15000); pg.wait_for_timeout(600)
    check('1. /mugs opens with the hero headline', pg.get_by_text('Mugs for people who take their coffee personally.').is_visible())
    check('2. Empty shelf is honest: "Products coming soon", no product cards', pg.locator('[data-testid="mugs-empty"]').is_visible() and pg.locator('[data-testid="mug-card"]').count() == 0)
    check('3. No DEVELOPMENT ONLY samples on the built site', pg.get_by_text('DEVELOPMENT ONLY').count() == 0 and pg.get_by_text('DEV SAMPLE').count() == 0)
    # 30 Sep (owner's request): the shop is "Coming soon" (MUG_SHOP_OPEN = false).
    SHOP_OPEN = 'MUG_SHOP_OPEN = true' in open(os.path.join(os.path.dirname(__file__), '..', 'src', 'components', 'mugs', 'MugsPage.tsx')).read()
    if SHOP_OPEN:
        check('4. All six categories are there', all(pg.get_by_text(c).count() > 0 for c in ['Bookish Mugs', 'Minimal Mugs', 'Funny Reader Mugs', 'Café-Style Mugs', 'Aesthetic Mugs', 'Personalized Mugs']))
    else:
        check('4. Shop closed: "Coming soon" is shown and there are no categories', pg.locator('[data-testid="mugs-coming-soon"]').is_visible() and pg.get_by_text('Coming soon.').is_visible() and pg.get_by_text('Bookish Mugs').count() == 0)
    check('5. "Have a mug idea?" section is on the page', pg.get_by_text('Have a mug idea?').is_visible())
    check('6. No horizontal scroll on /mugs', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    check('7. Nothing smaller than 11px', pg.evaluate(JS_SMALL) >= 11)
    if SHOTS: pg.screenshot(path=f'{SHOTS}/mugs_375.png', full_page=True)

    # ── the enquiry ──
    pg.get_by_role('button', name='Create My Mug').click()
    dlg = pg.locator('[role="dialog"]')
    check('8. The enquiry opens full-screen on a phone', abs(dlg.bounding_box()['width'] - 375) < 2 and dlg.bounding_box()['height'] > 780)
    check('9. Progress shows 1 Idea / 2 Requirements / 3 Delivery / 4 Done', all(pg.locator('.mug-steps').get_by_text(x).count() for x in ['Idea', 'Requirements', 'Delivery', 'Done']))
    pg.get_by_role('button', name='Next').click(); pg.wait_for_timeout(150)
    errs = pg.locator('.mug-field__error').all_inner_texts()
    check('10. Next on an empty step shows inline messages for name, email, phone and idea', len(errs) == 4, errs)
    pg.fill('#mug-name', 'Asha Verma'); pg.fill('#mug-email', 'asha@bad'); pg.fill('#mug-phone', '12345')
    pg.fill('#mug-idea', 'A mug shaped like a stack of three hardbacks, spine text in gold, cream glaze.')
    pg.get_by_role('button', name='Next').click(); pg.wait_for_timeout(150)
    errs = pg.locator('.mug-field__error').all_inner_texts()
    check('11. Bad email and non-Indian phone are refused', any('email' in e for e in errs) and any('10-digit' in e for e in errs), errs)
    pg.fill('#mug-email', 'asha@example.com'); pg.fill('#mug-phone', '+91 98765 43210')
    # image: wrong type rejected, png accepted
    pg.set_input_files('#mug-image', files=[{'name': 'notes.gif', 'mimeType': 'image/gif', 'buffer': b'GIF89a'}]); pg.wait_for_timeout(200)
    check('12. A GIF reference image is refused with a clear message', pg.get_by_text('Please choose a JPG, PNG or WebP image.').is_visible())
    pg.set_input_files('#mug-image', files=[{'name': 'ref.png', 'mimeType': 'image/png', 'buffer': PNG}]); pg.wait_for_timeout(800)
    check('13. A PNG reference image is accepted and previewed', pg.locator('.mug-image img').count() == 1)
    pg.get_by_role('button', name='Next').click(); pg.wait_for_timeout(200)
    check('14. Step 2 (Requirements) is reached', pg.get_by_text('How much coffee should it hold?').is_visible())
    pg.get_by_role('button', name='Next').click(); pg.wait_for_timeout(150)
    errs = pg.locator('.mug-field__error').all_inner_texts()
    check('15. Style, capacity, quantity and budget are required', any('style' in e for e in errs) and any('hold' in e for e in errs) and any('how many' in e for e in errs) and any('budget' in e.lower() for e in errs), errs)
    pg.get_by_role('radio', name='Coffee Mug').click()
    pg.get_by_role('radio', name='Custom capacity').click()
    pg.fill('#mug-volumeCustomMl', '-5'); pg.get_by_role('button', name='Next').click(); pg.wait_for_timeout(150)
    check('16. Custom capacity must be a sensible positive number', pg.get_by_text('Enter a capacity between 30 and 2000 ml.').is_visible())
    pg.fill('#mug-volumeCustomMl', '350')
    check('17. The approximate-capacity note is shown', pg.get_by_text('Approximate capacity is fine').count() > 0)
    pg.locator('[aria-label="quantityRange"]').get_by_role('radio', name='6–20').click()
    pg.fill('#mug-quantityExact', '10')
    pg.get_by_role('radio', name='Per mug').click()
    pg.get_by_role('button', name='₹500–₹1,000').click()
    check('18. A budget chip fills the amount', pg.input_value('#mug-budgetAmount') == '1000')
    pg.fill('#mug-budgetAmount', '700')
    pg.get_by_role('button', name='Next').click(); pg.wait_for_timeout(150)
    check('19. Step 3 (Delivery) is reached', pg.get_by_text('Where should we deliver?').is_visible())
    pg.fill('#mug-pincode', '30200'); pg.get_by_role('button', name='Next').click(); pg.wait_for_timeout(150)
    check('20. Pincode must be exactly 6 digits', pg.get_by_text('Please enter a valid 6-digit pincode.').is_visible())
    pg.fill('#mug-pincode', '302001a1')
    check('21. Only digits are kept, max 6', pg.input_value('#mug-pincode') == '302001')
    pg.get_by_role('radio', name='Need it by a specific date').click()
    pg.get_by_role('button', name='Next').click(); pg.wait_for_timeout(150)
    check('22. A specific-date timeline needs the date', pg.get_by_text('Please pick the date you need it by.').is_visible())
    pg.get_by_role('radio', name='Within 1 month').click()
    pg.fill('#mug-additionalNotes', 'Gift for a book club.')
    pg.get_by_role('button', name='Next').click(); pg.wait_for_timeout(200)
    review = pg.locator('[data-testid="mug-review"]').inner_text()
    check('23. Review card "Your Mug Brief" shows style, capacity, quantity, budget, pincode, timeline',
          all(x in review for x in ['Your Mug Brief', 'Coffee Mug', '350 ml', '10 mugs', '₹700 per mug', '302001', 'Within 1 month']), review[:300])
    check('24. It says capacity is approximate and promises nothing', 'final usable volume will be confirmed during prototyping' in review and 'no price, maker or delivery date is promised' in review)
    check('25. The reference image is on the review', pg.locator('.mug-review__image').count() == 1)
    check('26. No horizontal scroll inside the form', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    if SHOTS: pg.screenshot(path=f'{SHOTS}/mug_review_375.png')
    # a server refusal is shown, not a fake success
    state['reply'] = {'success': False, 'error': 'VALIDATION', 'message': 'Please check the highlighted fields.', 'fieldErrors': {'pincode': 'Please enter a valid 6-digit pincode.'}}
    pg.get_by_role('button', name='Send My Mug Idea').click(); pg.wait_for_timeout(500)
    check('27. A server refusal is shown and the success screen does NOT appear', pg.locator('[data-testid="mug-done"]').count() == 0 and pg.get_by_text('Please check the highlighted fields.').is_visible())
    check('28. ...and it takes the reader back to the step with the problem', pg.get_by_text('Where should we deliver?').is_visible())
    state['reply'] = None
    pg.get_by_role('button', name='Next').click(); pg.wait_for_timeout(150)
    pg.get_by_role('button', name='Send My Mug Idea').click()
    pg.wait_for_selector('[data-testid="mug-done"]', timeout=5000)
    check('29. Success only after the server returns an id', pg.get_by_text('Your mug idea is on its way.').is_visible() and pg.get_by_text('MUG-20260930-AB12C').is_visible())
    s = state['submit'][-1]
    check('30. The request carries every field, capacity as a number (350 ml)',
          s['name'] == 'Asha Verma' and s['email'] == 'asha@example.com' and s['mugType'] == 'Coffee Mug' and s['volumeMl'] == 350
          and s['quantityRange'] == '6-20' and s['quantityExact'] == '10' and s['budgetType'] == 'per_mug' and s['budgetAmount'] == 700
          and s['pincode'] == '302001' and s['timeline'] == 'within_1_month' and s['additionalNotes'] == 'Gift for a book club.', json.dumps({k: v for k, v in s.items() if k != 'referenceImage'}))
    check('31. The reference image travels as a JPG/PNG/WebP data URL', s['referenceImage'].startswith('data:image/'))
    check('32. The honeypot is sent empty', s['website'] == '')
    check('33. No page errors', not errors, errors)

    # live products
    state['products'] = [
        {'id': 'p1', 'title': 'Stoneware reading mug', 'description': 'Matte cream glaze.', 'category': 'minimal', 'imageUrl': '', 'price': 749, 'mrp': 999, 'currency': 'INR', 'availability': '', 'sourceMarketplace': 'Amazon', 'sourceUrl': 'https://www.amazon.in/dp/EXAMPLE', 'affiliateUrl': 'https://www.amazon.in/dp/EXAMPLE?tag=x', 'vendor': '', 'rating': None, 'ratingCount': None, 'ratingSource': ''},
        {'id': 'p2', 'title': 'Hand-thrown café cup', 'description': 'From a Jaipur studio.', 'category': 'cafe-style', 'imageUrl': '', 'price': 1200, 'mrp': None, 'currency': 'INR', 'availability': 'Made to order', 'sourceMarketplace': '', 'sourceUrl': '', 'affiliateUrl': '', 'vendor': 'Studio Mitti', 'rating': None, 'ratingCount': None, 'ratingSource': ''},
    ]
    if not SHOP_OPEN:
        pg2 = ctx.new_page(); pg2.goto(BASE + '/mugs'); pg2.wait_for_selector('[data-testid="mugs-coming-soon"]', timeout=15000); pg2.wait_for_timeout(800)
        check('34. Shop closed: even with live rows in the feed, no product cards show', pg2.locator('[data-testid="mug-card"]').count() == 0)
        check('35. Shop closed: "Create Your Mug" still opens the enquiry', (pg2.get_by_role('button', name='Create Your Mug').first.click() or True) and pg2.locator('[role="dialog"]').first.is_visible())
    else:
        pg2 = ctx.new_page(); pg2.goto(BASE + '/mugs'); pg2.wait_for_selector('[data-testid="mug-card"]', timeout=15000)
        cards = pg2.locator('[data-testid="mug-card"]')
        check('34. Live products render as cards', cards.count() == 2)
        t = cards.nth(0).inner_text()
        check('35. An external product says where it is sold, shows price, MRP and the real saving', 'sold on amazon' in t.lower() and '₹749' in t and '₹999' in t and '25% off MRP' in t, t)
        check('36. No rating is shown when the source gave none', '★' not in pg2.locator('.mugs-grid').inner_text())
        buy = cards.nth(0).get_by_role('link')
        check('37. Buy Now goes out to the marketplace (sponsored, new tab)', buy.get_attribute('href').startswith('https://www.amazon.in/') and 'sponsored' in buy.get_attribute('rel') and buy.get_attribute('target') == '_blank')
        check('38. The affiliate/marketplace disclosure appears', pg2.get_by_text('not by SwapSutra').count() > 0)
        t2 = cards.nth(1).inner_text()
        check('39. A product without MRP shows no discount', 'off MRP' not in t2 and '₹1,200' in t2)
        pg2.get_by_role('button', name='Café-Style Mugs').click(); pg2.wait_for_timeout(200)
        check('40. Categories filter the grid', pg2.locator('[data-testid="mug-card"]').count() == 1)
        check('41. Two columns on a phone', len(set(round(c.bounding_box()['x']) for c in ctx.pages[-1].locator('[data-testid="mug-card"]').all())) >= 1 and pg2.evaluate("getComputedStyle(document.querySelector('.mugs-grid')).gridTemplateColumns.split(' ').length") == 2)
    b.close()
print(f'\n{ok} passed, {fail} failed')
sys.exit(0 if fail == 0 else 1)
