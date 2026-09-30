"""
browser_partial_listing_375.py — Playwright check at 375px (24 Sep 2026).

Verifies, against the built site with a mocked backend:
  - a front-cover-only listing can be submitted (nothing else is sent),
  - it shows "More photos coming" on its shelf tile and book page,
  - its owner gets the "finish your listing" prompt (My Books + book page)
    and the finish modal sends only the missing photos,
  - an unverified price shows "Estimated deposit (price not verified by
    the owner): ₹150" in the swap request,
  - opening the listing form is counted once (recordListingFormOpen).

Run:  npm run build && npx vite preview --port 8962   (or any static server
      that serves dist/ with SPA fallback), then
      python3 tests/browser_partial_listing_375.py
      BASE_URL=http://127.0.0.1:4173 python3 tests/browser_partial_listing_375.py
Needs: pip install playwright && playwright install chromium
"""
import base64, json, os, sys
from playwright.sync_api import sync_playwright
BASE=os.environ.get('BASE_URL','http://127.0.0.1:8962').rstrip('/')
JPEG=b''
SUB={"id":"S1","email":"r@e.com","name":"Asha Verma","computedStatus":"Active","status":"Active","membershipType":"premium","booksListedCount":1,"area":"Civil Lines","pincode":"247001"}
DRV="https://drive.google.com/thumbnail?id=DRIVEFILE0001&sz=w800"
OWN_PARTIAL={"id":"B_OWN","title":"My Half Listing","author":"Me","status":"Approved","isbn":"9780061120084","ownerEmail":"r@e.com","ownerId":"Rme",
  "imageUrls":DRV,"frontCoverImage":DRV,"backCoverImage":"","internalBookImage":"","internalBookVideo":"","permanent_exchange":True,"available_for_swap":True,"genre":"Fiction","condition":"Good"}
OTHER_PARTIAL={"id":"B_OTH","title":"Someone Else's Book","author":"Other","status":"Approved","isbn":"9780451526342","ownerEmail":"o@e.com","ownerId":"Roth",
  "imageUrls":DRV,"frontCoverImage":DRV,"missingPhotos":["back","inside"],"permanent_exchange":True,"temporary_exchange":True,"available_for_swap":True,"genre":"Fiction","condition":"Good"}
OTHER_FULL={"id":"B_FULL","title":"A Complete Listing","author":"Other","status":"Approved","isbn":"9781250301697","ownerEmail":"o@e.com","ownerId":"Roth",
  "imageUrls":DRV+"|"+DRV,"frontCoverImage":DRV,"backCoverImage":DRV,"internalBookImage":DRV,"permanent_exchange":True,"available_for_swap":True,"genre":"Fiction","condition":"Good"}
BOOKS=[OWN_PARTIAL,OTHER_PARTIAL,OTHER_FULL]
PROFILE={"success":True,"isRegistered":True,"profile":{"subscription":SUB,"books":[OWN_PARTIAL],"swapRequests":[],"readingSpace":[],"readerId":"Rme"}}
calls=[]; sent={}
def api(route):
    req=route.request; body={}
    if req.method=='POST':
        try: body=json.loads(req.post_data or '{}')
        except: pass
    u=req.url; act=body.get('action') or (u.split('action=')[1].split('&')[0] if 'action=' in u else '')
    calls.append(act)
    if act=='getBooks': return route.fulfill(json={"success":True,"data":BOOKS})
    if act=='checkSubscription': return route.fulfill(json={"success":True,"isRegistered":True,"subscription":SUB,"daysRemaining":200,"membershipStatus":"premium"})
    if act=='getUserProfile': return route.fulfill(json=PROFILE)
    if act=='createBook':
        sent['create']=body; return route.fulfill(json={"success":True,"id":"B_NEW","status":"Approved","message":"Your book is live in the Library."})
    if act=='updateUserBook':
        sent['update']=body; return route.fulfill(json={"success":True,"message":"Photos added.","data":{"missingPhotos":["inside"]}})
    if act=='getDepositQuote':
        return route.fulfill(json={"success":True,"requestedBookValue":250,"offeredBookValue":400,"requesterDeposit":150,"ownerDeposit":240,
          "ratePercent":60,"requesterDepositRatePercent":60,"ownerDepositRatePercent":60,"requesterDepositEstimated":True,"ownerDepositEstimated":False})
    if act=='lookupIsbn': return route.fulfill(json={"success":True,"found":False})
    return route.fulfill(json={"success":True,"data":[]})
def books_api(route):
    u=route.request.url
    if 'action=lookup' in u: return route.fulfill(json={"success":False,"error":"NOT_FOUND"})
    if 'action=quote' in u: return route.fulfill(json={"success":False})
    return route.fulfill(status=404, json={"success":False})
