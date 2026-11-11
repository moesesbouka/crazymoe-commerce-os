'use strict';
(async()=>{
 document.addEventListener('click',event=>{if(event.isTrusted&&event.target.closest('[data-testid="ListButton"]'))chrome.runtime.sendMessage({type:'CM_MERCARI_SUBMIT'}).catch(()=>{});},true);
 const answer=await chrome.runtime.sendMessage({type:'CM_MERCARI_READY'});if(!answer?.job)return;
 const badge=document.createElement('aside');badge.id='crazy-moe-mercari-status';badge.style.cssText='position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:370px;background:#17212a;color:#fff;padding:18px;border-radius:12px;font:14px/1.6 system-ui;box-shadow:0 6px 24px #0004';badge.textContent='Crazy Moe: '+(answer.job.mode==='categories'?'Importing Mercari categories…':'Loading your Studio listing…');document.body.append(badge);
 let result;
 try{result=answer.job.mode==='categories'?{state:'categories',paths:await CMMercariForm.importCategories(n=>badge.textContent='Crazy Moe: '+n+' category choices imported…')} : await CMMercariForm.fill(answer.job.draft);
  badge.textContent=answer.job.mode==='categories'?'Crazy Moe: categories imported. Return to Studio.':'Crazy Moe loaded: '+result.done.join(', ')+'. '+result.warnings.join(' ')+' Nothing has been published.';
 }catch(e){result={state:'error',error:e.message};badge.textContent='Crazy Moe: '+e.message;}
 await chrome.runtime.sendMessage({type:'CM_MERCARI_PROGRESS',result});
})();
