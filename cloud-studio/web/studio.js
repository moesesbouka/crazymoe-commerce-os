"use strict";
const backend = "https://sfheqjnxlkygjfohoybo.supabase.co";
const publicKey = "sb_publishable_xfIVDlnktUiJYm5U_1jEtw_Res600Af";
const get = id => document.getElementById(id);
const form = get("edit-form");
const fields = ["title", "price", "condition", "model", "description", "source_url", "notes"];
const auth = studioAuth.auth;
let session, current, saving = false, items = [], view = "all", photoRequest = 0;
const statusLabel = {review:"Review", approved:"Ready", listed:"Listed", archived:"Archived"};

// Signed photo links stay in memory only. Limit work while scrolling or searching.
const photoLinks = new Map(), photoQueue = [];
let activePhotos = 0;
function photoPath(item, photo) {
  return "/functions/v1/studio-api/" + (photo.kind === "real"
    ? "photo/" + encodeURIComponent(photo.sha)
    : "reference/" + encodeURIComponent(item.id) + "/" + encodeURIComponent(photo.id));
}
async function photoLink(item, photo, renew = false) {
  const key = photoPath(item, photo), cached = photoLinks.get(key);
  if (!renew && cached && cached.until > Date.now()) return cached.value;
  const value = request(key).then(result => result.url);
  photoLinks.set(key, {value, until:Date.now() + 60000});
  if (photoLinks.size > 160) photoLinks.delete(photoLinks.keys().next().value);
  try { return await value; } catch(error) { photoLinks.delete(key); throw error; }
}
function drainPhotos() {
  while (activePhotos < 4 && photoQueue.length) {
    const job = photoQueue.shift();
    if (!job.image.isConnected) continue;
    activePhotos++;
    job.run().finally(() => { activePhotos--; drainPhotos(); });
  }
}
const photoObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    photoObserver.unobserve(entry.target);
    entry.target.loadPhoto();
  }
}, {rootMargin:"240px"});
function photoImage(item, photo, alt, status) {
  const image = document.createElement("img");
  image.alt = alt; image.decoding = "async"; image.referrerPolicy = "no-referrer";
  image.loadPhoto = () => {
    photoQueue.push({image, run:async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const url = await photoLink(item, photo, attempt > 0);
          if (!image.isConnected) return;
          image.src = url;
          await image.decode();
          if (status) status.hidden = true;
          return;
        } catch(error) {
          if (attempt === 1 && image.isConnected) {
            image.removeAttribute("src");
            if (status) {status.hidden=false; status.textContent="Photo unavailable · refresh to retry";}
          }
        }
      }
    }});
    drainPhotos();
  };
  photoObserver.observe(image);
  return image;
}

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
const title = item => item.fields.title || item.generated_candidate?.title || item.id;
const matchesView = (item, key) => key === "all" ? item.status !== "archived" : item.status === (key === "ready" ? "approved" : key);
function filtered() {
  const query = get("search").value.trim().toLowerCase();
  return items.filter(item => matchesView(item, view) && [title(item),item.fields.model,item.id].join(" ").toLowerCase().includes(query));
}
function render() {
  photoObserver.disconnect();
  photoQueue.splice(0);
  const visible = filtered();
  get("cards").replaceChildren(...visible.map(item => {
    const card = document.createElement("button");
    card.className = "card inventory-card";
    card.type = "button";
    const media = document.createElement("span"), body = document.createElement("span");
    media.className = "image"; body.className = "body";
    const photoStatus = document.createElement("span"); photoStatus.className = "photo-placeholder";
    const photos = (item.photo_selection || []).filter(p => (p.kind === "real" && p.sha) || (p.kind === "manufacturer" && p.id));
    photoStatus.textContent = photos.length ? "Loading photo…" : "No selected photo";
    media.append(photoStatus);
    if (photos.length) media.append(photoImage(item, photos[0], "", photoStatus));
    const name = document.createElement("strong"), summary = document.createElement("small");
    name.textContent = title(item);
    summary.textContent = [statusLabel[item.status], item.fields.price && "$" + item.fields.price, photos.length + " photos"].filter(Boolean).join(" · ");
    body.append(name,summary); card.append(media,body);
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
async function openWorkspace(authSession) {
  session = authSession;
  await refresh();
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
    photoLinks.clear(); photoQueue.splice(0); photoObserver.disconnect();
    get("cards").replaceChildren(); get("thumbs").replaceChildren(); get("hero").removeAttribute("src");
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
  const item = current;
  get("hero").removeAttribute("src");
  get("photo-status").textContent = "Loading photo…";
  try {
    const url = await photoLink(item, photo);
    if (sequence !== photoRequest) return;
    get("hero").src = url;
    await get("hero").decode();
    if (sequence === photoRequest) get("photo-status").textContent = "";
  } catch(error) { if (sequence === photoRequest) get("photo-status").textContent = error.message; }
}
function openItem(item) {
  current = item;
  get("transfer-export").hidden = item.status !== "approved";
  get("edit-title").textContent = title(item);
  get("editor-status").textContent = "";
  for (const key of fields) {
    const input = form.elements[key], value = String(item.fields[key] ?? "");
    if (key === "condition" && value && !Array.from(input.options).some(option => option.value === value)) input.add(new Option(value,value));
    input.value = key === "condition" && !Object.hasOwn(item.fields,key) ? "New" : value;
    input.dataset.initial = input.value;
  }
  get("diagnostics").textContent = statusLabel[item.status] + " · Revision " + item.revision;
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
  get("thumbs").replaceChildren(...photos.map((photo,index) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "thumb";
    const label = document.createElement("span");
    label.textContent = (photo.kind === "manufacturer" ? "Reference " : "Photo ") + (index + 1);
    button.append(photoImage(item, photo, ""), label);
    button.setAttribute("aria-label", label.textContent);
    button.classList.toggle("selected", index === 0);
    button.onclick = () => {
      get("thumbs").querySelectorAll("button").forEach(b => b.classList.toggle("selected", b === button));
      preview(photo);
    };
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
let reviewedExport = null, previewGeneration = 0;
const previewObjects = [];
get("review-export").onclick = async () => {
  if (Object.keys(patch()).length) {get("editor-status").textContent="Save your changes before reviewing the draft."; return;}
  const generation=++previewGeneration;
  get("confirm-export").disabled=true; reviewedExport=null;
  get("export-fields").textContent=get("export-description").textContent="";
  get("export-photos").replaceChildren();get("export-status").textContent="Checking selected JPEG files…";
  get("export-review").showModal();
  try {
    const data=await request("/functions/v1/studio-api/export-preview",{method:"POST",body:JSON.stringify({id:current.id,revision:current.revision})});
    const snapshot=data.snapshot;
    if (generation!==previewGeneration) return;
    get("export-fields").textContent=[snapshot.title,"$"+(snapshot.price||""),snapshot.condition].filter(Boolean).join(" · ");
    get("export-description").textContent=snapshot.description;
    for (const [position,file] of snapshot.images.entries()) {
      const response=await fetch(data.urls[position],{cache:"no-store"});
      if (!response.ok) throw Error("Photo download failed");
      const bytes=await response.arrayBuffer();
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
      if (bytes.byteLength!==file.bytes || digest!==file.sha) throw Error("Photo verification failed");
      if (generation!==previewGeneration) return;
      const img=document.createElement("img"),url=URL.createObjectURL(new Blob([bytes],{type:"image/jpeg"}));
      previewObjects.push(url);img.src=url;img.alt="Listing photo "+(position+1);img.width=144;
      await img.decode();
      if (generation!==previewGeneration) return;
      get("export-photos").append(img);
    }
    reviewedExport=snapshot;get("confirm-export").disabled=false;
    get("export-status").textContent="Review the listing text and photo order before approving.";
  } catch(error) {if (generation===previewGeneration) get("export-status").textContent=error.message;}
};
get("close-export").onclick=()=>get("export-review").close();
get("export-review").onclose=()=>{++previewGeneration;reviewedExport=null;previewObjects.splice(0).forEach(url=>URL.revokeObjectURL(url));};
get("confirm-export").onclick=async ()=>{
  const snapshot=reviewedExport;if (!snapshot) return;
  get("confirm-export").disabled=true;
  try {
    await rpc("studio_approve_export",{p_item:snapshot.id,p_revision:snapshot.revision,p_snapshot:snapshot});
    current.status="approved";render();get("export-review").close();openItem(current);
    get("editor-status").textContent="Approved for Facebook handoff.";
  } catch(error) {get("export-status").textContent=error.message;get("confirm-export").disabled=false;}
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
    const answer=await chrome.runtime.sendMessage(extensionId,{type:"STUDIO_APPROVED_DRAFT",token});
    if(!answer?.ok)throw Error("Commerce OS could not open the draft.");
    get("editor-status").textContent="In the Facebook tab, choose Load next approved product.";
  }catch(error){get("editor-status").textContent=error.message;}
};

{
  const dialog = get("photo-editor"), list = get("photo-list"), message = get("selection-status");
  const saveButton = get("save-photos"), previousButton = get("previous-photos");
  let data, order, item, generation = 0, writing = false;
  const thumbnails = new Map();
  function draw() {
    list.replaceChildren();
    const remaining = data.choices.map(c=>c.id).filter(id=>!order.includes(id));
    for (const id of [...order,...remaining]) {
      const choice = data.choices.find(c=>c.id===id), index = order.indexOf(id);
      const row = document.createElement("li"), name = document.createElement("span");
      const group = choice.source.kind==="manufacturer" ? "Manufacturer" : "Inventory";
      name.textContent = group+" photo "+choice.position+" · "+(choice.source.style_mode || "original");
      if (thumbnails.has(id)) {
        const img=document.createElement("img"); img.src=thumbnails.get(id); img.alt=""; row.append(img);
      }
      row.append(name);
      const button = (label,disabled,action)=>{
        const b=document.createElement("button"); b.type="button"; b.className="secondary"; b.textContent=label;
        b.disabled=disabled || writing; b.onclick=()=>{action();draw();}; row.append(b);
      };
      if (index<0) button("Add",order.length>=10,()=>order.push(id));
      else {
        button("Earlier",index===0,()=>{order.splice(index,1);order.splice(index-1,0,id);});
        button("Later",index===order.length-1,()=>{order.splice(index,1);order.splice(index+1,0,id);});
        button("Remove",false,()=>order.splice(index,1));
      }
      list.append(row);
    }
    saveButton.disabled=writing || !order.length || JSON.stringify(order)===JSON.stringify(data.selected);
  }
  get("edit-photos").onclick=async ()=>{
    if(Object.keys(patch()).length){get("editor-status").textContent="Save your listing edits before changing photos.";return;}
    item=current; const turn=++generation;
    data=null; thumbnails.clear(); list.replaceChildren(); previousButton.hidden=true;
    saveButton.disabled=true; message.textContent="Loading prepared photos…";dialog.showModal();
    try {
      const result=await rpc("studio_photo_choices",{p_item:item.id});
      if(turn!==generation)return;
      if(result.listing_revision!==item.revision)throw Error("Listing changed. Refresh inventory before editing photos.");
      data=result; order=[...data.selected];previousButton.hidden=!data.previous;
      message.textContent=data.choices.length?"":"This product has no verified prepared photos yet.";
      draw();
      await Promise.allSettled(data.choices.map(async choice=>{
        const source=choice.source;
        const path=source.kind==="manufacturer" ? "reference/"+encodeURIComponent(item.id)+"/"+encodeURIComponent(source.id) : "photo/"+encodeURIComponent(source.sha);
        const result=await request("/functions/v1/studio-api/"+path);
        if(turn===generation && !writing){thumbnails.set(choice.id,result.url);draw();}
      }));
    } catch(error){if(turn===generation)message.textContent=error.message;}
  };
  previousButton.onclick=()=>{if(data?.previous){order=[...data.previous];draw();}};
  get("cancel-photos").onclick=()=>{if(!writing)dialog.close();};
  dialog.oncancel=event=>{if(writing)event.preventDefault();};
  dialog.onclose=()=>{generation++;thumbnails.clear();};
  saveButton.onclick=async ()=>{
    if(writing || !data)return;
    writing=true;previousButton.disabled=true;draw();message.textContent="Saving photos…";
    try {
      await rpc("studio_save_photo_choices",{p_item:item.id,p_listing_revision:data.listing_revision,p_photo_revision:data.revision,p_choices:order});
      saveButton.disabled=true;
      dialog.close();
      await refresh();openItem(items.find(i=>i.id===item.id));
      get("editor-status").textContent="Photos saved. Review the updated Facebook draft before approval.";
    } catch(error){if(dialog.open)message.textContent=error.message;else get("editor-status").textContent="Photos saved. Refresh inventory to load the updated selection.";}
    finally{writing=false;previousButton.disabled=false;if(dialog.open)draw();}
  };
}

