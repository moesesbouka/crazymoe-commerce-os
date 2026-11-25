"use strict";
{
  const root = "https://sfheqjnxlkygjfohoybo.supabase.co";
  const publicKey = "sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af";
  const actions = new Set(["start", "heartbeat", "saving", "batch", "complete", "fail"]);
  const headers = {apikey: publicKey, "Content-Type": "application/json"};
  let refreshInFlight;

  async function renewSession(refreshToken) {
    const response = await fetch(root + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers, body: JSON.stringify({refresh_token: refreshToken}), signal: AbortSignal.timeout(15000)
    }).catch(() => { throw Object.assign(Error("Studio sign-in connection interrupted."), {retry: true}); });
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) throw Object.assign(Error("Studio sign-in temporarily unavailable."), {retry: true});
      throw Error("Studio sign-in expired. Sign in to the extension and start a new scan.");
    }
    const auth = await response.json();
    const {studioSync: current} = await chrome.storage.session.get("studioSync");
    if (current?.refresh !== refreshToken) {
      if (current?.token) return current.token;
      throw Error("The extension signed out. Sign in to Studio again.");
    }
    const session = {token: auth.access_token, expires: auth.expires_at, refresh: auth.refresh_token};
    if (!session.token || !session.expires || !session.refresh) throw Error("Studio returned an incomplete sign-in session.");
    await chrome.storage.session.set({studioSync: session});
    return session.token;
  }

  async function getSessionToken(action, rejectedToken) {
    if (refreshInFlight) return refreshInFlight;
    const {studioSync: current} = await chrome.storage.session.get("studioSync");
    if (current?.token && current.expires > Date.now() / 1000 + 30 && current.token !== rejectedToken) return current.token;
    if (current?.refresh) {
      if (!refreshInFlight) refreshInFlight = renewSession(current.refresh).finally(() => { refreshInFlight = null; });
      return refreshInFlight;
    }
    if (action === "start") await chrome.tabs.create({url: chrome.runtime.getURL("sync_login.html")});
    throw Error("Connect the extension to your Studio account and retry.");
  }

  async function trackImport(message, sender) {
    const page = new URL(sender.url);
    if (page.origin !== "https://www.facebook.com" || !/^\/marketplace\/you\/selling\/?$/.test(page.pathname)
      || sender.frameId !== 0 || !actions.has(message.action)) {
      throw Error("Open the Facebook selling page to scan.");
    }
    const body = JSON.stringify({
      p_action: message.action, p_id: message.id, p_account: message.account, p_mode: message.mode,
      p_profile: message.profile, p_version: chrome.runtime.getManifest().version,
      p_found: message.found, p_pages: message.pages, p_end_reason: message.endReason,
      p_batch: message.batch, p_rows: message.rows, p_error: message.error
    });
    const send = token => fetch(root + "/rest/v1/rpc/studio_facebook_import_v2", {
      method: "POST", headers: {...headers, Authorization: "Bearer " + token},
      body, signal: AbortSignal.timeout(20000)
    }).catch(() => { throw Object.assign(Error("Studio connection interrupted."), {retry: true}); });

    const token = await getSessionToken(message.action);
    let response = await send(token);
    if (response.status === 401) response = await send(await getSessionToken(message.action, token));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (result.message === "FACEBOOK_ACCOUNT_MISMATCH") throw Error("This Facebook profile is not registered for the selected Studio account.");
      if (result.code === "23505" && message.action === "start") throw Error("A scan is already running for this Facebook account.");
      throw Object.assign(Error("Studio could not record this scan (" + response.status + ")."), {retry: response.status >= 500});
    }
    return result;
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== "STUDIO_FACEBOOK_SCAN_V2") return false;
    trackImport(message, sender).then(result => reply({ok: true, ...result}),
      error => reply({ok: false, error: error.message, retry: error.retry === true}));
    return true;
  });
}
