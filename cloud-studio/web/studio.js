"use strict";
const backend = "https://sfheqjnxlkygjfohoybo.supabase.co";
const publicKey = "sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af";
const get = id => document.getElementById(id);
const form = get("edit-form");
const fields = ["title", "price", "condition", "model", "description", "source_url", "notes"];
const auth = studioAuth.auth;
let session, current, saving = false, items = [], view = "all", photoRequest = 0;
let thumbnailGeneration = 0;
const selectedItems = new Set();
let layout = "queue";
let useSavedReference = async () => {};
let resetManualPhoto = () => {};
let addingPhotos = false;
function setAddingPhotos(active){addingPhotos=active;for(const key of fields)form.elements[key].disabled=active;}
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
  return studioWorkflows.editorValue(item,key);
}
const title = item => editorValue(item, "title") || item.id;
function category(item){
  if(item.fields.category)return item.fields.category;
  const text=title(item).toLowerCase();
  if(/desk|table|dresser|cabinet|nightstand|trundle|loft/.test(text))return "Furniture";
  if(/speaker|amplifier|preamplifier|receiver|subwoofer|tuner|soundbar|audio|turntable/.test(text))return "Audio";
  if(/heater|radiator|fan|dehumidifier/.test(text))return "Heating & cooling";
  if(/vacuum|floor washer|tineco|dyson/.test(text))return "Floor care";
  if(/tv|television|display|projector|monitor|screen/.test(text))return "TV & displays";
  if(/adapter|controller|remote|hdmi|connect|poe/.test(text))return "Electronics & accessories";
  return "Other";
}
function needsRepair(item) { return item.media_health ? !item.media_health.export_ready : !(item.exports_verified && item.photo_selection?.length); }
const matchesView = (item, key) => key === "all" || (key === "repair" ? needsRepair(item) : item.status === (key === "ready" ? "approved" : key));
function filtered() {
  const query = get("search").value.trim().toLowerCase();
  return items.filter(item => matchesView(item, view) && (!get("category-filter").value || category(item) === get("category-filter").value) && [title(item),editorValue(item,"model"),item.id].join(" ").toLowerCase().includes(query));
}
// Cards respect the seller-selected cover, but never private
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
  const photo = selection[0] || (item.media_health?.preview_reference ? {kind:"manufacturer",id:item.media_health.preview_reference,referenceOnly:true} : null);
  if (!photo) { label.textContent = "Add a listing photo"; return frame; }
  const key = photo.kind === "real" ? "photo/" + encodeURIComponent(photo.sha)
    : "reference/" + encodeURIComponent(item.id) + "/" + encodeURIComponent(photo.id);
  if(photo.referenceOnly) { const badge=document.createElement("small"); badge.className="reference-badge";badge.textContent="Reference · not selected";frame.append(badge); }
  const image = document.createElement("img");
  image.alt = "Product photo for " + title(item);
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  const load = async () => {
    try {
      if (!card.isConnected) return;
      frame.append(image);
      await studioImages.load(image,key,()=>card.isConnected);
      label.remove();
    } catch(error) {
      if (card.isConnected) label.textContent = "Photo unavailable";
    }
  };
  card._loadCover = () => {coverJobs.push({card,load});drainCoverQueue();};
  if (coverObserver) coverObserver.observe(card); else card._loadCover();
  return frame;
}
function updateBulkBar() {
  get("bulk-bar").hidden = !selectedItems.size;
  get("bulk-count").textContent = selectedItems.size + " selected";
  get("select-visible").checked = filtered().length>0 && filtered().every(i=>selectedItems.has(i.id));
}
function render() {
  const visible = filtered();
  get("cards").classList.toggle("queue",layout==="queue");
  get("cards").replaceChildren(...visible.map(item => {
    const wrap=document.createElement("article");wrap.className="queue-row";
    const check=document.createElement("input");check.type="checkbox";check.className="item-check";
    check.setAttribute("aria-label","Select "+title(item));check.checked=selectedItems.has(item.id);
    check.onchange=()=>{check.checked?selectedItems.add(item.id):selectedItems.delete(item.id);updateBulkBar();};
    const card = document.createElement("button"); card.className = "inventory-card";
    const name=document.createElement("strong"),summary=document.createElement("small"),body=document.createElement("div");
    name.textContent=title(item);summary.textContent=[editorValue(item,"model"),category(item)].filter(Boolean).join(" · ") || "Inventory item";
    body.className="product-card-body";body.append(name,summary);
    const details=document.createElement("div");details.className="card-facts";
    const price=document.createElement("strong");price.className="card-price";
    price.textContent=editorValue(item,"price")?"$"+editorValue(item,"price"):"Set price";
    const status=document.createElement("span");status.className="status-chip "+(needsRepair(item)?"repair":item.status);
    status.textContent=needsRepair(item)?"Photos need attention":statusLabel[item.status];
    const photos=document.createElement("small");photos.textContent=(item.photo_selection?.length||0)+" selected"+(item.media_health?.references?" · "+item.media_health.references+" references":"");
    details.append(price,status,photos);
    card.append(productCover(item,card),body,details);card.onclick=()=>startReview(filtered(),false,item.id);
    wrap.append(check,card);return wrap;
  }));
  if(!visible.length){const empty=document.createElement("p");empty.className="empty";empty.textContent="No products match these filters.";get("cards").append(empty);}
  get("results").textContent = visible.length + " product" + (visible.length===1?"":"s");
  document.querySelectorAll("[data-view]").forEach(button => {
    const key=button.dataset.view;button.classList.toggle("active",key===view);
    get("count-"+key).textContent=items.filter(item=>matchesView(item,key)).length;
  });
  get("metric-total").textContent=items.length;
  get("metric-ready").textContent=items.filter(i=>i.status==="approved").length;
  get("metric-photos").textContent=items.filter(needsRepair).length;
  get("metric-price").textContent=items.filter(i=>!editorValue(i,"price")).length;
  updateBulkBar();
}
async function refresh() {
  items=(await rpc("studio_state")).filter(item=>item.lifecycle!=="archived");
  const cat=get("category-filter"),value=cat.value;
  cat.replaceChildren(new Option("All categories",""),...Array.from(new Set(items.map(category))).sort().map(v=>new Option(v,v)));
  cat.value=value;
  for(const id of selectedItems)if(!items.some(i=>i.id===id))selectedItems.delete(id);
  render();
}
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
async function preview(photo, referenceOnly=false) {
  const sequence=++photoRequest,item=current,hero=get("hero");
  hero.hidden=true;hero.removeAttribute("src");get("hero-empty").hidden=false;
  get("hero-empty").textContent="Loading photo…";
  get("photo-status").textContent=referenceOnly?"Saved reference preview · choose Use in listing to add it.":"";
  const key=photo.kind==="real"?"photo/"+encodeURIComponent(photo.sha):"reference/"+encodeURIComponent(item.id)+"/"+encodeURIComponent(photo.id);
  try {
    await studioImages.load(hero,key,()=>sequence===photoRequest&&current===item);
    if(sequence===photoRequest&&current===item){hero.hidden=false;hero.style.display="";get("hero-empty").hidden=true;}
  } catch(error) { if(sequence===photoRequest){hero.hidden=true;get("hero-empty").textContent="Photo unavailable. Refresh photos to retry.";get("photo-status").textContent=error.message;} }
}
let inlinePhotoLoader = () => {};
let inlinePhotoPendingChanges = () => false;
let inlinePhotoSave = async () => {};
let reviewQueue = null, renderReady = false;
function startReview(batch, selected = false, firstId = batch[0]?.id) {
  if(!batch.length)return;
  reviewQueue={ids:batch.map(item=>item.id),selected,approved:0};
  openItem(batch.find(item=>item.id===firstId)||batch[0]);
}
function updateReviewNavigation() {
  const index=reviewQueue?.ids.indexOf(current?.id) ?? -1;
  const progress=get("review-progress");
  progress.hidden=!reviewQueue?.selected;
  progress.textContent=reviewQueue?.selected?"Selected item "+(index+1)+" of "+reviewQueue.ids.length:"";
  const more=reviewQueue?.ids.slice(index+1).some(id=>items.some(item=>item.id===id));
  get("skip").textContent=more?"Skip to next":"Finish review";
  get("save-next").textContent=more?"Save & next →":"Save & finish";
  if(!approvalBusy)get("review-export").textContent=reviewQueue?.selected?(more?"Approve & next →":"Approve & finish"):"Approve listing";
  get("review-export").disabled=!renderReady||approvalBusy||saving||addingPhotos;
}
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
  resetManualPhoto();
  current = item;
  renderReady = false;
  updateReviewNavigation();
  get("transfer-export").hidden = item.status !== "approved";
  get("edit-title").textContent = title(item);
  get("editor-status").textContent = "Saved · revision " + item.revision;
  for (const key of fields) {
    const input = form.elements[key], value = editorValue(item,key);
    if (key === "condition" && value && !Array.from(input.options).some(option => option.value === value)) input.add(new Option(value,value));
    input.value = value;
    // Displayed defaults are not unsaved seller keystrokes. Keep the saved
    // value separately so Save can persist them without blocking photo edits.
    input.dataset.initial = value;
    input.dataset.saved = String(item.fields[key] ?? "");
  }
  get("diagnostics").replaceChildren();
  const checks=document.createElement("div");checks.className="readiness-checks";
  for(const [label,ok] of [["Photos",!needsRepair(item)],["Price",Number(editorValue(item,"price"))>0],["Title",!!editorValue(item,"title")],["Description",!!editorValue(item,"description")]]) {
    const chip=document.createElement("span");chip.className=ok?"check-ok":"check-needed";chip.textContent=(ok?"✓ ":"! ")+label;checks.append(chip);
  }
  get("diagnostics").append(checks);
  if(item.identity_status && item.identity_status!=="verified_exact") {
    const info=document.createElement("details"),summary=document.createElement("summary"),text=document.createElement("p");
    summary.textContent="Product identity · "+item.identity_status.replaceAll("_"," ");
    text.textContent=item.research?.manufacturer_research?.reason || "The exact product model is not independently confirmed. Review the evidence before using model-specific details.";
    info.append(summary,text);get("diagnostics").append(info);
  }
  get("suggested-description").value=item.generated_candidate?.description || "";
  get("use-copy").disabled=!get("suggested-description").value;
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
  const photos = (item.photo_selection||[]).filter(photo => (photo.kind === "real" && photo.sha) || (photo.kind === "manufacturer" && photo.id));
  ++photoRequest;
  get("hero").removeAttribute("src");
  get("hero-empty").hidden=!!photos.length;
  get("hero-empty").textContent="No listing photos selected. Choose a saved reference or add a photo below.";
  get("hero").hidden = !photos.length;
  get("hero").style.display = photos.length ? "" : "none";
  get("photo-status").textContent = photos.length ? "" : "No listing photos selected yet. Your saved manufacturer references may be available below under Photos & cover.";
  get("thumbs").replaceChildren();
  if (photos.length) preview(photos[0]);
  else if(item.media_health?.preview_reference)preview({kind:"manufacturer",id:item.media_health.preview_reference},true);
  if (!get("editor").open) get("editor").showModal();
  inlinePhotoLoader(item);
  get("editor").querySelectorAll(".photo-pane,.details-pane,.editor-grid").forEach(el=>el.scrollTop=0);
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
  renderReady=false;get("review-export").disabled = true;
  get("render-status").textContent = "Checking listing photos…";
  stopRenderStatus = studioRenderStatus.watch({
    read:()=>rpc("studio_render_status",{p_item:item.id}), revision:item.revision,
    active:()=>get("editor").open && current===item,
    show:(message,ready,value)=>{
      renderReady=ready;get("render-status").textContent=message;updateReviewNavigation();
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
function canLeave() { return !saving && !approvalBusy && !addingPhotos && (!(Object.keys(patch()).length || inlinePhotoPendingChanges()) || confirm("Discard your unsaved listing and photo changes?")); }
function next(id) {
  const ids=reviewQueue?.ids || filtered().map(item=>item.id),index=ids.indexOf(id);
  const following=index<0?null:ids.slice(index+1).map(key=>items.find(item=>item.id===key)).find(Boolean);
  if(following)openItem(following);
  else {
    if(reviewQueue?.selected)notice("Selected review finished. "+reviewQueue.approved+" approved; "+reviewQueue.ids.filter(key=>selectedItems.has(key)&&items.some(item=>item.id===key)).length+" still selected for review.");
    get("editor").close();
    reviewQueue=null;
  }
}
async function save(advance, propagate = false) {
  if(addingPhotos){get("editor-status").textContent="Wait for photo upload to finish.";return;}
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
    if(inlinePhotoPendingChanges()){await inlinePhotoSave(item);await refresh();Object.assign(item,items.find(i=>i.id===item.id)||{});}
    render(); if (advance) next(item.id); else {openItem(item); get("editor-status").textContent = "Saved.";}
    return true;
  } catch(error) {
    get("editor-status").textContent = error.message;
    if (propagate) throw error;
    return false;
  }
  finally { controls.forEach((input,index) => {input.disabled=disabled[index];}); saving = false; updateReviewNavigation(); }
}
form.onsubmit = event => {event.preventDefault(); save(false);};
get("save-next").onclick = () => save(true);
get("skip").onclick = () => {if(canLeave()) next(current.id);};
get("close").onclick = () => {if(canLeave()) get("editor").close();};
get("editor").oncancel = event => {if(!canLeave()) event.preventDefault();};
get("editor").onclose=()=>{if(get("editor").open)return;stopRenderStatus();++photoRequest;reviewQueue=null;};
let uploadBatch;
get("files").onchange = () => {uploadBatch = crypto.randomUUID();};
if (location.pathname.startsWith("/app")) get("upload").open = true;
get("upload-form").onsubmit = async event => {
  event.preventDefault();
  const picker = get("files"), button = event.currentTarget.querySelector("button");
  const photos = Array.from(picker.files), message = get("upload-status");
  if (!photos.length || photos.length > 10 || photos.some(file => file.size > 16*1024*1024)) {
    message.textContent = "Choose up to 10 photos, each 16 MB or smaller."; return;
  }
  button.disabled = picker.disabled = true;
  // Keep the idempotency key across reconnect/reload; only hashes and a batch ID.
  let uploadKey;
  try {
    const hashes=await Promise.all(photos.map(async file=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,"0")).join("")));
    uploadKey="studio-upload:"+session.user.id+":"+hashes.join(":");
    uploadBatch=sessionStorage.getItem(uploadKey)||crypto.randomUUID();
    sessionStorage.setItem(uploadKey,uploadBatch);
  } catch(error){message.textContent="Unable to initialize upload: "+error.message;button.disabled=picker.disabled=false;return;}
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
    picker.value = ""; sessionStorage.removeItem(uploadKey); uploadBatch = null;
    await refresh();
    const item = items.find(product => product.id===completed.id);
    if (item) startReview([item]);
  } catch(error) { message.textContent = error.message; }
  finally { button.disabled = picker.disabled = false; }
};
// Single-click approval: verify exactly the saved draft and every selected JPEG,
// then submit the existing revision-checked approval RPC. Never show a second dialog.
let approvalBusy = false;
get("review-export").onclick = async () => {
  if (approvalBusy || addingPhotos) return;
  const item = current;
  const button = get("review-export"), message = get("editor-status");
  approvalBusy = true;
  button.disabled = true;
  button.textContent = "Verifying listing…";
  try {
    if (Object.keys(patch(true)).length || inlinePhotoPendingChanges()) await save(false, true);
    if (current.id !== item.id) throw Error("Product changed; reopen it before approving.");
    // Server checks membership, saved fields, eligible media and stale revisions.
    const response = await request("/functions/v1/studio-api/export-preview", {
      method: "POST", body: JSON.stringify({id:item.id,revision:current.revision})
    });
    const snapshot = response.snapshot;
    if (!snapshot || snapshot.id !== item.id || snapshot.revision !== current.revision ||
        !Array.isArray(snapshot.images) || !snapshot.images.length ||
        snapshot.images.length > 10 || response.urls?.length !== snapshot.images.length) {
      throw Error("The saved listing or photo set is incomplete.");
    }
    studioWorkflows.validateListing(snapshot);
    await studioWorkflows.verifyPhotos(response);
    button.textContent = "Approving…";
    await rpc("studio_approve_export",{
      p_item:snapshot.id,p_revision:snapshot.revision,p_snapshot:snapshot
    });
    item.status="approved";
    if(reviewQueue?.selected){reviewQueue.approved++;selectedItems.delete(item.id);}
    try{await refresh();}catch(error){render();notice("Approval saved. Inventory refresh failed: "+error.message);}
    if(reviewQueue?.selected)next(item.id);
    else {
      const updated = items.find(product=>product.id===item.id);
      if (updated) openItem(updated);
      message.textContent = "Approved — ready for Facebook handoff.";
    }
  } catch(error) {
    get("editor-status").textContent = error.message || "Unable to approve listing.";
  } finally {
    approvalBusy = false;
    updateReviewNavigation();
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
      const key=photoPath(choice.source,product.id);
      studioImages.load(img,key,()=>tile.isConnected).catch(()=>{img.hidden=true;const error=document.createElement("span");error.className="image-error";error.textContent="Photo unavailable · Refresh photos";imageButton.append(error);});
      imageButton.append(img);imageButton.onclick=()=>preview(choice.source);
      const name=document.createElement("span");
      name.className="photo-label";
      name.textContent=(choice.source.kind==="manufacturer"?"Factory reference":"Warehouse photo")+
        (idx===0?" · COVER":on?" · Selected":" · Available");
      const controls=document.createElement("div");controls.className="photo-tile-controls";
      tile.append(imageButton,name,controls);
      if(!on) action(controls,"Add",order.length>=10,()=>order.push(choice.id));
      else {
        if(idx>0)
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
      explanation.textContent="Saved privately. Preview a photo, then choose Use in listing to prepare and add it. Your current cover stays first.";
      const grid=document.createElement("div");grid.className="factory-reference-grid";
      for(const ref of hidden) {
        const tile=document.createElement("div");tile.className="photo-tile reference-only";
        const btn=document.createElement("button");btn.type="button";btn.className="photo-preview";
        btn.title="Preview factory/reference photograph";
        const img=document.createElement("img");img.alt="Factory reference thumbnail";img.loading="lazy";
        const key="reference/"+encodeURIComponent(product.id)+"/"+encodeURIComponent(ref.id);
        studioImages.load(img,key,()=>tile.isConnected).catch(()=>{img.hidden=true;const error=document.createElement("span");error.className="image-error";error.textContent="Photo unavailable · Refresh photos";btn.append(error);});
        btn.append(img);btn.onclick=()=>preview({kind:"manufacturer",id:ref.id},true);
        const label=document.createElement("small");
        label.textContent=ref.label||"Factory/reference photo · preview only";
        const use=document.createElement("button");use.type="button";use.className="secondary";use.textContent="Use in listing";
        use.onclick=()=>useSavedReference(product,ref,use);
        tile.append(btn,label,use);grid.append(tile);
      }
      referencesBox.append(heading,explanation,grid);
    }
    saveButton.disabled=savingPhotos||!chosen.length||chosen.length>10||
      JSON.stringify(order)===JSON.stringify(data.selected);
    previousButton.hidden=!data.previous;
  }
  async function load(item) {
    const serial=++turn;product=item;data=null;refs=[];order=[];urls.clear();
    list.replaceChildren();referencesBox.replaceChildren();saveButton.disabled=true;count.textContent="Loading photos…";
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
      status.textContent=data.choices.length?"":"Choose a saved reference or add a product photo to start this gallery.";
      if(response[1].status==="rejected")status.textContent+=" Manufacturer reference lookup unavailable.";
      draw();
      if(!item.photo_selection?.length && refs.length && !item.media_health?.preview_reference)preview({kind:"manufacturer",id:refs[0].id},true);
    }catch(error){if(serial===turn&&current===item)status.textContent=error.message;}
  }
  inlinePhotoLoader=load;
  inlinePhotoPendingChanges=()=>!!data && JSON.stringify(order)!==JSON.stringify(data.selected);
  get("edit-photos").onclick=()=>{if(current && (!inlinePhotoPendingChanges() || confirm("Discard unsaved photo changes and refresh?"))){studioImages.clear();load(current);}};
  previousButton.onclick=()=>{
    if(!data?.previous)return;
    order=data.previous.filter(id=>data.choices.some(c=>c.id===id));
    status.textContent="Previous order restored locally. Save photos to keep it.";draw();
  };
  get("cancel-photos").onclick=()=>{
    if(!data||savingPhotos)return;
    order=[...data.selected];status.textContent="Unsaved photo changes discarded.";draw();
  };
  inlinePhotoSave=async(item)=>{
    if(!data||product.id!==item.id||!inlinePhotoPendingChanges())return;
    if(!order.length||order.length>10)throw Error("Select one to ten listing photos.");
    const nextRevision=await rpc("studio_save_photo_choices",{p_item:item.id,p_listing_revision:item.revision,p_photo_revision:data.revision,p_choices:[...order]});
    data.revision=nextRevision;data.listing_revision=item.revision;data.selected=[...order];
  };
  saveButton.onclick=()=>save(false);

}


