"""Scoped office intake update. Run from a staged directory containing tested files."""
from pathlib import Path
import ast,hashlib,shutil,sys
BASE=Path.home()/'Documents/Moe-Marketplace-Workflow/intake'
STAGE=Path(__file__).parent
service=BASE/'intake_service.py';original=service.read_text(encoding='utf-8')
needle='separated = split_public_research(fields.get("title",""), fields.get("description",""))'
replacement='separated = split_public_research(fields.get("title",""), fields.get("description",""), manual_fields={key for key,meta in item["field_provenance"].items() if meta.get("source") in ("seller_edit","seller_rollback")})'
assert original.count(needle)==1,'Unexpected service version'
updated=original.replace(needle,replacement)
# Run the output boundary after all enrichers, immediately before returning the groups.
start=updated.index('def read_groups(')
end=updated.index('\ndef ',start+5)
section=updated[start:end]
assert section.count('    return kept')==1,'Unexpected group return'
section=section.replace('    return kept','    from listing_public_copy import sanitize_item\n    return [sanitize_item(item) for item in kept]')
updated=updated[:start]+section+updated[end:];ast.parse(updated)
backup=BASE/'backups/manual-notes-only-20261108';backup.mkdir(parents=True,exist_ok=True)
assert hashlib.sha256((BASE/'listing_persistence.py').read_bytes()).hexdigest()=='d9a1dd4be7a681648cd66b8214ef6e8742bc3e90fc3a7e4233246f319fa4de73','Concurrent persistence edit'
for name in ('intake_service.py','listing_public_copy.py','listing_persistence.py'):
 shutil.copy2(BASE/name,backup/name)
# Ensure no concurrent source edit was overwritten.
assert service.read_text(encoding='utf-8')==original
for name in ('listing_public_copy.py','listing_persistence.py'):
 ast.parse((STAGE/name).read_text(encoding='utf-8'));shutil.copy2(STAGE/name,BASE/name)
policy=BASE/'copy_policy';policy.mkdir(exist_ok=True)
for name in ('clean.py','policy.json'):shutil.copy2(STAGE/'copy_policy'/name,policy/name)
service.write_text(updated,encoding='utf-8')
print('Office intake source updated; backup and syntax checks complete')