def drive(route): return route.fulfill(body=JPEG, headers={"content-type":"image/jpeg"})
INIT="""
 localStorage.setItem('swapsutraUserEmail','r@e.com');localStorage.setItem('swapsutraSessionToken','tok');
 localStorage.setItem('swapsutraSubscriptionStatus','Active');localStorage.setItem('swapsutraMembershipStatus','premium');
 localStorage.setItem('swapsutraSessionVerifiedEmail','r@e.com');localStorage.setItem('swapsutraSessionVerifiedAt',String(Date.now()));
 sessionStorage.setItem('swapsutraSplashShown','true');
"""
res=[]
def ck(l,c,d=''):
    res.append((l,bool(c))); print(("PASS: " if c else "FAIL: ")+l+((' ['+str(d)+']') if (d and not c) else ''))
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':375,'height':812},is_mobile=True,has_touch=True)
    ctx.add_init_script(INIT); pg=ctx.new_page(); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route("**/api/swapsutra**", api); pg.route("**/api/books**", books_api); pg.route("https://drive.google.com/**", drive)
    # Test photos are drawn in the browser, so the check needs no fixture files.
    scratch=b.new_page()
    def make_jpeg(color):
        url=scratch.evaluate(f"""() => {{ const c=document.createElement('canvas'); c.width=600; c.height=900;
          const x=c.getContext('2d'); x.fillStyle='{color}'; x.fillRect(0,0,600,900);
          for(let i=0;i<400;i++){{x.fillStyle=`hsl(${{i*7%360}},60%,50%)`; x.fillRect((i*37)%600,(i*53)%900,30,30);}}
          return c.toDataURL('image/jpeg',0.9); }}""")
        return base64.b64decode(url.split(',',1)[1])
    JPEG=make_jpeg('#8E4A59'); BACK=make_jpeg('#4A3B32'); scratch.close()

    # ── 1. Library: label on a partial listing
    pg.goto(BASE+'/library'); pg.wait_for_timeout(4500)
    tags=pg.locator('[data-testid="more-photos-tag"]')
    ck("1. Library tile of a front-cover-only listing shows the label", tags.count()>=1)
    ck("2. The label text is 'More photos coming'", any(tags.nth(i).text_content().strip()=='More photos coming' for i in range(tags.count())))
    full_tile=pg.locator('button.ss-shelf__book[aria-label^="A Complete Listing"]')
    ck("3. A complete listing has no label", full_tile.count()==1 and full_tile.locator('[data-testid="more-photos-tag"]').count()==0)
    (os.makedirs('shots',exist_ok=True) or pg.screenshot)(path='shots/partial_library_375.png')
    pg.locator('button.ss-shelf__book[aria-label^="Someone Else"]').click(); pg.wait_for_timeout(1200)
    ck("4. A reader sees the honest label on the book page", pg.locator('[data-testid="more-photos-label"]').count()==1 and 'hasn\'t added the back cover and an inside photo or video' in pg.locator('[data-testid="more-photos-label"]').inner_text())
    ck("5. ...and no owner prompt", pg.locator('[data-testid="finish-listing-prompt"]').count()==0)
    (os.makedirs('shots',exist_ok=True) or pg.screenshot)(path='shots/partial_detail_reader_375.png')

    # ── 2. Deposit estimate in the swap request modal
    req=pg.locator('button', has_text='Request to Swap')
    if req.count():
        req.first.click(); pg.wait_for_timeout(1500)
        if pg.locator('select[name=offeredBookId] option').count()>1: pg.select_option('select[name=offeredBookId]', index=1)
        pg.select_option('select[name=swapPreference]', 'Temporary'); pg.wait_for_timeout(1500)
        pg.locator('[data-testid="deposit-estimate"]').first.scroll_into_view_if_needed() if pg.locator('[data-testid="deposit-estimate"]').count() else None
        est=pg.locator('[data-testid="deposit-estimate"]')
        ck("6. Swap request shows 'Estimated deposit (price not verified by the owner): ₹150'",
           est.count()==1 and 'Estimated deposit (price not verified by the owner): ₹150' in est.inner_text(), est.inner_text() if est.count() else pg.locator('body').inner_text()[:300])
        (os.makedirs('shots',exist_ok=True) or pg.screenshot)(path='shots/deposit_estimate_375.png')
    else:
        ck("6. Swap request button found", False)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # ── 3. Listing: front cover only submits
    pg.goto(BASE+'/library'); pg.wait_for_timeout(3500)
    before=calls.count('recordListingFormOpen')
    pg.get_by_role('button', name='List a book').first.click(); pg.wait_for_timeout(1500)
    ck("7. Opening the form is counted once", calls.count('recordListingFormOpen')==before+1, calls.count('recordListingFormOpen'))
    ck("8. Front cover is shown first and marked Required", 'REQUIRED' in pg.locator('[data-testid="listing-media-front"]').inner_text().upper())
    later=pg.locator('[data-testid="listing-media-later"]')
    ck("9. Back cover / inside grouped as 'Add now or later', marked optional", 'ADD NOW OR LATER' in later.inner_text().upper() and 'OPTIONAL NOW' in later.inner_text().upper())
    pg.locator('input[aria-label="ISBN"]').fill('9780061120084'); pg.wait_for_timeout(800)
    pg.fill('form input[name=title]','Front Only Book'); pg.fill('form input[name=author]','Test Author')
    pg.locator('form input[name=copyType]').first.check(); pg.wait_for_timeout(300)
    pg.locator('form input[name=copyTypeDeclaration]').check()
    pg.locator('form input[name=readingPermanentExchange]').check()
    if pg.locator('form select[name=condition]').count(): pg.select_option('form select[name=condition]', index=1)
    if pg.locator('form select[name=genre]').count(): pg.select_option('form select[name=genre]', index=1)
    if pg.locator('form input[name=mrp]').count() and pg.locator('form input[name=mrp]').is_enabled(): pg.fill('form input[name=mrp]','399')
    pg.locator('#required-media-frontCoverImage').set_input_files({'name':'front.jpg','mimeType':'image/jpeg','buffer':JPEG}); pg.wait_for_timeout(2500)
    ck("10. Badge flips to 'Ready to list' with just the front cover", 'READY TO LIST' in pg.locator('form').inner_text().upper())
    pg.locator('[data-testid="listing-media-front"]').scroll_into_view_if_needed(); (os.makedirs('shots',exist_ok=True) or pg.screenshot)(path='shots/partial_form_375.png')
    invalid=pg.evaluate("[...document.querySelectorAll('form input,form select,form textarea')].filter(el=>el.offsetParent!==null && !el.checkValidity()).map(el=>el.name||el.getAttribute('aria-label'))")
    if invalid: print('   invalid fields:', invalid)
    pg.get_by_role('button', name='Add to the Library').click(); pg.wait_for_timeout(3500)
    c=sent.get('create') or {}
    ck("11. A front-cover-only listing is submitted", bool(c), pg.locator('[role=alert], .text-red-700, .text-red-600').all_inner_texts()[:3])
    ck("12. ...with the front cover and nothing else", bool(c.get('frontCoverImage')) and not c.get('backCoverImage') and not c.get('internalBookImage') and not c.get('internalBookVideo'))
    body=pg.locator('body').inner_text()
    ck("13. The success message says how to finish it", 'More photos coming' in body and 'My Books' in body, body[:200])
    (os.makedirs('shots',exist_ok=True) or pg.screenshot)(path='shots/partial_created_375.png')

    # ── 4. Owner: My Books prompt, book-page prompt, finish flow
    pg.goto(BASE+'/profile'); pg.wait_for_timeout(4000)
    pg.evaluate("""() => {const b=[...document.querySelectorAll('button')].find(b=>/^My Books/i.test(b.innerText.trim())); if(b) b.click();}""")
    pg.wait_for_timeout(1500)
    mp=pg.locator('[data-testid="my-books-finish-prompt"]')
    ck("14. My Books shows the 'finish your listing' prompt", mp.count()==1 and 'Add the back cover and an inside photo or video to finish your listing' in mp.inner_text(), mp.inner_text() if mp.count() else '')
    ck("15. The owner's tile says 'Add photos'", pg.locator('[data-testid="more-photos-tag"]', has_text='Add photos').count()>=1)
    mp.scroll_into_view_if_needed(); (os.makedirs('shots',exist_ok=True) or pg.screenshot)(path='shots/partial_mybooks_375.png')
    pg.locator('button.ss-shelf__book[aria-label^="My Half Listing"]').click(); pg.wait_for_timeout(1200)
    fp=pg.locator('[data-testid="finish-listing-prompt"]')
    ck("16. The owner's book page shows the finish prompt", fp.count()==1 and 'to finish your listing' in fp.inner_text())
    (os.makedirs('shots',exist_ok=True) or pg.screenshot)(path='shots/partial_detail_owner_375.png')
    fp.get_by_role('button', name='Add photos').click(); pg.wait_for_timeout(800)
    dlg=pg.get_by_role('dialog', name='Finish your listing')
    ck("17. The finish modal offers only the missing slots", dlg.count()==1 and dlg.locator('#finish-media-backCoverImage').count()==1 and dlg.locator('#finish-media-frontCoverImage').count()==0)
    dlg.locator('#finish-media-backCoverImage').set_input_files({'name':'back.jpg','mimeType':'image/jpeg','buffer':BACK}); pg.wait_for_timeout(2000)
    (os.makedirs('shots',exist_ok=True) or pg.screenshot)(path='shots/partial_finish_modal_375.png')
    dlg.get_by_role('button', name='Add to my listing').click(); pg.wait_for_timeout(2000)
    u=sent.get('update') or {}
    ck("18. Finishing sends finishListingPhotos with only the back cover", u.get('finishListingPhotos') is True and bool(u.get('backCoverImage')) and not u.get('frontCoverImage') and u.get('bookId')=='B_OWN', list(u.keys()))
    ck("19. No page errors", not errs, errs[:2])
    b.close()
f=[l for l,ok in res if not ok]
print("\n%d passed, %d failed (%d total)"%(len(res)-len(f),len(f),len(res)))
sys.exit(1 if f else 0)
