// Same-origin bridge for unpacked Commerce OS installations whose IDs differ by computer.
(()=>{
  if(window.top!==window || !["https://crazymoe-marketplace-studio.vercel.app","https://studio.crazymoe.com"].includes(location.origin))return;
  let reading=null;
  window.addEventListener("message",async event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.type!=="CRAZYMOE_STUDIO_SESSION_REQUEST"||!/^[-a-f0-9]{36}$/.test(event.data.requestId||""))return;
    const requestId=event.data.requestId;
    try{
      if(!reading)reading=studioAuth.auth.getSession().finally(()=>{reading=null;});
      const {data,error}=await reading;if(error)throw error;
      const active=data.session;
      const session=active?{access_token:active.access_token,refresh_token:active.refresh_token,expires_at:active.expires_at}:null;
      window.postMessage({type:"CRAZYMOE_STUDIO_SESSION_RESPONSE",requestId,session},location.origin);
    }catch{
      // Network/SDK failures are not a signed-out state. Let the bridge retry.
    }
  });
})();
