'use strict';
// Runs only on the user-requested fresh sell form. Never clicks List or Save draft.
globalThis.CMMercariForm=(()=>{
 const visible=e=>!!e&&e.getClientRects().length>0;
 const text=e=>(e?.innerText||e?.textContent||'').trim();
 const wait=async(fn,label,ms=15000)=>{const start=Date.now();while(Date.now()-start<ms){const result=fn();if(result)return result;await new Promise(r=>setTimeout(r,120));}throw Error(label+' is unavailable.');};
 const test=id=>document.querySelector('[data-testid="'+id+'"]');
 const set=(e,value,blur=true)=>{if(!e||e.disabled)throw Error('A Mercari field is unavailable.');const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));if(blur)e.dispatchEvent(new Event('blur',{bubbles:true}));};
 const exact=(root,selector,label)=>[...root.querySelectorAll(selector)].find(e=>visible(e)&&text(e).toLowerCase()===String(label).trim().toLowerCase());
 async function category(path){
  if(!Array.isArray(path)||!path.length)throw Error('Choose an imported Mercari category in Studio.');
  test('SellCategoryFieldButton').click();
  for(const label of path){const b=await wait(()=>exact(document,'[data-testid="CategoryRow"]',label),'Category '+label);b.click();await new Promise(r=>setTimeout(r,220));}
  if(document.querySelector('[role="dialog"]'))throw Error('Mercari needs a more specific category.');
  if(!text(test('SellCategoryFieldButton')))throw Error('Category did not remain selected.');
 }
 async function brand(value){
  if(!value)return false;const e=test('Brand');if(!e)throw Error('Brand is unavailable.');e.focus();set(e,value,false);
  // Mercari accepts typed brands; never replace an unlisted brand with another option.
  if(e.value!==String(value))throw Error('Brand did not remain entered.');return true;
 }
 async function fixedPrice(){
  const toggle=test('SmartPricingButton');if(!toggle||toggle.getAttribute('aria-pressed')!=='true')return;
  toggle.click();
  await wait(()=>toggle.getAttribute('aria-pressed')!=='true'||exact(document,'[role="dialog"] button','Turn off'),'Fixed-price confirmation');
  const confirm=exact(document,'[role="dialog"] button','Turn off');if(confirm)confirm.click();
  await wait(()=>test('SmartPricingButton')?.getAttribute('aria-pressed')!=='true','Automatic price reductions to turn off');
 }
 async function shipping(values){
  if(!values||!['weight_oz','length_in','width_in','height_in'].every(k=>Number(values[k])>0))return false;
  const control=await wait(()=>test('SelectShipping')&&!test('SelectShipping').disabled&&test('SelectShipping'),'Shipping label');control.click();
  await wait(()=>test('EditShippingButton')||test('ItemWeightInPounds'),'Shipping measurements');
  if(test('EditShippingButton'))test('EditShippingButton').click();
  const pounds=await wait(()=>test('ItemWeightInPounds'),'Packed weight');
  const ounces=Math.ceil(Number(values.weight_oz));set(pounds,Math.floor(ounces/16));set(test('ItemWeightInOunces'),ounces%16);
  test('FitsInShoeboxNo').click();await wait(()=>test('InputLength'),'Package dimensions');
  set(test('InputLength'),values.length_in);set(test('InputWidth'),values.width_in);set(test('InputHeight'),values.height_in);
  const next=await wait(()=>test('SelectCarrierButton')&&!test('SelectCarrierButton').disabled&&test('SelectCarrierButton'),'Shipping services');next.click();return true;
 }
 async function fill(draft){
  await wait(()=>test('Title')&&test('Description')&&test('SellPhotoInput'),'Mercari form',25000);
  if(test('Title').value.trim()||test('Description').value.trim()||test('SellPhotoInput').files?.length)throw Error('This form already contains a draft. Open a fresh form from Studio to avoid overwriting it.');
  const warnings=[],done=[];
  const desired=String(draft.condition||'').trim();
  if(!['New','Like new','Good','Fair','Poor'].includes(desired))throw Error('Studio did not supply an approved Mercari condition.');
  const conditionRadio=()=>[...document.querySelectorAll('input[type="radio"]')].find(e=>{
   const l=e.closest('label')||(e.id&&document.querySelector('label[for="'+CSS.escape(e.id)+'"]'))||e.parentElement;
   const label=text(l).toLowerCase(),name=desired.toLowerCase();
   return (visible(e)||visible(l))&&!e.disabled&&label.startsWith(name);
  });
  await wait(conditionRadio,'Condition '+desired);
  if(!test('Price')||!test('Brand')||!test('SellCategoryFieldButton')||!test('SelectShipping'))throw Error('Mercari changed its listing form. No listing fields were filled.');
  await category(draft.category_path);done.push('Category');
  const radio=conditionRadio();if(!radio.checked)radio.click();await wait(()=>conditionRadio()?.checked,'Selected condition '+desired,4000);done.push('Condition');
  set(test('Title'),draft.title);done.push('Title');set(test('Description'),draft.description);done.push('Description');
  const transfer=new DataTransfer();
  for(const [i,p] of draft.files.entries()){
   const bytes=Uint8Array.from(atob(p.base64),c=>c.charCodeAt(0));transfer.items.add(new File([bytes],p.name||String(i+1)+'.jpg',{type:p.mime||'image/jpeg'}));
  }
  const input=test('SellPhotoInput');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));if(input.files.length!==draft.files.length)throw Error('Mercari did not accept every selected photo.');done.push('Photos ('+transfer.files.length+')');if(transfer.files.length===1)warnings.push('Only one photo was saved in the source inventory.');
  await new Promise(r=>setTimeout(r,500));set(test('Price'),draft.price);done.push('Price');
  try{await fixedPrice();}catch(e){warnings.push('Check Smart Pricing: '+e.message);}
  if(test('Title').value!==draft.title||test('Description').value!==draft.description||Number(test('Price').value.replace(/[^0-9.]/g,''))!==Number(draft.price))throw Error('Mercari did not retain all text fields. Check the form before continuing.');
  try{if(await shipping(draft.shipping)){done.push('Packed weight and dimensions');warnings.push('Choose the carrier/service in the shipping picker and confirm who pays shipping.');}
   else warnings.push('Review shipping; no complete packed-shipping preset was supplied.');}
  catch(e){warnings.push('Shipping needs attention: '+e.message);}
  // Enter brand last so subsequent automation does not dismiss a custom typed value.
  try{if(await brand(draft.brand))done.push('Brand');else warnings.push('Brand is missing from the source. Enter it in Mercari.');}catch{warnings.push('Enter the brand in Mercari.');}
  return {state:'filled',done,warnings};
 }
 async function importCategories(progress=()=>{}){
  await wait(()=>test('SellCategoryFieldButton')&&test('Title'),'Category picker',25000);
  if(test('Title').value.trim()||test('Description').value.trim())throw Error('Use a fresh blank Mercari form to import categories.');
  const rows=()=>[...document.querySelectorAll('[data-testid="CategoryRow"]')].filter(visible);
  const signature=()=>rows().map(text).join('|');
  const paths=[],seen=new Set();
  async function enter(prefix){
   const close=document.querySelector('[role="dialog"] button[aria-label="Close"]');if(close)close.click();
   if(rows().length){const cancel=[...document.querySelectorAll('[role="dialog"] button')].find(e=>/close|cancel/i.test(e.getAttribute('aria-label')||text(e)));if(cancel)cancel.click();}
   if(rows().length)throw Error('Close the category picker and restart the import.');
   test('SellCategoryFieldButton').click();await wait(()=>rows().length,'Category rows');
   for(const label of prefix){const before=signature();const button=exact(document,'[data-testid="CategoryRow"]',label);if(!button)throw Error('Category navigation changed at '+label);button.click();await wait(()=>signature()!==before,'Category '+label);}
  }
  // Determine branch/leaf from what the picker actually does, never from a decorative SVG.
  async function walk(prefix){
   if(prefix.length>6||paths.length>=6000)throw Error('Category tree exceeds supported size.');
   await enter(prefix);const names=rows().map(text).filter(name=>name&&!/^all\b/i.test(name));
   for(const label of names){
    const path=[...prefix,label],key=JSON.stringify(path);if(seen.has(key))continue;seen.add(key);
    await enter(prefix);const before=signature(),button=exact(document,'[data-testid="CategoryRow"]',label);if(!button)throw Error('Category row is unavailable: '+label);button.click();
    await wait(()=>!rows().length||signature()!==before,'Category '+label);
    if(rows().length)await walk(path);
    else{paths.push(path);await progress(paths.length,paths);}
   }
  }
  await walk([]);document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click();return paths;
 }
 return {fill,importCategories};
})();
