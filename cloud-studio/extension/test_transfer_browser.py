"""Run the installed MV3 handoff and form filler on isolated Studio/Facebook fixtures."""
import base64
import hashlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
from PIL import Image
from playwright.sync_api import sync_playwright

extension=Path(sys.argv[1]).resolve()
studio="https://crazymoe-marketplace-studio.vercel.app"
facebook="https://www.facebook.com/marketplace/create/item"
backend="https://sfheqjnxlkygjfohoybo.supabase.co"
form="""<!doctype html><main aria-label="Marketplace">
<label>Title<input aria-label="Title"></label><label>Price<input aria-label="Price"></label>
<label>Description<textarea aria-label="Description"></textarea></label>
<label>Condition<select aria-label="Condition"><option>Choose</option><option>New</option><option>Used - Good</option></select></label>
<input type="file" multiple accept="image/jpeg"><div id="photos"></div></main>
<script>document.querySelector('[type=file]').onchange=e=>{
 const root=document.querySelector('#photos');root.replaceChildren();
 for(const f of e.target.files){const img=document.createElement('img');img.alt='Listing photo';img.src=URL.createObjectURL(f);
 const b=document.createElement('button');b.setAttribute('aria-label','Remove photo');b.onclick=()=>{img.remove();b.remove();};root.append(img,b);}
};</script>"""
photos={}
for i,color in enumerate(["red","blue","green"]):
    out=io.BytesIO()
    Image.new("RGB",(80+i,60),color).save(out,format="JPEG")
    raw=out.getvalue()
    photos[str(i)]={"sha":hashlib.sha256(raw).hexdigest(),"bytes":len(raw),"b64":base64.b64encode(raw).decode()}
payloads={}
for index,(token,indices) in enumerate([("a"*64,["0","1"]),("b"*64,["2"])]):
    item={"id":"fixture-"+str(index),"title":"Draft "+str(index),"revision":index+1,
          "price":str(57+index),"description":"Distinct description "+str(index),
          "condition":["New","Used - Good"][index],"images":[{k:photos[i][k] for k in ("sha","bytes")} for i in indices]}
    payloads[token]={"item":item,"urls":[backend+"/fixture/"+i for i in indices]}
with sync_playwright() as p, tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile:
    ctx=p.chromium.launch_persistent_context(profile,channel="chromium",headless=True,executable_path=os.environ.get("STUDIO_TEST_CHROMIUM"),
        args=["--disable-background-networking",f"--disable-extensions-except={extension}",f"--load-extension={extension}"])
    try:
        w=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker")
        manifest=w.evaluate("chrome.runtime.getManifest().version")
        gallery=manifest.startswith("68.")
        extid=w.evaluate("chrome.runtime.id")
        # Pin outbound traffic in the isolated worker. Only two fake claims and their JPEGs can succeed.
        w.evaluate("""({payloads,photos,backend})=>{
          self.probeCalls=[];self.claims=new Set();
          self.fetch=async(url,opts={})=>{
            self.probeCalls.push(String(url));
            if(url===backend+'/functions/v1/studio-handoff'){
              const token=String(opts.headers.Authorization).slice(7);
              if(!payloads[token]||claims.has(token))return new Response(null,{status:409});
              claims.add(token);return Response.json(payloads[token]);
            }
            const file=Object.keys(photos).find(k=>url===backend+'/fixture/'+k);
            if(file!==undefined)return new Response(Uint8Array.from(atob(photos[file].b64),x=>x.charCodeAt(0)));
            throw Error('Unexpected network request');
          };
        }""",{"payloads":payloads,"photos":photos,"backend":backend})
        cursor={"batch_id":"office-history","item_id":"office-cursor"}
        w.evaluate("cursor=>chrome.storage.local.set({moeLocalCursor:cursor,lastDraft:{title:'Old electric bike'}})",cursor)
        if gallery:w.evaluate("cursor=>chrome.storage.local.set({moeNgkCursor:cursor})",cursor)
        page=ctx.new_page()
        def route(r):
            url=r.request.url
            if url==facebook:r.fulfill(content_type="text/html",body=form)
            elif url.startswith(studio+"/"):r.fulfill(content_type="text/html",body="<title>Transfer fixture</title>")
            else:r.abort()
        ctx.route("**/*",route)
        page.goto(studio+"/app/")
        if gallery:
            assert page.evaluate("id=>chrome.runtime.sendMessage(id,{type:'STUDIO_CHECK_HANDOFF'})",extid)=={"ready":True}
        def open_form(token):
            with ctx.expect_page() as opened:
                reply=page.evaluate("([id,token])=>chrome.runtime.sendMessage(id,{type:'STUDIO_APPROVED_DRAFT',token})",[extid,token])
            assert reply["ok"]
            tab=opened.value
            tab.wait_for_url(facebook)
            load=tab.get_by_role("button",name="Load next approved product")
            load.wait_for()
            return tab,load
        for token,data in payloads.items():
            tab,button=open_form(token)
            assert tab.get_by_label("Title",exact=True).input_value()==""
            # The batch uploader belongs to the extension. Put its picker first
            # in DOM order, as can happen while Facebook rebuilds its form.
            if not gallery:tab.locator("#cm-root").wait_for(state="attached")
            if not gallery:tab.evaluate("document.body.prepend(document.querySelector('#cm-root'))")
            button.click()
            tab.wait_for_function("""()=>document.querySelector('#__moe_local_batch__,#__moe_approved_panel__')?.innerText.includes('Verified cloud draft')""",timeout=20000)
            item=data["item"]
            for field in ["Title","Price","Description","Condition"]:
                assert tab.get_by_label(field,exact=True).input_value()==item[field.lower()]
            actual=tab.locator('main [type=file]').evaluate("""async el=>Promise.all([...el.files].map(async f=>({
              type:f.type,sha:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('')
            })))""")
            assert actual==[{"type":"image/jpeg","sha":v["sha"]} for v in item["images"]]
        tab,button=open_form("c"*64)
        tab.get_by_label("Title",exact=True).fill("Seller's existing draft")
        button.click()
        tab.wait_for_function("""()=>/Existing Facebook draft detected|existing draft is preserved/.test(document.querySelector('#__moe_local_batch__,#__moe_approved_panel__').innerText)""")
        assert tab.get_by_label("Title",exact=True).input_value()=="Seller's existing draft"
        state=w.evaluate("chrome.storage.local.get(['moeLocalCursor','moeLocalPending','moeLocalUnconfirmed'])")
        assert state=={"moeLocalCursor":cursor},state
        if gallery:assert w.evaluate("chrome.storage.local.get('moeNgkCursor')")=={"moeNgkCursor":cursor}
        calls=w.evaluate("probeCalls")
        assert len(calls)==5,calls
        print(json.dumps({"installed_version":manifest,"extension_id":extid,"distinct_drafts":2,"jpeg_hashes_verified":3,
             "seller_draft_preserved":True,"office_cursor_preserved":True,"cloud_and_facebook_fixtures":True}))
    finally:ctx.close()
