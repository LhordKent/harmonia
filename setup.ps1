[CmdletBinding()]
param([switch]$Android, [switch]$StartWeb)
$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS, then open a new terminal.' }
$nodeVersion = (& node -p 'process.versions.node').Trim()
$nodeParts = $nodeVersion.Split('.')
if ([int]$nodeParts[0] -lt 22 -or ([int]$nodeParts[0] -eq 22 -and [int]$nodeParts[1] -lt 12)) {
    throw "Node $nodeVersion is too old. Install Node.js 24 LTS (or >=22.12)."
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd was not found. Reinstall Node.js with npm.' }
Push-Location (Join-Path $repoRoot 'WEBSITE CAPSTONE')
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
} finally { Pop-Location }
Write-Host 'Web dependencies installed. Firebase client configuration and the model are already included.'

if ($Android) {
    $mobileRoot = Join-Path $repoRoot 'HarmoniaAppMobile'
    $studioJbr = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
    if (-not $env:JAVA_HOME -and (Test-Path -LiteralPath $studioJbr)) { $env:JAVA_HOME = $studioJbr }
    if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
        throw 'Install current Android Studio and set JAVA_HOME to its jbr directory. See README.md.'
    }
    $env:Path = "$(Join-Path $env:JAVA_HOME 'bin');$env:Path"
    $sdkRoot = $env:ANDROID_HOME
    if (-not $sdkRoot) { $sdkRoot = $env:ANDROID_SDK_ROOT }
    if (-not $sdkRoot -and $env:LOCALAPPDATA) { $sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
    if (-not $sdkRoot -or -not (Test-Path -LiteralPath $sdkRoot)) {
        throw 'Install Android SDK through Android Studio (including platform 37) and set ANDROID_HOME.'
    }
    # Newer SDK packages use android-37.0 rather than android-37. Check metadata.
    $platformsRoot = Join-Path $sdkRoot 'platforms'
    $hasPlatform37 = $false
    if (Test-Path -LiteralPath $platformsRoot) {
        foreach ($platform in (Get-ChildItem -LiteralPath $platformsRoot -Directory)) {
            $metadata = Join-Path $platform.FullName 'source.properties'
            if ((Test-Path -LiteralPath $metadata) -and
                (Select-String -LiteralPath $metadata -Pattern '^AndroidVersion.ApiLevel=37(?:\.0)?\s*$' -Quiet)) {
                $hasPlatform37 = $true
            }
        }
    }
    if (-not $hasPlatform37) {
        throw 'Install Android SDK Platform 37 in Android Studio SDK Manager, then rerun setup.ps1 -Android.'
    }
    $localProperties = Join-Path $mobileRoot 'local.properties'
    if (-not (Test-Path -LiteralPath $localProperties)) {
        $sdkForJava = $sdkRoot.Replace('\','/').Replace(':','\:')
        [IO.File]::WriteAllText($localProperties, "sdk.dir=$sdkForJava`n", [Text.UTF8Encoding]::new($false))
    }
    Push-Location $mobileRoot
    try {
        & .\gradlew.bat assembleDebug --no-configuration-cache --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'Android build failed. Check SDK packages, licenses and JDK compatibility.' }
    } finally { Pop-Location }
    Write-Host 'APK: HarmoniaAppMobile/app/build/outputs/apk/debug/app-debug.apk'
}
Write-Host 'Start the website: cd "WEBSITE CAPSTONE"; npm.cmd run dev'
Write-Host 'Use your own authorized Harmonia account. No passwords or server secrets are stored in this repository.'
if ($StartWeb) {
    Push-Location (Join-Path $repoRoot 'WEBSITE CAPSTONE')
    try {
        & npm.cmd run dev
        if ($LASTEXITCODE -ne 0) { throw 'Vite exited with an error.' }
    } finally { Pop-Location }
}
