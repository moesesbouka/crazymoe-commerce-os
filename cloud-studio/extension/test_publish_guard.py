import importlib.util
import pathlib
import unittest


PATH = pathlib.Path(__file__).with_name("install_publish_guard.py")
SPEC = importlib.util.spec_from_file_location("install_publish_guard", PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class PublishGuardTest(unittest.TestCase):
    def test_patches_only_review_mode_and_preserves_manual_clicks(self):
        source = '''(()=>{\n const ROOT="__moe_approved_panel__";\n async function load(){\n      status.textContent="Verified cloud draft. Review it on Facebook.";\n }\n})();\n'''
        patched = MODULE.patch_panel(source)
        self.assertIn('event.isTrusted||!document.documentElement.hasAttribute("data-crazymoe-cloud-review-only")', patched)
        self.assertIn('event.preventDefault();event.stopImmediatePropagation();', patched)
        self.assertIn('document.documentElement.setAttribute("data-crazymoe-cloud-review-only","1")', patched)
        self.assertIn("Automated publishing was blocked", patched)

    def test_refuses_unreviewed_source(self):
        with self.assertRaises(RuntimeError):
            MODULE.patch_panel("different source")


if __name__ == "__main__":
    unittest.main()
