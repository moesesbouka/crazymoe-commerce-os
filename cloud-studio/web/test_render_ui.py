"""Isolated UI fixtures only. Does not use an owner browser profile or live API."""
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
root=Path(__file__).parent
origin='https://studio-fixture.invalid'
state={'calls':0}
item={'id':'fixture','lifecycle':'current','fields':{'title':'Fixture product','price':'50','condition':'New'},'revision':1,'status':'review','photo_selection':[],'exports_verified':False}
def route(req):
 url=urlsplit(req.request.url)
 if url.netloc=='studio-fixture.invalid':
  file='index.html' if url.path=='/' else url.path[1:]
  if file=='auth.js':
   req.fulfill(content_type='text/javascript',body="globalThis.studioAuth={auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{access_token:'synthetic'}}}),onAuthStateChange:()=>{}}};")
  else:req.fulfill(body=(root/file).read_bytes(),content_type='text/javascript' if file.endswith('.js') else 'text/css' if file.endswith('.css') else 'text/html')
 elif url.path.endswith('/studio_state'):req.fulfill(json=[item])
 elif url.path.endswith('/studio_render_status'):
  state['calls']+=1;req.fulfill(json={'state':'queued' if state['calls']==1 else 'ready','revision':1,'photo_revision':1})
 else:req.abort()
with sync_playwright() as p:
 browser=p.chromium.launch(channel='chromium',headless=True)
 try:
  for width in [390,1280]:
   state['calls']=0
   context=browser.new_context(viewport={'width':width,'height':850})
   context.route('**/*',route)
   page=context.new_page();page.goto(origin+'/')
   page.locator('.inventory-card').click()
   page.get_by_text('Preparing listing photos in the cloud…',exact=True).wait_for()
   assert page.locator('#review-export').is_disabled()
   page.locator('[name=title]').fill('Unsaved seller title')
   page.get_by_text('Listing photos are ready.',exact=True).wait_for(timeout=15000)
   assert page.locator('#review-export').is_enabled()
   assert page.locator('[name=title]').input_value()=='Unsaved seller title'
   assert page.locator('#editor').evaluate('(e)=>e.open')
   context.close()
  print('PASS: mobile and desktop progress, review gating, unsaved edits preserved; all external network mocked')
 finally:browser.close()
