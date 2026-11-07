"""Real Chromium regression using synthetic inventory only, with all network requests isolated."""
import json, hashlib, io, zipfile
from PIL import Image
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).parent
ORIGIN='https://studio-regression.local'
PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p4cAAAAASUVORK5CYII='

def run(width,height):
 items=[{'id':'workstation','lifecycle':'current','fields':{'title':'Walker Edison workstation','price':'45','condition':'','description':'Desk add-on only.'},'field_sources':{'condition':'legacy_preserved_unknown'},'revision':2,'status':'review','photo_selection':[],'exports_verified':False,'media_health':{'references':2,'preview_reference':'ref-one','export_ready':False}},
 {'id':'sonance','lifecycle':'current','fields':{'title':'Sonance speaker selector','price':'220','condition':'New','description':'Four-zone speaker selector.'},'revision':3,'status':'review','photo_selection':[{'kind':'manufacturer','id':'ref-one'},{'kind':'real','sha':'a'*64}],'exports_verified':True,'media_health':{'references':1,'export_ready':True}}]
 choices=[{'id':'factory','source':items[1]['photo_selection'][0],'position':1},{'id':'real','source':items[1]['photo_selection'][1],'position':2}]
 selected=['factory','real'];saves=[];photo_saves=[];errors=[]
 jpeg_buffer=io.BytesIO();Image.new('RGB',(120,100),'orange').save(jpeg_buffer,'JPEG');jpeg=jpeg_buffer.getvalue()
 file_receipt={'sha':hashlib.sha256(jpeg).hexdigest(),'bytes':len(jpeg),'width':120,'height':100}
 approvals=[]
 def handle(route):
  nonlocal selected
  req=route.request;u=urlsplit(req.url);body=req.post_data_json if req.post_data else {}
  if u.netloc=='studio-regression.local':
   name='index.html' if u.path in ('/','/app/') else u.path[1:]
   if name=='auth.js':route.fulfill(content_type='text/javascript',body="window.studioAuth={auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{access_token:'test',user:{id:'test'}}}}),onAuthStateChange:()=>{}}};")
   else:route.fulfill(body=(ROOT/name).read_bytes(),content_type='text/javascript' if name.endswith('.js') else 'text/css' if name.endswith('.css') else 'text/html')
   return
  item=next((i for i in items if i['id']==body.get('p_item',body.get('p_id'))),items[0]);path=u.path
  if path.endswith('/studio_state'):data=items
  elif path.endswith('/studio_photo_choices'):data={'revision':1,'listing_revision':item['revision'],'choices':choices if item['id']=='sonance' else [],'selected':selected if item['id']=='sonance' else [],'previous':None}
  elif path.endswith('/studio_reference_choices'):data=[{'id':'ref-one','label':'Manufacturer reference','prepared':item['id']=='sonance'}]
  elif path.endswith('/studio_render_status'):data={'state':'ready' if item['exports_verified'] else 'empty','revision':item['revision'],'photo_revision':1}
  elif path.endswith('/studio_refresh_copy_suggestion'):data={'description':'Cleaned product description','based_on_revision':item['revision']}
  elif path.endswith('/studio_seller_patch'):
   saves.append(body);item['fields'].update(body['p_patch']);item['revision']+=1;data={'fields':item['fields'],'revision':item['revision']}
  elif path.endswith('/studio_save_photo_choices'):
   photo_saves.append(body);selected=body['p_choices'];item['photo_selection']=[next(c['source'] for c in choices if c['id']==key) for key in selected];data=2
  elif path=='/exports/test.jpg':route.fulfill(body=jpeg,content_type='image/jpeg');return
  elif path.endswith('/export-preview'):
   item=next(i for i in items if i['id']==body['id'])
   data={'snapshot':{'id':item['id'],'revision':item['revision'],**item['fields'],'images':[file_receipt,file_receipt]},'urls':['https://private.test/exports/test.jpg']*2}
  elif path.endswith('/studio_approve_export'):
   approvals.append(body);item['status']='approved';data=1
  elif '/studio-api/' in path:data={'url':PNG,'expires_in':60}
  else:route.abort();return
  route.fulfill(json=data)
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True)
  context=browser.new_context(viewport={'width':width,'height':height});context.route('**/*',handle)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(15000)
  page.goto(ORIGIN)
  page.locator('.inventory-card').filter(has_text='Walker Edison').click()
  page.wait_for_function("document.querySelector('#hero').naturalWidth>0")
  assert page.locator('select[name=condition]').input_value()=='New'
  assert page.get_by_role('button',name='Use in listing',exact=True).count()==1
  assert page.locator('#review-export').bounding_box()['y']+page.locator('#review-export').bounding_box()['height'] <=height
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  page.get_by_role('button',name='Close editor',exact=True).click()
  page.locator('.inventory-card').filter(has_text='Sonance').click()
  page.locator('#photo-list .photo-tile').first.wait_for()
  page.wait_for_function("[...document.querySelectorAll('#photo-list img')].every(i=>i.naturalWidth>0)")
  assert 'Factory' in page.locator('#photo-list .cover').inner_text()
  page.get_by_role('button',name='Make cover',exact=True).click()
  page.locator('[name=price]').fill('225')
  page.get_by_role('button',name='Save changes',exact=True).click()
  page.get_by_text('Saved.',exact=True).wait_for()
  assert saves[-1]['p_patch']=={'price':'225'},saves
  assert photo_saves[-1]['p_listing_revision']==4,photo_saves
  assert selected==['real','factory'],selected
  assert page.locator('[name=price]').input_value()=='225'
  assert 'Warehouse' in page.locator('#photo-list .cover').inner_text()
  # A factory photo can be moved back to cover and saved without a warning popup.
  page.get_by_role('button',name='Make cover',exact=True).click()
  page.get_by_role('button',name='Save changes',exact=True).click()
  page.get_by_text('Saved.',exact=True).wait_for()
  assert selected==['factory','real'],selected
  page.get_by_role('button',name='Close editor',exact=True).click()
  page.get_by_role('checkbox',name='Select visible',exact=True).check()
  assert page.get_by_role('button',name='Approve eligible selected',exact=True).is_visible()
  page.get_by_role('button',name='Refresh copy suggestions',exact=True).click()
  page.get_by_text('Refresh copy suggestions:',exact=False).wait_for()
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  page.get_by_role('button',name='Approve eligible selected',exact=True).click()
  page.get_by_text('Approve selected:',exact=False).wait_for()
  assert len(approvals)==1 and approvals[0]['p_item']=='sonance',(approvals,page.locator('#message').inner_text())
  assert page.get_by_text('Prepare the selected photos first.',exact=False).count()==1
  with page.expect_download() as download_event:
   page.get_by_role('button',name='Download approved listings',exact=True).click()
  download=download_event.value
  with zipfile.ZipFile(download.path()) as archive:
   assert archive.testzip() is None
   assert archive.read('sonance/01.jpg')==jpeg and archive.read('sonance/02.jpg')==jpeg
   assert json.loads(archive.read('sonance/listing.json'))['price']=='225'
  assert not errors,errors
  context.close();browser.close()
for w,h in [(1366,768),(390,844)]:run(w,h);print('PASS',w,h,'reference preview, New default, JPEG decoding, fixed actions, seller edit plus reorder, factory cover, no overflow/errors')
