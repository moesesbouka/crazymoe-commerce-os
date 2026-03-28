Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "Installing npm dependencies..." -ForegroundColor Cyan
npm install

Write-Host "Installing Playwright browser..." -ForegroundColor Cyan
npx playwright install chromium

Write-Host "Running lint..." -ForegroundColor Cyan
npm run lint

Write-Host "Running tests..." -ForegroundColor Cyan
npm test

Write-Host "Done." -ForegroundColor Green