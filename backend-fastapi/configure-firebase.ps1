$ErrorActionPreference = 'Stop'
$BackendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $BackendDir
$EnvPath = Join-Path $BackendDir '.env'
$ExamplePath = Join-Path $BackendDir '.env.example'
$CredentialDestination = Join-Path $BackendDir 'firebase-service-account.json'

function Read-RequiredValue {
    param(
        [Parameter(Mandatory=$true)][string]$Prompt,
        [string]$CurrentValue = '',
        [string]$Pattern = ''
    )
    while ($true) {
        $suffix = if ($CurrentValue) { " [$CurrentValue]" } else { '' }
        $value = (Read-Host "$Prompt$suffix").Trim()
        if (-not $value) { $value = $CurrentValue }
        if (-not $value) {
            Write-Host 'This value is required.' -ForegroundColor Yellow
            continue
        }
        if ($value -match '(?i)your-|replace-with|placeholder|example-project') {
            Write-Host 'Replace the example value with the real value from Firebase Console.' -ForegroundColor Yellow
            continue
        }
        if ($Pattern -and $value -notmatch $Pattern) {
            Write-Host 'That value does not look valid. Please check Firebase Console and try again.' -ForegroundColor Yellow
            continue
        }
        return $value
    }
}

function Read-EnvMap {
    param([string]$Path)
    $values = @{}
    if (Test-Path $Path) {
        foreach ($line in [IO.File]::ReadAllLines($Path)) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
                $values[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
            }
        }
    }
    return $values
}

Write-Host ''
Write-Host 'ShikshaSetu - Firebase Google sign-in setup' -ForegroundColor Green
Write-Host 'This wizard writes your Firebase settings into backend-fastapi/.env.'
Write-Host 'Get the Web App values from Firebase Console > Project settings > General.'
Write-Host 'Get the private JSON key from Project settings > Service accounts.'
Write-Host 'Do not send the service-account JSON to anyone or upload it to GitHub.'
Write-Host ''

if (-not (Test-Path $EnvPath)) {
    if (-not (Test-Path $ExamplePath)) { throw 'backend-fastapi/.env.example was not found. Re-extract the complete ShikshaSetu project.' }
    Copy-Item $ExamplePath $EnvPath
    Write-Host 'Created backend-fastapi/.env from the example settings.' -ForegroundColor Cyan
}

$existing = Read-EnvMap $EnvPath
$apiKey = Read-RequiredValue 'Firebase Web API key' $existing['FIREBASE_API_KEY'] '^AIza[0-9A-Za-z_-]{20,}$'
$authDomain = Read-RequiredValue 'Firebase Auth domain (for example project-id.firebaseapp.com)' $existing['FIREBASE_AUTH_DOMAIN'] '^[A-Za-z0-9.-]+$'
$projectId = Read-RequiredValue 'Firebase Project ID' $existing['FIREBASE_PROJECT_ID'] '^[a-z0-9][a-z0-9-]{4,28}[a-z0-9]$'
$appId = Read-RequiredValue 'Firebase Web App ID (starts with 1:)' $existing['FIREBASE_APP_ID'] '^\d+:\d+:web:[A-Za-z0-9]+$'

Write-Host ''
Write-Host 'Select the Firebase Admin service-account JSON downloaded from Firebase Console.' -ForegroundColor Cyan
$defaultCredential = if (Test-Path $CredentialDestination) { $CredentialDestination } else { '' }
$credentialPrompt = 'Full path to service-account JSON'
if ($defaultCredential) { $credentialPrompt += " [$defaultCredential]" }
$credentialInput = (Read-Host $credentialPrompt).Trim().Trim('"')
if (-not $credentialInput) { $credentialInput = $defaultCredential }
if (-not $credentialInput) { throw 'A Firebase Admin service-account JSON file is required for this local backend setup.' }

$credentialSource = Resolve-Path -LiteralPath $credentialInput -ErrorAction Stop
$credential = Get-Content -LiteralPath $credentialSource -Raw | ConvertFrom-Json
$required = @('project_id', 'client_email', 'private_key', 'token_uri')
$missingCredentialFields = @()
foreach ($field in $required) {
    if ([string]::IsNullOrWhiteSpace([string]$credential.$field)) { $missingCredentialFields += $field }
}
if ($credential.type -ne 'service_account' -or $missingCredentialFields.Count -gt 0) {
    throw 'The selected file is not a complete Firebase Admin service-account JSON. Download a new private key from Firebase Console > Project settings > Service accounts.'
}
if (-not ([string]$credential.private_key).StartsWith('-----BEGIN PRIVATE KEY-----') -or ([string]$credential.private_key) -notmatch '-----END PRIVATE KEY-----') {
    throw 'The selected service-account JSON does not contain a valid private key.'
}
if ([string]$credential.project_id -ne $projectId) {
    throw "Project mismatch: Web App Project ID is '$projectId' but the service-account file belongs to '$($credential.project_id)'. Choose credentials from the same Firebase project."
}

$sourceFullPath = [IO.Path]::GetFullPath([string]$credentialSource)
$destinationFullPath = [IO.Path]::GetFullPath($CredentialDestination)
if ($sourceFullPath -ne $destinationFullPath) {
    Copy-Item -LiteralPath $sourceFullPath -Destination $CredentialDestination -Force
    Write-Host 'Copied the Admin SDK key into backend-fastapi/ (this path is excluded from Git).' -ForegroundColor Cyan
}

$superAdminEmail = Read-RequiredValue 'Initial Super Admin Google email' $existing['BOOTSTRAP_SUPER_ADMIN_EMAIL'] '^[^\s@]+@[^\s@]+\.[^\s@]+$'

$updates = [ordered]@{
    FIREBASE_API_KEY = $apiKey
    FIREBASE_AUTH_DOMAIN = $authDomain
    FIREBASE_PROJECT_ID = $projectId
    FIREBASE_APP_ID = $appId
    FIREBASE_SERVICE_ACCOUNT_PATH = './firebase-service-account.json'
    BOOTSTRAP_SUPER_ADMIN_EMAIL = $superAdminEmail.ToLowerInvariant()
}

$lines = [Collections.Generic.List[string]]::new()
$seen = @{}
foreach ($line in [IO.File]::ReadAllLines($EnvPath)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
        $key = $Matches[1]
        if ($updates.Contains($key)) {
            $lines.Add("$key=$($updates[$key])")
            $seen[$key] = $true
            continue
        }
    }
    $lines.Add($line)
}
foreach ($key in $updates.Keys) {
    if (-not $seen.ContainsKey($key)) { $lines.Add("$key=$($updates[$key])") }
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllLines($EnvPath, $lines.ToArray(), $utf8NoBom)

# Refresh this PowerShell process too. Without this, a previous backend run
# may leave placeholder values in the shell even though .env is now correct.
foreach ($key in $updates.Keys) {
    [Environment]::SetEnvironmentVariable($key, [string]$updates[$key], 'Process')
}

Write-Host ''
Write-Host 'Firebase configuration saved successfully.' -ForegroundColor Green
Write-Host 'Project ID and Admin SDK credentials were checked to belong to the same project.' -ForegroundColor Green
Write-Host 'Next: stop FastAPI (Ctrl+C), then start it again:' -ForegroundColor Cyan
Write-Host '  .\backend-fastapi\run-fastapi.ps1' -ForegroundColor White
Write-Host 'Then refresh http://localhost:5500/index.html and click Check again.' -ForegroundColor Cyan
Write-Host 'The private service-account key remains in backend-fastapi/ and must never be shared.' -ForegroundColor Yellow
