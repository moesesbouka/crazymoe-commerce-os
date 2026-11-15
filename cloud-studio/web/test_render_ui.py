"""Isolated UI fixtures only. Does not use an owner browser profile or live API."""
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
root=Path(__file__).parent
origin='https://studio-fixture.invalid'
state={'calls':0,'retries':0,'evidence':0}
item={'id':'fixture','lifecycle':'current','fields':{'title':'Fixture product','price':'50','condition':'New'},'revision':1,'status':'review','photo_selection':[],'exports_verified':False,'identity_revision':3,'research':{'catalog_match':{'brand':'Fixture brand','model':'F-1'}},'catalog_evidence':[]}
def route(req):
 url=urlsplit(req.request.url)
 if url.netloc=='studio-fixture.invalid':
  file='index.html' if url.path=='/' else url.path[1:]
  if file=='auth.js':
   req.fulfill(content_type='text/javascript',body="globalThis.studioAuth={auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{access_token:'synthetic'}}}),onAuthStateChange:()=>{}}};")
  else:req.fulfill(body=(root/file).read_bytes(),content_type='text/javascript' if file.endswith('.js') else 'text/css' if file.endswith('.css') else 'text/html')
 elif url.path.endswith('/studio_state'):req.fulfill(json=[item])
 elif url.path.endswith('/studio_retry_render'):
  state['retries']+=1;assert req.request.post_data_json['p_failed_job']=='failed-fixture';req.fulfill(json='new-job')
 elif url.path.endswith('/studio_add_catalog_evidence'):
  body=req.request.post_data_json;assert body['p_listing_revision']==1 and body['p_identity_revision']==3
  assert body['p_source_kind']=='retailer' and body['p_url']=='https://retailer.example/product'
  state['evidence']+=1;item['catalog_evidence']=[{'id':1,'source_kind':'retailer','url':body['p_url'],'product_name':body['p_product_name'],'brand':body['p_brand'],'model':body['p_model'],'based_on_listing_revision':1}]
  req.fulfill(json={'id':1})
 elif url.path.endswith('/studio_render_status'):
  state['calls']+=1;req.fulfill(json={'state':'failed' if state['calls']==1 else 'queued' if state['calls']==2 else 'ready','revision':1,'photo_revision':1,'retry_job':'failed-fixture' if state['calls']==1 else None})
 else:req.abort()
with sync_playwright() as p:
 browser=p.chromium.launch(channel='chromium',headless=True)
 try:
  for width in [390,1280]:
   state['calls']=0;state['retries']=0;state['evidence']=0;item['catalog_evidence']=[]
   context=browser.new_context(viewport={'width':width,'height':850})
   context.route('**/*',route)
   page=context.new_page();page.set_default_timeout(5000);page.goto(origin+'/')
   page.locator('.inventory-card').click()
   page.get_by_text('Photo preparation failed. Your originals and saved edits are safe.',exact=True).wait_for()
   page.locator('[name=title]').fill('Unsaved before retry')
   page.locator('#retry-render').click()
   page.get_by_text('Save your changes before retrying photo preparation.',exact=True).wait_for()
   assert state['retries']==0
   page.locator('[name=title]').fill('Fixture product')
   page.locator('#retry-render').click()
   page.get_by_text('Preparing listing photos in the cloud…',exact=True).wait_for()
   assert state['retries']==1
   assert page.locator('#review-export').is_disabled()
   page.locator('[name=title]').fill('Unsaved seller title')
   page.get_by_text('Listing photos are ready.',exact=True).wait_for(timeout=15000)
   assert page.locator('#review-export').is_enabled()
   assert page.locator('[name=title]').input_value()=='Unsaved seller title'
   page.locator('.catalog-evidence summary').click()
   page.locator('#catalog-kind').select_option('retailer')
   page.locator('#catalog-url').fill('https://retailer.example/product')
   page.locator('#record-catalog-evidence').click()
   page.get_by_text('Save your listing edits before recording evidence.',exact=True).wait_for()
   assert state['evidence']==0
   page.locator('[name=title]').fill('Fixture product')
   page.locator('#record-catalog-evidence').click()
   page.get_by_text('Evidence recorded without changing the listing.',exact=True).wait_for()
   assert state['evidence']==1 and page.locator('[name=title]').input_value()=='Fixture product'
   assert page.locator('#review-export').is_enabled()
   assert page.locator('#editor').evaluate('(e)=>e.open')
   context.close()
  print('PASS: mobile and desktop retry/evidence, unsaved-edit guards, progress and review gating; all external network mocked')
 finally:browser.close()
