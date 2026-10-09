"""
browser_open_pages_360.py — Playwright check (30 Sep 2026) for "remove the
authentication required block from every page, instead a non-registered
user will not be able to perform any activity without registering".

A signed-out visitor on a 360px phone, mocked backend:
  - every public page opens (no wall, no "Authentication Required"),
  - the Reading Room feed shows posts without any email address,
  - posting, reacting, requesting a book and the cart's actions open
    sign-in instead of doing anything,
  - Profile / Shelf ask to sign in rather than showing a wall.

Run against the built site:  python3 <scratchpad>/spa.py dist 8962
  then  python3 tests/browser_open_pages_360.py   (BASE_URL=… to override)
"""
import json, os, sys
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:8962').rstrip('/')
POSTS = [{"id": "P1", "authorEmail": "", "authorReaderId": "Rabc", "authorName": "Asha", "postType": "thought", "content": "Finished Train to Pakistan last night.", "isSpoiler": False, "reactionsCount": 2, "userReaction": None, "commentsCount": 0, "comments": [], "createdAt": "2026-09-29T10:00:00Z"}]
calls = []

def api(route):
    req = route.request; body = {}
    if req.method == 'POST':
        try: body = json.loads(req.post_data or '{}')
        except Exception: pass
    u = req.url; act = body.get('action') or (u.split('action=')[1].split('&')[0] if 'action=' in u else '')
    calls.append(act)
    if act == 'getReadingRoomFeed': return route.fulfill(json={"success": True, "posts": POSTS})
    if act == 'getBooks': return route.fulfill(json=[])
    return route.fulfill(json={"success": True, "data": [], "items": []})

ok = fail = 0
def check(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1; print('PASS:', label)
    else: fail += 1; print('FAIL:', label, f'[{detail}]' if detail else '')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 360, 'height': 780}, is_mobile=True, has_touch=True)
    ctx.add_init_script("try{sessionStorage.setItem('swapsutraSplashShown','true')}catch(e){}")
    ctx.route('**/api/**', api)
    pg = ctx.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    modal = lambda: pg.locator('[data-testid="login-modal"]').count() > 0
    close = lambda: pg.keyboard.press('Escape') or pg.evaluate("document.querySelector('[data-testid=\"login-modal\"] button')?.click()")

    walls = []
    for path in ['/library', '/community', '/book-requests', '/events', '/newsletter', '/chat', '/cart', '/mugs']:
        pg.goto(BASE + path); pg.wait_for_timeout(1300)
        if pg.evaluate('location.pathname') != path or pg.get_by_text('Authentication Required').count() or pg.get_by_text('member-only').count():
            walls.append((path, pg.evaluate('location.pathname')))
    check('1. Every page opens for a visitor, no wall', not walls, walls)

    pg.goto(BASE + '/community'); pg.wait_for_timeout(1500)
    check('2. The Reading Room feed shows to a visitor', pg.get_by_text('Finished Train to Pakistan last night.').count() == 1)
    check('3. No email address appears on the page', '@' not in pg.inner_text('main') if pg.locator('main').count() else True)
    pg.get_by_text('What are you reading? Write a post or share a photo…').click(); pg.wait_for_timeout(500)
    check('4. Writing a post asks the visitor to sign in', modal())
    close(); pg.wait_for_timeout(300)

    pg.goto(BASE + '/book-requests'); pg.wait_for_timeout(1200)
    check('5. Book requests: an invite, not a wall', pg.locator('[data-testid="book-requests-invite"]').is_visible())
    pg.get_by_role('button', name='Register to take part').click(); pg.wait_for_timeout(400)
    check('6. …and taking part asks to sign in', modal())
    close(); pg.wait_for_timeout(300)

    pg.goto(BASE + '/cart'); pg.wait_for_timeout(1200)
    check('7. The Cart opens for a visitor (empty)', pg.locator('[data-testid="cart-page"]').is_visible() and pg.get_by_text('Your cart is empty').count() == 1)
    pg.get_by_role('tab', name='Wishlist').click(); pg.wait_for_timeout(300)
    pg.get_by_role('button', name='Request a book').first.click(); pg.wait_for_timeout(400)
    check('8. Requesting a book from the Cart asks to sign in', modal())
    close(); pg.wait_for_timeout(300)

    pg.goto(BASE + '/library'); pg.wait_for_timeout(1200)
    bar = pg.locator('nav[aria-label="Primary mobile navigation"] button')
    bar.nth(5).click(); pg.wait_for_timeout(500)
    check('9. Profile asks a visitor to sign in (no wall page)', modal() and pg.evaluate('location.pathname') == '/library')
    close(); pg.wait_for_timeout(300)
    bar.nth(1).click(); pg.wait_for_timeout(500)
    check('10. Shelf asks a visitor to sign in', modal())
    close(); pg.wait_for_timeout(300)
    pg.goto(BASE + '/profile'); pg.wait_for_timeout(1200)
    check('11. /profile typed directly: Library + sign-in, never a wall', pg.evaluate('location.pathname') == '/library' and modal() and pg.get_by_text('Authentication Required').count() == 0)
    check('12. No page errors', not errors, errors[:3])
    b.close()
print(f'\n{ok} passed, {fail} failed')
sys.exit(0 if fail == 0 else 1)
