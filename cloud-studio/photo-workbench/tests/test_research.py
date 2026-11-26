import json
import unittest

from studio.research import catalog_items, evidence_from_page, lookup_product, merchant_target, photo_identifiers, valid_gtin


MODEL = "DX-201"
URL = "https://www.walmart.com/ip/catalog-example/1"


def product_page(model=MODEL, name=None, availability="InStock", price="89.99"):
    return '<script type="application/ld+json">' + json.dumps({
        "@type": "Product", "mpn": model, "name": name or "Example Table Lamp " + model,
        "brand": {"name": "Example"}, "color": "Silver",
        "additionalProperty": [{"name": "Wattage", "value": "40 W"}],
        "offers": {"@type": "Offer", "price": price, "priceCurrency": "USD",
                   "availability": "https://schema.org/" + availability},
    }) + "</script>"


class ProductResearchTest(unittest.TestCase):
    def test_only_readable_model_and_product_barcode_are_sent(self):
        self.assertEqual("12345678905", valid_gtin("012345678905"))
        record = {"tokens": {"DX-201"}, "codes": {"PRIVATE-SERIAL-392899"},
                  "gtins": {"012345678905", "123456789013"}, "text": "SN008245 email@example.test"}
        self.assertEqual(("012345678905", MODEL), photo_identifiers([(record, "label")]))
        standalone = {"text": "LF2000-SLV\n\nFLOOR LAMP WITH READING LIGHT"}
        self.assertEqual(("LF2000-SLV",), photo_identifiers([(standalone, "label")]))
        conflict = {"tokens": {"DX-202"}}
        self.assertEqual((), photo_identifiers([(record, "label"), (conflict, "label")]))

    def test_structured_product_requires_exact_model_and_current_offer(self):
        evidence = evidence_from_page(URL, product_page(), MODEL)
        self.assertEqual(8999, evidence["cents"])
        self.assertEqual("40 W", evidence["specs"]["Wattage"])
        self.assertIsNone(evidence_from_page(URL, product_page(model="DX-201B"), MODEL))
        self.assertIsNone(evidence_from_page(URL, product_page(name="Example DX-201 2-pack"), MODEL))
        self.assertIsNone(evidence_from_page(URL, product_page(availability="OutOfStock"), MODEL)["cents"])
        self.assertIsNone(evidence_from_page(URL, product_page(price="NaN"), MODEL)["cents"])

    def test_lookup_uses_pages_and_skips_untrusted_destinations(self):
        visits = []
        def read(url, deadline):
            visits.append(url)
            if "/search?" in url or "/html/?" in url:
                wrapped = "https://r.search.yahoo.com/r/RU=https%3A%2F%2Fwww.walmart.com%2Fip%2Fcatalog-example%2F1/RS=token"
                return url, f'<a href="https://evil.invalid/track">ignore</a><a href="{wrapped}">Product</a>'
            return url, product_page()
        item = lookup_product([MODEL], read=read)
        self.assertEqual(MODEL, item["model"])
        self.assertEqual([URL], item["identity_sources"])
        self.assertTrue(item["single_source_price"])
        self.assertEqual(8999, item["observations"][0]["cents"])
        self.assertEqual(1, visits.count(URL))
        self.assertFalse(any("evil.invalid" in url for url in visits))

    def test_family_with_unselected_variant_stays_unpriced(self):
        self.assertIsNone(lookup_product([MODEL], {"price_identifiers": ["DX-201A"]},
                                         read=lambda *_: self.fail("A family match went to lookup")))

    def test_catalog_rejects_other_models_and_uses_only_allowed_merchant_links(self):
        items = [{"model": MODEL, "title": "Example Table Lamp"},
                 {"model": MODEL + "B", "title": "Example Table Lamp"},
                 {"model": MODEL, "title": "Example Table Lamp 2-pack"}]
        self.assertEqual(items[:1], catalog_items(json.dumps({"items": items}), MODEL))
        ref = "https://www.upcitemdb.com/norob/alink/?id=sample"
        target = "https://www.jdoqocy.com/go?url=http%3A%2F%2Fwww.officedepot.com%2Fa%2Fproducts%2F1"
        self.assertEqual("https://www.officedepot.com/a/products/1", merchant_target(ref, target))
        bad = "https://www.jdoqocy.com/go?url=https%3A%2F%2Finternal.invalid"
        self.assertEqual(bad, merchant_target(ref, bad))
