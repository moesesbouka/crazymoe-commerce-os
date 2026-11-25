"use strict";

async function facebookImportRequest(action, id, details = {}) {
  const message = {type: "STUDIO_FACEBOOK_IMPORT", action, id, ...details};
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
  throw Error(reply?.error || "Studio could not record this scan.");
}

async function startFacebookImport(account, mode) {
  const id = crypto.randomUUID();
  await facebookImportRequest("start", id, {account, mode});
  let count = 0;
  let failure;
  let inFlight;
  const timer = setInterval(() => {
    if (inFlight || failure) return;
    inFlight = facebookImportRequest("heartbeat", id, {found: count})
      .then(run => {
        if (run.state !== "discovering" && run.state !== "saving") {
          failure = Error(run.state === "stopped" ? "Scan stopped in Studio." : "This scan is no longer running.");
        }
      }, error => { failure = error; })
      .finally(() => { inFlight = null; });
  }, 8000);

  async function save(listings, progress) {
    const rows = [...new Map(listings.map(listing => [listing.facebook_id, listing])).values()];
    function check(run) {
      if (run.state === "stopped") throw Error("Scan stopped in Studio.");
      if (run.state !== "saving") throw Error("This scan is no longer running.");
      return run;
    }
    let run = check(await facebookImportRequest("saving", id, {found: rows.length}));
    for (let offset = 0; offset < rows.length; offset += 50) {
      run = check(await facebookImportRequest("batch", id, {
        batch: offset / 50, rows: rows.slice(offset, offset + 50)
      }));
      progress(run.processed, rows.length);
    }
    return {matched: run.refreshed, pending: run.pending, skipped: run.skipped};
  }

  return {
    discoveryProgress(found) {
      if (failure) throw failure;
      count = found;
    },
    async save(listings, progress) {
      try {
        const counts = await save(listings, progress);
        const run = await facebookImportRequest("complete", id);
        if (run.state !== "completed") throw Error("Scan stopped before it was completed.");
        return counts;
      } finally {
        clearInterval(timer);
      }
    },
    async fail() {
      clearInterval(timer);
      try { await facebookImportRequest("fail", id); } catch {}
    }
  };
}
