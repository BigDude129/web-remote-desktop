param([string]$Dotnet = 'dotnet')
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$metadata = Get-Content -Raw -Encoding UTF8 (Join-Path $repository 'package.json') | ConvertFrom-Json
$version = $metadata.version
if ($version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') { throw 'Stable SemVer required.' }
$project = Join-Path $repository 'agent/DeskLink.Agent/DeskLink.Agent.csproj'
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $repository 'artifacts'))
$destination = [IO.Path]::GetFullPath((Join-Path $artifactRoot "agent-$version-win-x64"))
$assetName = "DeskLink.Agent-$version-win-x64.zip"
$archive = Join-Path $artifactRoot $assetName
if (Test-Path -LiteralPath $destination) {
  $resolved = (Resolve-Path -LiteralPath $destination).Path
  if ($resolved -ne $destination -or -not $resolved.StartsWith($artifactRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe package output path.' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
Push-Location $repository
try {
  node scripts/version.mjs --check
  if ($LASTEXITCODE -ne 0) { throw 'Version check failed.' }
  & $Dotnet publish $project -c Release -r win-x64 --self-contained true -o $destination -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=None -p:DebugSymbols=false
} finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'Agent build failed.' }
Copy-Item -LiteralPath (Join-Path $repository 'LICENSE') -Destination (Join-Path $destination 'LICENSE.txt')

# Include license/copyright notices from the exact runtime packs used by publish.
$assets = Get-Content -Raw -Encoding UTF8 (Join-Path $repository 'agent/DeskLink.Agent/obj/project.assets.json') | ConvertFrom-Json
$noticeParts = [System.Collections.Generic.List[string]]::new()
$noticeParts.Add('DeskLink Windows agent third-party notices. Project: MIT, see LICENSE.txt.')
$includedPacks = 0
foreach ($library in $assets.project.frameworks.PSObject.Properties.Value.downloadDependencies) {
  if ($library.name -notmatch '^Microsoft\.(NETCore|WindowsDesktop)\.App\.Runtime\.win-x64$') { continue }
  if ($library.version -notmatch '^\[([^,]+),\s*([^\]]+)\]$' -or $Matches[1] -ne $Matches[2]) { throw 'Expected an exact runtime pack version.' }
  $runtimeVersion = $Matches[1]
  $included = $false
  foreach ($folder in $assets.packageFolders.PSObject.Properties.Name) {
    $packagePath = Join-Path $folder ($library.name.ToLowerInvariant() + '/' + $runtimeVersion)
    if (-not (Test-Path -LiteralPath $packagePath)) { continue }
    $noticeFiles = @(Get-ChildItem -LiteralPath $packagePath -File | Where-Object { $_.Name -match '^(LICENSE|THIRD-PARTY-NOTICES)' })
    if (-not ($noticeFiles | Where-Object { $_.Name -match '^LICENSE' })) { throw "Missing license for $($library.name)." }
    if ($library.name -match 'NETCore' -and -not ($noticeFiles | Where-Object { $_.Name -match '^THIRD-PARTY-NOTICES' })) { throw 'Missing .NET runtime third-party notices.' }
    $noticeParts.Add("`n===== $($library.name) $runtimeVersion =====")
    foreach ($file in $noticeFiles) {
      $noticeParts.Add((Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8))
    }
    $included = $true
    $includedPacks++
    break
  }
  if (-not $included) { throw "Runtime pack not found: $($library.name)." }
}
if ($includedPacks -ne 2) { throw 'Expected .NETCore and WindowsDesktop license notices; refusing to package.' }
$encoding = [System.Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $destination 'THIRD-PARTY-NOTICES.txt'), ($noticeParts -join "`n"), $encoding)
[IO.File]::WriteAllText((Join-Path $destination 'README.txt'), "DeskLink Agent $version`nStart DeskLink.Agent.exe and sign in to your server.`nTo update: end remote control, close the old agent, extract the new ZIP and run it.`nNo background replacement or silent execution is performed.`nSee LICENSE.txt and THIRD-PARTY-NOTICES.txt.`n", $encoding)
Compress-Archive -Path (Join-Path $destination '*') -DestinationPath $archive -Force
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
$manifest = [ordered]@{ version=$version; protocolVersion=1; platform='win-x64'; assetName=$assetName; sha256=$hash; size=(Get-Item -LiteralPath $archive).Length }
[IO.File]::WriteAllText((Join-Path $artifactRoot 'agent-release.json'), ($manifest | ConvertTo-Json) + "`n", $encoding)
[IO.File]::WriteAllText((Join-Path $artifactRoot 'SHA256SUMS.txt'), "$hash  $assetName`n", $encoding)
Write-Host "Package ready: $assetName"
Write-Host "SHA-256: $hash"
