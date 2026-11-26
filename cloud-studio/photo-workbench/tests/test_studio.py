import hashlib
import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
import zipfile
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace

from PIL import Image, ImageDraw, ImageFont

from studio.local_vision import normalized_groups
from studio.pipeline import BRAND, burst_drafts, catalog_match, compile_draft, ocr, process, suggest_price, validate_groups
from studio.server import App
from studio.store import Store


def fixture(index, label=False):
    im = Image.new("RGB", (760, 540), "#eae9e5")
    draw = ImageDraw.Draw(im)
    if label:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 38)
        draw.text((45, 190), f"MODEL CM-{index:03}", font=font, fill="black")
        draw.text((45, 270), f"SERIAL TST{index:03}", font=font, fill="black")
    else:
        start = 100 + index % 112
        draw.rounded_rectangle((start, 135, start + 330, 420), radius=25,
                               fill=(10 + index % 200, 65, 92), outline="#233239", width=8)
        draw.ellipse((start + 55, 205, start + 140, 287), fill="#eeae45")
        draw.line((start + 25, 350, start + 295, 350), fill="#f7dfb6", width=12)
    content = io.BytesIO()
    im.save(content, "JPEG", quality=86)
    return content.getvalue()


def catalog_item(index):
    model = f"CM-{index:03}"
    return {"model": model, "title": "Test item " + model, "specs": {"Finish": "Blue"},
            "observations": [{"model": model, "kind": "retail", "cents": cents,
                              "date": date.today().isoformat(), "url": f"https://{host}.invalid/product"}
                             for host, cents in (("fixture-one", 10000), ("fixture-two", 12000))]}


def synthetic_grouper(store, records):
    """Test fixture adapter. Production grouping never reads these names."""
    groups = {}
    for i, record in enumerate(records):
        key, role = record["name"].split("-")[:2]
        groups.setdefault(key, {"type": "Synthetic product", "uncertain": False, "photos": []})
        groups[key]["photos"].append({"index": i, "role": role})
    return validate_groups(list(groups.values()), len(records))


class StudioIntegrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name)
        self.app = App(("127.0.0.1", 0), self.store)
        self.thread = threading.Thread(target=self.app.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.app.server_port}"
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.app.server_close)
        self.addCleanup(self.app.shutdown)

    def api(self, path, method="GET", data=None, headers=None, error=None):
        headers = headers or {}
        if isinstance(data, dict):
            data = json.dumps(data).encode()
            headers = {"Content-Type": "application/json", **headers}
        request = urllib.request.Request(self.url + path, data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                content = response.read()
                self.assertIsNone(error)
                return json.loads(content) if response.headers.get_content_type() == "application/json" else content
        except urllib.error.HTTPError as failed:
            self.assertEqual(error, failed.code, failed.read())

    def create(self, manifest, key=None):
        return self.api("/api/batches", "POST", {"key": key or uuid.uuid4().hex,
                        "files": [{"name": name, "size": len(data), "sha": hashlib.sha256(data).hexdigest()}
                                  for name, data in manifest]})

    def upload(self, batch, f, data, offset=0, error=None):
        return self.api(f"/api/batches/{batch}/files/{f['id']}", "PUT", data, {"Upload-Offset": str(offset)}, error)

    def test_64_photo_intake_to_approved_package(self):
        manifest = [(f"{i}-label-image.jpg", fixture(i, label=True)) for i in range(7)]
        manifest.extend((f"{i % 7}-product-image-{i}.jpg", fixture(i + 10)) for i in range(57))
        key = uuid.uuid4().hex
        batch = self.create(manifest, key)
        bid, files = batch["id"], batch["files"]
        data = manifest[0][1]
        midpoint = len(data) // 2
        self.assertEqual(midpoint, self.upload(bid, files[0], data[:midpoint])["offset"])
        self.assertEqual(midpoint, self.upload(bid, files[0], data[:midpoint])["offset"])
        self.upload(bid, files[0], b"mismatch", error=409)
        self.assertEqual(midpoint, Store(self.temp.name).batch(bid)["files"][0]["offset"])
        resumed = self.create(manifest, key)
        self.assertEqual(bid, resumed["id"])
        self.assertEqual("accepted", self.upload(bid, files[0], data[midpoint:], midpoint)["state"])
        for file, (_, data) in zip(files[1:], manifest[1:]):
            self.assertEqual("accepted", self.upload(bid, file, data)["state"])
        self.assertEqual("queued", self.api(f"/api/batches/{bid}")["state"])
        self.api(f"/api/batches/{bid}/commit", "POST", {})
        claim = self.store.claim()
        process(self.store, *claim, {item["model"]: item for item in map(catalog_item, range(7))},
                grouping=synthetic_grouper)
        result = self.api(f"/api/batches/{bid}")
        self.assertEqual("review", result["state"])
        self.assertEqual(7, len(result["drafts"]))
        self.assertEqual(64, sum(len(d["photos"]) for d in result["drafts"]))
        draft = result["drafts"][0]
        self.assertEqual(5500, draft["price_cents"])
        self.assertEqual("CM-000", draft["identity"])
        self.assertNotIn(files[0]["id"], draft["gallery"])
        self.assertTrue(draft["issues"])
        path = f"/api/drafts/{draft['id']}"
        self.api(path + "/approve", "POST", {"revision": 1}, error=422)
        updated = self.api(path, "PATCH", {"revision": 1, "condition_confirmed": True, "photo_reviewed": True})
        self.assertFalse(updated["issues"])
        self.api(path + "/approve", "POST", {"revision": 2})
        text = self.api(path + "/copy", "POST", {"revision": 2, "channel": "storefront"})["text"]
        self.assertIn("$55.00", text)
        raw = self.api(path + "/export", "POST", {"revision": 2, "channel": "storefront"})
        with zipfile.ZipFile(io.BytesIO(raw)) as package:
            self.assertIn("$55.00", package.read("listing.txt").decode())
            with Image.open(io.BytesIO(package.read("photos/01.jpg"))) as cover:
                self.assertEqual((1600, 1600), cover.size)
                thumbnail = cover.resize((320, 320))
                self.assertIn(BRAND, ocr(thumbnail.crop((0, 274, 320, 312)), psm=7).lower().replace(" ", ""))
        self.api(path, "PATCH", {"revision": 1, "title": "Stale"}, error=409)
        self.api(path, "PATCH", {"revision": 2, "price_cents": 4900})
        self.api(path + "/export", "POST", {"revision": 2, "channel": "storefront"}, error=409)
        self.api(path + "/copy", "POST", {"revision": 2, "channel": "storefront"}, error=409)

    def test_unsupported_duplicate_and_corrupt_uploads_have_receipts(self):
        jpeg = fixture(2)
        manifest = [("same.jpg", jpeg), ("duplicate.jpg", jpeg), ("broken.jpg", b"not a photo"), ("different.jpg", jpeg)]
        batch = self.create(manifest)
        bid = batch["id"]
        states = []
        for i, (file, (_, data)) in enumerate(zip(batch["files"], manifest)):
            if i == 3:
                data = data[:-1] + b"0"
            states.append(self.upload(bid, file, data)["state"])
        self.assertEqual(["accepted", "duplicate", "rejected", "rejected"], states)
        self.assertEqual("queued", self.store.batch(bid)["state"])
        self.assertTrue(self.api("/api/private-photo/" + batch["files"][0]["id"]).startswith(b"\xff\xd8"))
        self.assertEqual(403, self.forbidden_origin())

    def forbidden_origin(self):
        request = urllib.request.Request(self.url + "/api/batches", b"{}", {"Origin": "https://example.invalid"})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        return error.exception.code

    def test_variant_and_price_evidence_contract(self):
        item = catalog_item(0)
        item["observations"][0]["model"] = "CM-001"
        self.assertIsNone(suggest_price(item, "New")["cents"])
        self.assertIsNone(suggest_price(item, "Used")["cents"])
        with self.assertRaises(ValueError):
            validate_groups([{"type": "duplicate", "uncertain": False,
                              "photos": [{"index": 0, "role": "product"}] * 2}], 2)

    def test_private_barcode_can_match_catalog_without_entering_gallery(self):
        item = catalog_item(0)
        item["identifiers"] = [item["model"], "123456789012"]
        item["price_identifiers"] = ["123456789012"]
        catalog = {item["model"]: item}
        records = [{"id": "private-photo", "name": "label.jpg", "text": "", "tokens": {item["model"]},
                    "sensitive": True, "score": 100, "codes": set()}]
        group = {"type": "Accessory", "uncertain": True, "photos": [{"index": 0, "role": "product", "cover": True}]}
        draft = compile_draft(self.store, group, records, catalog, "local vision")
        self.assertEqual(item["model"], draft["identity"])
        self.assertIsNone(draft["price_cents"])
        records[0]["codes"] = {"123456789012"}
        draft = compile_draft(self.store, group, records, catalog, "local vision")
        self.assertEqual(5500, draft["price_cents"])
        self.assertEqual([], draft["gallery"])
        self.assertIsNone(draft["cover"])

    def test_model_cannot_choose_a_private_or_duplicate_frame(self):
        answer = {"private": [2], "detail": [], "groups": [
            {"type": "scale", "description": "Black glass scale.", "photos": [1, 2], "cover": 2}
        ]}
        parsed = validate_groups(normalized_groups(answer, 2), 2)
        self.assertTrue(parsed[0]["uncertain"])
        self.assertEqual("label", parsed[0]["photos"][1]["role"])
        self.assertFalse(parsed[0]["photos"][1]["cover"])
        answer["groups"][0]["photos"] = [1, 1]
        with self.assertRaises(ValueError):
            validate_groups(normalized_groups(answer, 2), 2)

    def test_burst_rejects_unsupported_feeder_type_and_keeps_safe_angles(self):
        records = [{"id": f"photo-{i}", "taken": datetime(2026, 11, 26, 12),
                    "text": "LUMA 400" if i < 2 else "SERIAL", "sensitive": i == 2,
                    "tokens": set(), "score": 4} for i in range(3)]
        vision = SimpleNamespace(review_burst=lambda *args, **kwargs: {
            "kind": "Automatic Pet Feeder", "cover": 0, "angles": [1, 2],
        })
        group, = burst_drafts(self.store, records, {}, vision)
        self.assertEqual("", group["type"])
        self.assertEqual(["product", "product", "label"], [p["role"] for p in group["photos"]])
        self.assertTrue(group["photos"][0]["cover"])
        records[0]["text"] = "Pet feeder"
        group, = burst_drafts(self.store, records, {}, vision)
        self.assertEqual("Automatic Pet Feeder", group["type"])

    def test_catalog_keeps_halo_plus_distinct_from_halo(self):
        item = {"model": "XGIMI HALO+", "identifiers": ["XGIMI HALO+"]}
        record = {"text": "XGIMI Halo", "tokens": set(), "sensitive": False}
        self.assertIsNone(catalog_match(self.store, [(record, "product")], {item["model"]: item})[0])
        record["text"] = "XGIMI Halo+"
        self.assertEqual(item, catalog_match(self.store, [(record, "product")], {item["model"]: item})[0])

    def test_gallery_revision_renders_added_photo_and_rejects_label(self):
        images = [fixture(0), fixture(1), fixture(0, label=True)]
        batch = self.create([(f"photo-{i}.jpg", data) for i, data in enumerate(images)])
        for file, data in zip(batch["files"], images, strict=True):
            self.upload(batch["id"], file, data)
        group = {"type": "Accessory", "uncertain": False, "photos": [
            {"index": 0, "role": "product", "cover": True},
            {"index": 1, "role": "accessory"},
            {"index": 2, "role": "label"},
        ]}
        process(self.store, *self.store.claim(), {"CM-000": catalog_item(0)}, grouping=lambda *_: [group])
        draft = self.store.batch(batch["id"])["drafts"][0]
        first, second, label = [f["id"] for f in batch["files"]]
        path = f"/api/drafts/{draft['id']}"
        self.assertEqual([first], draft["gallery"])
        self.api(path, "PATCH", {"revision": 1, "gallery": [first, label]}, error=400)
        changed = self.api(path, "PATCH", {"revision": 1, "gallery": [second],
                                           "cover": second, "photo_reviewed": True})
        self.assertEqual([second], changed["gallery"])
        self.assertEqual(second, changed["cover"])
        self.assertFalse(changed["photo_reviewed"])
        self.assertTrue((self.store.root / "renders" / (second + "-storefront.jpg")).is_file())

    def test_failed_lease_recovers_without_duplicate_drafts(self):
        image = fixture(1)
        batch = self.create([("item.jpg", image)])
        bid = batch["id"]
        self.upload(bid, batch["files"][0], image)
        first = self.store.claim()
        with self.store.connection(write=True) as db:
            db.execute("UPDATE jobs SET expires=0 WHERE batch_id=?", (bid,))
        second = self.store.claim()
        self.assertNotEqual(first[1], second[1])
        self.store.finish(bid, first[1], [{"stale": True}])
        self.assertEqual([], self.store.batch(bid)["drafts"])
        process(self.store, *second, {}, grouping=lambda *args: None)
        self.assertEqual(1, len(self.store.batch(bid)["drafts"]))
        self.assertIsNone(self.store.claim())


if __name__ == "__main__":
    unittest.main()
