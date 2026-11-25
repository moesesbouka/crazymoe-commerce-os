"use strict";

async function facebookImportRequest(action, id, profile, details = {}) {
  const message = {type: "STUDIO_FACEBOOK_SCAN_V2", action, id, profile, ...details};
  let reply;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      reply = await chrome.runtime.sendMessage(message);
    } catch {
      reply = {retry: true, error: "Crazy Moe extension disconnected. Reload this tab and retry."};
    }
    if (reply?.ok) return reply;
    if (!reply?.retry) break;
  }
  throw facebookScanError("STUDIO_ERROR", reply?.error || "Studio could not record this scan.");
}

async function startHardenedFacebookScan(mode, profile) {
  const id = crypto.randomUUID();
  const request = (action, details) => facebookImportRequest(action, id, profile, details);
  const started = await request("start", {mode});
  if (started.state !== "discovering") throw Error("This scanner run is no longer active.");
  const controller = new AbortController();
  let count = 0;
  let pages = 0;
  let inFlight = false;

  function checkActive(run, expected) {
    if (run.state === "stopped") throw Error("Scan stopped in Studio.");
    if (!expected.includes(run.state)) throw Error("This scan is no longer running.");
    return run;
  }

  const timer = setInterval(async () => {
    if (inFlight || controller.signal.aborted) return;
    inFlight = true;
    try {
      checkActive(await request("heartbeat", {found: count, pages}), ["discovering", "saving", "completed", "partial"]);
    } catch (error) {
      controller.abort(error);
    } finally {
      inFlight = false;
    }
  }, 8000);

  return {
    account: started.account_tag,
    signal: controller.signal,
    discoveryProgress(found, visitedPages) {
      controller.signal.throwIfAborted();
      count = found;
      pages = visitedPages;
    },
    async save(discovery, progress) {
      try {
        controller.signal.throwIfAborted();
        const {listings, endReason} = discovery;
        const rows = [...new Map(listings.map(listing => [listing.facebook_id, listing])).values()];
        let run = checkActive(await request("saving", {found: rows.length, pages: discovery.pages, endReason}), ["saving"]);
        for (let offset = 0; offset < rows.length; offset += 50) {
          controller.signal.throwIfAborted();
          if (facebookSellingProfile() !== profile) throw facebookScanError("FACEBOOK_IDENTITY", "Facebook switched profiles during the scan.");
          run = checkActive(await request("batch", {batch: offset / 50, rows: rows.slice(offset, offset + 50)}), ["saving"]);
          progress(run.processed, rows.length);
        }
        run = checkActive(await request("complete"), ["completed", "partial"]);
        return {matched: run.refreshed, pending: run.pending, skipped: run.skipped, state: run.state, endReason: run.end_reason};
      } finally {
        clearInterval(timer);
      }
    },
    async fail(error) {
      clearInterval(timer);
      const codes = ["FACEBOOK_HTTP","FACEBOOK_NETWORK","FACEBOOK_TIMEOUT","FACEBOOK_RESPONSE","FACEBOOK_CURSOR","FACEBOOK_IDENTITY"];
      try { await request("fail", {error: codes.includes(error?.code) ? error.code : "STUDIO_ERROR"}); } catch {}
    }
  };
}
