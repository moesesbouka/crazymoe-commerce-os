"""Install the shared photo renderer and upgraded queue, preserving other extension work."""
from pathlib import Path
import hashlib,json,subprocess,sys
EXPECTED={'account_queue_worker.js':'44f7ac211c98ea093c310845080fa1f277e98269173196d687e57b91045e29b6','manifest.json':'0372b45f28cfdf416250a8272b268cd016d6454779fbcbd17eb54ef174f73c35'}
def main(target,source):
 target=Path(target);source=Path(source)
 originals={n:(target/n).read_bytes() for n in EXPECTED}
 for name,data in originals.items():
  if hashlib.sha256(data).hexdigest()!=EXPECTED[name]:raise SystemExit('Extension changed; review before installing: '+name)
 manifest=json.loads(originals['manifest.json'])
 if manifest['version']!='68.1.21':raise SystemExit('Unexpected installed version')
 if 'account_queue_worker.js' not in (target/'background.js').read_text(encoding='utf-8-sig'):raise SystemExit('Account queue import missing')
 manifest['version']='68.1.22'
 changes={'account_queue_worker.js':(source/'extension/account_queue_worker.js').read_bytes(),'posting-photo.js':(source/'web/posting-photo.js').read_bytes(),'manifest.json':(json.dumps(manifest,indent=2)+'\n').encode()}
 for path in (source/'extension/account_queue_worker.js',source/'web/posting-photo.js'):subprocess.run(['node','--check',str(path)],check=True)
 backup=target.parent/'pre-account-photos-68.1.21';backup.mkdir(exist_ok=True)
 for name,data in originals.items():
  path=backup/name
  if path.exists() and path.read_bytes()!=data:raise SystemExit('Backup conflict')
  path.write_bytes(data)
 written=[]
 try:
  for name,data in changes.items():
   path=target/name
   if name in originals and path.read_bytes()!=originals[name]:raise RuntimeError('Concurrent extension change')
   if name not in originals and path.exists():raise RuntimeError('New module already exists')
   path.write_bytes(data);written.append(name)
 except BaseException:
  for name in reversed(written):
   if (target/name).read_bytes()==changes[name]:
    if name in originals:(target/name).write_bytes(originals[name])
    else:(target/name).unlink()
  raise
 print(json.dumps({'version':manifest['version'],'installed_on_disk':True,'reload_required':True,'hashes':{n:hashlib.sha256(data).hexdigest() for n,data in changes.items()}}))
if __name__=='__main__':main(*sys.argv[1:])
