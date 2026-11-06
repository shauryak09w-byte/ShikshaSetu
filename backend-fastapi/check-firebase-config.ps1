$ErrorActionPreference = 'Stop'
$BackendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvPath = Join-Path $BackendDir '.env'
if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { throw "Missing $EnvPath. Run configure-firebase.ps1 first." }
$Values = @{}
foreach ($line in [IO.File]::ReadAllLines($EnvPath)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $Values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
    }
}
$Required = @('FIREBASE_API_KEY','FIREBASE_AUTH_DOMAIN','FIREBASE_PROJECT_ID','FIREBASE_APP_ID','FIREBASE_SERVICE_ACCOUNT_PATH')
$Failed = $false
Write-Host 'ShikshaSetu Firebase configuration check' -ForegroundColor Cyan
foreach ($key in $Required) {
    $value = [string]$Values[$key]
    $ok = -not [string]::IsNullOrWhiteSpace($value) -and $value -notmatch '(?i)your-|replace-with|placeholder|example-project'
    if ($key -eq 'FIREBASE_SERVICE_ACCOUNT_PATH' -and $ok) {
        $path = [Environment]::ExpandEnvironmentVariables($value)
        if (-not [IO.Path]::IsPathRooted($path)) { $path = Join-Path $BackendDir $path }
        $ok = Test-Path -LiteralPath $path -PathType Leaf
        if ($ok) {
            try {
                $json = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
                $ok = ($json.type -eq 'service_account') -and
                      -not [string]::IsNullOrWhiteSpace([string]$json.project_id) -and
                      -not [string]::IsNullOrWhiteSpace([string]$json.private_key) -and
                      ([string]$json.project_id -eq [string]$Values['FIREBASE_PROJECT_ID'])
            } catch { $ok = $false }
        }
    }
    if ($ok) { Write-Host "[OK] $key" -ForegroundColor Green }
    else { Write-Host "[MISSING/INVALID] $key" -ForegroundColor Yellow; $Failed = $true }
}
if ($Failed) {
    Write-Host 'Run .\backend-fastapi\configure-firebase.ps1 from the project root and follow the prompts.' -ForegroundColor Yellow
    exit 1
}
Write-Host 'All five Firebase settings are present and the Admin SDK project matches.' -ForegroundColor Green
Write-Host 'No credential values or private-key contents were displayed.' -ForegroundColor Cyan
