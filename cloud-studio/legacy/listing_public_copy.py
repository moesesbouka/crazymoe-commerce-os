"""Pure public-copy projection; research stays separate and originals stay stored.

No product-specific replacement text or group-ID overrides belong here.
"""
import re

_INTERNAL_HEADING = re.compile(
    r'(?i)(?:MANUFACTURER MODEL REFERENCE|IDENTIFICATION\s*/\s*SOURCE CORROBORATION|'
    r'SELLER REVIEW REQUIRED|INTERNAL (?:SKU AUDIT|VERIFICATION NOTES)|'
    r'AI (?:IDENTIFICATION|PROCESSING) NOTES|MANIFEST CORROBORATION|SELLER CHECK)')
_PUBLIC_HEADING = re.compile(
    r'(?i)^(?:ACTUAL ITEM|ACTUAL CONDITION|PRODUCT OVERVIEW|KEY FEATURES|MAIN FEATURES|PRODUCT FEATURES|FEATURES(?: & DETAILS)?|'
    r'(?:TECHNICAL |MANUFACTURER )?SPECIFICATIONS|PHOTOGRAPHED DETAILS|INCLUDED ACCESSORIES|'
    r"WHAT.S INCLUDED|CONDITION(?: NOTES)?|DAMAGE|MISSING (?:PARTS|ACCESSORIES))\b")
_INTERNAL_LINE = re.compile(
    r'(?i)(?:^\s*Source\s*:\s*https?://|^\s*Best Buy SKU\s*:|'
    r'EXACT MODEL LABEL NOT PHOTOGRAPHED|HIGH.CONFIDENCE CANDIDATE|'
    r'\bMANIFEST\s+(?:REFERENCE|CORROBORATION)\b|\bML\d{7,10}\b|'
    r'^\s*(?:Candidate identity|Confidence score|OCR output)\s*:|'
    r'Verify (?:identity|price and condition).*before (?:approving|listing)|'
    r'This is a provisional description|Only actual buyer.safe merchandise photos may be used)')
_DISCLOSURE = re.compile(
    r'(?i)\b(?:exposed wir(?:e|es|ing)|damaged|cracked|broken|missing|not included|'
    r'does not (?:work|power)|doesn.t (?:work|power)|sold for parts|carton \d+ of \d+)\b')
_GENERIC_QA = (
    'Photographs show the actual warehouse item. Manufacturer features describe the model, not verified functionality. Check power, operation, wear, accessories, cables and completeness. Do not assume any unpictured accessory is included. The seller has not confirmed testing or item condition.',
    'The first photos show the actual item; any manufacturer images are references showing its complete intended appearance. Please verify physical condition, included parts and accessories before purchasing.',
    'The warehouse packaging establishes the product family; functionality and package contents remain untested.',
)

def _heading(line):
    # Ignore decorative bullets/emoji only for heading recognition.
    return re.sub(r'^[^A-Za-z0-9]+', '', line.strip()).rstrip(':').strip()

_PROCEDURE_SENTENCE = re.compile(
    r"(?i)^(?:Confirm actual condition, missing parts, hardware and accessories before listing|"
    r"Verify seller condition and included parts before sale|"
    r"Check exact physical contents before approving a listing|"
    r"Check the unit.s electrical rating and seller condition|"
    r"Match exact shape, model and SKU against photographed carton|"
    r"Regional retail SKU: NOT independently established|"
    r"Seller price, selected photo order, condition and published draft remain unchanged|"
    r"Do not use model.specific runtime, motor power, head bundle or accessory count until physically checked)")

def split_public_research(title, description):
    title = str(title or '').strip()
    raw = str(description or '').strip()
    public, internal = [], []
    in_internal = False
    for line in raw.splitlines():
        head = _heading(line)
        if _INTERNAL_HEADING.search(head):
            in_internal = True
            internal.append(line)
            continue
        if _PUBLIC_HEADING.match(head):
            in_internal = False
        # Real buyer disclosures survive even if embedded under a QA heading.
        disclosure = bool(_DISCLOSURE.search(line))
        if line.strip() in _GENERIC_QA or _INTERNAL_LINE.search(head):
            internal.append(line)
        elif in_internal and not disclosure:
            internal.append(line)
        else:
            kept = []
            for sentence in re.split(r'(?<=[.!?])\s+', line):
                if _PROCEDURE_SENTENCE.search(_heading(sentence)):
                    internal.append(sentence)
                else:
                    kept.append(sentence)
            public.append(' '.join(kept))
    # Never replace an informative title with a generic product template.
    public_title = re.sub(r'(?i)\bFront\s+Previous\s+Next\s+', '', title).strip()
    title_issue = bool(_INTERNAL_HEADING.search(title) or _INTERNAL_LINE.search(title))
    if title_issue:
        internal.insert(0, 'Original title: ' + title)
        # Preserve original for editing; export is blocked by the issue list.
    clean = re.sub(r'\n{3,}', '\n\n', '\n'.join(public)).strip()
    issues = []
    if title_issue:
        issues.append('Internal research remains in product title')
    if _INTERNAL_HEADING.search(clean) or _INTERNAL_LINE.search(clean):
        issues.append('Internal research remains in public description')
    issues.extend(quantity_issues(public_title, clean))
    return {'public_title': public_title, 'public_description': clean,
            'internal_research_notes': '\n'.join(internal).strip(), 'issues': issues}

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
