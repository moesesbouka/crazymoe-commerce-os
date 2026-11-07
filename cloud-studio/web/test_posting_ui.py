"""Synthetic isolated browser acceptance; never connects to a Facebook session."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).parent
PHOTO='https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/listings/1234567890123/img_0.jpg'
ITEM={'id':1,'facebook_id':'1234567890123','account_tag':'crazymoe','title':'Bose 900 — Black','description':'USED. Glass top cracked.\n\nRemote included.\n\nPickup only.','condition':'Used - Fair','price':200,'category':'Audio','images':[PHOTO,PHOTO.replace('0.jpg','1.jpg')],'digest':'abc','copies':[]}
ACCOUNT={'id':'11111111-1111-4111-8111-111111111111','label':'Second seller','profile_id':'1999999999999'}

def main():
 with sync_playwright() as p:
  browser=p.chromium.launch(channel='msedge',headless=True)
  try:
   for width in (390,1280):
    page=browser.new_page(viewport={'width':width,'height':900})
    state={'queue':[],'claims':0,'prepared':None};errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    def local(route):
     name=route.request.url.rsplit('/',1)[-1]
     if name=='auth.js':
      route.fulfill(content_type='application/javascript',body='window.studioAuth={auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{access_token:"fixture"}}}),onAuthStateChange:()=>{}}};');return
     if name not in ('posting.html','posting.js','posting.css','posting-copy.js'):route.abort();return
     route.fulfill(path=str(ROOT/name),content_type='application/javascript' if name.endswith('.js') else 'text/css' if name.endswith('.css') else 'text/html')
    def api(route):
     if '/rpc/' not in route.request.url:route.fulfill(status=404);return
     name=route.request.url.rsplit('/',1)[-1];args=route.request.post_data_json
     if name=='studio_posting_accounts':result=[ACCOUNT]
     elif name=='studio_posting_inventory':result={'total':2,'items':[ITEM,{**ITEM,'id':2,'title':'Missing condition','condition':None}]}
     elif name=='studio_posting_queue':result=state['queue']
     elif name=='studio_posting_prepare':
      state['prepared']=args['p_rows'];state['queue']=[{'id':'22222222-2222-4222-8222-222222222222','source_id':1,'account_id':ACCOUNT['id'],'account_label':ACCOUNT['label'],'revision':1,'draft':args['p_rows'][0]['draft'],'state':'prepared','created_at':'2026-11-07T00:00:00Z'}];result=[state['queue'][0]['id']]
     elif name=='studio_posting_claim':state['claims']+=1;state['queue'][0]['state']='filled';result={'token':'a'*64}
     elif name=='studio_posting_result':
      assert args['p_action']=='submitted';state['queue'][0]['state']='submitted';state['queue'][0]['listing_id']='1999999999999';result={'ok':True}
     else:route.fulfill(status=400,json={'message':name});return
     route.fulfill(json=result)
    page.route('https://studio.test/**',local);page.route('https://sfheqjnxlkygjfohoybo.supabase.co/**',api)
    page.add_init_script('window.chrome={runtime:{sendMessage:async(id,msg)=>msg.type==="STUDIO_ACCOUNT_QUEUE_CHECK"?{ready:true}:{ok:true,filled:true}}};')
    page.goto('https://studio.test/posting.html');page.locator('#workspace').wait_for(state='visible')
    assert page.locator('input[type=checkbox]:disabled').count()==1
    page.locator('#select-visible').click();assert page.locator('#selection-count').inner_text()=='1'
    page.locator('#review-selected').click();page.locator('.photo-choice').nth(1).click()
    page.screenshot(path=str(ROOT/f'posting-review-{width}.png'),full_page=True)
    page.locator('#prepare-batch').click();page.locator('.queue-card').wait_for()
    assert state['prepared'][0]['draft']['images'][0]==ITEM['images'][1]
    assert 'Glass top cracked.' in state['prepared'][0]['draft']['description']
    page.locator('#start-queue').click();page.get_by_text('Draft filled',exact=True).wait_for();assert state['claims']==1
    page.locator('#start-queue').click();page.wait_for_timeout(100);assert state['claims']==1
    page.locator('.queue-card input[type=url]').fill('https://www.facebook.com/marketplace/item/1999999999999/')
    page.get_by_role('button',name='Save link',exact=True).click();page.get_by_text('Publication recorded',exact=True).wait_for()
    assert page.get_by_text('Confirmed live',exact=True).count()==0
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    page.screenshot(path=str(ROOT/f'posting-queue-{width}.png'),full_page=True)
    print(json.dumps({'width':width,'status':'PASS','claims':state['claims'],'source_preserved':True,'false_live':False,'js_errors':errors}),flush=True)
    page.close()
  finally:browser.close()

if __name__=='__main__':main()
