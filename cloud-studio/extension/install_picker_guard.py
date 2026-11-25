"""Upgrade the exact 66.0.7 unpacked build's photo-input detection."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

root=Path(sys.argv[1]).resolve()
hashes={"background.js":"5d5190e8b3ba3632a4126b729281aaf481d69f404228a0708383e2addcb22b3a",
        "fb_fill.js":"9ebb52feb2793d68a8f74d2ffc7efde92e56242b35500c4ec7590bff23d46c8b",
        "manifest.json":"0587c97372ef0957e55f842f37e75c92b1ac2621e21b10590d17f50100fd40fb"}
old={k:(root/k).read_bytes() for k in hashes}
if any(hashlib.sha256(v).hexdigest()!=hashes[k] for k,v in old.items()):
    sys.exit("Extension has changed; inspect before applying")
bg=old["background.js"].decode("utf-8").replace("\r\n","\n")
a=bg.index("   let input=document.querySelector(",bg.index("func:async photos=>"))
b=bg.index("   const dt=new DataTransfer();",a)
bg=bg[:a]+'''   const pickers=[...document.querySelectorAll('input[type="file"]')].filter(el=>!el.closest('#cm-root'));
   const images=pickers.filter(el=>/image|\\.jpe?g|\\.png|\\.webp/i.test(el.accept));
   const input=images.length===1?images[0]:(images.length===0 && pickers.length===1 && !pickers[0].accept?pickers[0]:null);
   if(!input)return {ok:false,error:"Facebook photo picker is missing or ambiguous"};
'''+bg[b:]
fill=old["fb_fill.js"].decode("utf-8")
needle="""document.querySelectorAll('input[type="file"]')"""
if fill.count(needle)<2:
    sys.exit("Expected photo guards missing")
fill=fill.replace(needle,"""document.querySelectorAll('input[type="file"]:not(#cm-root *)')""")
manifest=json.loads(old["manifest.json"])
manifest["version"]="66.0.8"
files={"background.js":bg.encode(),"fb_fill.js":fill.encode(),"manifest.json":(json.dumps(manifest,indent=2)+"\n").encode()}
backup=root.parent/"backup-pre-picker-66.0.7"
backup.mkdir(exist_ok=True)
written=[]
try:
    for k,v in old.items():
        if not (backup/k).exists():
            with (backup/k).open("xb") as f:
                f.write(v)
        if (backup/k).read_bytes()!=v:
            raise RuntimeError("Backup differs")
    for k,v in files.items():
        path=root/k
        if path.read_bytes()!=old[k]:
            raise RuntimeError("Concurrent edit")
        temp=root/("stage-668-"+k)
        with temp.open("xb") as f:
            f.write(v)
        if k.endswith(".js"):
            subprocess.run(["node","--check",str(temp)],check=True)
        temp.replace(path)
        written.append(k)
        if path.read_bytes()!=v:
            raise RuntimeError("Verification failed")
except BaseException:
    for k in reversed(written):
        if (root/k).read_bytes()==files[k]:
            (root/k).write_bytes(old[k])
    raise
print("Verified on disk: Commerce OS 66.0.8")
