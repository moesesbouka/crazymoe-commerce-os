"use strict";
const $=id=>document.getElementById(id);
const state={items:[],view:"all",query:"",csrf:"",detail:null,base:null,photoIndex:0,busy:false,dirty:false,request:0,inventoryFresh:false,navOrder:[],reloadRequired:false};
const selectedProducts=new Set();
let batchBusy=false;
const names={all:"All products",review:"Review queue",blocked:"Needs attention",identity:"Identity holds",seller:"Seller inputs",ready:"Ready to list",listed:"Inventory"};
const textFields=["title","price","condition","model","description","source_url","notes"];
function el(tag,cls,content){const n=document.createElement(tag);if(cls)n.className=cls;if(content!==undefined)n.textContent=content;return n;}
function message(t){$("message").textContent=t;$("message").hidden=!t;}
async function api(path,body){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
 try{const r=await fetch(path,{method:body===undefined?"GET":"POST",credentials:"same-origin",cache:"no-store",
 headers:body===undefined?{}:{"Content-Type":"application/json","X-Moe-CSRF":state.csrf},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
 if(r.status===401){location.assign("/login");throw Error("Sign in to continue");}
 const data=await r.json();if(!r.ok)throw Error(data.error||"Request failed");return data;
 }catch(e){if(e.name==="AbortError")throw Error("The office took too long to respond. Retry shortly.");throw e;}finally{clearTimeout(timer);}
}
function photoURL(p){return p.kind==="real"?"/api/photo/"+encodeURIComponent(p.sha):"/api/stock/"+encodeURIComponent(p.id);}
function publicReferenceURL(raw){
 // Product sources are deliberate external clicks, never automatic lookups.
 // Do not turn private/local URLs or embedded credentials into clickable links.
 try{
  const url=new URL(String(raw||""));
  // DNS treats trailing dots as equivalent; normalize before private-host checks.
  // Bare single-label hosts are intranet names, not public product sources.
  const host=url.hostname.toLowerCase().replace(/\.+$/, "");
  if(url.protocol!=="https:"||url.username||url.password||!host||!host.includes(".")||host==="localhost"||
     host.endsWith(".local")||host.endsWith(".localhost")||host.endsWith(".lan")||
     host.endsWith(".home.arpa")||host.endsWith(".internal")||host.endsWith(".ts.net")||host.includes(":")||
     /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))return "";
  return url.href;
 }catch(_){return "";}
}
function compactSearch(value){return String(value||"").normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");}
function listingPriceLabel(value){const raw=String(value??"").trim();return !raw?"Set price":!validSellerPrice(raw)?"Check price":(raw.startsWith("$")?raw:"$"+raw);}
function validSellerPrice(value){
 const raw=String(value??"").trim().replace(/^\$\s*/,"");
 return /^(?:[0-9]{1,12}|[0-9]{1,3}(?:,[0-9]{3}){1,3})(?:\.[0-9]{1,2})?$/.test(raw)&&Number(raw.replace(/,/g,""))>0;
}
function sellerInputIssues(g){
 const f=g.fields||{},raw=String(f.price??"").trim(),issues=[];
 if(!raw)issues.push("Set seller price");
 else if(!validSellerPrice(f.price))issues.push("Correct invalid price");
 if(!String(f.condition??"").trim())issues.push("Choose seller condition");
 return issues;
}
function needsSellerInput(g){return sellerInputIssues(g).length>0;}
function isIdentityHold(g){return (g.visual_recognition||{}).status!=="verified_exact";}
function identityHoldReason(g){
 const category=String((g.visual_recognition||{}).category||"").trim();
 return "Physical identity unverified · "+(category||"Confirm exact model or UPC against the actual item");
}
function filtered(){
 const query=state.query.trim().toLowerCase(),compact=compactSearch(query);
 return state.items.filter(g=>{
  const viewMatch=state.view==="all"||(state.view==="identity"?isIdentityHold(g):state.view==="seller"?needsSellerInput(g):g.diagnostics.state===state.view);
  if(!viewMatch)return false;
  const source=g.catalog_match||{},visual=g.visual_recognition||{};
  const haystack=JSON.stringify([g.id,g.fields,g.barcode,g.model_number,source.brand,source.model,source.sku,visual.category]).toLowerCase();
  return !query||haystack.includes(query)||(compact&&compactSearch(haystack).includes(compact));
 });
}
function updateBulk(){
 // A search/view change must not leave an unseen product in the next
 // Facebook handoff. Selection is scoped to the currently visible ready cards.
 const available=state.view==="ready"?filtered().filter(g=>g.diagnostics.state==="ready"):[];
 const visible=new Set(available.map(g=>g.id));
 for(const id of selectedProducts)if(!visible.has(id))selectedProducts.delete(id);
 $("bulk").hidden=state.view!=="ready";
 $("bulk-count").textContent=selectedProducts.size+" selected";
 $("bulk-prepare").disabled=batchBusy||!selectedProducts.size;
 $("bulk-all").checked=available.length>0&&available.every(g=>selectedProducts.has(g.id));
}
function render(){
 $("view-title").textContent=names[state.view];
 const items=filtered();$("results").textContent=items.length+" products · "+(state.inventoryFresh?"live office inventory":navigator.onLine?"last-loaded inventory · office connection unverified":"offline snapshot · reconnect to refresh");
 $("cards").replaceChildren();
 for(const g of items){
 const wrapper=el("div","card-wrap");const card=el("button","card");card.type="button";card.setAttribute("aria-label","Review "+(g.fields.title||"Unidentified product"));
 const image=el("div","image");const p=(g.listing_photos||[])[0];
 if(p){const im=el("img");im.src=photoURL(p);im.alt=g.fields.title||"Product photo";im.loading="lazy";image.append(im);}
 else image.append(el("span","muted","No listing photo"));
 if(state.view==="ready"){
 const selection=el("label","bulk-check");const cb=el("input");cb.type="checkbox";cb.checked=selectedProducts.has(g.id);
 cb.setAttribute("aria-label","Select "+(g.fields.title||"product"));
 cb.addEventListener("click",e=>e.stopPropagation());
 cb.addEventListener("change",()=>{if(cb.checked&&selectedProducts.size>=30){cb.checked=false;message("Choose up to 30 products per batch.");return;}cb.checked?selectedProducts.add(g.id):selectedProducts.delete(g.id);updateBulk();});
 selection.append(cb,el("span","","Select"));wrapper.append(selection);
}
 const b=el("div","body");b.append(el("span","chip "+g.diagnostics.state,g.diagnostics.state==="blocked"?"Needs attention":g.diagnostics.state==="review"?"Review":g.diagnostics.state));
 b.append(el("h3","",g.fields.title||"Unidentified product"));
 b.append(el("p","reason",state.view==="identity"?identityHoldReason(g):state.view==="seller"?sellerInputIssues(g).join(" · "):g.diagnostics.state==="ready"?"Seller approved · ready for handoff":g.diagnostics.reason));
 const bottom=el("div","card-bottom");bottom.append(el("span","price",listingPriceLabel(g.fields.price)),el("span","photo-count",g.diagnostics.photo_count+" photos"));
 b.append(bottom);card.append(image,b);card.addEventListener("click",()=>openItem(g.id));wrapper.append(card);$("cards").append(wrapper);
 }
 if(!items.length)$("cards").append(el("div","empty","No products in this view."));
 document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===state.view));
 updateBulk();
}
async function refresh(){
 let data;
 try{data=await api("/api/studio/groups");}catch(e){
  state.inventoryFresh=false;render();throw e;
 }
 state.inventoryFresh=true;state.items=data.items;
 for(const id of selectedProducts)if(!state.items.some(g=>g.id===id&&g.diagnostics.state==="ready"))selectedProducts.delete(id);
 for(const key of ["total","ready","blocked","review"])$(key).textContent=key==="total"?data.summary.products:data.summary[key];
 $("count-all").textContent=data.summary.products;
 $("count-identity").textContent=state.items.filter(isIdentityHold).length;
 $("count-seller").textContent=state.items.filter(needsSellerInput).length;
 for(const key of ["ready","blocked","review","listed"])$("count-"+key).textContent=data.summary[key];
 render();
 // A save or office refresh can change readiness while the editor remains
 // open. Do not leave a stale "Missing price/photo" message after a fix.
 if(state.detail&&$("editor").open){
  const latest=state.items.find(x=>x.id===state.detail.id);
  if(latest){
   if(latest.revision===state.detail.revision){
    state.detail.diagnostics=latest.diagnostics;diagnostics(state.detail);
    $("edit-title").textContent=state.detail.fields.title||"Unidentified product";
   }else{
    $("editor-status").textContent="Office product data changed while this editor was open. Close and reopen it to review the latest information before saving or approving.";
   }
  }
 }
}
function diagnostics(g){
 const d=g.diagnostics||{blockers:[],research:[]};
 $("diagnostics").replaceChildren();
 $("diagnostics").append(el("strong","",d.state==="ready"?"Approved listing":d.blockers.length?"Complete before approving":"Ready for your review"));
 for(const t of [...d.blockers,...d.research])$("diagnostics").append(el("p","",t));
}
function renderIdentityEvidence(g){
 const panel=$("identity-evidence"),body=$("identity-evidence-body");
 body.replaceChildren();
 const fields=g.fields||{},catalog=g.catalog_match||{},visual=g.visual_recognition||{};
 panel.open=visual.status!=="verified_exact";
 function row(label,value){
  if(!value)return;
  const wrap=el("div","identity-row");
  wrap.append(el("strong","",label),el("span","",String(value)));
  body.append(wrap);
 }
if(visual.status==="verified_exact"&&catalog.model){
  row("Verified catalog model",catalog.model);
  if(fields.model&&compactSearch(fields.model)!==compactSearch(catalog.model))
   row("Listing model (check against physical label)",fields.model);
 }else row("Recorded model",fields.model||g.model_number||"Not confirmed");
 row("Scanned UPC candidate",g.barcode||"None recorded");
 const method={upc:"UPC-based candidate",model:"Model-based candidate",visual_review:"Visual-review candidate"};
 row("Identification basis",method[g.identity_method]||"Not confirmed");
 if(catalog.brand||catalog.model){
  row("Catalog reference",[catalog.brand,catalog.model].filter(Boolean).join(" ")+" (cross-check against the physical item)");
 }
 if(visual.status)row("Recorded review status",String(visual.status).replaceAll("_"," "));
 if(visual.status!=="verified_exact"){
  row("Identity under review",visual.category||"Exact model/UPC not yet confirmed");
  row("Recorded inspection findings",visual.notes||"No physical identity inspection notes recorded yet");
 }
 body.append(el("p","identity-caveat","Research links are candidates, not proof of included accessories, condition or exact identity. Confirm the actual label and photos before approval."));
 const refs=Array.isArray(visual.candidates)?visual.candidates.slice(0,32):[];
 let shown=0,more=null,extra=0;
 for(const candidate of refs){
  if(!candidate||typeof candidate.url!=="string")continue;
  // Reuse the stricter manufacturer reference policy: owner-triggered
  // public HTTPS only, never private hosts or embedded credentials.
  // Rejected candidates must not use up the four visible source slots.
  const sourceURL=publicReferenceURL(candidate.url);
  if(!sourceURL)continue;
  const wrap=el("div","identity-source");
  wrap.append(el("span","",String(candidate.title||"Product reference").slice(0,175)));
  const a=el("a","","Open source");
  a.href=sourceURL;a.target="_blank";a.rel="noopener noreferrer";a.referrerPolicy="no-referrer";
  wrap.append(a);
  if(candidate.basis)wrap.append(el("p","identity-note",String(candidate.basis).slice(0,160)));
  if(shown<4)body.append(wrap);
  else{
   if(!more){more=el("details","identity-more");more.append(el("summary","",""));body.append(more);}
   more.append(wrap);extra++;
  }
  shown++;
 }
 if(more)more.querySelector("summary").textContent="Show "+extra+" more recorded source"+(extra===1?"":"s")+" (research only)";
 if(Array.isArray(visual.candidates)&&visual.candidates.length>refs.length)
  body.append(el("p","identity-caveat","Only the first 32 recorded reference candidates are shown."));
 if(!shown)body.append(el("p","identity-caveat","No verified external evidence links recorded for this item."));
}
function showPhotos(){
 const g=state.detail;if(!g)return;
 const photos=g.listing_photos||[];
 state.photoIndex=Math.max(0,Math.min(state.photoIndex,photos.length-1));
 $("hero").hidden=!photos.length;
 if(photos.length)$("hero").src=photoURL(photos[state.photoIndex]);
 $("thumbs").replaceChildren();
 photos.forEach((p,i)=>{
 const b=el("button","thumb"+(i===state.photoIndex?" selected":""));b.type="button";
 const img=el("img");img.src=photoURL(p);img.alt="Photo "+(i+1);
 b.append(img,el("span","",i===0?"Cover":p.kind==="real"?"Actual":"Stock"));
 b.addEventListener("click",()=>{state.photoIndex=i;showPhotos();});$("thumbs").append(b);
 });
 const selected=photos[state.photoIndex];
 $("set-cover").disabled=!selected||selected.kind!=="real"||state.busy||state.reloadRequired;
 $("move-left").disabled=!selected||selected.kind!=="real"||state.photoIndex<1||state.busy||state.reloadRequired;
 $("move-right").disabled=!selected||selected.kind!=="real"||!photos[state.photoIndex+1]||photos[state.photoIndex+1].kind!=="real"||state.busy||state.reloadRequired;
 $("stock-options").replaceChildren();
 const refs=g.manufacturer_images||[];
 const real=g.listing_photos.filter(p=>p.kind==="real");
 const remaining=Math.max(0,10-real.length);
 const selectedSet=new Set(g.fields.manufacturer_selected||[]);
 const includedSet=new Set(g.listing_photos.filter(p=>p.kind==="stock"||p.kind==="manufacturer").map(p=>p.id));
 if(!refs.length)$("stock-options").append(el("p","muted","No manufacturer photos sourced yet. This is tracked as a research gap."));
 else{
  const note=el("p","muted",includedSet.size+" manufacturer photo(s) included; "+remaining+" slot(s) available after actual photos (10-photo maximum).");
  const hidden=[...selectedSet].filter(id=>!includedSet.has(id)).length;
  if(hidden)note.textContent+=" "+hidden+" previously selected reference(s) not currently included (source unavailable or photo limit); choices remain saved.";
  if(!remaining)note.textContent+=" All 10 slots are occupied by actual photos; no stock photo can be added without changing the photo group.";
  $("stock-options").append(note);
 }
 refs.forEach(ref=>{
  const row=el("div","stock-reference");
  const lab=el("label","stock-option");const cb=el("input");cb.type="checkbox";cb.disabled=state.busy||state.reloadRequired;cb.checked=selectedSet.has(ref.id);
  const img=el("img");img.src="/api/stock/"+encodeURIComponent(ref.id);img.alt=ref.label||"Product reference";
  lab.append(cb,img,el("span","",ref.label||"Product reference"));row.append(lab);
  const source=el("div","stock-source");
  source.append(el("span","",includedSet.has(ref.id)?"Included in listing":selectedSet.has(ref.id)?"Selected but excluded by the 10-photo limit":"Reference only · not selected"));
  const url=publicReferenceURL(ref.source_url);
  if(url){
   const link=el("a","","View recorded photo source");link.href=url;link.target="_blank";
   link.rel="noopener noreferrer";link.referrerPolicy="no-referrer";source.append(link);
  }else source.append(el("span","muted","No public source link recorded"));
  row.append(source);$("stock-options").append(row);
  cb.addEventListener("change",()=>{
   const selected=new Set(g.fields.manufacturer_selected||[]);
   // Never silently save a checked stock reference that cannot enter the
   // ten-photo listing; preserve the owner's existing choices unchanged.
   // A saved choice for a temporarily unavailable source is not a visible
   // gallery image and must not consume one of the current photo slots.
   // Preserve that dormant choice while permitting valid newly sourced photos.
   const visibleSelected=refs.filter(r=>selected.has(r.id)).length;
   if(cb.checked&&!selected.has(ref.id)&&visibleSelected>=remaining){
    cb.checked=false;
    $("editor-status").textContent="No photo was added: "+(remaining===0
     ?"all 10 listing slots contain actual product photos."
     :"only "+remaining+" manufacturer-photo slot(s) fit. Unselect another reference first.");
    return;
   }
   cb.checked?selected.add(ref.id):selected.delete(ref.id);
   g.fields.manufacturer_selected=[...selected];
   // Newly discovered source photos must not reorder previously selected listing images.
   const rank=new Map([...selected].map((id,i)=>[id,i]));
   const ordered=refs.filter(r=>selected.has(r.id)).sort((a,b)=>rank.get(a.id)-rank.get(b.id));
   g.listing_photos=[...real,...ordered.slice(0,remaining).map(r=>({kind:"manufacturer",id:r.id}))];
   $("editor-status").textContent="";
   state.dirty=true;showPhotos();
  });
 });
}
async function openItem(id){
 if(state.dirty&&!window.confirm("Discard unsaved changes?"))return;
 const seq=++state.request;
 const navigationOrder=filtered().map(x=>x.id);
 try{
 const g=await api("/api/item/"+encodeURIComponent(id));if(seq!==state.request)return;
 state.navOrder=navigationOrder.includes(id)?navigationOrder:[...navigationOrder,id];
 g.diagnostics=state.items.find(x=>x.id===id)?.diagnostics;
 state.detail=g;state.base=structuredClone(g);state.photoIndex=0;state.dirty=false;state.reloadRequired=false;
 $("edit-title").textContent=g.fields.title||"Unidentified product";
 for(const name of textFields){
 const input=$("edit-form").elements.namedItem(name),v=String(g.fields[name]||"");
 if(name==="condition"&&v&&![...input.options].some(o=>o.value===v)){const o=el("option","",v);o.value=v;input.append(o);}
 // Never infer "New": a blank condition is a required seller decision.
 input.value=v;
 }
 $("editor-status").textContent="";
 $("queue").hidden=!g.approval.approved;$("approve").hidden=!!g.approval.approved;
 diagnostics(g);renderIdentityEvidence(g);showPhotos();if(!$("editor").open)$("editor").showModal();
 if(!state.busy)setBusy(false);
 }catch(e){message(e.message);}
}
function updateOrder(){
 const g=state.detail;const real=g.listing_photos.filter(p=>p.kind==="real");
 if(real.length)g.fields.cover=real[0].sha;
 const shas=real.map(p=>p.sha);
 g.fields.photo_order=[...shas,...(state.base.real_photos||[]).map(p=>p.sha).filter(s=>!shas.includes(s))];
 state.dirty=true;showPhotos();
}
function movePhoto(delta){
 const list=state.detail.listing_photos,i=state.photoIndex,j=i+delta;
 if(j<0||j>=list.length||list[i].kind!=="real"||list[j].kind!=="real")return;
 [list[i],list[j]]=[list[j],list[i]];state.photoIndex=j;updateOrder();
}
function setBusy(b){
 state.busy=b;
 // An acknowledged POST followed by a failed reload must never submit the
 // same stale revision again. Keep Close/Skip available for recovery.
 const locked=b||state.reloadRequired;
 for(const id of ["save","save-next","approve","queue"])$(id).disabled=locked;
 for(const id of ["skip","close"])$(id).disabled=b;
 $("edit-form").querySelectorAll("input,textarea,select").forEach(n=>n.disabled=locked);
 showPhotos();
}
async function saveChanges(){
 if(state.reloadRequired)throw Error("The office accepted your last save, but a fresh product revision is required. Close and reopen this item after reconnecting.");
 const g=state.detail,base=state.base,payload={expected_revision:base.revision};
 for(const key of textFields){
 const value=$("edit-form").elements.namedItem(key).value;
 if(value!==String(base.fields[key]||""))payload[key]=value;
 }
 for(const key of ["cover","photo_order","manufacturer_selected"]){
 if(JSON.stringify(g.fields[key])!==JSON.stringify(base.fields[key]))payload[key]=g.fields[key];
 }
 if(Object.keys(payload).length>1){
 await api("/api/item/"+g.id,payload);
 // POST succeeded; if this separate GET fails, the edit may already be
 // committed. Never retry a stale revision or tell the owner it was unsaved.
 let fresh;
 try{fresh=await api("/api/item/"+g.id);}
 catch(e){
  state.reloadRequired=true;state.dirty=false;
  throw Error("Your changes were accepted by the office, but the latest product could not be reloaded. Close and reopen this product after reconnecting before editing or approving. "+e.message);
 }
 fresh.diagnostics=g.diagnostics;state.detail=fresh;state.base=structuredClone(fresh);state.dirty=false;
 $("queue").hidden=!fresh.approval.approved;$("approve").hidden=!!fresh.approval.approved;
  return true;
 }
 // A user can type and undo a change, or tap the already-selected cover.
 // A no-op Save must not trap them in an unnecessary "unsaved" warning.
 state.detail=structuredClone(state.base);state.dirty=false;showPhotos();
 return false;
}
async function action(fn){
 if(state.busy)return;setBusy(true);$("editor-status").textContent="";
 try{await fn();}catch(e){$("editor-status").textContent=e.message;}finally{setBusy(false);}
}
async function nextItem(){
 const items=filtered(),current=state.detail?.id;
 const eligible=new Set(items.map(g=>g.id));
 const order=state.navOrder||[];
 const i=order.indexOf(current);
 let next=null;
 // The saved/approved item may disappear from its queue before the user
 // presses Skip or Approve & next. Preserve its position in the prior order.
 if(i>=0)for(let step=1;step<order.length;step++){
  const candidate=order[(i+step)%order.length];
  if(eligible.has(candidate)){next=items.find(g=>g.id===candidate);break;}
 }
 // Fallback for items newly added since the editor opened.
 if(!next)next=items.find(g=>g.id!==current);
 state.dirty=false;
 if(next)await openItem(next.id);else $("editor").close();
}
$("edit-form").addEventListener("input",e=>{
 // Manufacturer checkboxes commit only from their validated change handler.
 // A rejected selection must not create a phantom unsaved-edit warning.
 if(e.target.closest("#stock-options"))return;
 state.dirty=true;
});
$("edit-form").addEventListener("submit",e=>{e.preventDefault();void action(async()=>{
 const saved=await saveChanges();await refresh();
 if(!$("editor-status").textContent.includes("Office product data changed"))
  $("editor-status").textContent=saved?"Changes saved.":"No changes to save.";
});});
// Save successfully, refresh server-owned readiness, then advance through the
// original queue order. If a write/refresh fails, stay on the same item.
$("save-next").addEventListener("click",()=>void action(async()=>{
 // An invalid typed price must not be stored and silently skipped into
 // the next seller-input card. Blank price remains allowed for partial edits.
 const price=$("edit-form").elements.namedItem("price").value.trim();
 if(price&&!validSellerPrice(price))
  throw Error("Correct seller price before Save & next. Enter a positive dollar amount such as 99.99, or leave it blank until known.");
 await saveChanges();await refresh();await nextItem();
}));
$("approve").addEventListener("click",()=>void action(async()=>{
 await saveChanges();const g=state.detail;
 await api("/api/approve/"+g.id,{confirm_group:true,confirm_identity:true,expected_revision:g.revision});
 await refresh();await nextItem();
}));
$("queue").addEventListener("click",()=>void action(async()=>{
 if(state.reloadRequired)throw Error("Reopen this product to confirm its latest revision before Facebook handoff.");
 if(state.dirty)throw Error("Save your edits and approve the updated product before preparing a handoff.");
 const g=state.detail;const r=await api("/api/batch/prepare",{items:[{id:g.id,revision:g.revision}]});
 if(!r.ok)throw Error((r.blocked||[]).map(x=>x.reason).join("; ")||r.message);
 $("editor-status").textContent="Prepared "+r.prepared+" product for the paired office extension. Open a blank Facebook listing and choose Load next approved product. Nothing has been published.";
}));
$("set-cover").addEventListener("click",()=>{const g=state.detail;const [p]=g.listing_photos.splice(state.photoIndex,1);g.listing_photos.unshift(p);state.photoIndex=0;updateOrder();});
$("move-left").addEventListener("click",()=>movePhoto(-1));$("move-right").addEventListener("click",()=>movePhoto(1));
$("skip").addEventListener("click",()=>{if(!state.dirty||window.confirm("Discard unsaved changes and skip?"))void nextItem();});
function closeEditor(){if(state.busy)return;if(state.dirty&&!window.confirm("Discard unsaved changes?"))return;state.dirty=false;state.request++;$("editor").close();}
$("close").addEventListener("click",closeEditor);$("editor").addEventListener("cancel",e=>{e.preventDefault();closeEditor();});
$("search").addEventListener("input",e=>{state.query=e.target.value;render();});
document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>{state.view=b.dataset.view;render();}));
$("refresh").addEventListener("click",()=>refresh().then(()=>message("Office inventory refreshed.")).catch(e=>message("Office inventory unavailable. Retry after reconnecting: "+e.message)));
$("bulk-all").addEventListener("change",e=>{
 const available=filtered().filter(g=>g.diagnostics.state==="ready");
 selectedProducts.clear();if(e.target.checked)available.slice(0,30).forEach(g=>selectedProducts.add(g.id));
 render();
});
$("bulk-prepare").addEventListener("click",async()=>{
 if(batchBusy||!selectedProducts.size)return;
 batchBusy=true;updateBulk();
 try{
 const items=state.items.filter(g=>selectedProducts.has(g.id)).map(g=>({id:g.id,revision:g.revision}));
 const result=await api("/api/batch/prepare",{items});
 if(!result.ok)throw Error((result.blocked||[]).map(x=>(x.title||x.id)+": "+x.reason).join("; ")||result.message);
 message(result.prepared+" approved products prepared for the paired office extension. Open Facebook and choose Load next approved product. Nothing has been published.");
 selectedProducts.clear();render();
 }catch(e){message(e.message);}finally{batchBusy=false;updateBulk();}
});
window.addEventListener("offline",()=>{
 state.inventoryFresh=false;render();
 message("Phone offline. Product cards are a last-loaded snapshot. Reconnect before saving or approving.");
});
window.addEventListener("online",()=>{
 message("Phone network restored. Checking the private office connection...");
 void refresh().then(()=>message("Office inventory reconnected."))
  .catch(e=>message("Office inventory still unavailable: "+e.message));
});
window.addEventListener("beforeunload",e=>{if(state.dirty){e.preventDefault();e.returnValue="";}});
(async()=>{try{const me=await api("/api/me");state.csrf=me.csrf;await refresh();}catch(e){message(e.message);$("results").textContent="Inventory unavailable";}})();
