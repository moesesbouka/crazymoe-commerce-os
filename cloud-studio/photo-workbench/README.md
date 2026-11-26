# Studio photo workbench

Listing Studio opens the workbench at `/photo-workbench.html`. It uses the existing
Studio sign-in to enter and the owner’s Tailscale connection to reach the private
worker. The first time on a device, connect to the desktop’s HTTPS Tailscale Serve
origin. Chrome may ask for local network permission. The browser remembers the
origin for that profile. It sends photo and draft requests to the workbench worker
and keeps Studio authentication tokens on their existing origin.

The AI desktop keeps the originals, upload receipts, drafts, and rendered media
in the pilot’s existing data folder. It uses the existing loopback vision model
and OCR. Draft approval makes the saved revision available as a manual listing
package. Live inventory, pricing, and marketplace publication use their existing
workflows.

## Run locally

```sh
python -m pip install -r requirements.txt
python -m studio.server --data ./data --catalog catalog/warehouse-reviewed.json
```

Install Tesseract and the DejaVu Sans Bold font. Set `MOE_LOCAL_VISION_MODEL` to a
local vision model to enable visual grouping. Completed uploads run OCR, visual
grouping, product research, draft copy, and cover rendering automatically.
When the catalog lacks an exact model or a current offer, the worker searches
for printed model identifiers and retail barcodes and checks structured product
data from supported retailers. Photos and raw OCR stay on the AI desktop.
Verified new retail offers suggest an asking price at half their mean.
Drafts with insufficient evidence display the available fields and their review
checks. Preparing a draft does not approve or publish it.

To enable portal access on the existing private Windows pilot, set
`MOE_STUDIO_PORTAL_ORIGIN=https://studio.crazymoe.com` alongside the configured
`MOE_TAILNET_OWNER` and `MOE_TAILNET_HOST`. Keep the worker bound to loopback
behind Tailscale Serve. Keep the pilot’s data folder when updating its Python
files. The legacy private landing page can continue to serve its existing assets.

## Verify

```sh
python -m unittest discover -s tests -v
```

Against a fresh test server, run `node tests/browser-smoke.cjs` and
`node tests/browser-resume.cjs` with Playwright and Chromium installed.
Before relying on the workbench for warehouse intake, validate physical Pixel
uploads with a large batch, interrupted transfers, and draft review.
