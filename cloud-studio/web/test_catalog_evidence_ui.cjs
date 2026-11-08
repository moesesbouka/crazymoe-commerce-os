const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=__dirname;

test('mobile and desktop evidence recording preserves seller edits',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  for(const width of [390,1280]){
   let evidenceCalls=0,statusCalls=0;
   const item={id:'fixture',lifecycle:'current',fields:{title:'Fixture product',price:'50',condition:'New'},revision:1,status:'review',
    photo_selection:[],exports_verified:false,identity_revision:3,research:{catalog_match:{brand:'Fixture brand',model:'F-1'}},catalog_evidence:[]};
   const context=await browser.newContext({viewport:{width,height:850}});
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='studio-fixture.invalid'){
     const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
     if(file==='auth.js') return route.fulfill({contentType:'text/javascript',body:"globalThis.studioAuth={auth:{initialize:async()=>({}),getSession:async()=>({data:{session:{access_token:'synthetic'}}}),onAuthStateChange:()=>{}}};"});
     const body=fs.readFileSync(path.join(root,file));
     return route.fulfill({body,contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
    }
    if(url.pathname.endsWith('/studio_state')) return route.fulfill({json:[item]});
    if(url.pathname.endsWith('/studio_render_status')){statusCalls++;return route.fulfill({json:{state:'ready',revision:1,photo_revision:1}});}
    if(url.pathname.endsWith('/studio_add_catalog_evidence')){
     const body=route.request().postDataJSON();
     assert.equal(body.p_listing_revision,1);assert.equal(body.p_identity_revision,3);assert.equal(body.p_source_kind,'retailer');
     assert.equal(body.p_url,'https://retailer.example/product');evidenceCalls++;
     item.catalog_evidence=[{id:1,source_kind:'retailer',url:body.p_url,product_name:body.p_product_name,brand:body.p_brand,model:body.p_model,based_on_listing_revision:1}];
     return route.fulfill({json:{id:1}});
    }
    return route.abort();
   });
   const page=await context.newPage();page.setDefaultTimeout(5000);await page.goto('https://studio-fixture.invalid/');
   await page.locator('.inventory-card').click();await page.locator('.catalog-evidence summary').click();
   await page.locator('#catalog-kind').selectOption('retailer');await page.locator('#catalog-url').fill('https://retailer.example/product');
   await page.locator('[name=title]').fill('Unsaved seller title');await page.locator('#record-catalog-evidence').click();
   await page.getByText('Save your listing edits before recording evidence.',{exact:true}).waitFor();assert.equal(evidenceCalls,0);
   assert.equal(await page.locator('[name=title]').inputValue(),'Unsaved seller title');
   await page.locator('[name=title]').fill('Fixture product');await page.locator('#record-catalog-evidence').click();
   await page.getByText('Evidence recorded without changing the listing.',{exact:true}).waitFor();
   assert.equal(evidenceCalls,1);assert.equal(await page.locator('[name=title]').inputValue(),'Fixture product');
   assert.equal(await page.locator('.catalog-record').count(),1);assert.ok(statusCalls>=2);
   await context.close();
  }
 } finally {await browser.close();}
});
