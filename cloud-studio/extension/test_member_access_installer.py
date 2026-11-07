import unittest
from install_member_access_68120 import transform_background, transform_gallery


class MemberAccessInstallerTests(unittest.TestCase):
    def test_background_replaces_only_expected_database_calls(self):
        source = " ".join(["fetch(`${cfg.url}/rest/v1/x" for _ in range(3)] +
                          ["fetch(`${SB_URL}/rest/v1/x" for _ in range(6)] + ["fetch('https://facebook.com')"])
        changed = transform_background(source)
        self.assertEqual(changed.count("studioMemberFetch("), 9)
        self.assertIn("fetch('https://facebook.com')", changed)

    def test_gallery_preserves_facebook_download_and_secures_database_and_storage(self):
        source = "fetch(url, {}); fetch(url, {}); fetch(src); " + \
            'fetch(cfg.url + "/storage/v1/object/listing-images/" + objectPath, {'
        changed = transform_gallery(source)
        self.assertEqual(changed.count("studioMemberFetch("), 3)
        self.assertIn("fetch(src)", changed)


if __name__ == "__main__":
    unittest.main()
