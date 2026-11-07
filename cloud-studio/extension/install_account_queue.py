"""Add the account queue without replacing current gallery/auth modules."""
from pathlib import Path
import hashlib,json,subprocess,sys

EXPECTED={'background.js':'16aace235799444eee037c934d54f79c975bc9499b6e87b1b7fd4fe319e1a834','manifest.json':'4d0ce23dedfc37ec9869a7fe783d0ca8b138af2f1fd2bbdeabf94dc31918600b'}
def main(target,source):
 target=Path(target);source=Path(source)
 originals={name:(target/name).read_bytes() for name in EXPECTED}
 for name,data in originals.items():
  if hashlib.sha256(data).hexdigest()!=EXPECTED[name]:raise SystemExit('Current extension changed; review before installing: '+name)
 manifest=json.loads(originals['manifest.json'])
 if manifest['version']!='68.1.20':raise SystemExit('Unexpected extension version')
 code=(source/'account_queue_worker.js').read_bytes();subprocess.run(['node','--check',str(source/'account_queue_worker.js')],check=True)
 background=originals['background.js'].decode('utf-8-sig')
 if 'importScripts("cloud_handoff.js","ngk_cloud_worker.js")' not in background:raise SystemExit('Cloud upload modules are unavailable')
 if 'account_queue_worker.js' in background:raise SystemExit('Account queue already installed')
 background+='\nimportScripts("account_queue_worker.js");\n'
 manifest['version']='68.1.21'
 changes={'background.js':background.encode(),'manifest.json':(json.dumps(manifest,indent=2)+'\n').encode(),'account_queue_worker.js':code}
 backup=target.parent/'pre-account-queue-68.1.20';backup.mkdir(exist_ok=True)
 for name,data in originals.items():
  p=backup/name
  if p.exists() and p.read_bytes()!=data:raise SystemExit('Backup conflict')
  p.write_bytes(data)
 written=[]
 try:
  for name,data in changes.items():
   p=target/name
   if name in originals and p.read_bytes()!=originals[name]:raise RuntimeError('Concurrent extension edit')
   if name not in originals and p.exists():raise RuntimeError('New file already exists')
   p.write_bytes(data);written.append(name)
  subprocess.run(['node','--check',str(target/'background.js')],check=True)
 except BaseException:
  for name in reversed(written):
   if (target/name).read_bytes()==changes[name]:
    if name in originals:(target/name).write_bytes(originals[name])
    else:(target/name).unlink()
  raise
 print(json.dumps({'version':manifest['version'],'installed_on_disk':True,'reload_required':True,'hashes':{name:hashlib.sha256(data).hexdigest() for name,data in changes.items()}}))
if __name__=='__main__':main(*sys.argv[1:])
