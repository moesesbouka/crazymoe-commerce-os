(async()=>{
  const result=await chrome.runtime.sendMessage({type:"STUDIO_MEMBER_PROBE"});
  document.getElementById("status").textContent=result?.ok?"Member access verified":"Member access failed";
  await chrome.downloads.download({
    url:"data:application/json,"+encodeURIComponent(JSON.stringify({...result,checked_at:new Date().toISOString()})),
    filename:"CrazyMoe-sync/member-access-probe.json",conflictAction:"overwrite",saveAs:false
  });
})();
