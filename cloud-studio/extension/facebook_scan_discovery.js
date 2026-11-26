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

const SELLING_FIELDS = new Set([
  "marketplace_listing_sets", "marketplace_listings", "marketplace_seller_listings",
  "marketplace_listing_management", "marketplace_listing_management_listings", "seller_listings"
]);
const SELLING_WRAPPERS = new Set(["marketplace_listing_set", "listing_set", "listing_sets", "active_listings", "listings", "items"]);
const STRUCTURAL_FIELDS = new Set([
  "data", "payload", "viewer", "node", "seller", "marketplace", "marketplace_listing_set",
  "listing_set", "listing_sets", "active_listings", "listings", "items", "edges", "page_info",
  "has_next_page", "end_cursor", ...SELLING_FIELDS, ...SELLING_WRAPPERS
]);

function readSellingRecords(body) {
  const stripPrefix = text => text.replace(/^\s*for\s*\(\s*;;\s*\)\s*;?\s*/, "").trim();
  const readable = stripPrefix(body);
  try {
    return [JSON.parse(readable)].flat();
  } catch {
    return readable.split(/\r?\n/).filter(line => line.trim()).flatMap(line => JSON.parse(stripPrefix(line)));
  }
}

function summarizeSellingResponse(records, issue, paths) {
  const errorCodes = [];
  for (const record of records) {
    const errors = record?.errors ?? record?.payload?.errors;
    for (const error of Array.isArray(errors) ? errors : []) {
      const code = String(error?.code ?? error?.extensions?.code ?? "");
      if (/^\d{1,9}$/.test(code) && !errorCodes.includes(code)) errorCodes.push(code);
    }
  }
  return {issue, records: records.length, errorCodes: errorCodes.slice(0, 6), paths: paths.slice(0, 8)};
}

function sellingResponseError(issue, records = [], paths = []) {
  const messages = {
    malformed: "Facebook returned a response that was not readable JSON.",
    platform_error: "Facebook returned an error instead of the selling feed.",
    missing_feed: "The response did not contain the expected Facebook selling feed.",
    ambiguous_feed: "Facebook returned more than one candidate selling feed.",
    invalid_page: "The Facebook selling feed was missing listings or pagination information."
  };
  return Object.assign(facebookScanError("FACEBOOK_RESPONSE", messages[issue]), {
    diagnostic: summarizeSellingResponse(records, issue, paths)
  });
}

function parseFacebookSellingPage(body) {
  let records;
  try {
    records = readSellingRecords(body);
  } catch {
    throw sellingResponseError("malformed");
  }
  if (!records.length || records.some(record => !record || typeof record !== "object")) {
    throw sellingResponseError("malformed");
  }
  if (records.some(record => record.errors?.length || record.payload?.errors?.length)) throw sellingResponseError("platform_error", records);

  const connections = [];
  const paths = [];
  const visit = (value, path, sellingScope) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, path, sellingScope);
      return;
    }
    if (Object.hasOwn(value, "edges") || Object.hasOwn(value, "page_info")) {
      if (!paths.includes(path)) paths.push(path);
      if (sellingScope && Array.isArray(value.edges) && value.page_info) connections.push(value);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, path + "." + (STRUCTURAL_FIELDS.has(key) ? key : "*"), SELLING_FIELDS.has(key) || (sellingScope && SELLING_WRAPPERS.has(key)));
    }
  };
  for (const record of records) {
    visit(record.data, "data", false);
    visit(record.payload?.data, "payload.data", false);
  }
  if (connections.length !== 1) throw sellingResponseError(connections.length ? "ambiguous_feed" : "missing_feed", records, paths);
  const {edges, page_info: page} = connections[0];
  if (typeof page.has_next_page !== "boolean" || edges.some(edge => !edge?.node)) {
    throw sellingResponseError("invalid_page", records, paths);
  }
  return {nodes: edges.map(edge => edge.node), hasNext: page.has_next_page, cursor: page.end_cursor};
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
