'use strict';
// No account tokens cross this bridge. Studio supplies only the requested draft.
window.addEventListener('message',event=>{
 if(event.source!==window||event.origin!==location.origin||event.data?.channel!=='CRAZYMOE_MERCARI_REQUEST'||typeof event.data.requestId!=='string')return;
 const {requestId,type,payload}=event.data;
 if(!['PING','FILL','CATEGORIES'].includes(type))return;
 chrome.runtime.sendMessage({type:'CM_MERCARI_'+type,payload}).then(result=>window.postMessage({channel:'CRAZYMOE_MERCARI_RESPONSE',requestId,result},location.origin))
 .catch(error=>window.postMessage({channel:'CRAZYMOE_MERCARI_RESPONSE',requestId,result:{ok:false,error:error.message}},location.origin));
});
chrome.runtime.onMessage.addListener(message=>{
 if(message.type==='CM_MERCARI_RESULT')window.postMessage({channel:'CRAZYMOE_MERCARI_EVENT',result:message.result},location.origin);
});
