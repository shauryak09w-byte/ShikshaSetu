$ErrorActionPreference = 'Stop'
$NewRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$NewBackend = Join-Path $NewRoot 'backend-fastapi'
if (-not (Test-Path -LiteralPath $NewBackend -PathType Container)) {
    throw 'Run this script from the extracted ShikshaSetu project root. The backend-fastapi folder was not found.'
}

$DefaultOldRoot = Join-Path $env:USERPROFILE 'Desktop\final\ShikshaSetu-Firebase-Setup-Fix\ShikshaSetu-FullStack-Responsive-Moss-Fix'
Write-Host ''
Write-Host 'ShikshaSetu project switch - preserve existing local data and Firebase settings' -ForegroundColor Green
Write-Host 'This copies configuration and database files from your previous project into this patched project.'
Write-Host 'Your previous project will not be changed. Existing files in this new project are backed up first.'
Write-Host ''
$OldRootInput = (Read-Host "Path to your OLD project root (folder containing index.html) [$DefaultOldRoot]").Trim().Trim('"')
if (-not $OldRootInput) { $OldRootInput = $DefaultOldRoot }
$OldRoot = [IO.Path]::GetFullPath($OldRootInput)
$OldBackend = Join-Path $OldRoot 'backend-fastapi'
if (-not (Test-Path -LiteralPath $OldBackend -PathType Container)) {
    throw "Could not find '$OldBackend'. Enter the old project root folder that contains index.html and backend-fastapi."
}
if ([IO.Path]::GetFullPath($OldRoot).TrimEnd('\') -eq [IO.Path]::GetFullPath($NewRoot).TrimEnd('\')) {
    throw 'The old and new project folders are the same. Extract the patched ZIP into a new folder first.'
}

$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$OldEnv = Join-Path $OldBackend '.env'
$NewEnv = Join-Path $NewBackend '.env'
$OldData = Join-Path $OldBackend 'data'
$NewData = Join-Path $NewBackend 'data'

if (Test-Path -LiteralPath $OldEnv -PathType Leaf) {
    if (Test-Path -LiteralPath $NewEnv -PathType Leaf) {
        Copy-Item -LiteralPath $NewEnv -Destination (Join-Path $NewBackend ".env.before-switch-$Stamp") -Force
    }
    Copy-Item -LiteralPath $OldEnv -Destination $NewEnv -Force
    Write-Host 'Copied existing backend-fastapi/.env (contents not displayed).' -ForegroundColor Green
} else {
    Write-Warning 'The old project has no backend-fastapi/.env. Firebase must be configured with configure-firebase.ps1 after switching.'
}

if (Test-Path -LiteralPath $OldData -PathType Container) {
    if (Test-Path -LiteralPath $NewData -PathType Container) {
        Move-Item -LiteralPath $NewData -Destination (Join-Path $NewBackend "data.before-switch-$Stamp")
    }
    Copy-Item -LiteralPath $OldData -Destination $NewBackend -Recurse -Force
    Write-Host 'Copied existing database/data folder. The previous new-package data folder (if any) was backed up.' -ForegroundColor Green
} else {
    Write-Warning 'No old backend-fastapi/data folder was found. Existing database files were not copied.'
}

# Locate the service-account file using the old .env setting, or the wizard's default filename.
$CredentialSource = $null
if (Test-Path -LiteralPath $OldEnv -PathType Leaf) {
    $envLines = [IO.File]::ReadAllLines($OldEnv)
    $credentialLine = $envLines | Where-Object { $_ -match '^\s*FIREBASE_SERVICE_ACCOUNT_PATH\s*=' } | Select-Object -Last 1
    if ($credentialLine) {
        $credentialSetting = ($credentialLine -replace '^\s*FIREBASE_SERVICE_ACCOUNT_PATH\s*=\s*', '').Trim().Trim('"').Trim("'")
        if ($credentialSetting) {
            $credentialSetting = [Environment]::ExpandEnvironmentVariables($credentialSetting)
            if ([IO.Path]::IsPathRooted($credentialSetting)) {
                $candidate = $credentialSetting
            } else {
                $candidate = Join-Path $OldBackend $credentialSetting
            }
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $CredentialSource = (Resolve-Path -LiteralPath $candidate).Path }
        }
    }
}
if (-not $CredentialSource) {
    $defaultOldCredential = Join-Path $OldBackend 'firebase-service-account.json'
    if (Test-Path -LiteralPath $defaultOldCredential -PathType Leaf) { $CredentialSource = (Resolve-Path -LiteralPath $defaultOldCredential).Path }
}

if ($CredentialSource) {
    $NewCredential = Join-Path $NewBackend 'firebase-service-account.json'
    if (Test-Path -LiteralPath $NewCredential -PathType Leaf) {
        Copy-Item -LiteralPath $NewCredential -Destination (Join-Path $NewBackend "firebase-service-account.before-switch-$Stamp.json") -Force
    }
    Copy-Item -LiteralPath $CredentialSource -Destination $NewCredential -Force

    # Make the copied .env point to the key's new local path, without displaying its contents.
    if (Test-Path -LiteralPath $NewEnv -PathType Leaf) {
        $lines = [Collections.Generic.List[string]]::new()
        $updated = $false
        foreach ($line in [IO.File]::ReadAllLines($NewEnv)) {
            if ($line -match '^\s*FIREBASE_SERVICE_ACCOUNT_PATH\s*=') {
                if (-not $updated) { $lines.Add('FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json'); $updated = $true }
            } else {
                $lines.Add($line)
            }
        }
        if (-not $updated) { $lines.Add('FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json') }
        [IO.File]::WriteAllLines($NewEnv, $lines.ToArray(), [System.Text.UTF8Encoding]::new($false))
    }
    Write-Host 'Copied Firebase Admin service-account JSON and updated its local path (private contents not displayed).' -ForegroundColor Green
} else {
    Write-Warning 'Could not find the old Firebase service-account JSON. Keep a copy of your downloaded file and rerun the Firebase wizard if needed.'
}

Write-Host ''
Write-Host 'Switch preparation complete.' -ForegroundColor Green
Write-Host "New project: $NewRoot"
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. Open a NEW PowerShell terminal at this new project root.'
Write-Host '  2. Run: .\backend-fastapi\run-fastapi.ps1'
Write-Host '  3. In a second terminal run: python -m http.server 5500'
Write-Host '  4. Open: http://localhost:5500/index.html'
Write-Host '  5. Check: http://localhost:8000/api/auth/firebase/config'
Write-Host 'Do not delete the old project until the new one has been tested.' -ForegroundColor Yellow