// Owner-managed additions to an existing listing, including external product photos.
// Photos are normalized to JPEG in the browser, SHA-256 checked in the private
// upload gateway, and appended with existing order and seller copy preserved.
{
  const photoPanel=document.createElement("section");
  photoPanel.className="manual-photo-panel";
  photoPanel.style.cssText="margin-top:20px;padding:16px;border:1px solid #c9d6e1;border-radius:12px;background:#f7fafc";
  photoPanel.innerHTML='<h4 style="margin:0 0 8px">Add photos to this listing</h4>'+
    '<p style="margin:0 0 12px">Upload new warehouse pictures or product photos you saved. No separate listing is created. Up to 10 selected photos per listing.</p>'+
    '<label>Choose photos <input id="manual-photo-files" type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple></label>'+
    '<label style="display:block;margin-top:10px">Photo type <select id="manual-photo-kind"><option value="real">My warehouse/product photo</option><option value="manufacturer">Product image I found online</option></select></label>'+
    '<label style="display:block;margin-top:10px">Image source URL (optional) <input id="manual-photo-source" type="url" placeholder="https://..."></label>'+
    '<button type="button" id="manual-photo-add" class="primary" style="margin-top:12px">Add selected photos</button>'+
    '<p id="manual-photo-status" role="status"></p>';
  get("reference-gallery").after(photoPanel);
  let pendingReference=null;
  const filePicker=get("manual-photo-files");
  filePicker.addEventListener("change",()=>{pendingReference=null;});
  const addButton=get("manual-photo-add");
  const status=get("manual-photo-status");
  resetManualPhoto=()=>{pendingReference=null;filePicker.value="";get("manual-photo-kind").value="real";get("manual-photo-source").value="";status.textContent="";};
  async function prepareManualPhoto(file) {
    const decoded=await createImageBitmap(file);
    try {
      const canvas=document.createElement("canvas");
      canvas.width=canvas.height=1000;
      const ctx=canvas.getContext("2d");
      ctx.fillStyle="#ffffff";ctx.fillRect(0,0,1000,1000);
      const scale=Math.min(1000/decoded.width,1000/decoded.height);
      const w=Math.round(decoded.width*scale),h=Math.round(decoded.height*scale);
      ctx.drawImage(decoded,Math.floor((1000-w)/2),Math.floor((1000-h)/2),w,h);
      const blob=await new Promise((resolve,reject)=>
        canvas.toBlob(value=>value?resolve(value):reject(Error("Unable to convert photo")),"image/jpeg",0.91));
      const buffer=await blob.arrayBuffer();
      const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",buffer)),
        byte=>byte.toString(16).padStart(2,"0")).join("");
      return {blob,sha,bytes:blob.size,width:1000,height:1000,name:file.name};
    } finally { decoded.close(); }
  }
  useSavedReference=async(item,ref,button)=>{
    if(current!==item)return;
    if(addingPhotos)return;
    setAddingPhotos(true);button.disabled=true;
    try {
      if(Object.keys(patch()).length||inlinePhotoPendingChanges())throw Error("Save your listing and photo changes first.");
      const signed=await request("/functions/v1/studio-api/reference/"+encodeURIComponent(item.id)+"/"+encodeURIComponent(ref.id));
      const result=await fetch(signed.url,{cache:"no-store"});
      if(!result.ok)throw Error("Saved photo could not be downloaded. Refresh photos and retry.");
      const photo=await result.blob(),dt=new DataTransfer();dt.items.add(new File([photo],ref.id+".jpg",{type:photo.type||"image/jpeg"}));
      pendingReference=ref.id;filePicker.files=dt.files;get("manual-photo-kind").value="manufacturer";get("manual-photo-source").value=ref.source_url||"";
      await addButton.onclick();
    }catch(error){status.textContent=error.message;}
    finally{setAddingPhotos(false);button.disabled=false;}
  };
  // Refresh references after photo additions, without altering seller-controlled order.
  addButton.onclick=async()=>{
    const item=current;
    if(!item || !get("editor").open) return;
    if(Object.keys(patch()).length || inlinePhotoPendingChanges()){
      status.textContent="Save listing and photo-order changes before adding new pictures.";return;
    }
    const files=[...filePicker.files];
    if(!files.length){status.textContent="Select one or more picture files first.";return;}
    if(files.length>10){status.textContent="Choose up to ten photos at once.";return;}
    if(files.some(file=>file.size>16000000)){
      status.textContent="Each photo must be smaller than 16 MB.";return;
    }
    setAddingPhotos(true);addButton.disabled=true;filePicker.disabled=true;
    let added=0;
    try{
      const response=await rpc("studio_photo_choices",{p_item:item.id});
      let revision=response.revision;
      if(response.selected.length+files.length>10)
        throw Error("You have "+response.selected.length+" selected photos. Remove some first to stay within 10.");
      const authenticated=await auth.getSession();
      if(authenticated.error || !authenticated.data.session)throw Error("Sign in again to add photos.");
      const active=authenticated.data.session;
      for(const [idx,file] of files.entries()){
        status.textContent="Preparing photo "+(idx+1)+" of "+files.length+"…";
        const image=await prepareManualPhoto(file);
        const batch=crypto.randomUUID();
        const originalBytes=await file.arrayBuffer();
        const originalSha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",originalBytes)),v=>v.toString(16).padStart(2,"0")).join("");
        const originalUpload=await fetch(backend+"/storage/v1/object/studio-originals/incoming/"+active.user.id+"/"+batch+"/"+originalSha,{
          method:"POST",headers:{apikey:publicKey,Authorization:"Bearer "+active.access_token,"Content-Type":file.type||"application/octet-stream","x-upsert":"false"},body:file
        });
        if(!originalUpload.ok)throw Error("Original photo could not be saved. Nothing was added to the listing.");
        const path="incoming/"+active.user.id+"/"+batch+"/"+image.sha;
        const uploaded=originalSha===image.sha ? originalUpload : await fetch(backend+"/storage/v1/object/studio-originals/"+path,{
          method:"POST",headers:{apikey:publicKey,Authorization:"Bearer "+active.access_token,
            "Content-Type":"image/jpeg","x-upsert":"false"},body:image.blob
        });
        if(!uploaded.ok){
          const details=await uploaded.text().catch(()=>uploaded.statusText);
          throw Error("Photo upload failed: "+details.slice(0,180));
        }
        status.textContent="Adding photo "+(idx+1)+" of "+files.length+" to this listing…";
        const saved=await request("/functions/v1/studio-api/add-photo",{
          method:"POST",body:JSON.stringify({
            id:item.id,batch,sha:image.sha,bytes:image.bytes,width:image.width,
            height:image.height,name:image.name,photo_revision:revision,
            kind:get("manual-photo-kind").value,
            source_url:get("manual-photo-source").value.trim(),
            original:{sha:originalSha,bytes:originalBytes.byteLength},...(pendingReference?{reference_id:pendingReference}:{})
          })
        });
        if(!saved.ok)throw Error("Photo addition failed");
        revision=saved.photo_revision;
        added++;
      }
      filePicker.value="";pendingReference=null;
      await refresh();
      const updated=items.find(product=>product.id===item.id);
      if(updated)openItem(updated);
      get("editor-status").textContent="Added "+added+" photo"+(added===1?"":"s")+". Existing cover and listing text preserved.";
      status.textContent="Added "+added+" photo"+(added===1?"":"s")+". Choose Make cover or rearrange photos above.";
    }catch(error){
      status.textContent=(added?added+" added. ":"")+(error.message||"Unable to add photos.")+
        (added?" Refresh this product to see the saved additions.":"");
    }finally{setAddingPhotos(false);addButton.disabled=false;filePicker.disabled=false;}
  };
}

