"""Synthetic isolated browser acceptance; never connects to a Facebook session."""
import json,io,base64,hashlib
from PIL import Image,ImageDraw
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).parent
PHOTO='https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/public/listing-images/listings/1234567890123/img_0.jpg'
ITEM={'id':1,'facebook_id':'1234567890123','account_tag':'crazymoe','title':'Bose 900 — Black','description':'USED. Glass top cracked.\n\nRemote included.\n\nPickup only.','condition':'Used - Fair','price':200,'category':'Audio','images':[PHOTO,PHOTO.replace('0.jpg','1.jpg')],'digest':'abc','copies':[]}
FIXTURE=Image.new('RGB',(720,480),'white');draw=ImageDraw.Draw(FIXTURE);draw.rectangle((60,90,660,390),fill='#303944');draw.line((240,90,370,250,330,390),fill='white',width=4);draw.rectangle((0,0,15,15),fill='red');draw.rectangle((704,464,719,479),fill='blue');buf=io.BytesIO();FIXTURE.save(buf,format='JPEG');PHOTO_BYTES=buf.getvalue()
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
     if name not in ('posting.html','posting.js','posting.css','posting-copy.js','posting-photo.js'):route.abort();return
     route.fulfill(path=str(ROOT/name),content_type='application/javascript' if name.endswith('.js') else 'text/css' if name.endswith('.css') else 'text/html')
    def api(route):
     if '/rpc/' not in route.request.url:route.fulfill(content_type='image/jpeg',body=PHOTO_BYTES,headers={'Access-Control-Allow-Origin':'*'});return
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
    page.add_init_script('window.chrome={runtime:{sendMessage:async(id,msg)=>msg.type==="STUDIO_ACCOUNT_QUEUE_CHECK"?{ready:true,version:2}:{ok:true,filled:true}}};')
    page.goto('https://studio.test/posting.html');page.locator('#workspace').wait_for(state='visible')
    assert page.locator('input[type=checkbox]:disabled').count()==1
    page.locator('#select-visible').click();assert page.locator('#selection-count').inner_text()=='1'
    page.locator('#review-selected').click();page.locator('.photo-choice').nth(1).click()
    page.locator('.framed-preview').wait_for(state='visible')
    page.screenshot(path=str(ROOT/f'posting-review-{width}.png'),full_page=True)
    page.locator('#prepare-batch').click();page.locator('.queue-card').wait_for()
    assert state['prepared'][0]['draft']['images'][0]==ITEM['images'][1]
    assert state['prepared'][0]['draft']['photo_style']=='alt-frame-v1'
    assert len(state['prepared'][0]['draft']['photo_manifest'])==2
    assert all(x['source_sha256']==hashlib.sha256(PHOTO_BYTES).hexdigest() for x in state['prepared'][0]['draft']['photo_manifest'])
    assert 'Glass top cracked.' in state['prepared'][0]['draft']['description']
    page.evaluate('()=>{window.chrome.runtime.sendMessage=async()=>({ready:true,version:1});}')
    page.locator('#start-queue').click();page.get_by_text('Reload the updated Commerce OS extension',exact=False).wait_for();assert state['claims']==0
    page.evaluate('()=>{window.chrome.runtime.sendMessage=async(id,msg)=>msg.type==="STUDIO_ACCOUNT_QUEUE_CHECK"?{ready:true,version:2}:{ok:true,filled:true};}')
    page.locator('#start-queue').click();page.get_by_text('Draft filled',exact=True).wait_for();assert state['claims']==1
    page.locator('#start-queue').click();page.wait_for_timeout(100);assert state['claims']==1
    page.locator('.queue-card input[type=url]').fill('https://www.facebook.com/marketplace/item/1999999999999/')
    page.get_by_role('button',name='Save link',exact=True).click();page.get_by_text('Publication recorded',exact=True).wait_for()
    assert page.get_by_text('Confirmed live',exact=True).count()==0
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    page.screenshot(path=str(ROOT/f'posting-queue-{width}.png'),full_page=True)
    print(json.dumps({'width':width,'status':'PASS','claims':state['claims'],'source_preserved':True,'false_live':False,'js_errors':errors}),flush=True)
    # Exercise the real photo worker + native-file staging with a synthetic Facebook adapter.
    page.evaluate('window.importScripts=()=>{};window.studioOrigins=new Set();window.chrome.runtime.onMessageExternal={addListener:()=>{}}')
    page.add_script_tag(content=(ROOT.parent/'extension/account_queue_worker.js').read_text())
    packet={'source_id':1,'profile_id':ACCOUNT['profile_id'],'account_label':ACCOUNT['label'],'item':state['prepared'][0]['draft']}
    receipt=page.evaluate('''async packet=>{
     const uploads=[],events=[];window.__packet=packet;
     accountTransfer=async(token,action,evidence)=>{events.push({action,evidence});return action==='read'?packet:{ok:true}};
     chrome.tabs={create:async()=>({id:7})};chrome.scripting={executeScript:async()=>[{result:{ok:true}}]};
     accountWaitTab=async()=>{};accountAssertSeller=async()=>packet.profile_id;moeFillExplicitListing=()=>{};
     waitFacebookFields=async()=>{};waitFacebookCondition=async()=>{};waitFacebookPhotoCount=async(tab,n)=>{if(n!==uploads.length)throw Error('Photo attachment count mismatch')};
     chrome.downloads={download:async photo=>{uploads.push(photo);return uploads.length}};
     waitStudioDownload=async id=>'test/'+id+'.jpg';setNativeFacebookPhotos=async(tab,paths)=>{if(paths.length!==packet.item.images.length)throw Error('Missing native files')};
     removeStagedPhotos=async()=>{};scheduleStagedPhotoCleanup=async()=>{};
     const result=await accountFill('a'.repeat(64));return {result,uploads,events};
    }''',packet)
    assert receipt['result']['ok'],receipt
    assert len(receipt['uploads'])==2
    worker=page.evaluate('''async input=>{
     const script=input.code+';self.onmessage=async({data})=>{try{const out=await PostingPhoto.prepare(data.url,data.options);postMessage({manifest:out.manifest,hash:out.output_sha256})}catch(e){postMessage({error:e.message})}}';
     const url=URL.createObjectURL(new Blob([script],{type:'text/javascript'})),worker=new Worker(url);
     try{return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker timed out')),30000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data)};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message))};worker.postMessage({url:input.url,options:{profile:input.profile,source:1}});});}finally{worker.terminate();URL.revokeObjectURL(url)}
    }''',{'code':(ROOT/'posting-photo.js').read_text(),'url':packet['item']['images'][0],'profile':ACCOUNT['profile_id']})
    assert not worker.get('error'),worker
    assert worker['hash']==receipt['events'][-1]['evidence']['photo_manifest'][0]['output_sha256'],'Page and worker render differently'
    assert receipt['events'][-1]['action']=='filled'
    proof=receipt['events'][-1]['evidence'];assert proof['photo_style']=='alt-frame-v1'
    for i,u in enumerate(receipt['uploads']):
     raw=base64.b64decode(u['url'].split(',')[1]);assert hashlib.sha256(raw).hexdigest()==proof['photo_manifest'][i]['output_sha256']
     img=Image.open(io.BytesIO(raw));assert img.size==(proof['photo_manifest'][i]['width'],proof['photo_manifest'][i]['height'])
     assert b'CrazyMoe|alt-frame-v1|source=1' in img.getexif().get_ifd(0x8769)[0x9286]
     assert raw!=PHOTO_BYTES
    failure=page.evaluate('''async()=>{__packet.item.photo_manifest[0].source_sha256='0'.repeat(64);try{await accountPreparedPhotos(__packet);return false}catch(e){return e.message.includes('Source photo changed')}}''')
    assert failure,'Changed source was uploaded'
    print(json.dumps({'photo_handoff':'PASS','attached_framed_files':len(receipt['uploads']),'changed_source_blocked':True,'exif_verified':True}),flush=True)
    # A missing photo must prevent saving any item in the batch.
    page.locator('#browse-tab').click();page.locator('#select-visible').click();page.locator('#review-selected').click()
    page.route('**/storage/v1/object/public/listing-images/**',lambda route:route.fulfill(status=404,headers={'Access-Control-Allow-Origin':'*'}))
    page.locator('#prepare-batch').click();page.get_by_text('No products from this batch were saved.',exact=False).wait_for()
    assert len(state['queue'])==1
    page.close()
  finally:browser.close()

if __name__=='__main__':main()
