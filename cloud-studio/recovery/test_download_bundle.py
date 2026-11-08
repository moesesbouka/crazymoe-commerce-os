import gzip
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from download_bundle import check_url, download, NoRedirect
from test_verify_bundle import table


class DownloadTests(unittest.TestCase):
    def test_url_boundaries(self):
        path = 'originals/' + 'a' * 64
        good = 'https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/sign/studio-originals/' + path + '?token=test'
        check_url(good, path)
        for bad in [good.replace('https:', 'http:'), good.replace('.co/', '.co.evil/'), good.replace('sign/', 'public/'), good + '#fragment', good.replace('originals/a', 'originals/b')]:
            with self.assertRaises(ValueError):
                check_url(bad, path)

    def test_redirect_blocked(self):
        with self.assertRaises(ValueError):
            NoRedirect().redirect_request(None, None, 302, '', {}, 'https://elsewhere/')

    def test_download_and_cache_then_offline_verify(self):
        body = b'synthetic media'
        sha = hashlib.sha256(body).hexdigest()
        path = 'originals/' + sha
        asset = {'bucket': 'studio-originals', 'object_path': path, 'sha256': sha, 'bytes': len(body), 'cloud_verified_at': None}
        doc = {'format': 1, 'tables': {
            'photo_assets': table([asset], asset.keys()),
            'reference_assets': table([], asset.keys()),
            'photo_choices': table([], ['choice', 'image']),
            'export_sets': table([], ['images'])}}
        core = gzip.compress(json.dumps(doc).encode())
        prefix = 'https://sfheqjnxlkygjfohoybo.supabase.co/storage/v1/object/sign/studio-originals/'
        corepath = 'recovery/2026-11-06/00000000-0000-0000-0000-000000000001.json.gz'
        plan = {'format': 1, 'snapshot': {'path': corepath, 'sha256': hashlib.sha256(core).hexdigest(), 'bytes': len(core), 'url': prefix + corepath},
                'objects': [{'path': path, 'sha256': sha, 'bytes': len(body), 'url': prefix + path}]}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            def open_url(url, timeout):
                return io.BytesIO(core if url == prefix + corepath else body)
            with patch('download_bundle.build_opener') as build:
                build.return_value.open.side_effect = open_url
                first = download(plan, root / 'first')
                self.assertEqual(first['downloaded_objects'], 1)
                build.return_value.open.reset_mock()
                second = download(plan, root / 'second', root / 'first' / 'media.zip')
                self.assertEqual(second['reused_objects'], 1)
                self.assertEqual(build.return_value.open.call_count, 1)
                with self.assertRaises(FileExistsError):
                    download(plan, root / 'first')
                with ZipFile(root / 'first' / 'media.zip', 'w') as z:
                    z.writestr(path, b'x' * len(body))
                with self.assertRaisesRegex(ValueError, 'hash or size'):
                    download(plan, root / 'broken', root / 'first' / 'media.zip')
                self.assertFalse((root / 'broken').exists())


if __name__ == '__main__':
    unittest.main()
