"""Apply the reviewed transfer fix to the exact unpacked 66.0.6 build."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

target = Path(sys.argv[1]).resolve()
source = Path(__file__).resolve().parent
checks = {
    "fb_fill.js":"533550ef1f214ef3faa8f65ea43f4b8c0049832ce1b5caa0602ade28ea676b83",
    "cloud_handoff.js":"a7ec0730ce92275042b5b8b87b1c65f1377e697451225907eb4a581afdc59d83",
    "manifest.json":"0ec7e5dc4c173e12dcfb776025db3633072e61b958f2521fbd6eec597c1f2085",
}
original = {name:(target/name).read_bytes() for name in checks}
for name,data in original.items():
    if hashlib.sha256(data).hexdigest() != checks[name]:
        sys.exit(f"Review newer installed {name} before applying")
backup = target.parent/"backup-pre-transfer-isolation-66.0.6"
backup.mkdir(exist_ok=True)
for name,data in original.items():
    path = backup/name
    if not path.exists():
        with path.open("xb") as stream:
            stream.write(data)
    if path.read_bytes()!=data:
        sys.exit("Backup mismatch")

s = original["fb_fill.js"].decode("utf-8-sig").replace("\r\n","\n")
def once(old,new):
    global s
    if s.count(old)!=1:
        sys.exit("Installed handler differs: "+old[:60])
    s=s.replace(old,new)

once("async function fillApprovedProduct(item, communicate)", "async function fillApprovedProduct(item, communicate, cloud)")
start=s.index("    // Facebook keeps uploaded photos")
end=s.index("    await smartFill(findTitle(),title",start)
legacy=s[start:end]
s=s[:start]+'''    if (cloud) {
      if (facebookCreateHasContent() || removePhotos().length || document.querySelector('img[alt^="Listing photo"]'))
        throw Error("Facebook restored an existing draft. Open a blank draft from Studio.");
    } else {
'''+''.join('  '+line if line.strip() else line for line in legacy.splitlines(keepends=True))+'''    }
'''+s[end:]
once("if(!checkText())throw Error('Facebook changed a product field during upload; review required');",
     "if(!checkText() || !conditionMatches())throw Error('Facebook changed a product field during upload; review required');")
once("   const hasDraft=",'''   const mode=await communicate({type:"STUDIO_TRANSFER_MODE"});
   if(!mode.ok)throw Error("Open the Marketplace create-item form and retry.");
   const hasDraft=''')
once('   if(hasDraft&&!window.confirm(','''   if(mode.cloud && (hasDraft || facebookCreateHasContent()))throw Error("Existing Facebook draft detected. Open a blank draft from Studio.");
   if(hasDraft&&!window.confirm(''')
once('status.textContent="Loading approved listing and prepared photos from office...";',
     'status.textContent=mode.cloud?"Loading approved cloud listing and photos…":"Loading approved office listing and photos…";')
once('   await fillApprovedProduct(r.item,communicate);','''   if(Boolean(mode.cloud)!==(r.source==="studio"))throw Error("Transfer source changed. Open the product again.");
   await fillApprovedProduct(r.item,communicate,mode.cloud);
   if(mode.cloud){
     status.textContent="Verified cloud draft: "+r.item.title+". Review it on Facebook. Nothing was published.";
     return;
   }''')
manifest=json.loads(original["manifest.json"])
manifest["version"]="66.0.7"
changes={"fb_fill.js":s.encode("utf-8"),"cloud_handoff.js":(source/"cloud_handoff.js").read_bytes(),
         "manifest.json":(json.dumps(manifest,indent=2)+"\n").encode("utf-8")}
staged=backup/"staged"
staged.mkdir(exist_ok=True)
for name,data in changes.items():
    path=staged/name
    path.write_bytes(data)
    if name.endswith(".js"):
        subprocess.run(["node","--check",str(path)],check=True)
written=[]
try:
    for name,data in changes.items():
        path=target/name
        if path.read_bytes()!=original[name]:
            raise RuntimeError("Concurrent extension change")
        temp=target/(name+".transfer-667.tmp")
        with temp.open("xb") as stream:
            stream.write(data)
        temp.replace(path)
        written.append(name)
        if path.read_bytes()!=data:
            raise RuntimeError("Write verification failed")
except BaseException:
    for name in reversed(written):
        if (target/name).read_bytes()==changes[name]:
            (target/name).write_bytes(original[name])
    raise
print("Verified on disk: Commerce OS 66.0.7")
