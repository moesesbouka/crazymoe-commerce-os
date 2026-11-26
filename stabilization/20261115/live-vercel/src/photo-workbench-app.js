import { connectWorkbench, resumeStorageKey, workbenchRequest, workbenchUrl } from "./photo-workbench-connect.js";

const $ = (id) => document.getElementById(id);
let view = "upload", activeBatch = null, editorDraft = null, cover = null, gallery = [];
let sending = false, poll = null, batchRows = [];
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function api(path, method = "GET", data = null, headers = {}) {
  const options = { method, headers, cache: "no-store" };
  if (data !== null) {
    if (data instanceof Blob) options.body = data;
    else {
      options.body = JSON.stringify(data);
      options.headers = { ...headers, "Content-Type": "application/json" };
    }
  }
  const response = await workbenchRequest(path, options);
  const type = response.headers.get("Content-Type") || "";
  if (!response.ok) {
    const detail = type.includes("json") ? (await response.json()).error : "Studio is unavailable.";
    throw new Error(detail);
  }
  return type.includes("zip") ? response.blob() : response.json();
}

function report(error) {
  $("notice").textContent = error instanceof Error ? error.message : String(error || "");
  $("notice").hidden = !$("notice").textContent;
}

function go(next) {
  view = next;
  document.querySelectorAll("[data-view]").forEach((button) => {
    if (button.dataset.view === next) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  for (const tab of ["upload", "inventory", "channels"]) $(tab).hidden = tab !== next;
  $("breadcrumb").textContent = "Workspace / " + next[0].toUpperCase() + next.slice(1);
  if (next === "channels") renderChannels().catch(report);
  if (next === "inventory") drawInventory();
}

function formatMoney(cents) {
  return cents == null ? "Price needed" : money.format(cents / 100);
}

function media(id, profile = "storefront") {
  return workbenchUrl("/api/media/" + id + "-" + profile + ".jpg");
}

function picture(id, alt, profile) {
  if (!id) return el("div", "Cover needed", "placeholder");
  const img = el("img");
  img.crossOrigin = "anonymous";
  img.loading = "lazy";
  img.src = media(id, profile);
  img.alt = alt;
  return img;
}

function empty(container, message) {
  container.replaceChildren(el("div", message, "empty"));
}

const batchStates = {
  receiving: "Upload paused", queued: "Queued", processing: "Processing",
  review: "Drafts available", failed: "Needs attention",
};

function renderBatches() {
  const list = $("batches");
  const selector = $("batch-select");
  list.replaceChildren();
  selector.replaceChildren();
  if (!batchRows.length) empty(list, "No batches yet. Your first upload will appear here.");
  for (const batch of batchRows) {
    const label = new Date(batch.created * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const option = el("option", label + " · " + batch.photos + " photos");
    option.value = batch.id;
    selector.append(option);
    const button = el("button");
    button.append(el("span", label + " · " + batch.photos + " photos"), el("span", batchStates[batch.state], "chip"));
    button.addEventListener("click", () => openBatch(batch.id).catch(report));
    list.append(button);
  }
  if (activeBatch) selector.value = activeBatch.id;
}

async function refreshBatches() {
  batchRows = await api("/api/batches");
  renderBatches();
}

async function openBatch(id) {
  activeBatch = await api("/api/batches/" + id);
  if (activeBatch.state === "receiving") {
    drawReceipt(activeBatch);
    go("upload");
  } else {
    go("inventory");
  }
  renderBatches();
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(poll);
  if (!activeBatch || !["queued", "processing"].includes(activeBatch.state)) return;
  const id = activeBatch.id;
  poll = setTimeout(async () => {
    try {
      const batch = await api("/api/batches/" + id);
      if (activeBatch?.id !== id) return;
      activeBatch = batch;
      if (view === "inventory") drawInventory();
      if (!["queued", "processing"].includes(batch.state)) await refreshBatches();
    } catch (error) { report(error); }
    schedulePoll();
  }, 1500);
}

function drawReceipt(batch) {
  const receipt = el("div", "", "receipt");
  const accepted = batch.files.filter((file) => file.state === "accepted").length;
  const skipped = batch.files.filter((file) => ["rejected", "duplicate", "skipped"].includes(file.state));
  const progress = el("progress");
  progress.max = batch.files.reduce((sum, f) => sum + f.size, 0);
  progress.value = batch.files.reduce((sum, f) => sum + f.offset, 0);
  progress.setAttribute("aria-label", "Photo bytes received");
  receipt.append(el("strong", accepted + " received · " + skipped.length + " skipped · " +
                    (batch.files.length - accepted - skipped.length) + " pending"), progress);
  if (!sending && batch.state === "receiving") {
    receipt.append(el("p", "Select the same photos again to resume from the saved receipts."));
    if (accepted) {
      const commit = el("button", "Process received photos");
      commit.addEventListener("click", async () => {
        try {
          await api("/api/batches/" + batch.id + "/commit", "POST", { allow_incomplete: true });
          await refreshBatches();
          await openBatch(batch.id);
        } catch (error) { report(error); }
      });
      receipt.append(commit);
    }
  }
  if (skipped.length) {
    const details = el("details");
    const list = el("ul");
    for (const file of skipped) list.append(el("li", file.name + " · " + (file.issue || "Exact duplicate")));
    details.append(el("summary", "File details"), list);
    receipt.append(details);
  }
  $("receipt").replaceChildren(receipt);
}

function getResume() {
  try { return JSON.parse(localStorage.getItem(resumeStorageKey())) || []; }
  catch { return []; }
}

async function startUpload(selection) {
  if (sending || !selection.length) return;
  const files = Array.from(selection);
  if (files.length > 100 || files.some((file) => file.size < 1 || file.size > 24 * 1024 ** 2)) {
    report("Choose up to 100 nonempty photos, each 24 MB or smaller.");
    return;
  }
  sending = true;
  $("choose").disabled = true;
  let current;
  try {
    report("Checking photo integrity before upload…");
    const hashed = [];
    for (const file of files) {
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
      const sha = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      hashed.push({ file, receipt: { name: file.name, size: file.size, sha } });
    }
    const previous = getResume();
    const original = JSON.stringify(hashed.map((row) => row.receipt));
    if (!previous.some((row) => row.signature === original)) {
      hashed.sort((a, b) => a.receipt.sha.localeCompare(b.receipt.sha) ||
        a.receipt.name.localeCompare(b.receipt.name));
    }
    const manifest = hashed.map((row) => row.receipt);
    const manifestKey = JSON.stringify(manifest);
    const known = previous.find((row) => row.signature === manifestKey);
    const key = known?.key || crypto.randomUUID();
    localStorage.setItem(resumeStorageKey(), JSON.stringify([{ signature: manifestKey, key }, ...previous.filter((r) => r.key !== key)].slice(0, 12)));
    current = await api("/api/batches", "POST", { key, files: manifest });
    drawReceipt(current);
    report("");
    if (current.state === "receiving") {
      for (const [index, { file }] of hashed.entries()) {
        const saved = current.files[index];
        while (saved.offset < saved.size && saved.state === "pending") {
          const chunk = file.slice(saved.offset, saved.offset + 1024 ** 2);
          const update = await api("/api/batches/" + current.id + "/files/" + saved.id, "PUT",
                                   chunk, { "Upload-Offset": String(saved.offset) });
          Object.assign(saved, update);
          drawReceipt(current);
        }
      }
    }
    await refreshBatches();
    await openBatch(current.id);
  } catch (error) {
    report("Upload stopped. Accepted chunks are saved. " + error.message);
  } finally {
    sending = false;
    $("choose").disabled = false;
    if (current && view === "upload") drawReceipt(current);
  }
}

function draftCard(draft, click, profile) {
  const card = el("button", "", "card");
  const content = el("div", "", "card-content");
  const status = draft.approval === draft.revision ? "Approved" : (draft.issues.length ? "Needs review" : "Ready");
  content.append(el("span", status, "chip " + (draft.issues.length ? "needs" : "good")),
                 el("h3", draft.title || "Untitled item"), el("div", formatMoney(draft.price_cents), "price"),
                 el("small", draft.issues[0] || (draft.condition + " · " + draft.gallery.length + " gallery photos")));
  card.append(picture(draft.cover, "", profile), content);
  card.addEventListener("click", click);
  return card;
}

function drawInventory() {
  const cards = $("cards");
  $("counts").replaceChildren();
  if (!activeBatch) return empty(cards, "Choose a batch to review your drafts.");
  const batch = activeBatch, drafts = batch.drafts.filter((item) => !item.merged);
  if (batch.state !== "review") {
    empty(cards, batch.issue || "Processing your photos. You can close this page after the upload receipt.");
    if (batch.state === "failed" && batch.files.some((file) => file.state === "accepted")) {
      const retry = el("button", "Retry processing");
      retry.addEventListener("click", async () => {
        try {
          await api("/api/batches/" + batch.id + "/retry", "POST", {});
          await openBatch(batch.id);
        } catch (error) { report(error); }
      });
      cards.append(retry);
    }
    return;
  }
  const ready = drafts.filter((item) => !item.issues.length).length;
  for (const label of [batch.files.length + " selected", drafts.length + " drafts",
                       ready + " ready", (drafts.length - ready) + " need review"]) $("counts").append(el("span", label));
  if (batch.evaluation?.includes("capture-time") || batch.evaluation === "manual grouping required") {
    $("counts").append(el("span", "Some groups use capture times and need a photo check"));
  }
  const filter = $("filter").value;
  const visible = drafts.filter((draft) => filter === "all" ||
    (filter === "needs" && draft.issues.length) || (filter === "ready" && !draft.issues.length && !draft.approval) ||
    (filter === "approved" && draft.approval === draft.revision));
  if (!visible.length) return empty(cards, "No drafts match this filter.");
  cards.replaceChildren(...visible.map((draft) => draftCard(draft, () => openEditor(draft))));
}

function openEditor(draft) {
  editorDraft = draft;
  cover = draft.cover;
  gallery = [...draft.gallery];
  const form = $("edit-form").elements;
  form.title.value = draft.title;
  form.price.value = draft.price_cents == null ? "" : (draft.price_cents / 100).toFixed(2);
  form.condition.value = draft.condition;
  form.condition_confirmed.checked = draft.condition_confirmed;
  form.group_confirmed.checked = !draft.uncertain;
  form.photo_reviewed.checked = draft.photo_reviewed;
  form.description.value = draft.description;
  $("edit-title").textContent = draft.title || "Untitled item";
  $("edit-notice").textContent = "";
  $("approve").disabled = Boolean(draft.issues.length || draft.approval === draft.revision);
  $("edit-issues").replaceChildren(...draft.issues.map((issue) => el("div", issue)));
  renderGallery();
  renderEvidence(draft);
  renderGroups(draft);
  if (!$("editor").open) $("editor").showModal();
}

function renderGallery() {
  const box = $("previews");
  const candidate = (id, alt) => {
    const frame = picture(id, alt);
    if (id && !editorDraft.gallery.includes(id)) frame.src = workbenchUrl("/api/private-photo/" + id);
    return frame;
  };
  const main = candidate(cover, "Listing cover");
  main.classList.add("preview");
  const thumbs = el("div", "", "thumbs");
  for (const [index, id] of gallery.entries()) {
    const button = el("button", "", id === cover ? "selected" : "");
    button.type = "button";
    button.setAttribute("aria-label", "Set photo " + (index + 1) + " as cover");
    button.append(candidate(id, ""));
    button.addEventListener("click", () => { cover = id; renderGallery(); });
    thumbs.append(button);
  }
  box.replaceChildren(main, thumbs);
}

function renderEvidence(draft) {
  const details = el("details");
  details.append(el("summary", "Private evidence"), el("p", draft.identity),
                 el("p", draft.price_override ? "Seller-set price" : draft.price.basis));
  if (draft.price.conditional_cents && !draft.price_override) {
    const use = el("button", "Use " + formatMoney(draft.price.conditional_cents) + " if " + draft.price.variant + " and New");
    use.type = "button";
    use.addEventListener("click", () => {
      const price = $("edit-form").elements.price;
      price.value = (draft.price.conditional_cents / 100).toFixed(2);
      price.focus();
    });
    details.append(use);
  }
  for (const observation of draft.price.sources) {
    const link = el("a", new URL(observation.url).hostname + " · " + formatMoney(observation.cents) + " · " + observation.date);
    link.href = observation.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const row = el("div");
    row.append(link);
    details.append(row);
  }
  $("source-evidence").replaceChildren(details);
}

function renderGroups(draft) {
  const details = el("details");
  details.append(el("summary", "Group photos · " + draft.photos.length));
  const other = activeBatch.drafts.filter((item) => item.id !== draft.id && !item.merged);
  for (const photo of draft.photos) {
    const row = el("div", "", "move-row");
    const dropdown = el("select");
    dropdown.setAttribute("aria-label", "Move photo destination");
    const newItem = el("option", "New draft");
    newItem.value = "";
    dropdown.append(newItem);
    for (const item of other) {
      const option = el("option", item.title || "Untitled item");
      option.value = item.id;
      dropdown.append(option);
    }
    const button = el("button", "Move");
    button.type = "button";
    button.addEventListener("click", async () => {
      if (!window.confirm("Move this photo? Unsaved draft edits will be discarded.")) return;
      try {
        const target = other.find((item) => item.id === dropdown.value);
        activeBatch = await api("/api/drafts/" + draft.id + "/transfer", "POST",
          { revision: draft.revision, photo: photo.id, destination: target?.id, destination_revision: target?.revision });
        $("editor").close();
        drawInventory();
      } catch (error) { $("edit-notice").textContent = error.message; }
    });
    const evidence = el("span");
    const link = el("a", photo.name);
    link.href = workbenchUrl("/api/private-photo/" + photo.id);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    evidence.append(link, document.createTextNode(" · " + (photo.excluded ? "Excluded from exports" : "Gallery")));
    row.append(evidence);
    if (!(photo.blocked ?? photo.excluded)) {
      const choice = el("label");
      choice.className = "gallery-choice";
      const toggle = el("input");
      toggle.type = "checkbox";
      toggle.checked = gallery.includes(photo.id);
      toggle.setAttribute("aria-label", "Use " + photo.name + " in gallery");
      toggle.addEventListener("change", () => {
        gallery = toggle.checked ? [...gallery, photo.id] : gallery.filter((id) => id !== photo.id);
        if (!gallery.includes(cover)) cover = gallery[0] ?? null;
        $("edit-form").elements.photo_reviewed.checked = false;
        renderGallery();
      });
      choice.append(toggle, " Gallery");
      row.append(choice);
    }
    row.append(dropdown, button);
    details.append(row);
  }
  $("groups").replaceChildren(details);
}

async function updateDraft(action) {
  const draft = editorDraft, form = $("edit-form").elements;
  try {
    let updated;
    if (action === "approve") {
      updated = await api("/api/drafts/" + draft.id + "/approve", "POST", { revision: draft.revision });
    } else {
      const body = { revision: draft.revision, title: form.title.value, description: form.description.value,
        condition: form.condition.value, condition_confirmed: form.condition_confirmed.checked,
        uncertain: !form.group_confirmed.checked, photo_reviewed: form.photo_reviewed.checked, cover, gallery };
      if (form.price.value && (form.condition.value === draft.condition ||
          Math.round(Number(form.price.value) * 100) !== draft.price_cents || draft.price_override)) {
        body.price_cents = Math.round(Number(form.price.value) * 100);
      }
      updated = await api("/api/drafts/" + draft.id, "PATCH", body);
    }
    activeBatch.drafts = activeBatch.drafts.map((item) => item.id === updated.id ? updated : item);
    openEditor(updated);
    $("edit-notice").textContent = action === "approve" ? "Approved. Find this draft in Channels." : "Changes saved.";
    drawInventory();
  } catch (error) { $("edit-notice").textContent = error.message; }
}

async function renderChannels() {
  const cards = $("eligible"), channel = $("channel").value;
  const destinations = { facebook: "https://www.facebook.com/marketplace/create/item/", mercari: "https://www.mercari.com/sell/" };
  $("open-channel").hidden = !destinations[channel];
  if (destinations[channel]) $("open-channel").href = destinations[channel];
  const batches = await Promise.all(batchRows.filter((batch) => batch.state === "review").map((batch) => api("/api/batches/" + batch.id)));
  if (view !== "channels" || $("channel").value !== channel) return;
  const eligible = batches.flatMap((batch) => batch.drafts).filter((d) => d.revision === d.approval);
  if (!eligible.length) return empty(cards, "Approve a ready draft to make it available for download.");
  cards.replaceChildren(...eligible.map((draft) => {
    const panel = el("article", "", "download-card");
    const card = draftCard(draft, async () => {
      try {
        const blob = await api("/api/drafts/" + draft.id + "/export", "POST", { revision: draft.revision, channel });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "crazy-moe-" + channel + ".zip";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      } catch (error) { report(error); }
    }, channel === "storefront" ? "storefront" : "clean");
    card.querySelector("small").textContent = "Download photo and copy package";
    const copy = el("button", "Copy buyer text");
    copy.addEventListener("click", async () => {
      try {
        const result = await api("/api/drafts/" + draft.id + "/copy", "POST", { revision: draft.revision, channel });
        await navigator.clipboard.writeText(result.text);
        copy.textContent = "Copied";
      } catch (error) { report(error); }
    });
    panel.append(card, copy);
    return panel;
  }));
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { report(""); go(button.dataset.view); }));
$("photos").addEventListener("change", (event) => { startUpload(event.target.files); event.target.value = ""; });
$("choose").addEventListener("click", () => $("photos").click());
$("drop").addEventListener("dragover", (event) => { event.preventDefault(); $("drop").classList.add("is-drag"); });
$("drop").addEventListener("dragleave", () => $("drop").classList.remove("is-drag"));
$("drop").addEventListener("drop", (event) => { event.preventDefault(); $("drop").classList.remove("is-drag"); startUpload(event.dataTransfer.files); });
$("batch-select").addEventListener("change", (event) => openBatch(event.target.value).catch(report));
$("filter").addEventListener("change", drawInventory);
$("channel").addEventListener("change", () => renderChannels().catch(report));
$("edit-form").addEventListener("submit", (event) => { event.preventDefault(); updateDraft("save"); });
$("approve").addEventListener("click", () => updateDraft("approve"));
$("close").addEventListener("click", () => $("editor").close());

connectWorkbench(() => refreshBatches().then(async () => {
  const recent = batchRows[0];
  if (!recent) return;
  activeBatch = await api("/api/batches/" + recent.id);
  if (recent.state === "receiving") {
    drawReceipt(activeBatch);
  }
  renderBatches();
  schedulePoll();
}).catch(report));
