"""Install over the verified 66.0.5 unpacked Commerce OS build only."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

target = Path(sys.argv[1]).resolve()
source = Path(__file__).resolve().parent
expected = {
    "background.js": "cc54c292257aebacA587ff447d584774f7cca8800471a30cf197744fe9b1e4aa".lower(),
    "fb_scraper.js": "911c49659a1d3d07b28666bc40e9535348244c132a814fcfd5b4adbad28c1073",
    "manifest.json": "fc772de577ef6d95c407351172446bec3fb3d7c33fcb5ba5450a128b2db5c193",
}
def sha(data):
    return hashlib.sha256(data).hexdigest()

original = {name: (target / name).read_bytes() for name in expected}
if any(sha(data) != expected[name] for name, data in original.items()):
    sys.exit("Installed sources changed. Inspect before applying.")
backup = target.parent / "backup-pre-observed-sync-66.0.5"
backup.mkdir(exist_ok=True)
for name, data in original.items():
    path = backup / name
    if not path.exists():
        with path.open("xb") as stream:
            stream.write(data)
    if path.read_bytes() != data:
        sys.exit("Backup mismatch")

scraper = original["fb_scraper.js"].decode("utf-8-sig")
start = scraper.index("  async function logImportRun(")
end = scraper.index("  async function runImport(", start)
scraper = scraper[:start] + scraper[end:]
prefix, run = scraper.split("  async function runImport(", 1)
run, removed = re.subn(r'^    if \(!hasSupabaseConfig\(\)\).*?\r?\n', '', run, flags=re.M)
scraper = prefix + '  async function runImport(' + run
if removed != 1:
    sys.exit("Config guard changed")
scraper = scraper.replace("syncToSupabase(listings,", "syncObservedListings(listings, ACCOUNT, mode,").replace("}, mode);","});")
start = scraper.index('      if (mode === "full")', scraper.index('const modeLabels ='))
end = scraper.index("      setStatus(msg);", start)
scraper = scraper[:start] + '      msg += result.matched + " existing listings seen; " + result.pending + " new observations held privately for review.";\n' + scraper[end:]
manifest = json.loads(original["manifest.json"])
record = next(item for item in manifest["content_scripts"] if "fb_scraper.js" in item["js"])
record["js"].insert(record["js"].index("fb_scraper.js"), "sync_observed.js")
manifest["version"] = "66.0.6"
additional = ["sync_worker.js","sync_observed.js","sync_login.html","sync_login.js"]
changes = {name: (source / name).read_bytes() for name in additional}
if any((target / name).exists() for name in additional):
    sys.exit("Unexpected existing sync files")
changes.update({"background.js":original["background.js"] + b'\nimportScripts("sync_worker.js");\n',
                "fb_scraper.js":scraper.encode("utf-8"),
                "manifest.json":(json.dumps(manifest, indent=2)+"\n").encode("utf-8")})
stage = backup / "staged"
stage.mkdir(exist_ok=True)
for name,data in changes.items():
    path = stage / name
    path.write_bytes(data)
    if name.endswith(".js"):
        subprocess.run(["node","--check",str(path)],check=True)
written = []
try:
    for name,data in changes.items():
        path = target / name
        if (path.read_bytes() if path.exists() else None) != original.get(name):
            raise RuntimeError("Extension changed during installation")
        temp = path.with_suffix(path.suffix + ".66-0-6.tmp")
        with temp.open("xb") as stream:
            stream.write(data)
        temp.replace(path)
        written.append(name)
    for name in written:
        if (target / name).read_bytes() != changes[name]:
            raise RuntimeError("Verification failed")
except BaseException:
    for name in reversed(written):
        path = target / name
        if path.read_bytes() == changes[name]:
            if name in original:
                path.write_bytes(original[name])
            else:
                path.unlink()
    raise
print("Verified on disk:", manifest["version"], len(written), "files")
