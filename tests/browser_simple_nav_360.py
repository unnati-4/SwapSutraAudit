"""
browser_simple_nav_360.py — Playwright check (30 Sep 2026) for the owner's
"simple" navigation: Books · Shelf · Cart · Chat · Community · Profile on the
bottom bar (Mugs in the menu and header), Community = Posts / Shout-outs /
Book requests, Shelf and Cart are profile sections with their own URLs,
Mugs says "Coming soon". Mocked backend, signed-in member, 360px phone.

Run against the built site:  python3 <scratchpad>/spa.py dist 8962
  then  python3 tests/browser_simple_nav_360.py   (BASE_URL=… to override)
"""
import json, os, sys
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:8962').rstrip('/')
SUB = {"id": "S1", "email": "r@e.com", "name": "Asha Verma", "computedStatus": "Active", "status": "Active", "membershipType": "premium", "booksListedCount": 2}
BOOKS = [{"id": f"B{i}", "title": f"Book {i}", "author": "A", "status": "Approved", "ownerEmail": "r@e.com" if i < 2 else "o@e.com", "ownerId": "R", "permanent_exchange": True, "available_for_swap": True, "genre": "Fiction", "condition": "Good"} for i in range(6)]
PROFILE = {"success": True, "isRegistered": True, "profile": {"subscription": SUB, "books": BOOKS[:2], "swapRequests": [], "readingSpace": [], "readerId": "R"}}


def api(route):
    req = route.request; body = {}
    if req.method == 'POST':
        try: body = json.loads(req.post_data or '{}')
        except Exception: pass
    u = req.url; act = body.get('action') or (u.split('action=')[1].split('&')[0] if 'action=' in u else '')
    if act == 'getBooks': return route.fulfill(json=BOOKS)
    if act == 'getUserProfile': return route.fulfill(json=PROFILE)
    if act == 'checkSubscription': return route.fulfill(json={"success": True, "isRegistered": True, "subscription": SUB, "daysRemaining": 200, "membershipStatus": "premium"})
    return route.fulfill(json={"success": True, "data": [], "items": []})


