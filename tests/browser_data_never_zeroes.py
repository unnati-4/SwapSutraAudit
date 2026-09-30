"""
browser_data_never_zeroes.py — Playwright check (25 Sep 2026) for
"use karte hue bich me sab 0 ho jata hai".

With a mocked backend that fails the way Apps Script does (502 "page not
found", "Server Error: …" JSON), checks at 375px that:
  - a first load that fails once still shows the Library (retry),
  - a background refresh that fails keeps the Library on screen (no "0"),
  - the cached Library is not overwritten with an empty list,
  - a failed profile refresh keeps My Books and its count.

Run against the built site:  npx vite preview --port 8962  then
  python3 tests/browser_data_never_zeroes.py     (BASE_URL=… to override)
"""
import json, os, sys
from playwright.sync_api import sync_playwright
BASE=os.environ.get('BASE_URL','http://127.0.0.1:8962').rstrip('/')
SUB={"id":"S1","email":"r@e.com","name":"Asha Verma","computedStatus":"Active","status":"Active","membershipType":"premium","booksListedCount":2}
BOOKS=[{"id":f"B{i}","title":f"Book {i}","author":"A","status":"Approved","ownerEmail":"r@e.com" if i<2 else "o@e.com","ownerId":"R","permanent_exchange":True,"available_for_swap":True,"genre":"Fiction","condition":"Good"} for i in range(6)]
PROFILE={"success":True,"isRegistered":True,"profile":{"subscription":SUB,"books":BOOKS[:2],"swapRequests":[],"readingSpace":[],"readerId":"R"}}
mode={'books':[], 'profile':[]}   # queued failures per action
calls={'getBooks':0,'getUserProfile':0}
FAIL_502={"status":502,"json":{"success":False,"error":"BACKEND_DEPLOYMENT_NOT_FOUND","message":"SwapSutra is having trouble reaching its library right now. Please try again in a few minutes."}}
FAIL_SE={"status":200,"json":{"success":False,"message":"Server Error: Exception: Service Spreadsheets timed out while accessing document"}}
def api(route):
    req=route.request; body={}
    if req.method=='POST':
        try: body=json.loads(req.post_data or '{}')
        except: pass
    u=req.url; act=body.get('action') or (u.split('action=')[1].split('&')[0] if 'action=' in u else '')
    if act=='getBooks':
        calls['getBooks']+=1
        if mode['books']:
            f=mode['books'].pop(0); return route.fulfill(status=f['status'], json=f['json'])
        return route.fulfill(json=BOOKS)
    if act=='getUserProfile':
        calls['getUserProfile']+=1
        if mode['profile']:
            f=mode['profile'].pop(0); return route.fulfill(status=f['status'], json=f['json'])
        return route.fulfill(json=PROFILE)
    if act=='checkSubscription': return route.fulfill(json={"success":True,"isRegistered":True,"subscription":SUB,"daysRemaining":200,"membershipStatus":"premium"})
    return route.fulfill(json={"success":True,"data":[]})
INIT="""
 localStorage.setItem('swapsutraUserEmail','r@e.com');localStorage.setItem('swapsutraSessionToken','tok');
 localStorage.setItem('swapsutraSubscriptionStatus','Active');localStorage.setItem('swapsutraMembershipStatus','premium');
 localStorage.setItem('swapsutraSessionVerifiedEmail','r@e.com');localStorage.setItem('swapsutraSessionVerifiedAt',String(Date.now()));
 sessionStorage.setItem('swapsutraSplashShown','true');
"""
res=[]
def ck(l,c,d=''):
    res.append((l,bool(c))); print(("PASS: " if c else "FAIL: ")+l+((' ['+str(d)+']') if (d and not c) else ''))
def shelf_count(pg): return pg.locator('button.ss-shelf__book').count()
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':375,'height':812},is_mobile=True,has_touch=True)
    ctx.add_init_script(INIT); pg=ctx.new_page(); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route("**/api/swapsutra**", api); pg.route("**/api/books**", lambda r: r.fulfill(status=404, json={}))

    # 1. First load: Apps Script fails once, then answers.
    mode['books']=[FAIL_502]
    pg.goto(BASE+'/library'); pg.wait_for_timeout(6000)
    ck("1. A first load that fails once still shows the Library", shelf_count(pg)==6, shelf_count(pg))

    # 2. Background refresh fails three times (the retries too) → shelf stays.
    mode['books']=[FAIL_502, FAIL_SE, FAIL_502]
    before_calls=calls['getBooks']
    # Move the page clock past the 60 s refresh throttle, then do what a
    # tab switch does (focus) — the real trigger for the background refresh.
    pg.evaluate("(() => { const real = Date.now.bind(Date); Date.now = () => real() + 61000; })()")
    pg.evaluate("window.dispatchEvent(new Event('focus'))")
    pg.wait_for_timeout(6000)
    ck("2a. The failing refresh really happened (all three failures were served)", len(mode['books'])==0, (calls['getBooks']-before_calls, mode['books']))
    ck("2. A background refresh that fails keeps the Library on screen (no 0)", shelf_count(pg)==6, shelf_count(pg))
    body=pg.locator('body').inner_text()
    ck("3. The 'All' count does not drop to 0", 'All\n0' not in body and 'ALL\n0' not in body.upper().replace(' ',''))
    cached=pg.evaluate("""() => { for (const k of Object.keys(localStorage)) { if (/book/i.test(k) && /librar|cache/i.test(k)) { try { const v=JSON.parse(localStorage.getItem(k)); const arr=Array.isArray(v)?v:(v&&(v.data||v.value||v.items)); if (Array.isArray(arr)) return arr.length; } catch(e){} } } return -1; }""")
    ck("4. The saved Library is not overwritten with an empty list", cached!=0, cached)

    # 3. Profile refresh fails → My Books stays.
    pg.goto(BASE+'/profile'); pg.wait_for_timeout(4500)
    pg.evaluate("""() => {const b=[...document.querySelectorAll('button')].find(b=>/^My Books/i.test(b.innerText.trim())); if(b) b.click();}""")
    pg.wait_for_timeout(1200)
    tab_before=pg.evaluate("""() => {const b=[...document.querySelectorAll('button')].find(b=>/^My Books/i.test(b.innerText.trim())); return b?b.innerText.trim():''}""")
    mode['profile']=[FAIL_502, FAIL_SE, FAIL_502]
    ref=pg.get_by_role('button', name='Refresh')
    if ref.count(): ref.first.click()
    pg.wait_for_timeout(6000)
    tab_after=pg.evaluate("""() => {const b=[...document.querySelectorAll('button')].find(b=>/^My Books/i.test(b.innerText.trim())); return b?b.innerText.trim():''}""")
    ck("5. A failed profile refresh keeps 'My Books (2)'", tab_before=='My Books (2)' and tab_after=='My Books (2)', (tab_before, tab_after))
    ck("6. The profile was actually asked again (the failure was exercised)", calls['getUserProfile']>=2, calls['getUserProfile'])
    ck("7. No page errors", not errs, errs[:2])
    b.close()
f=[l for l,ok in res if not ok]
print("\n%d passed, %d failed (%d total)"%(len(res)-len(f),len(f),len(res)))
sys.exit(1 if f else 0)
