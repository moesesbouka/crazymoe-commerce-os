"""Remove machine notes from current local listings with audit and revision checks."""
import json,sqlite3,sys,shutil,re
from pathlib import Path
BASE=Path.home()/'Documents/Moe-Marketplace-Workflow/intake'
sys.path.insert(0,str(BASE))
from listing_public_copy import clean
from listing_persistence import save_fields,storage_revision,provenance_for
backup=BASE/'backups/manual-notes-only-20261108';backup.mkdir(parents=True,exist_ok=True)
db=sqlite3.connect(BASE/'intake.sqlite3');copy=sqlite3.connect(backup/'before-note-cleanup.sqlite3');db.backup(copy);copy.close()
metadata=provenance_for(db);count=0
for gid,raw in db.execute('SELECT id,fields FROM groups').fetchall():
 fields=json.loads(raw);patch={};manual={k for k,v in metadata.get(gid,{}).items() if v['source'] in ('seller_edit','seller_rollback')}
 for k in ('title','description','notes'):
  if k not in fields or k in manual:continue
  value='' if k=='notes' else clean(fields[k],k)
  if value!=fields[k]:patch[k]=value
 if patch:
  save_fields(db,gid,patch,source='owner_requested_automatic_notes_removal',actor='copy-policy-v2',seller_action=True,expected_storage_revision=storage_revision(fields),reason='Remove machine-written assessments; preserve manual fields')
  count+=1
def scrub(v,key=''):
 if isinstance(v,dict):return {k:scrub(x,k) for k,x in v.items() if not re.search(r'note|observation|needs_seller|reason|warning|internal',k,re.I)}
 if isinstance(v,list):return [scrub(x,key) for x in v]
 if isinstance(v,str) and key in ('title','description','overview','features','details'):return clean(v,'title' if key=='title' else 'description')
 return v
catalog=BASE/'catalog.json';old=catalog.read_text(encoding='utf-8-sig');new=scrub(json.loads(old));shutil.copy2(catalog,backup/'catalog-before-cleanup.json')
assert catalog.read_text(encoding='utf-8-sig')==old
catalog.write_text(json.dumps(new,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'local_saved_listings_cleaned':count,'catalog_entries':len(new),'manual_notes_preserved':True}))
