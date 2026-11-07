"""Regression for approval prefills and stable multi-item review, with strict mock API."""
import copy, hashlib, io, json, os
from pathlib import Path
from urllib.parse import urlsplit
from PIL import Image
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).parent
ORIGIN='https://studio-regression.local'
image=io.BytesIO();Image.new('RGB',(160,120),'orange').save(image,'JPEG');JPEG=image.getvalue()
RECEIPT={'sha':hashlib.sha256(JPEG).hexdigest(),'bytes':len(JPEG),'width':160,'height':120}

def run(width,height):
 def product(id,fields=None,**extra):
  return {'id':id,'lifecycle':'current','revision':1,'status':'review','fields':fields or {'title':id,'description':'Seller description '+id,'price':'45','condition':'New'},'generated_candidate':{},'photo_selection':[{'kind':'real','sha':'a'*64}],'exports_verified':True,'media_health':{'export_ready':True},**extra}
 initial=[product('Alpha',{'price':'45','description':'Keep seller wording','condition':''},generated_candidate={'title':'Alpha','description':'Do not overwrite seller','price':'90','model':'M1'}),product('Bravo'),product('Charlie'),product('Delta',{'title':'Delta','price':'','condition':'New','description':'Seller cleared price'},generated_candidate={'price':'70'})]
 state={'items':copy.deepcopy(initial),'approvals':[],'patches':[],'fail':None,'bad_photo':False,'refresh_failure':False}
 errors=[]
 def handle(route):
  req=route.request;u=urlsplit(req.url);body=req.post_data_json if req.post_data else {};path=u.path
  if u.netloc=='studio-regression.local':
   name='index.html' if path in ('/','/app/') else path[1:]
   if name=='auth.js':route.fulfill(content_type='text/javascript',body="window.studioAuth={auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{access_token:'test',user:{id:'test'}}}}),onAuthStateChange:()=>{}}};")
   else:route.fulfill(body=(ROOT/name).read_bytes(),content_type='text/javascript' if name.endswith('.js') else 'text/css' if name.endswith('.css') else 'text/html')
   return
  def fail(msg,code=400):route.fulfill(status=code,json={'message':msg})
  id=body.get('p_item',body.get('p_id',body.get('id')));item=next((i for i in state['items'] if i['id']==id),None)
  if path.endswith('/studio_state'):
   if state['refresh_failure']:state['refresh_failure']=False;fail('Temporary refresh failure',503);return
   data=state['items']
  elif path.endswith('/studio_photo_choices'):data={'revision':1,'listing_revision':item['revision'],'choices':[{'id':'real','source':item['photo_selection'][0],'position':1}],'selected':['real'],'previous':None}
  elif path.endswith('/studio_reference_choices'):data=[]
  elif path.endswith('/studio_render_status'):data={'state':'ready','revision':item['revision'],'photo_revision':1}
  elif path.endswith('/studio_seller_patch'):
   if body['p_expected_revision']!=item['revision']:fail('Stale revision',409);return
   state['patches'].append(body);item['fields'].update(body['p_patch']);item['revision']+=1;item['status']='review';data={'fields':item['fields'],'revision':item['revision'],'status':item['status']}
  elif path=='/photo.jpg':route.fulfill(body=JPEG if not state['bad_photo'] else b'broken',content_type='image/jpeg');return
  elif path.endswith('/export-preview'):
   if body['revision']!=item['revision']:fail('Stale preview',409);return
   data={'snapshot':{'id':item['id'],'revision':item['revision'],**item['fields'],'images':[RECEIPT]},'urls':['https://private.test/photo.jpg']}
  elif path.endswith('/studio_approve_export'):
   f=item['fields']
   if not all(f.get(key) for key in ['title','description','price','condition']):fail('Complete listing fields before approving');return
   if body['p_revision']!=item['revision'] or any(body['p_snapshot'].get(key)!=value for key,value in f.items()):fail('Stale approval',409);return
   if state['fail']==id:fail('Temporary approval failure',503);return
   state['approvals'].append(id);item['status']='approved';data=1
  elif '/studio-api/' in path:data={'url':'https://private.test/photo.jpg','expires_in':300}
  else:route.abort();return
  route.fulfill(json=data)
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True);context=browser.new_context(viewport={'width':width,'height':height});context.route('**/*',handle)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(10000)
  def reset():
   state.update(items=copy.deepcopy(initial),approvals=[],patches=[],fail=None,bad_photo=False,refresh_failure=False)
   page.goto(ORIGIN);expect(page.locator('#metric-total')).to_have_text('4')
  def choose(*ids):
   for id in ids:page.get_by_role('checkbox',name='Select '+id,exact=True).check()
  def begin(*ids):
   page.locator('[data-view=review]').click();choose(*ids);page.locator('#bulk-review').click()
  reset();choose('Alpha','Bravo','Charlie','Delta');page.locator('#bulk-approve').click()
  expect(page.locator('#message')).to_contain_text('3 completed; 1 need attention')
  assert state['approvals']==['Alpha','Bravo','Charlie'],state
  assert state['patches']==[{'p_id':'Alpha','p_expected_revision':1,'p_patch':{'title':'Alpha','condition':'New','model':'M1'}}],state['patches']
  assert state['items'][0]['fields']['description']=='Keep seller wording'
  assert state['items'][3]['fields']['price']==''
  expect(page.locator('.bulk-result.failure')).to_contain_text('positive price')
  assert page.locator('.bulk-result.success').count()==3
  # Selected sequence survives status changes that remove rows from the active Review filter.
  reset();begin('Alpha','Bravo','Charlie')
  for n,id in enumerate(['Alpha','Bravo','Charlie'],1):
   expect(page.locator('#edit-title')).to_have_text(id)
   expect(page.locator('#review-progress')).to_have_text('Selected item '+str(n)+' of 3')
   expect(page.locator('#review-export')).to_be_enabled()
   if id=='Bravo':page.locator('[name=description]').fill('Edited Bravo description')
   page.locator('#review-export').click()
  expect(page.locator('#editor')).not_to_be_visible()
  expect(page.locator('#message')).to_have_text('Selected review finished. 3 approved; 0 still selected for review.')
  assert state['approvals']==['Alpha','Bravo','Charlie'];assert state['items'][1]['fields']['description']=='Edited Bravo description'
  # Save & next and Skip remain inside the selection, skipping an unselected intervening row.
  reset();begin('Alpha','Charlie')
  page.locator('#save-next').click();expect(page.locator('#edit-title')).to_have_text('Charlie')
  page.locator('#skip').click();expect(page.locator('#editor')).not_to_be_visible();assert not state['approvals']
  # Closing or escaping selected review must not leak its navigation mode into ordinary review.
  page.locator('#bulk-review').click();page.locator('#close').click()
  page.locator('.inventory-card').filter(has_text='Bravo').click()
  expect(page.locator('#review-progress')).not_to_be_visible();expect(page.locator('#review-export')).to_have_text('Approve listing')
  page.locator('#skip').click();expect(page.locator('#edit-title')).to_have_text('Charlie');page.locator('#close').click()
  page.locator('#bulk-review').click();page.keyboard.press('Escape');expect(page.locator('#editor')).not_to_be_visible()
  # A failed item stays open and can be skipped; subsequent items still approve.
  reset();state['fail']='Alpha';begin('Alpha','Bravo');page.locator('#review-export').click()
  expect(page.locator('#editor-status')).to_contain_text('Temporary approval failure');expect(page.locator('#edit-title')).to_have_text('Alpha')
  page.locator('#skip').click();expect(page.locator('#edit-title')).to_have_text('Bravo');page.locator('#review-export').click()
  expect(page.locator('#editor')).not_to_be_visible();assert state['approvals']==['Bravo'];assert page.get_by_role('checkbox',name='Select Alpha',exact=True).is_checked()
  # Mixed bulk failures do not stop later items; altered JPEG bytes cannot pass.
  reset();state['fail']='Bravo';choose('Alpha','Bravo','Charlie');page.locator('#bulk-approve').click()
  expect(page.locator('#message')).to_contain_text('2 completed; 1 need attention');assert state['approvals']==['Alpha','Charlie']
  reset();state['bad_photo']=True;choose('Alpha','Bravo');page.locator('#bulk-approve').click()
  expect(page.locator('#message')).to_contain_text('0 completed; 2 need attention');assert not state['approvals']
  expect(page.locator('.bulk-result.failure').first).to_contain_text('integrity verification')
  # Approval is still complete when the subsequent inventory refresh has a network error.
  reset();begin('Alpha','Bravo');state['refresh_failure']=True;page.locator('#review-export').click()
  expect(page.locator('#edit-title')).to_have_text('Bravo');assert state['approvals']==['Alpha']
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
  if os.environ.get('STUDIO_TEST_SCREENSHOT'):page.screenshot(path=os.environ['STUDIO_TEST_SCREENSHOT'])
  assert not errors,errors
  context.close();browser.close()
for w,h in [(1366,768),(390,844)]:
 run(w,h);print('PASS',w,h,'strict approval prefills, preserved edits, three-item review, filtered removal, save/skip, close/Escape reset, partial failure, JPEG rejection, refresh failure')
