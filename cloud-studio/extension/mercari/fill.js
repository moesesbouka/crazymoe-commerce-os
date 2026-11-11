'use strict';
// Runs only on the user-requested fresh sell form. Never clicks List or Save draft.
globalThis.CMMercariForm=(()=>{
 const visible=e=>!!e&&e.getClientRects().length>0;
 const text=e=>(e?.innerText||e?.textContent||'').trim();
 const wait=async(fn,label,ms=15000)=>{const start=Date.now();while(Date.now()-start<ms){const result=fn();if(result)return result;await new Promise(r=>setTimeout(r,120));}throw Error(label+' is unavailable.');};
 const test=id=>document.querySelector('[data-testid="'+id+'"]');
 const set=(e,value)=>{if(!e||e.disabled)throw Error('A Mercari field is unavailable.');const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,String(value));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new Event('blur',{bubbles:true}));};
 const exact=(root,selector,label)=>[...root.querySelectorAll(selector)].find(e=>visible(e)&&text(e).toLowerCase()===String(label).trim().toLowerCase());
 async function category(path){
  if(!Array.isArray(path)||!path.length)throw Error('Choose an imported Mercari category in Studio.');
  test('SellCategoryFieldButton').click();
  for(const label of path){const b=await wait(()=>exact(document,'[data-testid="CategoryRow"]',label),'Category '+label);b.click();await new Promise(r=>setTimeout(r,220));}
  if(document.querySelector('[role="dialog"]'))throw Error('Mercari needs a more specific category.');
  if(!text(test('SellCategoryFieldButton')))throw Error('Category did not remain selected.');
 }
 async function brand(value){
  if(!value)return false;const e=test('Brand');set(e,value);
  const choice=await wait(()=>exact(document,'[role="option"],button,[role="listbox"] li',value)||exact(document,'li',value),'Brand '+value,5000);
  choice.click();return true;
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
  set(test('Title'),draft.title);set(test('Description'),draft.description);done.push('Title','Description');
  try{await category(draft.category_path);done.push('Category');}catch(e){warnings.push(e.message);document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click();}
  try{await brand(draft.brand);done.push('Brand');}catch{warnings.push('Select the brand in Mercari.');}
  const radio=[...document.querySelectorAll('[role="radiogroup"] input[type="radio"],input[type="radio"]')].find(e=>{
   const l=e.closest('label')||document.querySelector('label[for="'+e.id+'"]')||e.parentElement;return text(l).toLowerCase().startsWith(draft.condition.toLowerCase());
  });
  if(radio){radio.click();done.push('Condition');}else warnings.push('Select the condition in Mercari.');
  const transfer=new DataTransfer();
  for(const [i,p] of draft.files.entries()){
   const bytes=Uint8Array.from(atob(p.base64),c=>c.charCodeAt(0));transfer.items.add(new File([bytes],p.name||String(i+1)+'.jpg',{type:p.mime||'image/jpeg'}));
  }
  const input=test('SellPhotoInput');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));done.push('Photos ('+transfer.files.length+')');
  await new Promise(r=>setTimeout(r,500));set(test('Price'),draft.price);done.push('Price');
  if(test('Title').value!==draft.title||test('Description').value!==draft.description||Number(test('Price').value.replace(/[^0-9.]/g,''))!==Number(draft.price))throw Error('Mercari did not retain all text fields. Check the form before continuing.');
  try{if(await shipping(draft.shipping)){done.push('Packed weight and dimensions');warnings.push('Choose the carrier/service in the shipping picker and confirm who pays shipping.');}
   else warnings.push('Review shipping; no complete packed-shipping preset was supplied.');}
  catch(e){warnings.push('Shipping needs attention: '+e.message);}
  return {state:warnings.length?'needs_attention':'filled',done,warnings};
 }
 async function importCategories(progress=()=>{}){
  await wait(()=>test('SellCategoryFieldButton'),'Category picker');
  if(test('Title').value.trim()||test('Description').value.trim())throw Error('Use a fresh blank Mercari form to import categories.');
  test('SellCategoryFieldButton').click();await wait(()=>document.querySelector('[data-testid="CategoryRow"]'),'Category rows');
  const paths=[];
  async function walk(prefix){
   if(prefix.length>6||paths.length>6000)throw Error('Category import exceeded its expected size.');
   const rows=[...document.querySelectorAll('[data-testid="CategoryRow"]')].filter(visible).map(e=>({name:text(e),branch:!!e.querySelector('svg')}));
   for(const row of rows){
    if(row.branch){exact(document,'[data-testid="CategoryRow"]',row.name).click();await new Promise(r=>setTimeout(r,180));await walk([...prefix,row.name]);
     const back=[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.getAttribute('aria-label')==='Back'||text(e)==='Back');if(!back)throw Error('Mercari category navigation changed.');back.click();await new Promise(r=>setTimeout(r,180));
    }else{paths.push([...prefix,row.name]);progress(paths.length);}
   }
  }
  await walk([]);document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click();return paths;
 }
 return {fill,importCategories};
})();
