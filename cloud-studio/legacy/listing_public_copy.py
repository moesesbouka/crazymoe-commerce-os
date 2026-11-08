"""Product facts from automated copy; notes may only come from the seller."""
import re,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from copy_policy.clean import clean

def split_public_research(title,description,manual_fields=()):
    public_title=str(title or '') if 'title' in manual_fields else clean(title,'title')
    public_description=str(description or '') if 'description' in manual_fields else clean(description)
    return {'public_title':public_title,'public_description':public_description,
            'internal_research_notes':'','issues':quantity_issues(public_title,public_description)}

def sanitize_item(item):
    fields=item.get('fields',{})
    manual={key for key,meta in item.get('field_provenance',{}).items()
            if meta.get('source') in ('seller_edit','seller_rollback')}
    for key in ('title','description'):
        if key in fields and key not in manual:fields[key]=clean(fields[key],key)
    if 'notes' not in manual:fields['notes']=''
    item.pop('internal_research_notes',None)
    item.pop('grouping_note',None)
    for key in ('visual_recognition','manufacturer_research','photo_quality'):
        evidence=item.get(key)
        if isinstance(evidence,dict):
            for note in ('notes','observations','reason','needs_seller_input'):evidence.pop(note,None)
    return item

_NUMBERS = {'one':1,'two':2,'three':3,'four':4,'five':5,'six':6,'seven':7,'eight':8,'nine':9,'ten':10,'twelve':12}
_PACK = re.compile(r'(?i)\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*[- ]\s*pack\b|\bpack\s+of\s+(\d+)\b')
def _quantities(text):
    result = set()
    for m in _PACK.finditer(text or ''):
        token = (m.group(1) or m.group(2)).lower()
        result.add(int(token) if token.isdigit() else _NUMBERS[token])
    return result

def quantity_issues(title, description):
    counts = _quantities(title) | _quantities(description)
    return ['Conflicting pack quantities: ' + ', '.join(map(str, sorted(counts))) + '; verify physical quantity'] if len(counts)>1 else []

def listing_copy_issues(title, description):
    return split_public_research(title, description)['issues']

def public_copy(group_id, title, description):
    result = split_public_research(title, description)
    return result['public_title'], result['public_description']
