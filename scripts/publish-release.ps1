$ErrorActionPreference = 'Stop'
$repositoryPath = Split-Path -Parent $PSScriptRoot
$metadata = Get-Content -Raw -Encoding UTF8 (Join-Path $repositoryPath 'package.json') | ConvertFrom-Json
$releaseTag = $env:GITHUB_REF_NAME
if ($env:GITHUB_REF_TYPE -ne 'tag' -or $releaseTag -ne "v$($metadata.version)") { throw 'Release tag must match source version.' }
$repositoryName = $env:GITHUB_REPOSITORY
if ($repositoryName -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'GitHub repository is required.' }
$notesPath = Join-Path $repositoryPath "docs/releases/$releaseTag.md"
if (-not (Test-Path -LiteralPath $notesPath)) { throw 'Release notes are required.' }
$manifestPath = Join-Path $repositoryPath 'artifacts/agent-release.json'
$manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
$expectedName = "DeskLink.Agent-$($metadata.version)-win-x64.zip"
if ($manifest.version -ne $metadata.version -or $manifest.assetName -ne $expectedName) { throw 'Invalid release manifest.' }
$archivePath = Join-Path $repositoryPath "artifacts/$expectedName"
$sumsPath = Join-Path $repositoryPath 'artifacts/SHA256SUMS.txt'
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $manifest.sha256 -or (Get-Item -LiteralPath $archivePath).Length -ne $manifest.size) { throw 'Package checksum mismatch.' }
if ((Get-Content -Raw -Encoding UTF8 $sumsPath).Trim() -ne "$hash  $expectedName") { throw 'Checksum file mismatch.' }
$report = Get-Content -Raw -Encoding UTF8 (Join-Path $repositoryPath 'local/vm-e2e/report.json') | ConvertFrom-Json
if (-not $report.passed -or $report.packageHash -ne $hash -or $report.commit -ne $env:GITHUB_SHA -or $report.version -ne $metadata.version) {
  throw 'This exact package must pass Windows VM browser verification before publishing.'
}
$releaseState = & gh release view $releaseTag --repo $repositoryName --json isDraft --jq .isDraft 2>$null
if ($LASTEXITCODE -eq 0) {
  if ($releaseState.Trim() -ne 'true') { throw 'Published releases are immutable.' }
} else {
  & gh release create $releaseTag --repo $repositoryName --verify-tag --draft --title "DeskLink $releaseTag" --notes-file $notesPath
  if ($LASTEXITCODE -ne 0) { throw 'Could not create draft release.' }
}
& gh release upload $releaseTag $archivePath $manifestPath $sumsPath --repo $repositoryName --clobber
if ($LASTEXITCODE -ne 0) { throw 'Could not upload verified assets. Release remains a draft.' }
& gh release edit $releaseTag --repo $repositoryName --draft=false --latest
if ($LASTEXITCODE -ne 0) { throw 'Could not publish release.' }
