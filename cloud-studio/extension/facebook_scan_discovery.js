"use strict";

function facebookScanError(code, text) {
  return Object.assign(new Error(text), {code});
}

function facebookSellingProfile() {
  const profiles = new Set();
  for (const script of document.scripts) {
    const text = script.textContent || "";
    // Read only the current viewer identity, never the seller ID from cached query variables.
    for (const record of text.matchAll(/"CurrentUserInitialData"\s*,\s*\[[^\]]*\]\s*,\s*\{([^{}]{1,4000})\}/g)) {
      const profile = record[1].match(/"USER_ID"\s*:\s*"?([1-9]\d{4,24})"?(?=\s*(?:,|$))/);
      if (profile) profiles.add(profile[1]);
    }
  }
  if (profiles.size !== 1) throw facebookScanError("FACEBOOK_IDENTITY", "Reload Facebook Selling and check which profile is signed in.");
  return profiles.values().next().value;
}

function parseFacebookSellingPage(body) {
  const readable = body.replace(/^\s*for\s*\(\s*;;\s*\)\s*;?\s*/, "").trim();
  try {
    const records = (() => {
      try { return [JSON.parse(readable)]; }
      catch { return readable.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
    })();
    const connections = [];
    const visit = (value, field = "") => {
      if (!value || typeof value !== "object") return;
      if (isSellingListingsField(field) && Array.isArray(value.edges) && value.page_info) {
        connections.push(value);
        return;
      }
      for (const [key, child] of Object.entries(value)) visit(child, key);
    };
    for (const record of records.flat()) {
      if (record.errors?.length) throw Error("Facebook reported an error.");
      visit(record.data);
    }
    if (connections.length !== 1) throw Error("Expected one selling listings feed.");
    const {edges, page_info: page} = connections[0];
    if (typeof page.has_next_page !== "boolean" || edges.some(edge => !edge?.node)) throw Error("Invalid listings page.");
    return {nodes: edges.map(edge => edge.node), hasNext: page.has_next_page, cursor: page.end_cursor};
  } catch {
    throw facebookScanError("FACEBOOK_RESPONSE", "Facebook returned an unreadable selling listings page.");
  }
}

function isSellingListingsField(field) {
  return ["marketplace_listing_sets", "marketplace_listings", "marketplace_seller_listings",
    "marketplace_listing_management", "marketplace_listing_management_listings", "seller_listings"].includes(field);
}

async function discoverFacebookListings({fetchPage, extract, profile, getProfile, report, signal, pause, pageLimit = 300}) {
  const listings = new Map();
  const cursors = new Set();
  let cursor = null;

  for (let pages = 1; pages <= pageLimit; pages++) {
    signal.throwIfAborted();
    if (getProfile() !== profile) throw facebookScanError("FACEBOOK_IDENTITY", "Facebook switched profiles during the scan.");
    const page = parseFacebookSellingPage(await fetchPage(cursor, signal));
    if (getProfile() !== profile) throw facebookScanError("FACEBOOK_IDENTITY", "Facebook switched profiles during the scan.");
    for (const node of page.nodes) {
      const listing = extract(node);
      if (!listing || !/^\d{10,19}$/.test(listing.facebook_id)) {
        throw facebookScanError("FACEBOOK_RESPONSE", "Facebook returned a selling row without a listing ID.");
      }
      listings.set(listing.facebook_id, listing);
    }
    report(listings.size, pages);
    if (!page.hasNext) {
      if (!listings.size && pages !== 1) throw facebookScanError("FACEBOOK_RESPONSE", "Facebook returned inconsistent empty inventory pages.");
      return {listings: [...listings.values()], pages, endReason: listings.size ? "end_of_feed" : "verified_empty"};
    }
    if (!page.nodes.length || typeof page.cursor !== "string" || !page.cursor || cursors.has(page.cursor)) {
      throw facebookScanError("FACEBOOK_CURSOR", "Facebook returned an incomplete or repeated listing cursor.");
    }
    if (pages === pageLimit) return {listings: [...listings.values()], pages, endReason: "page_cap"};
    cursors.add(page.cursor);
    cursor = page.cursor;
    await pause();
  }
  throw facebookScanError("FACEBOOK_RESPONSE", "No Facebook listings page was checked.");
}

async function readFacebookScanResponse(fetcher, signal, timeoutMs = 20000) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const requestSignal = AbortSignal.any([signal, deadline]);
  try {
    const response = await fetcher(requestSignal);
    if (!response.ok) throw facebookScanError("FACEBOOK_HTTP", "Facebook returned HTTP " + response.status + ".");
    return await response.text();
  } catch (error) {
    signal.throwIfAborted();
    if (deadline.aborted) throw facebookScanError("FACEBOOK_TIMEOUT", "The Facebook listings page took too long to load.");
    if (error.code === "FACEBOOK_HTTP") throw error;
    throw facebookScanError("FACEBOOK_NETWORK", "The Facebook listings request was interrupted.");
  }
}
