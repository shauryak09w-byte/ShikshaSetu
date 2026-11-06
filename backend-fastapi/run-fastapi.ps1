$ErrorActionPreference = 'Stop'
$BackendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $BackendDir

# Create a local settings file on first run. It contains placeholders only;
# real Firebase values and the private Admin SDK key are configured by the user.
if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Created backend-fastapi/.env from .env.example.' -ForegroundColor Cyan
}

# This Windows launcher is for local development. Treat backend-fastapi/.env
# as the source of truth and overwrite values left in this PowerShell process
# by an earlier run. This prevents stale placeholder Firebase values from
# surviving after configure-firebase.ps1 updates .env.
Get-Content '.env' | ForEach-Object {
  $Line = $_.Trim()
  if ($Line -match '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    $Name = $Matches[1]
    $Value = $Matches[2].Trim()
    if ($Value.Length -ge 2) {
      if (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
          ($Value.StartsWith("'") -and $Value.EndsWith("'"))) {
        $Value = $Value.Substring(1, $Value.Length - 2)
      }
    }
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
  }
}

if (-not (Test-Path '.venv')) {
  Write-Host 'Creating Python virtual environment...' -ForegroundColor Cyan
  py -3 -m venv .venv
}

$Python = Join-Path $BackendDir '.venv\Scripts\python.exe'
$Pip = Join-Path $BackendDir '.venv\Scripts\pip.exe'
if (-not (Test-Path $Python)) { throw 'Python 3 is required. Install Python 3.11 or newer and try again.' }

Write-Host 'Installing / verifying FastAPI dependencies...' -ForegroundColor Cyan
& $Python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'pip upgrade failed.' }
& $Pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }

if (-not $env:BOOTSTRAP_SUPER_ADMIN_EMAIL) {
  do {
    $env:BOOTSTRAP_SUPER_ADMIN_EMAIL = (Read-Host 'Initial Super Admin Google email (must be verified in Firebase)').Trim().ToLowerInvariant()
    if ($env:BOOTSTRAP_SUPER_ADMIN_EMAIL -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
      Write-Host 'Enter a valid email address.' -ForegroundColor Yellow
      $env:BOOTSTRAP_SUPER_ADMIN_EMAIL = ''
    }
  } while (-not $env:BOOTSTRAP_SUPER_ADMIN_EMAIL)
}

if (-not $env:CORS_ORIGINS) {
  $env:CORS_ORIGINS = 'http://localhost:5500,http://127.0.0.1:5500,http://localhost:5501'
}

# Safe Firebase preflight: report status only; never print API values or private keys.
$FirebaseKeys = @('FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID')
$MissingFirebase = @()
foreach ($Key in $FirebaseKeys) {
  $Value = [Environment]::GetEnvironmentVariable($Key, 'Process')
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '(?i)your-|replace-with|placeholder|example-project') {
    $MissingFirebase += $Key
  }
}
$CredentialSetting = [Environment]::GetEnvironmentVariable('FIREBASE_SERVICE_ACCOUNT_PATH', 'Process')
if ([string]::IsNullOrWhiteSpace($CredentialSetting)) {
  $MissingFirebase += 'FIREBASE_SERVICE_ACCOUNT_PATH'
} else {
  $CredentialPath = [Environment]::ExpandEnvironmentVariables($CredentialSetting.Trim().Trim('"'))
  if (-not [IO.Path]::IsPathRooted($CredentialPath)) { $CredentialPath = Join-Path $BackendDir $CredentialPath }
  if (-not (Test-Path -LiteralPath $CredentialPath -PathType Leaf)) { $MissingFirebase += 'Firebase service-account JSON file' }
}
if ($MissingFirebase.Count -gt 0) {
  Write-Host ('Firebase sign-in still needs configuration: ' + ($MissingFirebase -join ', ')) -ForegroundColor Yellow
  Write-Host 'Run .\backend-fastapi\configure-firebase.ps1 from the project root, then restart this launcher.' -ForegroundColor Yellow
} else {
  Write-Host 'Firebase environment values and service-account file are present.' -ForegroundColor Green
}

Write-Host 'Starting ShikshaSetu FastAPI on http://localhost:8000 ...' -ForegroundColor Green
Write-Host 'After the server starts, the login page will show whether Firebase Google sign-in is ready.' -ForegroundColor Cyan
& $Python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
