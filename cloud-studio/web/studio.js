"use strict";
const backend = "https://sfheqjnxlkygjfohoybo.supabase.co";
const publicKey = "sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af";
const get = id => document.getElementById(id);
const form = get("edit-form");
const fields = ["title", "price", "condition", "model", "description", "source_url", "notes"];
let session, current, saving = false, items = [], view = "all", photoRequest = 0;
const statusLabel = {review:"Review", approved:"Approved", listed:"Listed", archived:"Archived"};

async function request(url, options = {}) {
  const response = await fetch(backend + url, {
    ...options, cache:"no-store",
    headers:{apikey:publicKey, "Content-Type":"application/json",
      ...(session ? {Authorization:"Bearer " + session.access_token} : {})}
  });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 409 || body.code === "40001")
      throw Error("This product changed. Copy your edits, close the editor, and refresh before saving.");
    if (response.status === 401 && session) throw Error("Your session expired. Copy your edits before signing in again.");
    throw Error(body.error_description || body.message || body.error || "Request failed");
  }
  return body;
}
const rpc = (name, args = {}) => request("/rest/v1/rpc/" + name, {method:"POST", body:JSON.stringify(args)});
const title = item => item.fields.title || item.generated_candidate?.title || item.id;
const matchesView = (item, key) => key === "all" || item.status === (key === "ready" ? "approved" : key);
function filtered() {
  const query = get("search").value.trim().toLowerCase();
  return items.filter(item => matchesView(item, view) && [title(item),item.fields.model,item.id].join(" ").toLowerCase().includes(query));
}
function render() {
  const visible = filtered();
  get("cards").replaceChildren(...visible.map(item => {
    const card = document.createElement("button");
    card.className = "inventory-card";
    const name = document.createElement("strong"), summary = document.createElement("small");
    name.textContent = title(item);
    summary.textContent = [statusLabel[item.status], item.fields.price && "$" + item.fields.price, item.id].filter(Boolean).join(" · ");
    card.append(name,summary);
    card.onclick = () => openItem(item);
    return card;
  }));
  get("results").textContent = visible.length + " products";
  document.querySelectorAll("[data-view]").forEach(button => {
    const key = button.dataset.view;
    button.classList.toggle("active", key === view);
    get("count-" + key).textContent = items.filter(item => matchesView(item,key)).length;
  });
}
async function refresh() { items = await rpc("studio_state"); render(); }
function notice(message) { get("message").hidden = !message; get("message").textContent = message; }
get("signin").onsubmit = async event => {
  event.preventDefault();
  const login = event.currentTarget;
  login.querySelector("button").disabled = true;
  try {
    session = await request("/auth/v1/token?grant_type=password", {method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(login)))});
    login.elements.password.value = "";
    await refresh();
    get("login").hidden = true;
    document.querySelector("aside").hidden = document.querySelector("main").hidden = false;
  } catch(error) { session = null; get("login-status").textContent = error.message; }
  finally { login.querySelector("button").disabled = false; }
};
get("logout").onclick = async () => { try {await request("/auth/v1/logout?scope=local",{method:"POST"});} finally {location.reload();} };
get("refresh").onclick = () => refresh().then(() => notice("Inventory refreshed.")).catch(error => notice(error.message));
get("search").oninput = render;
document.querySelectorAll("[data-view]").forEach(button => button.onclick = () => {
  view = button.dataset.view;
  get("view-title").textContent = button.firstChild.textContent.trim();
  render();
});
async function preview(photo) {
  const sequence = ++photoRequest;
  get("hero").removeAttribute("src");
  get("photo-status").textContent = "Loading photo…";
  try {
    const result = await request("/functions/v1/studio-api/photo/" + encodeURIComponent(photo.sha));
    if (sequence === photoRequest) { get("hero").src = result.url; get("photo-status").textContent = ""; }
  } catch(error) { if (sequence === photoRequest) get("photo-status").textContent = error.message; }
}
function openItem(item) {
  current = item;
  get("edit-title").textContent = title(item);
  get("editor-status").textContent = "";
  for (const key of fields) {
    const input = form.elements[key], value = String(item.fields[key] ?? "");
    if (key === "condition" && value && !Array.from(input.options).some(option => option.value === value)) input.add(new Option(value,value));
    input.value = key === "condition" && !Object.hasOwn(item.fields,key) ? "New" : value;
    input.dataset.initial = input.value;
  }
  get("diagnostics").textContent = statusLabel[item.status] + " · Revision " + item.revision;
  const photos = item.photo_selection.filter(photo => photo.kind === "real" && photo.sha);
  ++photoRequest;
  get("hero").removeAttribute("src");
  get("photo-status").textContent = photos.length ? "" : "No selected original photos.";
  get("thumbs").replaceChildren(...photos.map((photo,index) => {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = "Photo " + (index + 1); button.onclick = () => preview(photo);
    return button;
  }));
  if (photos.length) preview(photos[0]);
  if (!get("editor").open) get("editor").showModal();
}
function patch() {
  return Object.fromEntries(fields.filter(key => form.elements[key].value !== form.elements[key].dataset.initial)
    .map(key => [key,form.elements[key].value]));
}
function canLeave() { return !saving && (!Object.keys(patch()).length || confirm("Discard your unsaved changes?")); }
function next(id) {
  const list = filtered(), index = list.findIndex(item => item.id === id);
  if (index >= 0 && list[index + 1]) openItem(list[index + 1]); else get("editor").close();
}
async function save(advance) {
  if (saving) return;
  const item = current, changes = patch();
  saving = true;
  const controls = Array.from(form.elements), disabled = controls.map(input => input.disabled);
  controls.forEach(input => {input.disabled=true;});
  try {
    if (Object.keys(changes).length) {
      const updated = await rpc("studio_seller_patch",{p_id:item.id,p_expected_revision:item.revision,p_patch:changes});
      Object.assign(item,{fields:updated.fields,revision:updated.revision,status:updated.status || (item.status==="approved"?"review":item.status)});
    }
    render(); if (advance) next(item.id); else {openItem(item); get("editor-status").textContent = "Saved.";}
  } catch(error) {get("editor-status").textContent = error.message;}
  finally { controls.forEach((input,index) => {input.disabled=disabled[index];}); saving = false; }
}
form.onsubmit = event => {event.preventDefault(); save(false);};
get("save-next").onclick = () => save(true);
get("skip").onclick = () => {if(canLeave()) next(current.id);};
get("close").onclick = () => {if(canLeave()) get("editor").close();};
get("editor").oncancel = event => {if(!canLeave()) event.preventDefault();};
let uploadBatch;
get("files").onchange = () => {uploadBatch = crypto.randomUUID();};
if (location.pathname.startsWith("/app")) get("upload").open = true;
get("upload-form").onsubmit = async event => {
  event.preventDefault();
  const picker = get("files"), button = event.currentTarget.querySelector("button");
  const photos = Array.from(picker.files), message = get("upload-status");
  if (!photos.length || photos.length > 12 || photos.some(file => file.size > 16*1024*1024)) {
    message.textContent = "Choose up to 12 photos, each 16 MB or smaller."; return;
  }
  button.disabled = picker.disabled = true;
  uploadBatch ||= crypto.randomUUID();
  try {
    const manifest = [];
    for (const file of photos) {
      message.textContent = "Uploading photo " + (manifest.length+1) + " of " + photos.length + "…";
      const digest = await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
      const sha = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,"0")).join("");
      const path = "/storage/v1/object/studio-originals/incoming/" + session.user.id + "/" + uploadBatch + "/" + sha;
      const response = await fetch(backend+path,{method:"POST",headers:{apikey:publicKey,Authorization:"Bearer "+session.access_token,"Content-Type":file.type,"x-upsert":"false"},body:file});
      if (!response.ok) {
        const error = await response.json();
        if (error.error !== "Duplicate" && error.error !== "ResourceAlreadyExists" && error.code !== "Duplicate" && String(error.statusCode)!=="409")
          throw Error(error.message || "Upload failed");
      }
      manifest.push({sha,bytes:file.size,name:file.name});
    }
    message.textContent = "Verifying originals…";
    const completed = await request("/functions/v1/studio-api/intake",{method:"POST",body:JSON.stringify({batch:uploadBatch,files:manifest})});
    message.textContent = "Added product " + completed.id;
    picker.value = ""; uploadBatch = null;
    await refresh();
    const item = items.find(product => product.id===completed.id);
    if (item) openItem(item);
  } catch(error) { message.textContent = error.message; }
  finally { button.disabled = picker.disabled = false; }
};
