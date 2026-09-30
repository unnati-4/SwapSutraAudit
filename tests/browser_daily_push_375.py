"""
browser_daily_push_375.py — Playwright check (27 Sep 2026) for the daily
book updates, at 375px, against the built site with a mocked backend:
  - notifications are on by default: no card, no switch; the browser's
    own Allow box opens on the first tap, once (not on every tap),
  - a page opened from a push (?ss_push=morning) counts the tap and
    cleans the address bar,
  - /library?list=1 as a visitor opens sign-in.
Run: python3 ../spa.py dist 8962 &   then  python3 tests/browser_daily_push_375.py
"""
import json, os, sys
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:8962').rstrip('/')
BOOKS = [{"id": f"B{i}", "title": f"Book {i}", "author": "A", "status": "Approved", "ownerEmail": "o@e.com",
          "permanent_exchange": True, "available_for_swap": True, "genre": "Fiction", "condition": "Good"} for i in range(4)]
opens = []
ok = fail = 0
def check(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1; print('PASS:', label)
    else: fail += 1; print('FAIL:', label, detail)

def api(route):
    req = route.request; u = req.url
    if '/api/notifications/push-open' in u:
        opens.append(json.loads(req.post_data or '{}')); return route.fulfill(json={"success": True})
    if '/api/notifications/vapid-key' in u: return route.fulfill(json={"success": False, "configured": False})
    body = {}
    if req.method == 'POST':
        try: body = json.loads(req.post_data or '{}')
        except Exception: pass
    act = body.get('action') or (u.split('action=')[1].split('&')[0] if 'action=' in u else '')
    if act == 'getBooks': return route.fulfill(json=BOOKS)
    return route.fulfill(json={"success": True, "data": []})

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 375, 'height': 800}, is_mobile=True, has_touch=True)
    ctx.route('**/api/**', api)
    # Headless Chromium answers "denied" by default; a real first visit is
    # "default" (not asked yet), which is the case under test.
    ctx.add_init_script("window.__asked = 0; try { Object.defineProperty(Notification, 'permission', { get: () => 'default' }); Notification.requestPermission = () => { window.__asked++; return Promise.resolve('default'); }; } catch (e) {}")
    pg = ctx.new_page()
    pg.goto(BASE + '/library?ss_push=morning')
    pg.wait_for_selector('text=Book 1', timeout=15000)
    perm = pg.evaluate("typeof Notification !== 'undefined' ? Notification.permission : 'none'")
    has_push = pg.evaluate("'PushManager' in window && 'serviceWorker' in navigator")
    print('permission in this browser:', perm, 'push:', has_push)
    pg.wait_for_timeout(500)
    check('1. A push tap is counted (slot "morning")', any(o.get('slot') == 'morning' for o in opens), opens)
    check('2. ...and ?ss_push is removed from the address bar', 'ss_push' not in pg.url, pg.url)
    check('3. No card or banner asks anything — notifications are simply on', pg.locator('.ss-daily-ask').count() == 0 and pg.get_by_text('Not now').count() == 0)
    if has_push:
        check('4. Nothing is asked before the visitor touches the page', pg.evaluate('window.__asked') == 0)
        pg.mouse.click(5, 400)
        pg.wait_for_timeout(300)
        check('5. The first tap opens the browser\'s own Allow box', pg.evaluate('window.__asked') == 1)
        pg.mouse.click(5, 420); pg.wait_for_timeout(300)
        check('6. ...only once (not on every tap)', pg.evaluate('window.__asked') == 1)
        pg.reload(); pg.wait_for_selector('text=Book 1', timeout=15000)
        pg.mouse.click(5, 400); pg.wait_for_timeout(300)
        check('7. ...and not again the same day after a dismiss', pg.evaluate('window.__asked') == 0)
        check('8. No sideways scroll', pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
    pg2 = ctx.new_page()
    pg2.goto(BASE + '/library?list=1')
    pg2.wait_for_selector('text=Book 1', timeout=15000)
    pg2.wait_for_timeout(800)
    check('11. /library?list=1 as a visitor opens sign-in / sign-up', pg2.get_by_text("Tell us which one you're here for").first.is_visible())
    check('12. ...and ?list=1 is removed', 'list=1' not in pg2.url, pg2.url)
    b.close()
print(f'\n{ok} passed, {fail} failed')
sys.exit(0 if fail == 0 else 1)
