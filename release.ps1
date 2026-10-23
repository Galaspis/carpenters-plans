# ============================================================
#  Carpenter's Plans — release script (the one way to publish)
#  Usage:  .\release.ps1 -Message "what changed"
#  Does, in order, and stops on any failure:
#    1. Syntax-checks the app's JavaScript and runs the headless design tests
#    2. Bumps the version stamp in index.html + sw.js (so phones pick up the update)
#    3. Commits to git (if the folder is a git repo)
#    4. Deploys to the gallab server (woody.gallab.top)
#    5. Verifies the server has the new version
# ============================================================
param([Parameter(Mandatory=$true)][string]$Message)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# --- 1. checks ---
Get-ChildItem app\js\*.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { throw "syntax error in $($_.Name)" } }
$env:QUIET = '1'; node app\test\run.mjs | Select-Object -Last 1
if ($LASTEXITCODE -ne 0) { throw 'design tests FAILED - not deploying' }
Write-Host '[1/5] checks OK' -ForegroundColor Green

# --- 2. version stamp ---
# read/write as strict UTF-8 without BOM (PowerShell 5.1 would otherwise mangle the Hebrew)
$utf8 = New-Object System.Text.UTF8Encoding($false)
$htmlPath = Join-Path $PSScriptRoot 'app\index.html'; $swPath = Join-Path $PSScriptRoot 'app\sw.js'
$html = [IO.File]::ReadAllText($htmlPath, $utf8)
$m = [regex]::Match($html, '>v(\d+)<')
$v = [int]$m.Groups[1].Value + 1
$html = $html -replace '>v\d+<', ">v$v<"
[IO.File]::WriteAllText($htmlPath, $html, $utf8)
$sw = [IO.File]::ReadAllText($swPath, $utf8)
$sw = $sw -replace "const VERSION = 'cp-v\d+';", "const VERSION = 'cp-v$v';"
[IO.File]::WriteAllText($swPath, $sw, $utf8)
Write-Host "[2/5] version v$v" -ForegroundColor Green

# --- 3. git (optional) ---
if (Test-Path .git) {
  git add -A
  if (git status --porcelain) { git commit -m "$Message (v$v)" | Out-Null }
  if (git remote) { git push }
  Write-Host '[3/5] git committed' -ForegroundColor Green
} else { Write-Host '[3/5] no git repo - skipped' -ForegroundColor Yellow }

# --- 4. deploy: the push above triggers .github/workflows/deploy.yml (rsync to the gallab server + Caddy) ---
Write-Host '[4/5] waiting for the GitHub deploy Action...' -ForegroundColor Cyan
Start-Sleep -Seconds 8
$runId = (gh run list --repo Galaspis/carpenters-plans --branch master --limit 1 --json databaseId --jq '.[0].databaseId')
if (-not $runId) { throw 'no deploy run found (is gh logged in?)' }
gh run watch $runId --repo Galaspis/carpenters-plans --exit-status --interval 5 | Out-Null
if ($LASTEXITCODE -ne 0) { gh run view $runId --repo Galaspis/carpenters-plans --log-failed | Select-Object -Last 20; throw 'deploy Action failed' }
Write-Host '[4/5] deployed by Action' -ForegroundColor Green

# --- 5. verify (the site is behind the login, so check the file on the server itself) ---
$live = ssh ubuntu@hub "grep -c '>v$v<' /srv/woody/site/index.html"
if ("$live".Trim() -ne '1') { throw "server copy did not return v$v" }
Write-Host "[5/5] live: https://woody.gallab.top (v$v)" -ForegroundColor Green
