# Install the patched runtime published by our fork, never the official npm package.
[CmdletBinding()]
param(
  [string]$Prefix = $(if ($env:DSH_PREFIX) { $env:DSH_PREFIX } else { Join-Path $env:LOCALAPPDATA 'dsh' }),
  [string]$ReleaseTag = $(if ($env:DSH_RELEASE_TAG) { $env:DSH_RELEASE_TAG } else { 'dsh-custom-v0.1.0-rc.8-patched.1' })
)
$ErrorActionPreference = 'Stop'
function Fail([string]$Message) { Write-Error "dsh installer: $Message"; exit 1 }
$repo = if ($env:DSH_REPOSITORY) { $env:DSH_REPOSITORY } else { 'eiheil2/deepseek-harness' }
$version = $ReleaseTag -replace '^dsh-custom-v', ''
$asset = if ($env:DSH_RELEASE_ASSET) { $env:DSH_RELEASE_ASSET } else { "dsh-custom-runtime-$version.tar.gz" }
$url = if ($env:DSH_RELEASE_URL) { $env:DSH_RELEASE_URL } else { "https://github.com/$repo/releases/download/$ReleaseTag/$asset" }
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
$tar = Get-Command tar -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js 22.19+ or 24+ is required.' }
if (-not $npm) { Fail 'npm is required (it ships with Node.js).' }
if (-not $tar) { Fail 'tar.exe is required to unpack the runtime.' }
$nodeVersion = (& node -p "process.versions.node").Trim()
$parts = $nodeVersion.Split('.') | ForEach-Object { [int]$_ }
if (-not (($parts[0] -ge 24) -or (($parts[0] -eq 22) -and ($parts[1] -ge 19)))) { Fail "unsupported Node.js $nodeVersion; use 22.19+ or 24+." }

$temp = Join-Path ([IO.Path]::GetTempPath()) ("dsh-custom-" + [guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $Prefix "lib\dsh-custom\$version"
New-Item -ItemType Directory -Force -Path $temp, $installRoot | Out-Null
try {
  $archive = Join-Path $temp $asset
  $checksum = Join-Path $temp "$asset.sha256"
  Invoke-WebRequest -Uri $url -OutFile $archive
  Invoke-WebRequest -Uri "$url.sha256" -OutFile $checksum
  $expected = ((Get-Content $checksum -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { Fail "checksum mismatch for $asset" }
  & tar -xzf $archive -C $installRoot
  if (-not (Test-Path (Join-Path $installRoot 'runtime-manifest.json'))) { Fail 'runtime manifest missing from downloaded asset.' }
  $manifest = Get-Content (Join-Path $installRoot 'runtime-manifest.json') -Raw | ConvertFrom-Json
  $dependencies = @{}
  $manifest.packages.psobject.Properties | ForEach-Object { $dependencies[$_.Name] = "file:$($_.Value)" }
  @{ name = 'dsh-custom-runtime'; private = $true; version = '0.0.0'; dependencies = $dependencies } |
    ConvertTo-Json -Depth 10 | Set-Content (Join-Path $installRoot 'package.json')
  & npm install --prefix $installRoot --no-audit --no-fund --package-lock=false --omit=optional
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
  $cmd = Join-Path $Prefix 'dsh.cmd'
  "@echo off`r`nnode `"$installRoot\node_modules\@deepseek-ai\dsh\lib\bin.js`" %*`r`n" | Set-Content -Encoding ASCII $cmd
  $ps1 = Join-Path $Prefix 'dsh.ps1'
  "& node `"$installRoot\node_modules\@deepseek-ai\dsh\lib\bin.js`" @args`r`n" | Set-Content -Encoding UTF8 $ps1
  & $cmd --version
  Write-Host "patched dsh installed from $url"
  Write-Host "Add $Prefix to PATH if 'dsh' is not found."
} finally { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue }
