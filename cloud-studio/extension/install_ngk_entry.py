"""Give the installed gallery extension a direct, prominent cloud Studio entry."""
import hashlib
import json
from pathlib import Path
import sys

target=Path(sys.argv[1]).resolve()
expected={
 "popup.html":"0a466d771492651eabb99a7b2b256ac30546c0f788ce8b69e0c254d55f77f3a8",
 "manifest.json":"2ab562e5c20713feb1a63e3ef7f3740b9b901c0d2d1d79dd7947f348305f9835",
}
original={name:(target/name).read_bytes() for name in expected}
for name,data in original.items():
    if hashlib.sha256(data).hexdigest()!=expected[name]:
        sys.exit("Review newer file before applying: "+name)
html=original["popup.html"].decode("utf-8-sig")
old='<b>CrazyMoe Gallery Recovery</b><p>Approved listing handoff (manual only)</p>'
new='''<b>Crazy Moe Marketplace</b><p><a href="https://crazymoe-marketplace-studio.vercel.app/app/" target="_blank" rel="noopener noreferrer" style="display:block;background:#23608a;color:white;border-radius:8px;padding:12px;text-decoration:none;text-align:center">Open Marketplace Studio</a></p><p>Choose a product in Studio to review and open its Facebook draft.</p>'''
assert html.count(old)==1
html=html.replace(old,new)
html=html.replace('<button id="checkPairing"', '<details><summary>Office pairing and gallery tools</summary><button id="checkPairing"',1)
html=html.replace('<script src="popup.js">', '</details><script src="popup.js">',1)
manifest=json.loads(original["manifest.json"])
manifest["version"]="68.1.6"
manifest["action"]["default_title"]="Crazy Moe Marketplace"
changes={"popup.html":html.encode(),"manifest.json":(json.dumps(manifest,indent=2)+"\n").encode()}
backup=target.parent/"backup-before-studio-entry-6815"
backup.mkdir(exist_ok=True)
for name,data in original.items():
    dest=backup/name
    if not dest.exists():
        with dest.open("xb") as stream:stream.write(data)
    if dest.read_bytes()!=data:sys.exit("Backup differs: "+name)
written=[]
try:
    for name,data in changes.items():
        dest=target/name
        if dest.read_bytes()!=original[name]:raise RuntimeError("Concurrent file change")
        temp=dest.with_name(name+".entry.tmp")
        with temp.open("xb") as stream:stream.write(data)
        temp.replace(dest)
        written.append(name)
    assert 'https://crazymoe-marketplace-studio.vercel.app/app/' in (target/"popup.html").read_text()
    assert json.loads((target/"manifest.json").read_text())["version"]=="68.1.6"
except BaseException:
    for name in reversed(written):
        dest=target/name
        if dest.read_bytes()==changes[name]:dest.write_bytes(original[name])
    raise
print("Studio entry installed on disk in 68.1.6. Browser activation remains to be verified.")
