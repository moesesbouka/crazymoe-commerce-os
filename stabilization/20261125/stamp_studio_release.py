"""Write the exact Studio source SHA into a clean Vercel staging directory."""
import argparse
import json
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("deploy_root", type=Path)
parser.add_argument("--commit", required=True)
args = parser.parse_args()
sha = subprocess.check_output(["git", "rev-parse", "--verify", args.commit + "^{commit}"], text=True).strip()
if not re.fullmatch("[a-f0-9]{40}", sha):
    raise SystemExit("Invalid release commit")
if not (args.deploy_root / "health.html").is_file():
    raise SystemExit("Use the Studio web root containing health.html")
(args.deploy_root / "version.json").write_text(json.dumps({"git_sha": sha}) + "\n", encoding="utf-8")
