# CrazyMoe Commerce OS — Final Consolidated Starter

This is the final consolidated package for the architecture we landed on:

- `moe-inventory/` = control plane
  - `app/intake/`
  - `app/optimizer/`
  - `app/hub/`
  - `lib/`
  - `api/`
- `extensions/fb-poster/` = Facebook execution layer
- `crm/` = separate customer/post-sale workspace
- `supabase/` = schema + RLS starter

## What was added in this final pass
- FB Poster now creates and updates a **posting session** for a batch
- FB Poster writes **per-item posting results** with durations and error messages
- Hub includes clearer first-run setup guidance and connection refresh behavior
- Shared docs now point clearly at the remaining manual bottlenecks:
  - Google Drive / cloud photo source
  - production OCR/vision server wiring
  - final Facebook live selector verification

## Final recommendation
Use this as the base:
- keep `moe-inventory` as the admin/control plane
- keep FB Poster as the posting execution layer
- keep CRM separate
- keep optimization staged and review-first