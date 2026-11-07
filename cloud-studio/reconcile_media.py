"""Read-only local/cloud photo reconciliation. Never writes inventory or selections."""
import argparse
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def reconcile(groups, cloud):
    hashes = set(cloud['original_hashes'])
    indexed = {row['id']: row for row in cloud['items']}
    rows = []
    for group in groups:
        item = indexed.get(group['id'])
        local_hashes = {p['sha'] for p in group.get('photos', []) if p.get('sha')}
        rows.append({
            'id': group['id'],
            'local_originals': len(local_hashes),
            'cloud_originals_matched': len(local_hashes & hashes),
            'originals_missing_from_cloud': sorted(local_hashes - hashes),
            'local_private_references': len(group.get('private_reference_photos', [])),
            'local_manufacturer_photos': len(group.get('manufacturer_images', [])),
            'local_listing_photos': group.get('listing_photo_count', 0),
            'cloud_references': item['references'] if item else None,
            'cloud_prepared': item['prepared'] if item else None,
            'cloud_selected': item['selected'] if item else None,
            'cloud_exports_verified': item['exports_verified'] if item else None,
            'selection_count_differs': item is not None and group.get('listing_photo_count', 0) != item['selected'],
        })
    return {
        'checked_at': datetime.now(timezone.utc).isoformat(),
        'mode': 'read_only', 'local_products': len(groups),
        'cloud_products': len(indexed),
        'local_only': sorted({g['id'] for g in groups} - indexed.keys()),
        'cloud_only': sorted(indexed.keys() - {g['id'] for g in groups}),
        'originals_missing_from_cloud': sum(len(r['originals_missing_from_cloud']) for r in rows),
        'selection_count_differences': sum(r['selection_count_differs'] for r in rows),
        'items': rows,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cloud', required=True, type=Path, help='Private JSON snapshot with verified original_hashes and media items')
    parser.add_argument('--local-url', default='http://127.0.0.1:8765/api/groups')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    with urllib.request.urlopen(args.local_url, timeout=30) as response:
        groups = json.load(response)
    if isinstance(groups, dict):
        groups = groups['groups']
    result = reconcile(groups, json.loads(args.cloud.read_text(encoding='utf-8')))
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'items'}))
