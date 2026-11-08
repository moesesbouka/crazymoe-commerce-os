"""Isolated browser fixtures: connection bridge, origin checks, approved-panel recovery."""
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).parent
PAGE=(ROOT/'studio-connection.js').read_text() if (ROOT/'studio-connection.js').exists() else (ROOT.parent/'web/studio-connection.js').read_text()
BRIDGE=(ROOT/'studio_connection_bridge.js').read_text();PANEL=(ROOT/'approved_batch_panel.js').read_text()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 context=browser.new_context();context.route('**/*',lambda r:r.fulfill(content_type='text/html',body='<!doctype html><title>Fixture</title><body></body>'))
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('https://crazymoe-marketplace-studio.vercel.app/app/')
 page.evaluate("""()=>{window.captured=[];window.replies=[];window.studioAuth={auth:{getSession:async()=>({data:{session:{access_token:'synthetic.access.token',refresh_token:'123456789012',expires_at:Date.now()/1000+3600}}})}};window.chrome={runtime:{id:'fixture',onMessage:{addListener(){}},sendMessage:async value=>{captured.push(value);return {ok:true}}}};addEventListener('message',e=>{if(e.data?.type==='CRAZYMOE_STUDIO_SESSION_RESPONSE')replies.push(e.data)})}""")
 page.add_script_tag(content=PAGE);page.add_script_tag(content=BRIDGE)
 page.wait_for_function('captured.length===1');assert page.evaluate('captured[0].type')=='STUDIO_AUTH_SESSION'
 page.evaluate("""()=>{for(const origin of ['https://evil.invalid','null'])dispatchEvent(new MessageEvent('message',{source:window,origin,data:{type:'CRAZYMOE_STUDIO_SESSION_REQUEST',requestId:'00000000-0000-0000-0000-000000000000'}}));dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{type:'CRAZYMOE_STUDIO_SESSION_REQUEST',requestId:'invalid'}}));}""")
 page.wait_for_timeout(50);assert page.evaluate('replies.length')==1
 print('PASS same-origin bridge reconnects without hardcoded extension ID; other origins and invalid requests rejected')
 context.close()
 for width in (390,1366):
  context=browser.new_context(viewport={'width':width,'height':850});context.route('**/*',lambda r:r.fulfill(content_type='text/html',body='<!doctype html><title>Facebook fixture</title><body></body>'));page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('https://www.facebook.com/marketplace/create/item/')
  page.evaluate("""()=>{window.connected=false;window.messages=[];window.chrome={runtime:{lastError:null,sendMessage:(value,reply)=>{messages.push(value);if(value.type==='STUDIO_APPROVED_CONTEXT')reply({ok:true,context:null});else if(value.type==='STUDIO_APPROVED_LIST')reply(connected?{ok:true,items:Array.from({length:10},(_,i)=>({id:'item-'+i,revision:7,title:'Product '+i,price:55,condition:'New',photo_count:3}))}:{ok:false,error:'Sign in to the Studio tab, then click Refresh approved.'});else reply({ok:true});}}};}""")
  page.add_script_tag(content=PANEL);expect(page.locator('#__moe_approved_status__')).to_contain_text('Sign in')
  expect(page.locator('#__moe_approved_choice__ option')).to_have_text(['Connect Studio to load approved products'])
  page.evaluate("()=>{connected=true;dispatchEvent(new Event('focus'));}")
  expect(page.locator('#__moe_approved_choice__ option')).to_have_count(10)
  page.locator('#__moe_approved_choice__').select_option('item-4');page.get_by_role('button',name='Load selected product',exact=True).click()
  page.wait_for_function("messages.some(m=>m.type==='STUDIO_APPROVED_SELECT'&&m.id==='item-4'&&m.revision===7)")
  print('PASS approved panel reconnect and ten-product selection',width)
  context.close()
 assert not errors,errors
 browser.close()
