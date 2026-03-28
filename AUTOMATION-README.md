# Automation layer added

What this gives you:
- GitHub Actions CI on every push / PR
- ESLint checks before shipping
- Local Playwright smoke tests for app pages
- One-shot PowerShell bootstrap: `scripts/setup-dev.ps1`

What this does NOT magically solve:
- Facebook Marketplace E2E in cloud CI without a controlled test account/session
- Visual design polish
- Production secret management by itself

Use:
1. `powershell -ExecutionPolicy Bypass -File .\scripts\setup-dev.ps1`
2. Push to GitHub
3. Add the repo and let `.github/workflows/perfect-code.yml` run automatically