"use strict";
const backend = "https://sfheqjnxlkygjfohoybo.supabase.co";
const publicKey = "sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af";
const get = id => document.getElementById(id);
const form = get("edit-form");
const fields = ["title", "price", "condition", "model", "description", "source_url", "notes"];
const auth = studioAuth.auth;
let session, current, saving = false, items = [], view = "all", photoRequest = 0;
let thumbnailGeneration = 0;
const statusLabel = {review:"Review", approved:"Approved", listed:"Listed", archived:"Archived"};

async function request(url, options = {}) {
  const { data, error } = await auth.getSession();
  if (error) throw error;
  session = data.session;
  if (!session) throw Error("Please sign in to continue.");
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
async function connectStudioExtension(){
  const {data}=await auth.getSession(), active=data.session;
  if(!active?.access_token||!active?.refresh_token||!active?.expires_at||!globalThis.chrome?.runtime?.sendMessage)return;
  const message={type:"STUDIO_AUTH_SESSION",session:{access_token:active.access_token,
    refresh_token:active.refresh_token,expires_at:active.expires_at}};
  for(const id of ["jhkkefonggnemmdpaahpnkgcgfjibeal","kbdeepgfbofgljhijkdejmodfhfeeplh"])
    await chrome.runtime.sendMessage(id,message).catch(()=>null);
}
// Missing migrated fields may use prepared suggestions; explicit seller values,
// including empty strings, always win. Suggestions are persisted before review.
function editorValue(item, key) {
  if (Object.hasOwn(item.fields, key)) return String(item.fields[key] ?? "");
  if (key === "condition") return "New";
  if (["title", "model", "price", "description", "source_url"].includes(key))
    return String(item.generated_candidate?.[key] ?? "");
  return "";
}
const title = item => editorValue(item, "title") || item.id;
const matchesView = (item, key) => key === "all" || item.status === (key === "ready" ? "approved" : key);
function filtered() {
  const query = get("search").value.trim().toLowerCase();
  return items.filter(item => matchesView(item, view) && [title(item),editorValue(item,"model"),item.id].join(" ").toLowerCase().includes(query));
}
// Cards show a seller-selected warehouse cover where possible, but never private
// label/barcode reference images. URLs are short-lived and fetched only when visible.
const coverCache = new Map();
const coverJobs = [];
let coverActive = 0;
const coverObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    coverObserver.unobserve(entry.target);
    entry.target._loadCover?.();
  }
}, {rootMargin:"220px"}) : null;
function drainCoverQueue() {
  while (coverActive < 4 && coverJobs.length) {
    const job = coverJobs.shift();
    if (!job.card.isConnected) continue;
    coverActive++;
    job.load().finally(() => {coverActive--; drainCoverQueue();});
  }
}
function productCover(item, card) {
  const frame = document.createElement("div");
  frame.className = "product-cover";
  const label = document.createElement("span");
  label.className = "product-cover-placeholder";
  label.textContent = "Loading photo…";
  frame.append(label);
  const selection = Array.isArray(item.photo_selection) ? item.photo_selection : [];
  const photo = selection.find(p => p.kind === "real" && p.sha)
    || selection.find(p => p.kind === "manufacturer" && p.id);
  if (!photo) {
    label.textContent = "Product photo needed";
    return frame;
  }
  const key = photo.kind === "real" ? "photo/" + encodeURIComponent(photo.sha)
    : "reference/" + encodeURIComponent(item.id) + "/" + encodeURIComponent(photo.id);
  const image = document.createElement("img");
  image.alt = "Product photo for " + title(item);
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  const load = async () => {
    try {
      const cached = coverCache.get(key);
      const url = cached && Date.now() - cached.time < 180000 ? cached.url
        : (await request("/functions/v1/studio-api/" + key)).url;
      if (!cached || url !== cached.url) coverCache.set(key,{url,time:Date.now()});
      if (!card.isConnected) return;
      image.onload = () => {label.remove();};
      image.onerror = () => {image.remove();label.textContent = "Photo unavailable";coverCache.delete(key);};
      frame.append(image);
      image.src = url;
    } catch(error) {
      if (card.isConnected) label.textContent = "Photo unavailable";
    }
  };
  card._loadCover = () => {coverJobs.push({card,load});drainCoverQueue();};
  if (coverObserver) coverObserver.observe(card); else card._loadCover();
  return frame;
}
function render() {
  const visible = filtered();
  get("cards").replaceChildren(...visible.map(item => {
    const card = document.createElement("button");
    card.className = "inventory-card";
    const name = document.createElement("strong"), summary = document.createElement("small");
    name.textContent = title(item);
    summary.textContent = [statusLabel[item.status], item.fields.price && "$" + item.fields.price, item.id].filter(Boolean).join(" · ");
    const body = document.createElement("div");
    body.className = "product-card-body";
    body.append(name,summary);
    const cover = productCover(item,card);
    card.append(cover,body);
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
async function refresh() { items = (await rpc("studio_state")).filter(item => item.lifecycle !== "archived"); render(); }
function notice(message) { get("message").hidden = !message; get("message").textContent = message; }
async function openWorkspace(authSession) {
  session = authSession;
  await refresh();
  await connectStudioExtension();
  get("login").hidden = true;
  document.querySelector("aside").hidden = document.querySelector("main").hidden = false;
}
get("email-signin").onsubmit = async event => {
  event.preventDefault();
  const login = event.currentTarget;
  const button = login.querySelector("button");
  button.disabled = true;
  get("login-status").textContent = "Sending your sign-in link…";
  try {
    const {error} = await auth.signInWithOtp({
      email:login.elements.email.value.trim(),
      options:{shouldCreateUser:false, emailRedirectTo:location.origin + "/app/"}
    });
    if (error) throw error;
    get("login-status").textContent = "Check your email and click the newest sign-in link to open Studio.";
  } catch(error) {
    get("login-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
get("signin").onsubmit = async event => {
  event.preventDefault();
  const login = event.currentTarget;
  const button = login.querySelector("button");
  button.disabled = true;
  try {
    const {data, error} = await auth.signInWithPassword(Object.fromEntries(new FormData(login)));
    login.elements.password.value = "";
    if (error) throw error;
    await openWorkspace(data.session);
  } catch(error) { get("login-status").textContent = error.message; }
  finally { button.disabled = false; }
};
get("logout").onclick = async () => {
  if (get("editor").open && !canLeave()) return;
  const {error} = await auth.signOut({scope:"local"});
  if (error) {notice(error.message); return;}
  location.replace("/app/");
};
auth.onAuthStateChange((event, authSession) => {
  session = authSession;
  if (event === "SIGNED_OUT") {
    document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close());
    document.querySelector("aside").hidden = document.querySelector("main").hidden = true;
    get("login").hidden = false;
    get("login-status").textContent = "Sign in to continue.";
  }
  if (event === "SIGNED_IN" && get("login").hidden === false) {
    // Leave the auth callback before reading a session, since the SDK holds its lock here.
    setTimeout(() => openWorkspace(authSession).catch(error => {
      get("login-status").textContent = error.message;
    }), 0);
  }
});
async function restoreSignIn() {
  try {
    const initialization = await auth.initialize();
    if (initialization.error) throw initialization.error;
    const {data, error} = await auth.getSession();
    if (error) throw error;
    if (data.session) await openWorkspace(data.session);
    else get("login-status").textContent = "";
  } catch(error) {
    get("login-status").textContent = "Unable to open Studio. " + error.message;
  } finally {
    // Authentication links can carry a session or an expiry error in the fragment.
    // Remove it from browser history after the SDK finishes processing it.
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    get("email-signin").querySelector("button").disabled = false;
    get("signin").querySelector("button").disabled = false;
  }
}
restoreSignIn();
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
    const result = await request("/functions/v1/studio-api/" + (photo.kind === "real" ? "photo/"+encodeURIComponent(photo.sha) : "reference/"+encodeURIComponent(current.id)+"/"+encodeURIComponent(photo.id)));
    if (sequence === photoRequest) { get("hero").src = result.url; get("photo-status").textContent = ""; }
  } catch(error) { if (sequence === photoRequest) get("photo-status").textContent = error.message; }
}
let inlinePhotoLoader = () => {};
let inlinePhotoPendingChanges = () => false;
let stopRenderStatus = () => {};
function renderCatalogEvidence(item) {
  const list = get("catalog-evidence-list");
  list.replaceChildren(...(item.catalog_evidence || []).map(record => {
    const row=document.createElement("div"),heading=document.createElement("strong"),link=document.createElement("a"),meta=document.createElement("small");
    row.className="catalog-record";heading.textContent=(record.source_kind === "manufacturer" ? "Manufacturer" : "Retailer")+": "+record.product_name;
    link.href=record.url;link.target="_blank";link.rel="noopener noreferrer";link.textContent=record.url;
    meta.textContent=[record.brand,record.model,"listing revision "+record.based_on_listing_revision].filter(Boolean).join(" · ");
    row.append(heading,link,meta);return row;
  }));
  if (!(item.catalog_evidence || []).length) {
    const empty=document.createElement("p");empty.className="muted";empty.textContent="No reviewed web evidence recorded yet.";list.append(empty);
  }
  const candidate=item.research?.catalog_match || {};
  get("catalog-kind").value="manufacturer";
  get("catalog-url").value="";
  get("catalog-name").value=String(candidate.product_name || candidate.title || title(item));
  get("catalog-brand").value=String(candidate.brand || "");
  get("catalog-model").value=String(candidate.model || item.fields.model || "");
  get("catalog-note").value="";
  get("catalog-evidence-status").textContent=item.identity_revision == null ? "Identification must exist before evidence can be recorded." : "";
  get("record-catalog-evidence").disabled=item.identity_revision == null;
}
function openItem(item) {
  stopRenderStatus();
  current = item;
  get("transfer-export").hidden = item.status !== "approved";
  get("edit-title").textContent = title(item);
  get("editor-status").textContent = "";
  for (const key of fields) {
    const input = form.elements[key], value = editorValue(item,key);
    if (key === "condition" && value && !Array.from(input.options).some(option => option.value === value)) input.add(new Option(value,value));
    input.value = value;
    // Displayed defaults are not unsaved seller keystrokes. Keep the saved
    // value separately so Save can persist them without blocking photo edits.
    input.dataset.initial = value;
    input.dataset.saved = String(item.fields[key] ?? "");
  }
  get("diagnostics").textContent = statusLabel[item.status] + " · Revision " + item.revision;
  renderCatalogEvidence(item);
  const evidence = item.visual_proposal;
  if (evidence) {
    const panel = document.createElement("details"), caption = document.createElement("summary");
    caption.textContent = "Identification suggestions · " + evidence.confidence;
    panel.append(caption);
    for (const observation of evidence.observations || []) {
      const line = document.createElement("p"); line.textContent = observation; panel.append(line);
    }
    if (item.proposal_revision === item.revision) {
      for (const field of ["title","model"]) {
        if (!evidence.suggestion?.[field]) continue;
        const use = document.createElement("button"); use.type = "button"; use.className = "secondary";
        use.textContent = "Use " + field + ": " + evidence.suggestion[field];
        use.onclick = () => {form.elements[field].value = evidence.suggestion[field];};
        panel.append(use);
      }
    }
    get("diagnostics").append(panel);
  }
  const photos = item.photo_selection.filter(photo => (photo.kind === "real" && photo.sha) || (photo.kind === "manufacturer" && photo.id));
  ++photoRequest;
  get("hero").removeAttribute("src");
  get("photo-status").textContent = photos.length ? "" : "No selected original photos.";
  const thumbnailTurn = ++thumbnailGeneration;
  get("thumbs").replaceChildren(...photos.map((photo,index) => {
    const button = document.createElement("button");
    const label = (photo.kind === "manufacturer" ? "Reference " : "Photo ") + (index + 1);
    const img = document.createElement("img"), caption = document.createElement("small");
    button.type = "button";
    button.setAttribute("aria-label", "Preview " + label);
    button.style.cssText = "display:inline-flex;flex-direction:column;align-items:center;gap:5px;padding:6px;min-width:100px;min-height:105px;border:2px solid transparent;border-radius:10px;cursor:pointer";
    img.alt = "";
    img.loading = "lazy";
    img.style.cssText = "width:96px;height:76px;object-fit:contain;background:#eef0f2;border-radius:6px";
    caption.textContent = label;
    caption.style.cssText = "font-size:12px;line-height:1.3";
    button.append(img, caption);
    button.onclick = () => {
      get("thumbs").querySelectorAll("button").forEach(b => {
        b.style.borderColor = "transparent"; b.setAttribute("aria-pressed", "false");
      });
      button.style.borderColor = "#1b75bc";
      button.setAttribute("aria-pressed", "true");
      preview(photo);
    };
    if (index === 0) { button.style.borderColor = "#1b75bc"; button.setAttribute("aria-pressed", "true"); }
    else button.setAttribute("aria-pressed", "false");
    (async () => {
      try {
        const route = photo.kind === "real"
          ? "photo/" + encodeURIComponent(photo.sha)
          : "reference/" + encodeURIComponent(item.id) + "/" + encodeURIComponent(photo.id);
        const result = await request("/functions/v1/studio-api/" + route);
        if (thumbnailTurn === thumbnailGeneration && current === item) img.src = result.url;
      } catch (error) {
        if (thumbnailTurn === thumbnailGeneration && current === item) img.title = "Thumbnail unavailable: " + error.message;
      }
    })();
    return button;
  }));
  if (photos.length) preview(photos[0]);
  if (!get("editor").open) get("editor").showModal();
  inlinePhotoLoader(item);
  monitorRender(item);
}
get("record-catalog-evidence").onclick=async()=>{
  const item=current,status=get("catalog-evidence-status"),button=get("record-catalog-evidence");
  if(Object.keys(patch()).length){status.textContent="Save your listing edits before recording evidence.";return;}
  const inputs=["catalog-url","catalog-name","catalog-brand","catalog-model"];
  if(inputs.some(id=>!get(id).value.trim())){status.textContent="Enter the URL, product name, brand and model.";return;}
  button.disabled=true;status.textContent="Recording evidence…";
  try{
    await rpc("studio_add_catalog_evidence",{p_item:item.id,p_listing_revision:item.revision,p_identity_revision:item.identity_revision,
      p_source_kind:get("catalog-kind").value,p_url:get("catalog-url").value.trim(),p_product_name:get("catalog-name").value.trim(),
      p_brand:get("catalog-brand").value.trim(),p_model:get("catalog-model").value.trim(),p_evidence:{seller_note:get("catalog-note").value.trim()}});
    await refresh();const updated=items.find(product=>product.id===item.id);if(!updated)throw Error("Recorded, but product is no longer available.");
    openItem(updated);get("catalog-evidence-status").textContent="Evidence recorded without changing the listing.";
  }catch(error){if(current===item)status.textContent=error.message;}
  finally{if(current===item)button.disabled=false;}
};
function monitorRender(item) {
  stopRenderStatus();
  get("retry-render").hidden = true;
  get("review-export").disabled = true;
  get("render-status").textContent = "Checking listing photos…";
  stopRenderStatus = studioRenderStatus.watch({
    read:()=>rpc("studio_render_status",{p_item:item.id}), revision:item.revision,
    active:()=>get("editor").open && current===item,
    show:(message,ready,value)=>{
      get("render-status").textContent=message;get("review-export").disabled=!ready;
      const button=get("retry-render");button.hidden=!value?.retry_job;button.disabled=false;
      button.onclick=async()=>{
        if(Object.keys(patch()).length){get("editor-status").textContent="Save your changes before retrying photo preparation.";return;}
        button.disabled=true;
        try{
          await rpc("studio_retry_render",{p_item:item.id,p_revision:value.revision,p_photo_revision:value.photo_revision,p_failed_job:value.retry_job});
          if(current===item && get("editor").open)monitorRender(item);
        }catch(error){if(current===item){get("editor-status").textContent=error.message;button.disabled=false;}}
      };
    }
  });
}
function patch(includePrefills = false) {
  return Object.fromEntries(fields.filter(key =>
    form.elements[key].value !== form.elements[key].dataset[includePrefills ? "saved" : "initial"])
    .map(key => [key,form.elements[key].value]));
}
function canLeave() { return !saving && (!Object.keys(patch()).length || confirm("Discard your unsaved changes?")); }
function next(id) {
  const list = filtered(), index = list.findIndex(item => item.id === id);
  if (index >= 0 && list[index + 1]) openItem(list[index + 1]); else get("editor").close();
}
async function save(advance, propagate = false) {
  if (saving) return false;
  const item = current, changes = patch(true);
  saving = true;
  const controls = Array.from(form.elements), disabled = controls.map(input => input.disabled);
  controls.forEach(input => {input.disabled=true;});
  try {
    if (Object.keys(changes).length) {
      const updated = await rpc("studio_seller_patch",{p_id:item.id,p_expected_revision:item.revision,p_patch:changes});
      Object.assign(item,{fields:updated.fields,revision:updated.revision,status:updated.status || (item.status==="approved"?"review":item.status)});
    }
    render(); if (advance) next(item.id); else {openItem(item); get("editor-status").textContent = "Saved.";}
    return true;
  } catch(error) {
    get("editor-status").textContent = error.message;
    if (propagate) throw error;
    return false;
  }
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
      const {data:authData,error:authError}=await auth.getSession();
      if(authError)throw authError;
      session=authData.session;
      if(!session)throw Error("Please sign in to upload photos.");
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
// Single-click approval: verify exactly the saved draft and every selected JPEG,
// then submit the existing revision-checked approval RPC. Never show a second dialog.
let approvalBusy = false;
get("review-export").onclick = async () => {
  if (approvalBusy) return;
  const item = current;
  const button = get("review-export"), message = get("editor-status");
  if (inlinePhotoPendingChanges()) {
    message.textContent = "Save or discard your photo changes before approving."; return;
  }
  approvalBusy = true;
  button.disabled = true;
  button.textContent = "Verifying listing…";
  try {
    if (Object.keys(patch(true)).length) await save(false, true);
    if (current.id !== item.id) throw Error("Product changed; reopen it before approving.");
    // Server checks seller membership, identity, warehouse cover, and stale revisions.
    const response = await request("/functions/v1/studio-api/export-preview", {
      method: "POST", body: JSON.stringify({id:item.id,revision:current.revision})
    });
    const snapshot = response.snapshot;
    if (!snapshot || snapshot.id !== item.id || snapshot.revision !== current.revision ||
        !Array.isArray(snapshot.images) || !snapshot.images.length ||
        snapshot.images.length > 10 || response.urls?.length !== snapshot.images.length) {
      throw Error("The saved listing or photo set is incomplete.");
    }
    for (const [position,file] of snapshot.images.entries()) {
      button.textContent = "Checking photo " + (position + 1) + "/" + snapshot.images.length + "…";
      const fetched = await fetch(response.urls[position],{cache:"no-store"});
      if (!fetched.ok) throw Error("Listing photo " + (position + 1) + " is unavailable.");
      const bytes = await fetched.arrayBuffer();
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),
        value=>value.toString(16).padStart(2,"0")).join("");
      if (bytes.byteLength !== file.bytes || sha !== file.sha) {
        throw Error("Listing photo " + (position + 1) + " failed integrity verification.");
      }
    }
    button.textContent = "Approving…";
    await rpc("studio_approve_export",{
      p_item:snapshot.id,p_revision:snapshot.revision,p_snapshot:snapshot
    });
    await refresh();
    const updated = items.find(product=>product.id===item.id);
    if (updated) openItem(updated);
    message.textContent = "Approved — ready for Facebook handoff.";
  } catch(error) {
    get("editor-status").textContent = error.message || "Unable to approve listing.";
  } finally {
    approvalBusy = false;
    button.disabled = false;
    button.textContent = "Approve listing";
  }
};
get("transfer-export").onclick=async ()=>{
  try {
    if(Object.keys(patch()).length)throw Error("Save changes and approve the updated draft first.");
    if(!globalThis.chrome?.runtime?.sendMessage)throw Error("Open Studio in Chrome with the Commerce OS extension enabled.");
    let extensionId="kbdeepgfbofgljhijkdejmodfhfeeplh";
    const galleryId="jhkkefonggnemmdpaahpnkgcgfjibeal";
    const gallery=await chrome.runtime.sendMessage(galleryId,{type:"STUDIO_CHECK_HANDOFF"}).catch(()=>null);
    if(gallery?.ready)extensionId=galleryId;
    const token=await rpc("studio_issue_handoff",{p_item:current.id,p_revision:current.revision});
    const {data}=await auth.getSession(), active=data.session;
    const extensionSession=active?{access_token:active.access_token,refresh_token:active.refresh_token,expires_at:active.expires_at}:null;
    const answer=await chrome.runtime.sendMessage(extensionId,{type:"STUDIO_APPROVED_DRAFT",token,session:extensionSession});
    if(!answer?.ok)throw Error("Commerce OS could not open the draft.");
    get("editor-status").textContent="In the Facebook tab, choose Load next approved product.";
  }catch(error){get("editor-status").textContent=error.message;}
};


{
  const list=get("photo-list"), referencesBox=get("reference-gallery");
  const status=get("selection-status"),saveButton=get("save-photos");
  const previousButton=get("previous-photos"),count=get("photo-count");
  let data=null,order=[],refs=[],product=null,turn=0,savingPhotos=false,dragged=null;
  const urls=new Map();
  const photoPath=(source,id)=>source.kind==="manufacturer"
    ?"reference/"+encodeURIComponent(id)+"/"+encodeURIComponent(source.id)
    :"photo/"+encodeURIComponent(source.sha);
  function draw() {
    list.replaceChildren();referencesBox.replaceChildren();
    if(!data)return;
    const chosen=order.map(id=>data.choices.find(c=>c.id===id)).filter(Boolean);
    const rest=data.choices.filter(c=>!order.includes(c.id));
    count.textContent=chosen.length+" selected · "+data.choices.length+" prepared";
    const move=(id,offset)=>{
      const from=order.indexOf(id),to=from+offset;
      if(from<0||to<0||to>=order.length)return;
      const candidate=[...order];candidate.splice(from,1);candidate.splice(to,0,id);
      const firstFactory=candidate.findIndex(key=>data.choices.find(c=>c.id===key)?.source.kind==="manufacturer");
      if(firstFactory>=0&&candidate.slice(firstFactory+1).some(key=>
        data.choices.find(c=>c.id===key)?.source.kind==="real")) {
        status.textContent="Warehouse photos must stay before factory references.";return;
      }
      order=candidate;draw();
    };
    function action(parent,label,disabled,fn) {
      const b=document.createElement("button");b.type="button";b.className="secondary photo-action";
      b.textContent=label;b.disabled=disabled||savingPhotos;b.onclick=()=>{fn();draw();};
      parent.append(b);
    }
    for(const choice of [...chosen,...rest]) {
      const idx=order.indexOf(choice.id),on=idx>=0;
      const tile=document.createElement("li");
      tile.className="photo-tile"+(on?" selected":"")+(idx===0?" cover":"");
      const imageButton=document.createElement("button");imageButton.type="button";
      imageButton.className="photo-preview";imageButton.title="Preview larger photo";
      const img=document.createElement("img");img.alt="Product thumbnail";img.loading="lazy";
      if(urls.get(choice.id))img.src=urls.get(choice.id);
      imageButton.append(img);imageButton.onclick=()=>preview(choice.source);
      const name=document.createElement("span");
      name.className="photo-label";
      name.textContent=(choice.source.kind==="manufacturer"?"Factory reference":"Warehouse photo")+
        (idx===0?" · COVER":on?" · Selected":" · Available");
      const controls=document.createElement("div");controls.className="photo-tile-controls";
      tile.append(imageButton,name,controls);
      if(!on) action(controls,"Add",order.length>=10,()=>{
        if(choice.source.kind==="real"){
          const firstFactory=order.findIndex(id=>data.choices.find(c=>c.id===id)?.source.kind==="manufacturer");
          if(firstFactory>=0)order.splice(firstFactory,0,choice.id);else order.push(choice.id);
        }else order.push(choice.id);
      });
      else {
        if(choice.source.kind==="real"&&idx>0)
          action(controls,"Make cover",false,()=>{order.splice(idx,1);order.unshift(choice.id);});
        action(controls,"←",idx===0,()=>move(choice.id,-1));
        action(controls,"→",idx===order.length-1,()=>move(choice.id,1));
        action(controls,"Remove",false,()=>order.splice(idx,1));
      }
      tile.draggable=on&&!savingPhotos;
      tile.ondragstart=ev=>{dragged=choice.id;ev.dataTransfer.effectAllowed="move";};
      tile.ondragover=ev=>{if(dragged&&on)ev.preventDefault();};
      tile.ondrop=ev=>{
        ev.preventDefault();
        if(!dragged||!on||dragged===choice.id)return;
        const old=order.indexOf(dragged),dest=order.indexOf(choice.id);
        if(old>=0&&dest>=0)move(dragged,dest-old);
        dragged=null;
      };
      tile.ondragend=()=>{dragged=null;};
      list.append(tile);
    }
    const already=new Set(data.choices.filter(c=>c.source.kind==="manufacturer").map(c=>c.source.id));
    const hidden=refs.filter(r=>!already.has(r.id));
    if(hidden.length) {
      const heading=document.createElement("h4");
      heading.textContent="Saved manufacturer / retailer photos";
      const explanation=document.createElement("p");explanation.className="muted";
      explanation.textContent="Preview available. These references are not yet prepared as verified Facebook export photos; they are not automatically added to the listing.";
      const grid=document.createElement("div");grid.className="factory-reference-grid";
      for(const ref of hidden) {
        const tile=document.createElement("div");tile.className="photo-tile reference-only";
        const btn=document.createElement("button");btn.type="button";btn.className="photo-preview";
        btn.title="Preview factory/reference photograph";
        const img=document.createElement("img");img.alt="Factory reference thumbnail";img.loading="lazy";
        const key="reference/"+encodeURIComponent(product.id)+"/"+encodeURIComponent(ref.id);
        if(urls.get(key))img.src=urls.get(key);
        btn.append(img);btn.onclick=()=>preview({kind:"manufacturer",id:ref.id});
        const label=document.createElement("small");
        label.textContent=ref.label||"Factory/reference photo · preview only";
        tile.append(btn,label);grid.append(tile);
      }
      referencesBox.append(heading,explanation,grid);
    }
    const isReal=chosen.length&&chosen[0].source.kind==="real";
    saveButton.disabled=savingPhotos||!isReal||chosen.length>10||
      JSON.stringify(order)===JSON.stringify(data.selected);
    previousButton.hidden=!data.previous;
  }
  async function load(item) {
    const serial=++turn;product=item;data=null;refs=[];order=[];urls.clear();
    list.replaceChildren();referencesBox.replaceChildren();saveButton.disabled=true;
    status.textContent="Loading all prepared photos and saved factory references…";
    try {
      const response=await Promise.allSettled([
        rpc("studio_photo_choices",{p_item:item.id}),
        rpc("studio_reference_choices",{p_item:item.id})
      ]);
      if(serial!==turn||current!==item)return;
      if(response[0].status!=="fulfilled")throw response[0].reason;
      data=response[0].value;
      if(data.listing_revision!==item.revision)throw Error("Listing changed; refresh before editing photos.");
      order=(Array.isArray(data.selected)?data.selected:[]).filter(id=>data.choices.some(c=>c.id===id));
      refs=response[1].status==="fulfilled"&&Array.isArray(response[1].value)?response[1].value:[];
      status.textContent=data.choices.length?"":"No prepared photos available. Add at least one public-safe warehouse photo.";
      if(response[1].status==="rejected")status.textContent+=" Manufacturer reference lookup unavailable.";
      draw();
      const todo=[
        ...data.choices.map(c=>({key:c.id,path:photoPath(c.source,item.id)})),
        ...refs.filter(r=>!data.choices.some(c=>c.source.id===r.id))
          .map(r=>({key:"reference/"+encodeURIComponent(item.id)+"/"+encodeURIComponent(r.id),
            path:"reference/"+encodeURIComponent(item.id)+"/"+encodeURIComponent(r.id)}))
      ];
      let index=0;
      await Promise.allSettled(Array.from({length:Math.min(4,todo.length)},async()=>{
        while(index<todo.length) {
          const t=todo[index++];
          try {
            const photo=await request("/functions/v1/studio-api/"+t.path);
            if(serial===turn&&current===item){urls.set(t.key,photo.url);draw();}
          }catch(error){/* Leave the photo unselected; never guess a URL. */}
        }
      }));
    }catch(error){if(serial===turn&&current===item)status.textContent=error.message;}
  }
  inlinePhotoLoader=load;
  inlinePhotoPendingChanges=()=>!!data && JSON.stringify(order)!==JSON.stringify(data.selected);
  get("edit-photos").onclick=()=>{if(current)load(current);};
  previousButton.onclick=()=>{
    if(!data?.previous)return;
    order=data.previous.filter(id=>data.choices.some(c=>c.id===id));
    status.textContent="Previous order restored locally. Save photos to keep it.";draw();
  };
  get("cancel-photos").onclick=()=>{
    if(!data||savingPhotos)return;
    order=[...data.selected];status.textContent="Unsaved photo changes discarded.";draw();
  };
  saveButton.onclick=async()=>{
    if(savingPhotos||!data)return;
    if(Object.keys(patch()).length){
      status.textContent="Save listing text changes before saving photo choices.";return;
    }
    if(!order.length||data.choices.find(c=>c.id===order[0])?.source.kind!=="real"){
      status.textContent="Select an actual warehouse photograph as the cover.";return;
    }
    savingPhotos=true;draw();status.textContent="Saving photo choices…";
    const savingItem=product;
    try{
      await rpc("studio_save_photo_choices",{
        p_item:savingItem.id,p_listing_revision:data.listing_revision,
        p_photo_revision:data.revision,p_choices:order
      });
      await refresh();
      const updated=items.find(i=>i.id===savingItem.id);
      if(updated){
        openItem(updated);
        get("editor-status").textContent="Photo choices saved; review the updated draft before approval.";
      }else status.textContent="Saved. Refresh inventory to see the updated product.";
    }catch(error){status.textContent=error.message;}
    finally{savingPhotos=false;if(current===savingItem)draw();}
  };
}
