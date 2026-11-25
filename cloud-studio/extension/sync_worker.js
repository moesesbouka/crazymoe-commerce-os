"use strict";
{
  const root = "https://sfheqjnxlkygjfohoybo.supabase.co";
  const key = "sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af";
  const login = chrome.runtime.getURL("sync_login.html");
  const headers = {apikey:key,"Content-Type":"application/json"};
  async function handle(message, sender) {
    if (message.type === "STUDIO_SYNC_LOGIN") {
      if (sender.url !== login) throw Error("Invalid sign-in context.");
      const result = await fetch(root+"/auth/v1/token?grant_type=password",{method:"POST",headers,
        body:JSON.stringify({email:message.email,password:message.password})});
      if (!result.ok) throw Error("Studio sign-in failed.");
      const auth = await result.json();
      await chrome.storage.session.set({studioSync:{token:auth.access_token,expires:auth.expires_at}});
      return {};
    }
    const page = new URL(sender.url);
    if (page.origin !== "https://www.facebook.com" || !/^\/marketplace\/you\/selling\/?$/.test(page.pathname) || sender.frameId !== 0)
      throw Error("Open your Facebook selling page.");
    const {studioSync} = await chrome.storage.session.get("studioSync");
    if (!studioSync || studioSync.expires <= Date.now()/1000 + 10) {
      await chrome.tabs.create({url:login});
      throw Error("Connect your Studio account in the new tab and retry.");
    }
    const res = await fetch(root+"/rest/v1/rpc/studio_sync_observations",{method:"POST",
      headers:{...headers,Authorization:"Bearer "+studioSync.token},
      body:JSON.stringify({p_mode:message.mode,p_account:message.account,p_rows:message.rows})});
    if (!res.ok) {
      if (res.status===401) await chrome.storage.session.remove("studioSync");
      throw Error("Sync batch rejected ("+res.status+"). Retry after checking Studio access.");
    }
    return res.json();
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if (!["STUDIO_SYNC_LOGIN","STUDIO_SYNC_OBSERVATIONS"].includes(message?.type)) return false;
    handle(message,sender).then(result=>reply({ok:true,...result})).catch(error=>reply({ok:false,error:error.message}));
    return true;
  });
}
