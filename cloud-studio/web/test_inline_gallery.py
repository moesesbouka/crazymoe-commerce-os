"""Isolated browser regression: synthetic inventory and private photo URLs, no owner credentials or writes."""
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
root=Path(__file__).parent
origin="https://studio-gallery-fixture.invalid"
png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p4cAAAAASUVORK5CYII="
item={"id":"fixture-01","lifecycle":"current","fields":{"title":"Fixture IPORT mount","price":"270","condition":"New","model":"70808","description":"Verified fixture","source_url":"","notes":""},"revision":2,"status":"review","photo_selection":[{"kind":"real","sha":"a"*64},{"kind":"real","sha":"b"*64},{"kind":"manufacturer","id":"m-prepared"}],"exports_verified":True,"identity_revision":1,"catalog_evidence":[]}
choices=[{"id":"aa","source":{"kind":"real","sha":"a"*64},"position":1},{"id":"bb","source":{"kind":"real","sha":"b"*64},"position":2},{"id":"mm","source":{"kind":"manufacturer","id":"m-prepared"},"position":3}]
state={"selected":["aa","bb","mm"],"saves":[]}
def route(req):
 url=urlsplit(req.request.url)
 if url.netloc=="studio-gallery-fixture.invalid":
  name="index.html" if url.path in ("/","/app/") else url.path[1:]
  if name=="auth.js":
   req.fulfill(content_type="text/javascript",body="globalThis.studioAuth={auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{access_token:'test',user:{id:'test-user'}}},error:null}),onAuthStateChange:()=>{}}};")
  else:
   req.fulfill(body=(root/name).read_bytes(),content_type="text/javascript" if name.endswith(".js") else "text/css" if name.endswith(".css") else "text/html")
 elif url.path.endswith("/studio_state"):req.fulfill(json=[item])
 elif url.path.endswith("/studio_photo_choices"):
  req.fulfill(json={"revision":1,"listing_revision":2,"choices":choices,"selected":state["selected"],"previous":None})
 elif url.path.endswith("/studio_reference_choices"):
  req.fulfill(json=[{"id":"m-prepared","label":"Prepared reference","prepared":True},{"id":"m-extra","label":"Official manufacturer photo","prepared":False}])
 elif url.path.endswith("/studio_save_photo_choices"):
  body=req.request.post_data_json;state["saves"].append(body)
  state["selected"]=body["p_choices"];req.fulfill(json=2)
 elif url.path.endswith("/studio_render_status"):
  req.fulfill(json={"state":"ready","revision":2,"photo_revision":1})
 elif "/studio-api/" in url.path:
  req.fulfill(json={"url":png})
 else: req.abort()
with sync_playwright() as p:
 browser=p.chromium.launch(channel="chromium",headless=True)
 try:
  for width in (390,1280):
   state["selected"]=["aa","bb","mm"];state["saves"]=[]
   context=browser.new_context(viewport={"width":width,"height":900})
   context.route("**/*",route)
   page=context.new_page()
   page.set_default_timeout(12000)
   errors=[]
   page.on("pageerror",lambda e:errors.append(str(e)))
   page.goto(origin+"/app/")
   page.locator(".inventory-card").click()
   page.locator("#photo-list .photo-tile").first.wait_for()
   page.get_by_text("Official manufacturer photo",exact=True).wait_for()
   assert page.locator("#editor #photo-editor").is_visible()
   assert page.locator("dialog#photo-editor").count()==0
   assert page.locator("#photo-list .photo-tile").count()==3
   assert page.locator("#reference-gallery .photo-tile").count()==1
   assert page.locator("#photo-list .cover").count()==1
   assert page.locator("#photo-list .cover .photo-label").inner_text().endswith("COVER")
   assert page.locator("#photo-list .photo-preview img[src]").count()==3
   page.get_by_role("button",name="Make cover").click()
   assert "Warehouse photo" in page.locator("#photo-list .cover .photo-label").inner_text()
   assert page.locator("#save-photos").is_enabled()
   page.locator("[name=price]").fill("280")
   page.locator("#save-photos").click()
   page.get_by_text("Save listing text changes before saving photo choices.").wait_for()
   assert not state["saves"]
   page.locator("[name=price]").fill("270")
   page.locator("#save-photos").click()
   page.get_by_text("Photo choices saved; review the updated draft before approval.").wait_for()
   assert state["saves"] and state["saves"][0]["p_choices"]==["bb","aa","mm"],state["saves"]
   assert not errors,errors
   assert page.locator("#editor").evaluate("(el)=>el.open")
   context.close()
  print("PASS: 390px and 1280px inline cover selection, all prepared images, unprepared factory preview, no modal, server-safe save, unsaved text guard, no JavaScript errors")
 finally:browser.close()