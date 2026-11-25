"use strict";
{
  const root = "https://sfheqjnxlkygjfohoybo.supabase.co";
  const publicKey = "sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af";
  const scannerActions = new Set(["start", "heartbeat", "saving", "batch", "complete", "fail"]);

  async function trackImport(message, sender) {
    const page = new URL(sender.url);
    if (page.origin !== "https://www.facebook.com" || !/^\/marketplace\/you\/selling\/?$/.test(page.pathname) || sender.frameId !== 0 || !scannerActions.has(message.action)) {
      throw Error("Open the Facebook selling page to scan.");
    }

    const {studioSync} = await chrome.storage.session.get("studioSync");
    if (!studioSync || studioSync.expires <= Date.now() / 1000 + 10) {
      if (message.action === "start") await chrome.tabs.create({url: chrome.runtime.getURL("sync_login.html")});
      throw Error("Connect the extension to your Studio account and retry.");
    }

    const response = await fetch(root + "/rest/v1/rpc/studio_facebook_import", {
      method: "POST",
      headers: {
        apikey: publicKey, "Content-Type": "application/json", Authorization: "Bearer " + studioSync.token
      },
      body: JSON.stringify({
        p_action: message.action, p_id: message.id, p_account: message.account,
        p_mode: message.mode, p_found: message.found, p_batch: message.batch, p_rows: message.rows
      })
    }).catch(() => { throw Object.assign(Error("Studio connection interrupted."), {retry: true}); });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) await chrome.storage.session.remove("studioSync");
      if (result.code === "23505" && message.action === "start") throw Error("A scan is already running for this Facebook account.");
      throw Object.assign(Error("Studio could not record this scan (" + response.status + ")."), {retry: response.status >= 500});
    }
    return result;
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== "STUDIO_FACEBOOK_IMPORT") return false;
    trackImport(message, sender).then(result => reply({ok: true, ...result}), error => reply({ok: false, error: error.message, retry: error.retry === true}));
    return true;
  });
}
