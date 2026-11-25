"""Stage or install the Studio progress hooks over the verified office 66.0.11 scanner."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

BASELINE = {
    "manifest.json": "57e53f96b83bb13d3dbbe1ff0a518561be3f9ef6ea4842878aff167deb41b2b6",
    "fb_scraper.js": "2915e126513b7309b430e1aef7685d78c1a7858194f40c16d11665e2d4144e94",
    "sync_worker.js": "7dfb766502494c875380b579000717b6653eab496ba355f2caead36c6860f0c8",
    "sync_observed.js": "c539f40ca091cb77081130aeb96a2c7b187d43aac1fb2d6986c0d2f764d2df61",
}
VERSION = "66.0.12"
SOURCES = Path(__file__).resolve().parent


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError(f"Scanner hook changed: {old}")
    return text.replace(old, new, 1)


def build(original):
    manifest = json.loads(original["manifest.json"].decode("utf-8-sig"))
    if manifest["version"] != "66.0.11" or manifest["background"]["service_worker"] != "background.js":
        raise RuntimeError("Unexpected scanner manifest")
    scanner = next(script for script in manifest["content_scripts"] if "fb_scraper.js" in script["js"])
    scanner["js"].insert(scanner["js"].index("fb_scraper.js"), "sync_progress.js")
    manifest["version"] = VERSION

    script = original["fb_scraper.js"].decode("utf-8-sig").replace("\r\n", "\n")
    script = replace_once(script, "async function paginateActive() {",
                          "async function paginateActive(reportProgress) {")
    script = replace_once(script, "    while (pages < 300) {",
                          "    while (pages < 300) {\n      reportProgress(Object.keys(listings).length);")
    script = replace_once(script, "      const after = Object.keys(listings).length;",
                          "      const after = Object.keys(listings).length;\n      reportProgress(after);")
    script = replace_once(script,
                          '} catch(e) { console.warn("[Sync] fetch error:", e.message); break; }',
                          '} catch(e) { throw Error("Facebook listing scan was interrupted: " + e.message); }')
    script = replace_once(script, "        text = await resp.text();",
                          '        if (!resp.ok) throw Error("Facebook returned HTTP " + resp.status);\n        text = await resp.text();')

    start = script.index("  async function runImport(mode)")
    prefix, run = script[:start], script[start:]
    run = replace_once(run, "    try {\n      setStatus(",
                       "    let importRun;\n    try {\n      importRun = await startFacebookImport(ACCOUNT, mode);\n      setStatus(")
    run = replace_once(run, "const listings = await paginateActive();",
                       "const listings = await paginateActive(importRun.discoveryProgress);")
    run = replace_once(run, "      if (listings.length === 0) {",
                       "      if (listings.length === 0) {\n        await importRun.fail();")
    run = replace_once(run, "await syncObservedListings(listings, ACCOUNT, mode,",
                       "await importRun.save(listings,")
    run = replace_once(run, 'result.matched + " existing listings seen; "', 'result.matched + " existing listings refreshed; "')
    run = replace_once(run, 'result.pending + " new observations held privately for review."', 'result.pending + " new observations held for review; " + result.skipped + " skipped."')
    run = replace_once(run, "    } catch(e) {\n      console.error(",
                       "    } catch(e) {\n      await importRun?.fail();\n      console.error(")

    worker = original["background.js"]
    if b'importScripts("sync_worker.js")' not in worker or b"sync_progress_worker.js" in worker:
        raise RuntimeError("Existing sync worker registration changed")
    return {
        "manifest.json": (json.dumps(manifest, indent=2) + "\n").encode(),
        "fb_scraper.js": (prefix + run).encode(),
        "background.js": worker + b'\nimportScripts("sync_progress_worker.js");\n',
        "sync_progress.js": (SOURCES / "sync_progress.js").read_bytes(),
        "sync_progress_worker.js": (SOURCES / "sync_progress_worker.js").read_bytes(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("extension", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    target = args.extension.resolve()
    original = {name: (target / name).read_bytes() for name in (*BASELINE, "background.js")}
    for name, expected in BASELINE.items():
        if hashlib.sha256(original[name]).hexdigest() != expected:
            raise RuntimeError(f"Installed {name} differs from the verified office build")
    output = build(original)
    backup = target.parent / "backup-pre-import-progress-66.0.11"
    backup.mkdir(exist_ok=True)
    stage = backup / "staged"
    stage.mkdir(exist_ok=True)

    for name, data in output.items():
        if (target / name).exists() and name not in original:
            raise RuntimeError(f"Unexpected installed file: {name}")
        previous = original.get(name)
        if previous is not None:
            path = backup / name
            if not path.exists():
                with path.open("xb") as stream:
                    stream.write(previous)
            if path.read_bytes() != previous:
                raise RuntimeError(f"Backup check failed: {name}")
        (stage / name).write_bytes(data)
        if name.endswith(".js"):
            subprocess.run(["node", "--check", str(stage / name)], check=True)

    if not args.apply:
        print(f"Verified staged {VERSION} ({len(output)} files); current extension untouched.")
        return

    installed = []
    try:
        # Update the manifest last so Chrome only sees the new version once its files exist.
        for name in [*(name for name in output if name != "manifest.json"), "manifest.json"]:
            path = target / name
            if (path.read_bytes() if path.exists() else None) != original.get(name):
                raise RuntimeError(f"Extension changed during installation: {name}")
            temp = target / (name + ".progress.tmp")
            with temp.open("xb") as stream:
                stream.write(output[name])
            temp.replace(path)
            installed.append(name)
        for name, data in output.items():
            if (target / name).read_bytes() != data:
                raise RuntimeError(f"Install check failed: {name}")
    except BaseException:
        for name in reversed(installed):
            path = target / name
            if path.read_bytes() == output[name]:
                if name in original:
                    path.write_bytes(original[name])
                else:
                    path.unlink()
        raise
    print(f"Installed and verified CrazyMoe Commerce OS {VERSION} ({len(output)} files).")


if __name__ == "__main__":
    main()