get("category-filter").onchange=render;
get("layout-toggle").onclick=()=>{layout=layout==="queue"?"grid":"queue";get("layout-toggle").textContent=layout==="queue"?"Photo grid":"Work queue";render();};
get("select-visible").onchange=event=>{for(const item of filtered())event.target.checked?selectedItems.add(item.id):selectedItems.delete(item.id);render();};
get("clear-selection").onclick=()=>{selectedItems.clear();render();};
get("bulk-review").onclick=()=>startReview(items.filter(item=>selectedItems.has(item.id)),true);
let bulkBusy=false;
async function runBulk(label,operation){
  if(bulkBusy)return;
  const batch=items.filter(i=>selectedItems.has(i.id));
  if(!batch.length)return;
  bulkBusy=true;const buttons=[...get("bulk-bar").querySelectorAll("button")];buttons.forEach(b=>b.disabled=true);
  get("bulk-results").hidden=true;
  notice(label+"…");get("message").scrollIntoView({block:"nearest"});
  try {
    const results=await studioWorkflows.run(batch,operation,(n,total)=>notice(label+" "+n+" / "+total+"…"));
    const failed=results.filter(r=>!r.ok);
    let refreshError="";
    try{await refresh();}catch(error){refreshError=" Inventory refresh failed: "+error.message;}
    notice(label+": "+(results.length-failed.length)+" completed; "+failed.length+" need attention."+refreshError);
    get("bulk-results").replaceChildren(...results.map(result=>{
      const row=document.createElement("div"),name=document.createElement("strong"),status=document.createElement("span");
      const item=items.find(i=>i.id===result.id)||batch.find(i=>i.id===result.id);
      row.className="bulk-result "+(result.ok?"success":"failure");name.textContent=title(item);
      status.textContent=result.ok?"Completed":result.error;row.append(name,status);
      if(!result.ok){const review=document.createElement("button");review.className="secondary";review.textContent="Review item";review.onclick=()=>startReview([items.find(i=>i.id===result.id)||item]);row.append(review);}
      return row;
    }));
    get("bulk-results").hidden=false;
    return results;
  } catch(error) {notice(label+" failed: "+error.message);return [];}
  finally {bulkBusy=false;buttons.forEach(b=>b.disabled=false);}
}
get("bulk-price").onclick=()=>runBulk("Fill missing prices",async item=>{
  if(Object.hasOwn(item.fields,"price"))throw Error("Existing price or explicit blank preserved.");
  const suggestion=studioWorkflows.suggestedPrice(item);
  if(!suggestion)throw Error("No dated retail price and source are saved.");
  return rpc("studio_seller_patch",{p_id:item.id,p_expected_revision:item.revision,p_patch:{price:String(suggestion.price)}});
});
get("bulk-prepare").onclick=()=>runBulk("Prepare galleries",async item=>{
  const state=await rpc("studio_render_status",{p_item:item.id});
  if(state.state==="ready")return "Already prepared";
  if(!item.photo_selection?.length)throw Error("Choose a reference or add a listing photo first.");
  if(state.state==="failed")return rpc("studio_retry_render",{p_item:item.id,p_revision:item.revision,p_photo_revision:state.photo_revision,p_failed_job:state.retry_job});
  return rpc("studio_request_render",{p_item:item.id,p_revision:item.revision,p_photo_revision:state.photo_revision});
});
get("bulk-copy").onclick=()=>runBulk("Refresh copy suggestions",item=>rpc("studio_refresh_copy_suggestion",{p_item:item.id,p_revision:item.revision}));
get("bulk-approve").onclick=()=>runBulk("Approve selected",async item=>{
  if(!["review","approved"].includes(item.status))throw Error("This listing is not in the review queue.");
  if(needsRepair(item))throw Error("Prepare the selected photos first.");
  // Save exactly the same displayed prefills as individual approval.
  // Explicit seller values (including cleared fields) always take precedence.
  const changes=studioWorkflows.prefillPatch(item,fields);
  studioWorkflows.validateListing({...item.fields,...changes});
  if(Object.keys(changes).length){
    const changed=await rpc("studio_seller_patch",{p_id:item.id,p_expected_revision:item.revision,p_patch:changes});
    Object.assign(item,{fields:changed.fields,revision:changed.revision,status:changed.status||"review"});
  }
  const response=await request("/functions/v1/studio-api/export-preview",{method:"POST",body:JSON.stringify({id:item.id,revision:item.revision})});
  if(response.snapshot.id!==item.id||response.snapshot.revision!==item.revision)throw Error("Listing changed; reopen it.");
  studioWorkflows.validateListing(response.snapshot);
  await studioWorkflows.verifyPhotos(response);
  const result=await rpc("studio_approve_export",{p_item:item.id,p_revision:item.revision,p_snapshot:response.snapshot});
  item.status="approved";
  return result;
});
get("bulk-export").onclick=async()=>{
  const entries=[];let totalBytes=0;
  await runBulk("Export approved listings",async item=>{
    if(item.status!=="approved")throw Error("Approve this listing first.");
    const response=await request("/functions/v1/studio-api/export-preview",{method:"POST",body:JSON.stringify({id:item.id,revision:item.revision})});
    if(response.snapshot.id!==item.id||response.snapshot.revision!==item.revision)throw Error("Listing changed; reopen it.");
    const photos=await studioWorkflows.verifyPhotos(response);const bytes=photos.reduce((n,p)=>n+p.length,0);
    if(totalBytes+bytes>250*1024*1024)throw Error("Batch exceeds 250 MB. Download this product in a smaller batch.");
    // Recheck approval after downloads so stale exports do not masquerade as approved.
    const latest=(await rpc("studio_state")).find(i=>i.id===item.id);
    if(!latest||latest.status!=="approved"||latest.revision!==item.revision||JSON.stringify(latest.photo_selection)!==JSON.stringify(item.photo_selection))throw Error("Listing changed during export. Retry it.");
    const folder=item.id.replace(/[^a-zA-Z0-9_-]/g,"_")+"/";
    entries.push({name:folder+"listing.json",data:JSON.stringify(response.snapshot,null,2)});
    photos.forEach((data,n)=>entries.push({name:folder+String(n+1).padStart(2,"0")+".jpg",data}));totalBytes+=bytes;
  });
  if(entries.length){const url=URL.createObjectURL(studioWorkflows.zip(entries)),a=document.createElement("a");a.href=url;a.download="CrazyMoe-approved-listings.zip";a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
};
get("refresh-copy").onclick=async()=>{
  const item=current;get("refresh-copy").disabled=true;
  try{const result=await rpc("studio_refresh_copy_suggestion",{p_item:item.id,p_revision:item.revision});if(current===item){get("suggested-description").value=result.description;get("use-copy").disabled=false;get("editor-status").textContent="Suggestion refreshed. Your saved description is unchanged.";}}
  catch(error){get("editor-status").textContent=error.message;}
  finally{get("refresh-copy").disabled=false;}
};
get("use-copy").onclick=()=>{form.elements.description.value=get("suggested-description").value;form.dispatchEvent(new Event("input"));};
form.addEventListener("input",()=>{get("editor-status").textContent=Object.keys(patch()).length?"Unsaved changes":"Saved · revision "+current.revision;});
document.addEventListener("keydown",event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"&&get("editor").open){event.preventDefault();save(false);}
  if(event.target.matches("input,textarea,select")||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.key==="/"&&!get("editor").open){event.preventDefault();get("search").focus();}
  if(event.key.toLowerCase()==="j"&&get("editor").open&&canLeave())next(current.id);
});
