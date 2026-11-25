"use strict";

(() => {
  const {auth, rpc, element} = StudioChannels;
  const get = id => document.getElementById(id);
  const form = get("channel-filters");
  const message = get("channel-message");
  const previous = get("channel-prev");
  const next = get("channel-next");
  const refresh = get("channel-refresh");
  const params = new URLSearchParams(location.search);
  const pageSize = 50;
  const usd = new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"});
  const labels = {
    active: "Active", posted: "Posted", stale: "Needs rescan", inactive: "Inactive",
    sold: "Sold", needs_details: "Needs details", ready: "Ready",
    handed_off: "Form filled", cancelled: "Removed", skipped: "Skipped",
    source_unavailable: "Source unavailable", published: "Published"
  };

  const requestedView = params.get("view");
  if ([...form.elements.view.options].some(option => option.value === requestedView)) form.elements.view.value = requestedView;
  form.elements.query.value = (params.get("q") || "").slice(0, 200);
  let offset = 0;
  let controller;

  function money(price) {
    const number = Number(price);
    return price === null || price === undefined || String(price).trim() === "" || !Number.isFinite(number) ? "" : usd.format(number);
  }

  function link(text, href, external = false) {
    const anchor = element("a", text);
    anchor.href = href;
    if (external) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    return anchor;
  }

  function facebookUrl(id) {
    return /^\d{10,19}$/.test(id || "") ? "https://www.facebook.com/marketplace/item/" + id + "/" : "";
  }

  function mercariUrl(raw) {
    try {
      const url = new URL(raw);
      if (url.origin === "https://www.mercari.com" && /^\/us\/item\/m\d+\/?$/.test(url.pathname)) return url.origin + url.pathname;
    } catch {}
    return "";
  }

  function badge(state) {
    const pill = element("span", labels[state] || state, "channel-state");
    pill.dataset.state = state;
    return pill;
  }

  function channelCell(listings) {
    const cell = element("td");
    if (!listings.length) cell.append(element("small", "—"));
    for (const listing of listings) {
      const div = element("div", undefined, "channel-listing");
      div.append(badge(listing.state));
      const price = money(listing.price);
      if (price) div.append(element("small", price));
      if (listing.last_seen_at) div.append(element("small", "Seen " + new Date(listing.last_seen_at).toLocaleDateString()));
      const url = facebookUrl(listing.facebook_id);
      if (url) div.append(link("View on Facebook", url, true));
      cell.append(div);
    }
    return cell;
  }

  function mercariCell(item) {
    const cell = element("td");
    if (!item.mercari) {
      cell.append(element("small", item.shortlisted ? "Shortlisted" : "—"));
      return cell;
    }
    cell.append(badge(item.mercari.state));
    const price = money(item.mercari.price);
    if (price) cell.append(element("small", price));
    const url = mercariUrl(item.mercari.listing_url);
    if (url) cell.append(link("View listing", url, true), element("br"));
    cell.append(link("Open in Mercari desk", "/mercari.html?queue=" + encodeURIComponent(item.mercari.id)));
    return cell;
  }

  function websiteCell(item) {
    const cell = element("td");
    if (!item.website) cell.append(element("small", "—"));
    else {
      cell.append(badge("published"));
      const price = money(item.website.price);
      if (price) cell.append(element("small", price));
      cell.append(link("Open storefront", "https://www.crazymoe.com/", true));
    }
    return cell;
  }

  function details(item) {
    const drawer = element("details", undefined, "channel-detail");
    const heading = item.review.length ? "Review possible match" : "Related Facebook listings";
    drawer.append(element("summary", heading));
    const list = element("ul");
    for (const match of [...item.review, ...item.related.filter(row => !item.review.some(review => review.facebook_id === row.facebook_id))]) {
      const row = element("li");
      row.append(element("span", [match.title || "Untitled", money(match.price), match.active ? "Active record" : "Inactive record"].filter(Boolean).join(" · ")));
      const url = facebookUrl(match.facebook_id);
      if (url) row.append(element("br"), link("View on Facebook", url, true));
      if (item.review.includes(match)) {
        row.append(element("br"));
        const controls = [
          ["confirm", "Same physical item"],
          ["reject", "Different items"]
        ].map(([action, text]) => {
          const button = element("button", text, "channel-button");
          button.type = "button";
          button.onclick = async () => {
            controls.forEach(control => { control.disabled = true; });
            try {
              await rpc("studio_mercari_links", {p_action: action, p_link: match.id});
              await load();
            } catch (error) {
              message.textContent = error.message;
            } finally {
              controls.forEach(control => { control.disabled = false; });
            }
          };
          return button;
        });
        row.append(...controls);
      }
      list.append(row);
    }
    drawer.append(list);
    return drawer;
  }

  function render(result) {
    const columns = element("tr");
    const accounts = result.accounts.length ? result.accounts : [{account_tag: "", label: "Facebook"}];
    const columnNames = ["Product", ...accounts.map(account => account.label || "Facebook · " + account.account_tag), "Mercari", "CrazyMoe.com"];
    for (const name of columnNames) {
      const column = element("th", name);
      column.scope = "col";
      columns.append(column);
    }
    get("channel-columns").replaceChildren(columns);

    const rows = result.items.map(item => {
      const tr = element("tr");
      const title = element("th", item.title || "Untitled");
      title.scope = "row";
      const source = item.source_kind === "studio" ? "Studio" : "Facebook import";
      title.append(element("small", [source, money(item.price)].filter(Boolean).join(" · ")));
      if (item.review.length || item.related.length) title.append(details(item));
      tr.append(title);
      for (const account of accounts) tr.append(channelCell(item.facebook.filter(listing => listing.account_tag === account.account_tag)));
      tr.append(mercariCell(item), websiteCell(item));
      return tr;
    });
    if (!rows.length) {
      const row = element("tr");
      const cell = element("td", "No inventory matches this view.");
      cell.colSpan = columnNames.length;
      row.append(cell);
      rows.push(row);
    }
    get("channel-rows").replaceChildren(...rows);
    get("channel-range").textContent = result.total ? (offset + 1) + "–" + (offset + result.items.length) + " of " + result.total : "0 products";
    previous.disabled = offset === 0;
    next.disabled = offset + result.items.length >= result.total;
  }

  async function load() {
    controller?.abort();
    const pending = new AbortController();
    controller = pending;
    refresh.disabled = previous.disabled = next.disabled = true;
    message.textContent = "Loading inventory…";
    try {
      const result = await rpc("studio_channel_inventory", {
        p_view: form.elements.view.value,
        p_query: form.elements.query.value.trim(),
        p_offset: offset,
        p_limit: pageSize
      }, pending.signal);
      if (pending.signal.aborted) return;
      if (offset && offset >= result.total) {
        offset = Math.max(0, Math.ceil(result.total / pageSize) - 1) * pageSize;
        await load();
        return;
      }
      render(result);
      message.textContent = "";
    } catch (error) {
      if (!pending.signal.aborted) message.textContent = error.message;
    } finally {
      if (!pending.signal.aborted) refresh.disabled = false;
    }
  }

  function filter(event) {
    event?.preventDefault();
    offset = 0;
    const query = new URLSearchParams();
    if (form.elements.view.value !== "all") query.set("view", form.elements.view.value);
    if (form.elements.query.value.trim()) query.set("q", form.elements.query.value.trim());
    history.replaceState(null, "", query.size ? "?" + query : location.pathname);
    load();
  }

  form.onsubmit = filter;
  form.elements.view.onchange = filter;
  refresh.onclick = load;
  previous.onclick = () => { offset = Math.max(0, offset - pageSize); load(); };
  next.onclick = () => { offset += pageSize; load(); };

  async function initialize() {
    await auth.initialize();
    const {data} = await auth.getSession();
    get("channel-signin").hidden = !!data.session;
    get("channel-inventory").hidden = refresh.hidden = !data.session;
    if (data.session) await load();
    else message.textContent = "Sign in with your Studio account to view inventory.";
  }

  auth.onAuthStateChange(event => {
    if (event === "SIGNED_OUT") {
      controller?.abort();
      get("channel-rows").replaceChildren();
      setTimeout(initialize, 0);
    }
  });
  initialize().catch(error => { message.textContent = error.message; });
})();
