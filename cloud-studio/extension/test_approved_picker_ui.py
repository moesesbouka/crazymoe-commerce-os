"""Isolated synthetic Facebook fixture; no real account, tabs, or publication."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).parent
ITEMS=[{'id':f'item{i}','revision':i+1,'title':f'Approved product {i+1}','condition':'Used - Fair','price':100+i,'photo_count':2} for i in range(9)]
def main():
 with sync_playwright() as p:
  browser=p.chromium.launch(channel='msedge',headless=True)
  try:
   for width in (390,1440):
    page=browser.new_page(viewport={'width':width,'height':900});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',lambda route:route.fulfill(content_type='text/html',body='<html><body><h1>Facebook form test fixture</h1><label>Title<input></label><label>Price<input></label><label>Description<textarea></textarea></label></body></html>') if route.request.url=='https://www.facebook.com/marketplace/create/item' else route.abort())
    page.goto('https://www.facebook.com/marketplace/create/item')
    page.evaluate('''items=>{window.__test={items,calls:[],connected:true};window.chrome={runtime:{sendMessage(message,reply){__test.calls.push(message);let response;if(message.type==='STUDIO_APPROVED_CONTEXT')response={ok:true,context:__test.context||null};else if(message.type==='STUDIO_APPROVED_CONFIRM'||message.type==='STUDIO_APPROVED_ALREADY'){const item=__test.context||__test.items.find(x=>x.id===message.id);__test.items=__test.items.filter(x=>x.id!==item.id);__test.context={...item,phase:'confirmed',nextTabId:22};response={ok:true,nextTabId:22};}else if(message.type==='STUDIO_TRANSFER_MODE')response={ok:true,cloud:false};else if(message.type==='STUDIO_APPROVED_LIST')response=__test.connected?{ok:true,items:__test.items}:{ok:false,error:'Open the signed-in Studio once to connect this browser.'};else if(message.type==='STUDIO_APPROVED_SELECT'){__test.context={...__test.items.find(x=>x.id===message.id),phase:'loaded'};response={ok:true,title:__test.context.title,photo_count:2};}else response={ok:false,error:'Unexpected message'};setTimeout(()=>reply(response),10);}}};}''',ITEMS)
    worker=(ROOT/'approved_picker_worker.js').read_text(encoding='utf-8')
    blank=worker[worker.index('function studioPickerBlank()'):worker.index('async function studioAssertBlank')]
    page.add_script_tag(content=blank)
    assert page.evaluate('studioPickerBlank()')
    page.locator('input').first.fill('Existing draft')
    assert not page.evaluate('studioPickerBlank()')
    page.locator('input').first.fill('')
    page.add_script_tag(content=(ROOT/'approved_batch_panel.js').read_text(encoding='utf-8'))
    page.get_by_text('9 approved products',exact=True).wait_for()
    assert page.locator('#__moe_approved_choice__ option').count()==9
    assert page.get_by_text('Pair this computer',exact=True).count()==0
    page.locator('#__moe_approved_choice__').select_option('item8')
    page.get_by_role('button',name='Load selected product',exact=True).click()
    page.get_by_text('Loaded Approved product 9 with 2 photos.',exact=False).wait_for()
    sent=page.evaluate("__test.calls.filter(x=>x.type==='STUDIO_APPROVED_SELECT')")
    assert len(sent)==1 and sent[0]['id']=='item8' and sent[0]['revision']==9
    assert page.locator('html').get_attribute('data-crazymoe-import-owner')=='studio-approved'
    page.get_by_role('button',name='Confirm posted & load next',exact=True).click()
    page.get_by_text('Your confirmation is saved. The next product is open',exact=False).wait_for()
    assert page.evaluate("__test.calls.filter(x=>x.type==='STUDIO_APPROVED_CONFIRM').length")==1
    page.evaluate('()=>{__test.connected=false}')
    page.get_by_role('button',name='Refresh approved',exact=True).click()
    page.get_by_text('No pairing code is needed.',exact=False).wait_for()
    assert page.locator('#__moe_approved_choice__ option').count()==0
    assert page.get_by_role('button',name='Load selected product',exact=True,include_hidden=True).is_disabled()
    page.evaluate('()=>{__test.connected=true}')
    page.get_by_role('button',name='Refresh approved',exact=True).click()
    page.get_by_text('8 approved products',exact=True).wait_for()
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert page.get_by_role('button',name='Confirm posted & load next',exact=True).count()==0
    assert not errors,errors
    page.screenshot(path=str(ROOT/f'approved-picker-{width}.png'))
    print(json.dumps({'viewport':width,'approved_count':9,'selected_ninth':True,'confirm_and_next':True,'disconnected_recovery':True,'no_pairing_prompt':True,'errors':errors}),flush=True)
    page.close()
   # A full post-publication navigation must retain the confirm control for a tracked tab.
   page=browser.new_page(viewport={'width':390,'height':900})
   page.route('**/*',lambda route:route.fulfill(content_type='text/html',body='<html><body>Marketplace selling</body></html>'))
   page.goto('https://www.facebook.com/marketplace/you/selling')
   page.evaluate('''()=>{window.chrome={runtime:{sendMessage(m,reply){reply(m.type==='STUDIO_APPROVED_CONTEXT'?{ok:true,context:{id:'item8',revision:9,title:'Approved product 9',photo_count:2,phase:'loaded'}}:{ok:true,items:[]});}}};}''')
   page.add_script_tag(content=(ROOT/'approved_batch_panel.js').read_text(encoding='utf-8'))
   page.get_by_role('button',name='Confirm posted & load next',exact=True).wait_for()
   assert page.get_by_role('button',name='Load selected product',exact=True).count()==0
   page.screenshot(path=str(ROOT/'approved-after-post.png'))
   page.close()
   # Unrelated Marketplace tabs must not show a product confirmation.
   page=browser.new_page()
   page.route('**/*',lambda route:route.fulfill(content_type='text/html',body='<html><body>Marketplace selling</body></html>'))
   page.goto('https://www.facebook.com/marketplace/you/selling')
   page.evaluate('''()=>{window.chrome={runtime:{sendMessage(m,reply){reply({ok:true,context:null});}}};}''')
   page.add_script_tag(content=(ROOT/'approved_batch_panel.js').read_text(encoding='utf-8'))
   page.wait_for_timeout(100)
   assert page.locator('#__moe_approved_panel__').count()==0
   print(json.dumps({'post_publication_console':True,'unrelated_tab_hidden':True}),flush=True)
   page.close()
  finally:browser.close()
if __name__=='__main__':main()
