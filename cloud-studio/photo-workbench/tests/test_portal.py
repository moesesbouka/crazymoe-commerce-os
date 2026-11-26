import http.client
import tempfile
import threading
import unittest

from studio.server import App
from studio.store import Store


class PortalAccessTest(unittest.TestCase):
    origin = "https://studio.crazymoe.com"
    host = "workbench.test-tailnet.ts.net:8444"
    owner = "owner@example.test"

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = App(("127.0.0.1", 0), Store(self.temp.name),
                       tailnet_owner=self.owner, tailnet_host=self.host, portal_origin=self.origin)
        threading.Thread(target=self.app.serve_forever, daemon=True).start()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.app.server_close)
        self.addCleanup(self.app.shutdown)

    def request(self, method="GET", path="/api/workbench", headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.app.server_port, timeout=4)
        try:
            conn.request(method, path, headers={"Host": self.host, "Tailscale-User-Login": self.owner,
                                                "Origin": self.origin, **(headers or {})})
            response = conn.getresponse()
            response.read()
            return response.status, dict(response.getheaders())
        finally:
            conn.close()

    def test_portal_requires_both_the_correct_origin_and_tailnet_owner(self):
        status, headers = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], self.origin)
        self.assertEqual(headers["Vary"], "Origin")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn("Access-Control-Allow-Credentials", headers)
        for mistake in ({"Origin": "https://other.example.test"},
                        {"Tailscale-User-Login": ""}, {"Host": "localhost"}):
            with self.subTest(mistake=mistake):
                self.assertEqual(self.request(headers=mistake)[0], 403)
        status, headers = self.request(path="/")
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_upload_preflight_allows_only_the_protocol_headers(self):
        options = {"Access-Control-Request-Method": "PUT",
                   "Access-Control-Request-Headers": "Content-Type, Upload-Offset"}
        status, headers = self.request("OPTIONS", "/api/batches/example/files/example", options)
        self.assertEqual(status, 204)
        self.assertIn("upload-offset", headers["Access-Control-Allow-Headers"])
        for change in ({"Access-Control-Request-Headers": "Authorization"},
                       {"Access-Control-Request-Method": "DELETE"},
                       {"Tailscale-User-Login": "someone@example.test"},
                       {"Origin": "https://other.example.test"}):
            with self.subTest(change=change):
                self.assertEqual(self.request("OPTIONS", headers={**options, **change})[0], 403)

    def test_direct_private_preview_still_works(self):
        status, headers = self.request(path="/", headers={"Origin": f"https://{self.host}"})
        self.assertEqual(status, 200)
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertNotIn("Access-Control-Allow-Origin", headers)
