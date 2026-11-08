"""Synthetic browser proof: no automatic narratives; seller notes persist unchanged."""
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).parent
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 for width in (390,1366):
  saved=[]
  item=dict(id='fixture',lifecycle='current',revision=1,status='review',fields={'title':'Heater','description':'1500 W ceramic heater.','price':'55','condition':'New','notes':'My handwritten inspection: scuff on left side.'},photo_selection=[],identity_revision=1,identity_status='unconfirmed',research={'manufacturer_research':{'reason':'AUTOMATED RESEARCH WARNING'}},visual_proposal={'confidence':'partial','observations':['AUTOMATED WORN BOX WARNING'],'suggestion':{}},proposal_revision=1,catalog_evidence=[],generated_candidate={'description':'1500 W ceramic heater.'})
  def route(r):
   u=urlsplit(r.request.url)
   if u.netloc=='notes.test':
    path='index.html' if u.path=='/' else u.path[1:]
    if path=='auth.js':r.fulfill(content_type='text/javascript',body="window.studioAuth={auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{access_token:'test'}}}),onAuthStateChange:()=>{}}};")
    else:r.fulfill(body=(ROOT/path).read_bytes(),content_type='text/javascript' if path.endswith('.js') else 'text/css' if path.endswith('.css') else 'text/html')
   elif u.path.endswith('/studio_state'):r.fulfill(json=[item])
   elif u.path.endswith('/studio_render_status'):r.fulfill(json={'state':'ready','revision':item['revision'],'photo_revision':1})
   elif u.path.endswith('/studio_photo_choices'):r.fulfill(json={'revision':1,'listing_revision':item['revision'],'choices':[],'selected':[]})
   elif u.path.endswith('/studio_reference_choices'):r.fulfill(json=[])
   elif u.path.endswith('/studio_seller_patch'):
    body=r.request.post_data_json;saved.append(body);item['fields'].update(body['p_patch']);item['revision']+=1;r.fulfill(json=item)
   else:r.abort()
  context=browser.new_context(viewport={'width':width,'height':844});context.route('**/*',route);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('https://notes.test/');page.locator('.inventory-card').click()
  expect(page.locator('textarea[name=description]')).to_have_value('1500 W ceramic heater.')
  expect(page.locator('textarea[name=notes]')).to_have_value('My handwritten inspection: scuff on left side.')
  assert 'AUTOMATED' not in page.locator('#diagnostics').inner_text()
  page.locator('.private-details summary').click();page.locator('textarea[name=notes]').fill('My manual note: untested and missing remote.')
  page.get_by_role('button',name='Save changes',exact=True).click();expect(page.locator('#editor-status')).to_contain_text('Saved')
  assert saved[-1]['p_patch']=={'notes':'My manual note: untested and missing remote.'},saved
  assert not errors,errors
  print(f'PASS manual notes and no automated narrative at {width}px')
  context.close()
 browser.close()
