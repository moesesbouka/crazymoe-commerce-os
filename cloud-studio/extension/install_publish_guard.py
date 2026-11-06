"""Add a synthetic-publish guard to the exact installed Commerce OS 68.1.6 build."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path


EXPECTED = {
    "approved_batch_panel.js": "be4d536f1393b6155e768734b9a462026c87a4df200649fafaa8c474ec2b4aeb",
    "manifest.json": "f6c1cecff7ef81dfcb7299d3db11554da329fe0689a18d82d1991d99bf307b24",
}


def patch_panel(source: str) -> str:
    anchor = ' const ROOT="__moe_approved_panel__";\n'
    guard = ''' const ROOT="__moe_approved_panel__";
 // A Studio handoff is review-only. Block scripted Publish clicks while
 // retaining Moe's normal trusted click after he has reviewed the draft.
 const publishControl=target=>{
  const el=target?.closest?.('button,[role="button"],input[type="submit"]');
  if(!el)return null;
  const label=String(el.getAttribute("aria-label")||el.value||el.textContent||"").replace(/\\s+/g," ").trim();
  return /^(?:publish|publish listing)$/i.test(label)?el:null;
 };
 addEventListener("click",event=>{
  if(event.isTrusted||!document.documentElement.hasAttribute("data-crazymoe-cloud-review-only")||!publishControl(event.target))return;
  event.preventDefault();event.stopImmediatePropagation();
  const panel=document.getElementById(ROOT),status=panel?.querySelector("p");
  if(status)status.textContent="Automated publishing was blocked. Review the draft and click Publish yourself when ready.";
 },true);
'''
    if source.count(anchor) != 1:
        raise RuntimeError("Installed panel source differs at publish-guard anchor")
    source = source.replace(anchor, guard)
    old = '      status.textContent="Verified cloud draft. Review it on Facebook.";\n'
    new = ('      document.documentElement.setAttribute("data-crazymoe-cloud-review-only","1");\n'
           '      status.textContent="Verified cloud draft. Review it on Facebook. Automated publishing is blocked.";\n')
    if source.count(old) != 1:
        raise RuntimeError("Installed panel source differs at cloud success anchor")
    return source.replace(old, new)


def main(target_arg: str) -> None:
    target = Path(target_arg).resolve()
    originals = {name: (target / name).read_bytes() for name in EXPECTED}
    for name, data in originals.items():
        if hashlib.sha256(data).hexdigest() != EXPECTED[name]:
            raise SystemExit(f"Review newer installed {name} before applying")

    backup = target.parent / "pre-publish-guard-68.1.6"
    backup.mkdir(exist_ok=True)
    for name, data in originals.items():
        path = backup / name
        if not path.exists():
            with path.open("xb") as stream:
                stream.write(data)
        if path.read_bytes() != data:
            raise SystemExit("Publish-guard backup mismatch")

    panel = patch_panel(originals["approved_batch_panel.js"].decode("utf-8-sig").replace("\r\n", "\n"))
    manifest = json.loads(originals["manifest.json"])
    if manifest.get("version") != "68.1.6":
        raise SystemExit("Installed extension version changed")
    manifest["version"] = "68.1.7"
    changes = {
        "approved_batch_panel.js": panel.encode("utf-8"),
        "manifest.json": (json.dumps(manifest, indent=2) + "\n").encode("utf-8"),
    }
    staged = backup / "staged"
    staged.mkdir(exist_ok=True)
    for name, data in changes.items():
        path = staged / name
        path.write_bytes(data)
        if name.endswith(".js"):
            subprocess.run(["node", "--check", str(path)], check=True)

    written: list[str] = []
    try:
        for name, data in changes.items():
            path = target / name
            if path.read_bytes() != originals[name]:
                raise RuntimeError("Concurrent extension change")
            temp = target / (name + ".publish-guard-6817.tmp")
            with temp.open("xb") as stream:
                stream.write(data)
            temp.replace(path)
            written.append(name)
            if path.read_bytes() != data:
                raise RuntimeError("Write verification failed")
    except BaseException:
        for name in reversed(written):
            path = target / name
            if path.read_bytes() == changes[name]:
                path.write_bytes(originals[name])
        raise
    print("Verified on disk: Commerce OS 68.1.7 synthetic Publish guard")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: install_publish_guard.py EXTENSION_DIRECTORY")
    main(sys.argv[1])
