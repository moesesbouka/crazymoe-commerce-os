# Existing photo recipe in cloud runtime

`renderer.py` accepts verified bytes and produces a 1600×1600 JPEG using the captured office algorithms. It preserves natural enhancement, guarded blur/branding, manufacturer-image handling, reviewed focus crops and optional Pop. Existing migrated exports must be served unchanged. The new cloud recipe version identifies seeded OpenCV execution and pinned libraries; it does not assert byte identity with historical Windows outputs or Windows fonts.

`office_recipe/` is the unmodified algorithm reference captured from the running office source. Tests compare JPEG bytes under the same runtime across six recipe combinations, check repeatability and reject unsafe inputs. Synthetic images only; no inventory photos are included.

`api/render.py` is an authenticated, read-only preview endpoint for a selected photo on a product that has no verified export set. It verifies membership through Studio, binds both revisions, downloads only a server-signed private source, verifies its hash and rechecks revisions after rendering. It refuses to replace existing exports. This endpoint does not store output, approve products or publish listings.

Run `python -m unittest discover -s cloud-studio/render -p 'test_*.py' -v` with requirements installed. Production integration still needs durable render jobs, verified private export registration, reviewed per-source crop metadata and UI acceptance. No renderer completion or office-independent workflow acceptance is claimed.
