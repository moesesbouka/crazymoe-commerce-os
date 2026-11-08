// Runs only in the signed-in Studio origin. Credentials stay in extension session memory.
(()=>{
  if(window.top!==window || !["https://crazymoe-marketplace-studio.vercel.app","https://studio.crazymoe.com"].includes(location.origin))return;
  if(window.__moeStudioConnectionBridge)return;
  window.__moeStudioConnectionBridge=true;
  let connecting=null;
  const connect=()=>{
    if(connecting)return connecting;
    connecting=new Promise(resolve=>{
      const requestId=crypto.randomUUID();let finished=false;
      const finish=value=>{if(finished)return;finished=true;clearTimeout(timeout);clearInterval(retry);window.removeEventListener("message",receive);resolve(value);};
      const receive=async event=>{
        if(event.source!==window||event.origin!==location.origin||event.data?.type!=="CRAZYMOE_STUDIO_SESSION_RESPONSE"||event.data.requestId!==requestId)return;
        if(!event.data.session){finish({ok:false,needsSignIn:true});return;}
        try{finish(await chrome.runtime.sendMessage({type:"STUDIO_AUTH_SESSION",session:event.data.session}));}
        catch{finish({ok:false,error:"Reload the extension to reconnect."});}
      };
      const ask=()=>window.postMessage({type:"CRAZYMOE_STUDIO_SESSION_REQUEST",requestId},location.origin);
      const timeout=setTimeout(()=>finish({ok:false,error:"Studio connection timed out"}),6000);
      const retry=setInterval(ask,500);
      window.addEventListener("message",receive);ask();
    }).finally(()=>{connecting=null;});
    return connecting;
  };
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message?.type!=="STUDIO_CONNECT_REQUEST"||sender.id!==chrome.runtime.id)return false;
    connect().then(reply);return true;
  });
  void connect();
})();
