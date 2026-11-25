async function syncObservedListings(listings, account, mode, progress) {
  let matched = 0, pending = 0, confirmed = 0;
  for (let start = 0; start < listings.length; start += 50) {
    const rows = listings.slice(start,start+50);
    let reply;
    try {
      reply = await chrome.runtime.sendMessage({type:"STUDIO_SYNC_OBSERVATIONS",account,mode,rows});
    } catch { throw Error("Commerce OS disconnected. Reload the selling tab and retry."); }
    if (!reply?.ok)
      throw Error((reply?.error || "Cloud sync failed.") + " Previously confirmed observations: " + confirmed + ".");
    matched += reply.matched;
    pending += reply.pending;
    confirmed += rows.length;
    progress(confirmed,listings.length);
  }
  return {matched,pending};
}