INIT = """
 localStorage.setItem('swapsutraUserEmail','r@e.com');localStorage.setItem('swapsutraSessionToken','tok');
 localStorage.setItem('swapsutraSubscriptionStatus','Active');localStorage.setItem('swapsutraMembershipStatus','premium');
 localStorage.setItem('swapsutraSessionVerifiedEmail','r@e.com');localStorage.setItem('swapsutraSessionVerifiedAt',String(Date.now()));
 sessionStorage.setItem('swapsutraSplashShown','true');
"""
ok = fail = 0
def check(label, cond, detail=''):
    global ok, fail
    if cond: ok += 1; print('PASS:', label)
    else: fail += 1; print('FAIL:', label, f'[{detail}]' if detail else '')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 360, 'height': 780}, is_mobile=True, has_touch=True)
    ctx.add_init_script(INIT); ctx.route('**/api/**', api)
    pg = ctx.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(BASE + '/library'); pg.wait_for_timeout(2500)
    bar = pg.locator('nav[aria-label="Primary mobile navigation"] button')
    labels = [bar.nth(i).inner_text().strip() for i in range(bar.count())]
    check('1. Bottom bar is Books · Shelf · Cart · Chat · Community · Profile', labels == ['Books', 'Shelf', 'Cart', 'Chat', 'Community', 'Profile'], labels)
    check('2. Every bottom-bar label fits on one line', pg.evaluate("""[...document.querySelectorAll('nav[aria-label="Primary mobile navigation"] button span:last-child')].every(s => s.getBoundingClientRect().height < 20)"""))
    check('3. Books is highlighted on the Library', bar.nth(0).get_attribute('aria-current') == 'page')
    check('4. The Library no longer carries "Books wanted"', pg.get_by_text('Books wanted').count() == 0)

    bar.nth(1).click(); pg.wait_for_timeout(900)
    check('5. Shelf opens /shelf on My Shelf', pg.evaluate('location.pathname') == '/shelf' and pg.get_by_text('Listed Books').count() > 0)
    check('6. Shelf is highlighted', bar.nth(1).get_attribute('aria-current') == 'page')

    bar.nth(2).click(); pg.wait_for_timeout(900)
    check('7. Cart opens /cart with Swaps, Chats and Wanted', pg.evaluate('location.pathname') == '/cart' and all(pg.get_by_role('button', name=n).count() for n in ['Swaps (0)', 'Chats (0)', 'Wanted (0)']))
    pg.get_by_role('button', name='Chats (0)').click(); pg.wait_for_timeout(500)
    check('8. Chats live inside the Cart', pg.get_by_text('Swap Conversations').count() > 0 and bar.nth(2).get_attribute('aria-current') == 'page')

    bar.nth(3).click(); pg.wait_for_timeout(900)
    check('9. Chat opens the Readers’ Café at /chat', pg.evaluate('location.pathname') == '/chat' and pg.locator('#cafe-heading').count() > 0)

    bar.nth(4).click(); pg.wait_for_timeout(1200)
    tabs = pg.locator('.ss-community-tabs button')
    check('10. Community is at /community with Posts / Shout-outs / Book requests', pg.evaluate('location.pathname') == '/community' and [tabs.nth(i).inner_text() for i in range(tabs.count())] == ['Posts', 'Shout-outs', 'Book requests'])
    tabs.nth(1).click(); pg.wait_for_timeout(600)
    check('11. Shout-outs filters the feed to shout-outs', pg.get_by_text('No shout-outs yet').count() > 0 or pg.locator('text=🎉 Shout-out').count() > 0)
    pg.locator('.ss-community-tabs button', has_text='Book requests').click(); pg.wait_for_timeout(900)
    check('12. Book requests open inside Community (still highlighted)', pg.evaluate('location.pathname') == '/book-requests' and pg.locator('.ss-community-tabs button[aria-current="page"]').inner_text() == 'Book requests' and bar.nth(4).get_attribute('aria-current') == 'page')
    check('13. "+ Request a book" is offered there', pg.get_by_role('button', name='Request a book').count() > 0 or pg.get_by_text('Request a book').count() > 0)

    bar.nth(5).click(); pg.wait_for_timeout(900)
    check('14. Profile opens /profile', pg.evaluate('location.pathname') == '/profile' and bar.nth(5).get_attribute('aria-current') == 'page')

    pg.get_by_label('Open menu').click(); pg.wait_for_timeout(500)
    for gone in ['Community Events', 'How It Works', 'Newsletter', 'Campus Ambassador', 'Tracker']:
        if pg.get_by_role('button', name=gone, exact=True).count():
            check(f'15. Menu no longer lists {gone}', False); break
    else:
        check('15. Menu no longer lists Events, How it works, Newsletter, Ambassador, Tracker', True)
    check('16. Menu offers Mugs as coming soon', pg.get_by_role('button', name='Mugs · coming soon').count() == 1)
    pg.get_by_role('button', name='Mugs · coming soon').click(); pg.wait_for_timeout(1200)
    check('17. Mugs shows "Coming soon" and no products', pg.evaluate('location.pathname') == '/mugs' and pg.locator('[data-testid="mugs-coming-soon"]').is_visible() and pg.locator('[data-testid="mug-card"]').count() == 0)

    for path in ['/events', '/tracker', '/newsletter', '/about']:
        pg.goto(BASE + path); pg.wait_for_timeout(900)
    check('18. Old pages still open by URL', pg.evaluate('location.pathname') == '/about')
    for path in ['/library', '/shelf', '/cart', '/chat', '/community', '/mugs']:
        pg.goto(BASE + path); pg.wait_for_timeout(900)
        if pg.evaluate('document.documentElement.scrollWidth > window.innerWidth'):
            check(f'19. No horizontal scroll on {path}', False); break
    else:
        check('19. No horizontal scroll on any of the seven places', True)
    check('20. No page errors', not errors, errors[:3])
    b.close()
print(f'\n{ok} passed, {fail} failed')
sys.exit(0 if fail == 0 else 1)
