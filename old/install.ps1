[CmdletBinding()]
param(
  [string]$Version,
  [string]$Registry,
  [string]$Prefix,
  [switch]$NoPathUpdate,
  [switch]$Help
)

$ErrorActionPreference = 'Stop'
$Package = '@deepseek-ai/dsh'

if ($Help) {
  @'
Usage: .\install.ps1 [options]

Install the published @deepseek-ai/dsh CLI without repository or development files.

Options:
  -Version <version>      npm version or dist-tag (default: latest)
  -Registry <https-url>   npm registry (default: https://registry.npmjs.org)
  -Prefix <directory>     npm global prefix (default: writable npm prefix)
  -NoPathUpdate           do not add the install directory to the user PATH
  -Help                   show this help

Environment equivalents: DSH_VERSION, DSH_REGISTRY, DSH_INSTALL_PREFIX.
'@
  exit 0
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = $env:DSH_VERSION
}
if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = 'latest'
}
if ($Version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
  throw "install.ps1: invalid npm version or dist-tag: $Version"
}
if ([string]::IsNullOrWhiteSpace($Registry)) {
  $Registry = $env:DSH_REGISTRY
}
if ([string]::IsNullOrWhiteSpace($Registry)) {
  $Registry = 'https://registry.npmjs.org'
}
if ([string]::IsNullOrWhiteSpace($Prefix)) {
  $Prefix = $env:DSH_INSTALL_PREFIX
}

try { $null = Get-Command node -ErrorAction Stop } catch {
  throw 'install.ps1: Node.js 22.19+ (22.x) or 24+ is required; node was not found'
}
try { $null = Get-Command npm -ErrorAction Stop } catch {
  throw 'install.ps1: npm was not found; install it with Node.js first'
}

& node -e "const [major, minor] = process.versions.node.split('.').map(Number); if (!(major >= 24 || (major === 22 && minor >= 19))) { console.error('install.ps1: unsupported Node.js ' + process.versions.node + '; require 22.19+ on 22.x or 24+'); process.exit(1) }"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

try { $uri = [Uri]$Registry } catch { throw "install.ps1: invalid registry URL: $Registry" }
if ($uri.Scheme -ne 'https') {
  throw "install.ps1: registry must use HTTPS: $Registry"
}

$PrefixWasExplicit = -not [string]::IsNullOrWhiteSpace($Prefix)
if ([string]::IsNullOrWhiteSpace($Prefix)) {
  $Prefix = (& npm config get prefix 2>$null | Select-Object -First 1).Trim()
}
if ([string]::IsNullOrWhiteSpace($Prefix)) {
  $Prefix = Join-Path $env:APPDATA 'npm'
}

function Test-WritableDirectory([string]$Path) {
  try {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
    $probe = Join-Path $Path ('.dsh-install-' + [Guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($probe, '')
    Remove-Item -LiteralPath $probe -Force
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-WritableDirectory $Prefix)) {
  if ($PrefixWasExplicit) { throw "install.ps1: install prefix is not writable: $Prefix" }
  $Prefix = Join-Path $env:APPDATA 'npm'
  if (-not (Test-WritableDirectory $Prefix)) {
    throw "install.ps1: cannot find a writable install prefix: $Prefix"
  }
}

$npmArgs = @(
  '--prefix', $Prefix,
  'install', '--global', '--omit=dev', '--no-audit', '--no-fund',
  '--registry', $Registry,
  "$Package@$Version"
)
Write-Host "Installing $Package@$Version into $Prefix"
& npm @npmArgs
if ($LASTEXITCODE -ne 0) { throw "install.ps1: npm exited with code $LASTEXITCODE" }

$entry = Join-Path $Prefix 'dsh.cmd'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
  $entry = Join-Path $Prefix 'dsh.ps1'
}
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
  throw "install.ps1: npm completed but no dsh command was created in $Prefix"
}

if (-not $NoPathUpdate) {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @($userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $alreadyPresent = $parts | Where-Object { $_.TrimEnd('\') -ieq $Prefix.TrimEnd('\') }
  if (-not $alreadyPresent) {
    $newPath = (($parts + $Prefix) -join ';')
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    $env:Path = "$Prefix;$env:Path"
    Write-Host "Added $Prefix to the user PATH. New terminals will inherit it."
  }
}

$versionOutput = & $entry --version 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  throw "install.ps1: installed dsh failed its version check`n$versionOutput"
}
Write-Host ("Installed dsh " + $versionOutput.Trim())
