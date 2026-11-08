const out=document.getElementById('status');
function show(x){out.textContent=JSON.stringify(x,null,2)}
function get(){chrome.runtime.sendMessage({type:'CMOE_GET_BG_GALLERY'},r=>show(r||{error:chrome.runtime.lastError?.message}))}
document.getElementById('start').onclick=()=>chrome.runtime.sendMessage({type:'CMOE_START_BG_GALLERY',limit:5000},r=>{show(r);setTimeout(get,1000)});
document.getElementById('stop').onclick=()=>chrome.runtime.sendMessage({type:'CMOE_STOP_BG_GALLERY'},r=>show(r));
get();setInterval(get,5000);
// Manual recovery path when Facebook SPA navigation bypasses document_idle injection.
document.getElementById('openApproved').onclick=async()=>{
 const status=document.getElementById('approvedStatus');
 try{
  const tabs=await chrome.tabs.query({active:true,currentWindow:true});
  const tab=tabs[0];
  if(!tab?.id||!/^https:\/\/(?:www\.|m\.)?facebook\.com\/marketplace\/create\//.test(tab.url||''))throw Error('Open Facebook Marketplace Create Item first.');
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['approved_batch_panel.js']});
  const check=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>!!document.getElementById('__moe_approved_panel__')});
  if(!check?.[0]?.result)throw Error('Panel injection did not appear.');
  status.textContent='Approved-listing panel opened on Facebook. Close this popup to use it.';
 }catch(e){status.textContent='Panel not opened: '+String(e.message||e);}
};
const pairStatus=document.getElementById('approvedStatus');
const bridgeMessage=(msg)=>new Promise((resolve)=>chrome.runtime.sendMessage(msg,r=>resolve(chrome.runtime.lastError?{ok:false,error:chrome.runtime.lastError.message}:r||{ok:false,error:'No extension response'})));
document.getElementById('checkPairing').onclick=async()=>{
 pairStatus.textContent='Checking Studio connection…';
 const r=await bridgeMessage({type:'STUDIO_APPROVED_LIST'});
 pairStatus.textContent=r.ok?'Connected to Studio: '+r.items.length+' approved products. Open a blank Facebook item form to select one.':'Open Studio and sign in in this Chrome profile, then check again. '+(r.error||'');
};
