# Install the precompiled patched runtime published by our fork.
[CmdletBinding()]
param(
  [string]$Prefix = $(if ($env:DSH_PREFIX) { $env:DSH_PREFIX } else { Join-Path $env:LOCALAPPDATA 'dsh' }),
  [string]$ReleaseTag = $(if ($env:DSH_RELEASE_TAG) { $env:DSH_RELEASE_TAG } else { 'dsh-custom-v0.1.0-rc.8-fullfix.2' })
)

$ErrorActionPreference = 'Stop'
function Fail([string]$Message) { Write-Error "dsh installer: $Message"; exit 1 }

if ($ReleaseTag -notmatch '^dsh-custom-v[0-9A-Za-z][0-9A-Za-z._-]*$') {
  Fail "invalid release tag: $ReleaseTag"
}
$repo = if ($env:DSH_REPOSITORY) { $env:DSH_REPOSITORY } else { 'eiheil2/deepseek-harness' }
if (-not $env:DSH_RELEASE_URL -and $repo -notmatch '^[0-9A-Za-z_.-]+/[0-9A-Za-z_.-]+$') {
  Fail "invalid GitHub repository: $repo"
}
$version = $ReleaseTag -replace '^dsh-custom-v', ''
$asset = if ($env:DSH_RELEASE_ASSET) { $env:DSH_RELEASE_ASSET } else { "dsh-axl-windows-x64-$version.zip" }
if ([IO.Path]::GetFileName($asset) -ne $asset) { Fail 'release asset must be a filename.' }
$url = if ($env:DSH_RELEASE_URL) { $env:DSH_RELEASE_URL } else { "https://github.com/$repo/releases/download/$ReleaseTag/$asset" }

$prefixRoot = [IO.Path]::GetFullPath($Prefix)
$installBase = [IO.Path]::GetFullPath((Join-Path $prefixRoot 'lib\dsh-axl'))
$installRoot = [IO.Path]::GetFullPath((Join-Path $installBase $version))
$baseWithSeparator = $installBase.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $installRoot.StartsWith($baseWithSeparator, [StringComparison]::OrdinalIgnoreCase)) {
  Fail 'resolved install path escapes the installation prefix.'
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ("dsh-axl-" + [guid]::NewGuid().ToString('N'))
$staging = Join-Path $temp 'runtime'
New-Item -ItemType Directory -Force -Path $temp, $staging | Out-Null
try {
  $archive = Join-Path $temp $asset
  $checksum = Join-Path $temp "$asset.sha256"
  function Download([string]$Uri, [string]$OutFile) {
    $request = @{ Uri = $Uri; OutFile = $OutFile }
    if ($env:DSH_RELEASE_NO_PROXY -eq '1') {
      $request.NoProxy = $true
    } elseif ($env:DSH_RELEASE_PROXY) {
      $request.Proxy = $env:DSH_RELEASE_PROXY
    }
    Invoke-WebRequest @request
  }
  Download $url $archive
  Download "$url.sha256" $checksum
  $expected = ((Get-Content $checksum -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not $expected -or $expected -ne $actual) { Fail "checksum mismatch for $asset" }

  Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force
  foreach ($required in @(
    'dsh.cmd',
    'runtime\node.exe',
    'node_modules\@deepseek-ai\dsh\lib\bin.js',
    'settings.official.yaml',
    'BUILD_INFO.txt'
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $staging $required))) { Fail "runtime is missing $required" }
  }

  if (Test-Path -LiteralPath $installRoot) {
    Remove-Item -LiteralPath $installRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $installBase | Out-Null
  Move-Item -LiteralPath $staging -Destination $installRoot

  New-Item -ItemType Directory -Force -Path $prefixRoot | Out-Null
  $cmd = Join-Path $prefixRoot 'dsh.cmd'
  "@echo off`r`ncall `"$installRoot\dsh.cmd`" %*`r`nexit /b %errorlevel%`r`n" | Set-Content -Encoding ASCII $cmd
  $ps1 = Join-Path $prefixRoot 'dsh.ps1'
  "& `"$installRoot\dsh.cmd`" @args`r`nexit `$LASTEXITCODE`r`n" | Set-Content -Encoding UTF8 $ps1
  $web = Join-Path $prefixRoot 'dsh-web.cmd'
  "@echo off`r`ncall `"$installRoot\start-web.cmd`" %*`r`nexit /b %errorlevel%`r`n" | Set-Content -Encoding ASCII $web

  $dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
  $settings = Join-Path $dshHome 'settings.yaml'
  if (-not (Test-Path -LiteralPath $settings)) {
    New-Item -ItemType Directory -Force -Path $dshHome | Out-Null
    Copy-Item -LiteralPath (Join-Path $installRoot 'settings.official.yaml') -Destination $settings
    Write-Host "installed credential-free settings at $settings"
  } else {
    Write-Host "kept existing settings at $settings"
  }

  & $cmd --version
  if ($LASTEXITCODE -ne 0) { Fail 'installed runtime did not pass the CLI smoke test.' }
  Write-Host "preinstalled patched dsh installed from $url"
  Write-Host "Add $prefixRoot to PATH if 'dsh' is not found."
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
