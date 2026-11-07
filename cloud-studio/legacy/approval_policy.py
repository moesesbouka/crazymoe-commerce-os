"""Versioned public approval projection, distinct from edit concurrency."""
import hashlib
import json
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path

@lru_cache(maxsize=512)
def _digest(path, size, mtime_ns):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def public_payload(group):
    f = group.get('fields') or {}
    raw = str(f.get('price', '')).strip().removeprefix('$').replace(',', '')
    try:
        value = Decimal(raw)
        price = format(value.normalize(), 'f') if value.is_finite() and value > 0 else raw
    except InvalidOperation:
        price = raw
    refs = {p.get('id'):p for p in group.get('manufacturer_images', [])}
    photos = []
    for p in group.get('listing_photos') or []:
        kind = 'manufacturer' if p.get('kind') == 'stock' else p.get('kind')
        photo = {'kind':kind, 'identity':p.get('sha') if kind == 'real' else p.get('id')}
        if kind == 'real':
            photo.update(style=p.get('style_mode', 'natural'), pop=bool(p.get('pop')), recipe='existing-finish-v4-pop-v1')
        else:
            path = Path(str(refs.get(p.get('id'), {}).get('path', '')))
            try:
                stat = path.stat()
                photo['sha256'] = _digest(str(path), stat.st_size, stat.st_mtime_ns)
            except OSError:
                photo['sha256'] = 'unavailable'
        photos.append(photo)
    return {'policy':'public-listing-v2', 'group_id':group['id'],
            'title':str(f.get('title', '')), 'description':str(f.get('description', '')),
            'price':price, 'condition':str(f.get('condition', '')),
            'model':str(f.get('model', '')), 'category':str(f.get('category', '')),
            'photos':photos}

def fingerprint(group):
    return hashlib.sha256(json.dumps(public_payload(group), sort_keys=True,
        separators=(',', ':'), ensure_ascii=False).encode('utf-8')).hexdigest()
