"""Stage the office Facebook scanner upgrade by default. Apply only to the verified 66.0.12 build."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from install_import_progress_66012 import BASELINE, build as previous_build, replace_once

SOURCES = Path(__file__).resolve().parent
VERSION = "66.0.13"
BACKGROUND_SHA = "7b3d90659db8216f6f89908d3d7a44dbac2d6f65198b7dda0350f0ac8e09b4e6"
MODULES = ["facebook_scan_discovery.js", "facebook_scan_progress.js", "facebook_scan_worker.js"]


def patch_scraper(source):
    start = source.index("  async function paginateActive(")
    end = source.index("\n  }", start) + len("\n  }")
    old = source[start:end]
    extractor_start = old.index("    function dec(")
    extractor_end = old.index("    while (pages < 300)")
    extractor = old[extractor_start:extractor_end]
    extractor = replace_once(extractor, "const id = obj.id || obj.listing_id;",
                             "const id = String(obj.id || obj.listing_id || '');")
    extractor = replace_once(extractor, 'if (id && /^\\d{10,19}$/.test(id) && !listings[id]) {',
                             'if (/^\\d{10,19}$/.test(id)) {')
    extractor = replace_once(extractor, 'listings[id] = {', 'return {')
    extractor = replace_once(extractor, 'if (Array.isArray(obj)) { obj.forEach(extract); return; }',
                             'if (Array.isArray(obj)) return obj.map(extract).find(Boolean);')
    extractor = replace_once(extractor, 'Object.values(obj).forEach(v => { if (v && typeof v === "object") extract(v); });',
                             'return Object.values(obj).map(extract).find(Boolean);')
    request_start = old.index("      const vars = Object.assign(")
    request_end = old.index('      let text = "";', request_start)
    request = old[request_start:request_end]
    replacement = '''  async function paginateActive(importRun, profile) {
    const cap = getCapture();
    const {dtsg} = getDtsgAndUser();
    const userID = profile;
    const docId = cap.docId || KNOWN_DOC_ID;
    const fbDtsg = cap.fbDtsg || dtsg || "";
    let baseVars = {};
    try { baseVars = JSON.parse(cap.vars || "{}"); } catch {}
    let liveVars = null;
    try {
      const current = JSON.parse(localStorage.getItem("__fb_main_cap__") || "null");
      if (current?.vars) liveVars = typeof current.vars === "string" ? JSON.parse(current.vars) : current.vars;
    } catch {}
    const ACCOUNT = importRun.account;
''' + extractor + '''    function fetchPage(cursor, signal) {
''' + request + '''      return readFacebookScanResponse(requestSignal => fetch("https://www.facebook.com/api/graphql/", {
        method: "POST", credentials: "include",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: params.toString(), signal: requestSignal
      }), signal);
    }
    return discoverFacebookListings({
      fetchPage, extract, profile, getProfile: facebookSellingProfile, signal: importRun.signal,
      pause: () => sleep(300),
      report(found, pages) {
        importRun.discoveryProgress(found, pages);
        setStatus("Finding Facebook listings… " + found + " found across " + pages + " pages.");
      }
    });
  }'''
    source = source[:start] + replacement + source[end:]
    source = replace_once(source, "importRun = await startFacebookImport(ACCOUNT, mode);",
                          "const profile = facebookSellingProfile();\n      importRun = await startHardenedFacebookScan(mode, profile);")
    start = source.index("      const listings = await paginateActive(importRun.discoveryProgress);")
    end = source.index("      const now = new Date();", start)
    source = source[:start] + '''      const discovery = await paginateActive(importRun, profile);
      const result = await importRun.save(discovery, (done, total) => setStatus("Saving " + done + " / " + total + " observations."));
''' + source[end:]
    source = replace_once(source, "${modeLabels[mode]} complete!",
                          "${modeLabels[mode]} ${result.state === 'partial' ? 'saved partially (page cap reached)' : result.endReason === 'verified_empty' ? 'verified empty' : 'complete'}")
    source = replace_once(source, "await importRun?.fail();", "await importRun?.fail(e);")
    return source


def build(extension, baseline):
    source_names = (*BASELINE, "background.js")
    backed_up = {"manifest.json", "fb_scraper.js", "background.js"}
    original = {name: ((baseline if name in backed_up else extension) / name).read_bytes()
                for name in source_names}
    for name, digest in {**BASELINE, "background.js": BACKGROUND_SHA}.items():
        if hashlib.sha256(original[name]).hexdigest() != digest:
            raise RuntimeError(f"Wrong 66.0.11 baseline for {name}")
    version12 = previous_build(original)
    version12["sync_worker.js"] = original["sync_worker.js"]
    for name, expected in version12.items():
        if (extension / name).read_bytes() != expected:
            raise RuntimeError(f"Installed 66.0.12 file changed: {name}")

    manifest = json.loads(version12["manifest.json"])
    manifest["version"] = VERSION
    scraper = next(script for script in manifest["content_scripts"] if "fb_scraper.js" in script["js"])
    offset = scraper["js"].index("sync_progress.js")
    scraper["js"][offset:offset+1] = MODULES[:2]
    worker = replace_once(version12["sync_worker.js"].decode("utf-8-sig"), "expires:auth.expires_at", "expires:auth.expires_at,refresh:auth.refresh_token")
    return {
        "fb_scraper.js": patch_scraper(version12["fb_scraper.js"].decode()).encode(),
        "background.js": version12["background.js"] + b'\nimportScripts("facebook_scan_worker.js");\n',
        "sync_worker.js": worker.encode(),
        **{name: (SOURCES / name).read_bytes() for name in MODULES},
        "manifest.json": (json.dumps(manifest, indent=2) + "\n").encode(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("extension", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    extension = args.extension.resolve()
    baseline = extension.parent / "backup-pre-import-progress-66.0.11"
    output = build(extension, baseline)
    backup = extension.parent / "backup-pre-facebook-scan-66.0.13"
    stage = backup / "staged"
    stage.mkdir(parents=True, exist_ok=True)
    prior = {}
    for name, payload in output.items():
        path = extension / name
        if path.exists():
            prior[name] = path.read_bytes()
            original = backup / name
            if not original.exists():
                original.write_bytes(prior[name])
            if original.read_bytes() != prior[name]:
                raise RuntimeError(f"Rollback backup differs for {name}")
        (stage / name).write_bytes(payload)
        if name.endswith(".js"):
            subprocess.run(["node", "--check", str(stage / name)], check=True)

    if not args.apply:
        print(f"Verified staged {VERSION}. The installed extension is unchanged.")
        return
    changed = []
    try:
        for name, payload in output.items():
            path = extension / name
            if (path.read_bytes() if path.exists() else None) != prior.get(name):
                raise RuntimeError(f"Installed file changed during update: {name}")
            temp = extension / (name + ".scan.tmp")
            with temp.open("xb") as handle:
                handle.write(payload)
            temp.replace(path)
            changed.append(name)
        for name, payload in output.items():
            if (extension / name).read_bytes() != payload:
                raise RuntimeError(f"Installed file could not be verified: {name}")
    except BaseException:
        for name in reversed(changed):
            path = extension / name
            if path.read_bytes() == output[name]:
                if name in prior:
                    path.write_bytes(prior[name])
                else:
                    path.unlink()
        raise
    print(f"Installed and verified {VERSION} on disk.")


if __name__ == "__main__":
    main()
