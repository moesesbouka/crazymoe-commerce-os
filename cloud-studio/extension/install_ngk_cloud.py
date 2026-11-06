"""Upgrade the exact NGK gallery extension, retaining its office pairing and gallery flows."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

target = Path(sys.argv[1]).resolve()
source = Path(__file__).resolve().parent
expected = {
    "manifest.json":"5a9bfcbc6009980f19e4404bd39ccefbbd6e68336dd73de97bbfb4b1cd38346c",
    "background.js":"d58a1dd309a0fa60a256fcd7ed3e0076ecac863cdfc8f86539f2ebea89003988",
    "explicit_listing_fill.js":"47925dfe85c5c16bddff7b0e24316926439c4433c185d0590ceba11c7637fc0d",
    "approved_batch_panel.js":"e8a4e2bad4311c73b32536b36b9a7390576bf357213df9b3a0166d3a890a9e41",
}
names = [*expected, "cloud_handoff.js", "ngk_cloud_worker.js"]
original = {name:(target/name).read_bytes() if (target/name).exists() else None for name in names}
for name, data in original.items():
    if (hashlib.sha256(data).hexdigest() if data is not None else None) != expected.get(name):
        sys.exit("Review changed file before applying: "+name)

def replace_once(text, before, after):
    if text.count(before) != 1:
        sys.exit("Extension source differs")
    return text.replace(before, after)

panel = original["approved_batch_panel.js"].decode("utf-8-sig").replace("\r\n","\n")
panel = replace_once(panel, 'studio.onclick=()=>window.open("https://desktop-b3a97cu.tailac0bf8.ts.net/studio"', 'studio.onclick=()=>window.open("https://crazymoe-marketplace-studio.vercel.app/app/"')
panel = replace_once(panel, 'load.onclick=()=>{', 'load.onclick=async ()=>{')
panel = replace_once(panel, 'chrome.runtime.sendMessage({type:"MOE_NGK_NEXT"}', '''try {
    const mode=await chrome.runtime.sendMessage({type:"STUDIO_TRANSFER_MODE"});
    if(!mode?.ok)throw Error("Reopen the Facebook form from Studio.");
    if(mode.cloud){
      const result=await chrome.runtime.sendMessage({type:"STUDIO_NGK_FILL"});
      if(!result?.ok)throw Error(result?.error||"Facebook fill failed.");
      status.textContent="Verified cloud draft. Review it on Facebook.";
      load.disabled=false;return;
    }
   } catch(error){status.textContent=error.message;load.disabled=false;return;}
   chrome.runtime.sendMessage({type:"MOE_NGK_NEXT"}''')
fill = original["explicit_listing_fill.js"].decode("utf-8-sig").replace("\r\n","\n")
fill = replace_once(fill,"moeFillExplicitListing(data)", "moeFillExplicitListing(data, cloud = false)")
fill = replace_once(fill, '    const source=Array.isArray', '''    const conditionControls=()=>[...document.querySelectorAll('select,[role="combobox"]')]
      .filter(e=>e.getClientRects().length&&/\\bcondition\\b/i.test([e.getAttribute("aria-label"),e.closest("label")?.textContent,e.textContent].filter(Boolean).join(" ")));
    const conditionMatches=()=>{
      const controls=conditionControls();
      if(controls.length!==1)return false;
      const el=controls[0], selected=el.tagName==="SELECT"?[el.selectedOptions[0]?.textContent]:[el.innerText,el.getAttribute("aria-label")];
      return selected.some(s=>text(s).split(/\\n/).some(line=>line.trim().toLowerCase()===text(data.condition).toLowerCase()));
    };
    if(cloud&&!conditionMatches()){
      const controls=conditionControls();
      if(!text(data.condition)||controls.length!==1)throw Error("Review the Facebook condition control.");
      const el=controls[0];
      if(el.tagName==="SELECT"){
        const options=[...el.options].filter(o=>text(o.textContent).toLowerCase()===text(data.condition).toLowerCase());
        if(options.length!==1)throw Error("Facebook condition unavailable.");
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,options[0].value);
        el.dispatchEvent(new Event("change",{bubbles:true}));
      }else{
        el.click();
        const options=()=>[...document.querySelectorAll('[role="option"]')].filter(o=>o.getClientRects().length&&text(o.innerText).toLowerCase()===text(data.condition).toLowerCase());
        await wait(()=>options().length===1);options()[0].click();
      }
      await wait(conditionMatches);
    }
    const source=Array.isArray''')
fill = replace_once(fill,'    const checks=["category"', '''    if(cloud){
      if(!conditionMatches()||!source.length)throw Error("Facebook did not retain the approved condition or photos.");
      badge.textContent="Approved fields and photo count verified. Review the Facebook draft.";
      return {ok:true,photo_count:source.length};
    }
    const checks=["category"''')

manifest = json.loads(original["manifest.json"].decode("utf-8-sig"))
manifest.update(version="68.1.5", externally_connectable={"matches":["https://crazymoe-marketplace-studio.vercel.app/*","https://studio.crazymoe.com/*"]})
changes = {"cloud_handoff.js":(source/"cloud_handoff.js").read_bytes(),
           "ngk_cloud_worker.js":(source/"ngk_cloud_worker.js").read_bytes(),
           "approved_batch_panel.js":panel.encode(), "explicit_listing_fill.js":fill.encode(),
           "background.js":original["background.js"]+b'\nimportScripts("cloud_handoff.js","ngk_cloud_worker.js");\n',
           "manifest.json":(json.dumps(manifest,indent=2)+"\n").encode()}
backup = target.parent/"pre-cloud-handoff-68.1.4"
backup.mkdir(exist_ok=True)
for name,data in original.items():
    if data is None: continue
    p=backup/name
    if not p.exists():
        with p.open("xb") as f: f.write(data)
    if p.read_bytes()!=data: sys.exit("Backup mismatch: "+name)
written=[]
try:
    for name,data in changes.items():
        dest=target/name
        if (dest.read_bytes() if dest.exists() else None)!=original[name]:raise RuntimeError("Concurrent modification")
        temp=dest.with_name(name+".studio-stage"+dest.suffix)
        with temp.open("xb") as f: f.write(data)
        try:
            if name.endswith(".js"):subprocess.run(["node","--check",str(temp)],check=True)
            temp.replace(dest)
        finally:temp.unlink(missing_ok=True)
        written.append(name)
except BaseException:
    for name in reversed(written):
        dest=target/name
        if dest.read_bytes()!=changes[name]:continue
        if original[name] is None:dest.unlink()
        else:dest.write_bytes(original[name])
    raise
print("NGK cloud handoff installed on disk; Chrome reload required.")
