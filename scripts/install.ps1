param(
    [string]$MarketplaceRoot = (Join-Path $env:LOCALAPPDATA 'VegetationQuota/marketplace'),
    [string]$CodexPath,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Install Node.js 22.19 or newer, then rerun this script.' }
$nodeVersion = & $nodeCommand.Source -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.19.0') { throw 'Node.js 22.19 or newer is required.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Install Git and sign in to an account with read access to wwzh6/vegGPTUsage.' }
if (-not $CodexPath) {
    $codexCommand = Get-Command codex -ErrorAction SilentlyContinue
    if ($codexCommand) { $CodexPath = $codexCommand.Source }
    else {
        $bundled = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'OpenAI/Codex/bin/*/codex.exe') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($bundled) { $CodexPath = $bundled.FullName }
    }
}
if (-not $CodexPath -or -not (Test-Path -LiteralPath $CodexPath)) { throw 'Install Codex desktop or pass -CodexPath with its CLI executable.' }
$hashFile = Join-Path $sourceRoot 'runtime.sha256.json'
if (-not (Test-Path -LiteralPath $hashFile)) { throw 'Missing prebuilt runtime checksums. Use a complete release package.' }
$hashes = Get-Content -LiteralPath $hashFile -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($entry in $hashes.PSObject.Properties) {
    $filePath = [IO.Path]::GetFullPath((Join-Path $sourceRoot $entry.Name))
    if (-not $filePath.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid runtime file path.' }
    if (-not (Test-Path -LiteralPath $filePath)) { throw ('Runtime file missing: ' + $entry.Name) }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($filePath))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($digest -ne $entry.Value) { throw ('Runtime integrity check failed: ' + $entry.Name) }
}
foreach ($required in 'dist/server.mjs','dist/usage-ball.html','plugin.json','.mcp.json') {
    if (-not $hashes.PSObject.Properties[$required]) { throw ('Missing runtime checksum: ' + $required) }
}
& $CodexPath plugin add --help | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Update Codex: this CLI does not support plugin installation.' }
if ($CheckOnly) { Write-Output 'Preflight passed. No installation or key changes made.'; return }
$marketplacesText = & $CodexPath plugin marketplace list --json
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect registered marketplaces.' }
$registered = ($marketplacesText | ConvertFrom-Json).marketplaces | Where-Object name -eq 'cotemu-local' | Select-Object -First 1
if ($registered) {
    if ($registered.marketplaceSource.sourceType -eq 'git') { throw 'This marketplace is managed by Git; update its owning source instead.' }
    if ($PSBoundParameters.ContainsKey('MarketplaceRoot') -and [IO.Path]::GetFullPath($MarketplaceRoot) -ne [IO.Path]::GetFullPath($registered.root)) {
        throw 'The marketplace is already registered at another path. Omit -MarketplaceRoot to upgrade it in place.'
    }
    $MarketplaceRoot = $registered.root
}
$catalogRoot = [IO.Path]::GetFullPath($MarketplaceRoot)
$pluginRoot = Join-Path $catalogRoot 'plugins/cotemu-usage-ball'
$catalogDirectory = Join-Path $catalogRoot '.agents/plugins'
$catalogFile = Join-Path $catalogDirectory 'marketplace.json'
$otherPlugins = @()
if (Test-Path -LiteralPath $catalogFile) {
    $oldCatalog = Get-Content -LiteralPath $catalogFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($oldCatalog.name -ne 'cotemu-local') { throw 'Destination belongs to a different marketplace.' }
    $otherPlugins = @($oldCatalog.plugins | Where-Object name -ne 'cotemu-usage-ball')
}
New-Item -ItemType Directory -Path $pluginRoot,$catalogDirectory -Force | Out-Null
foreach ($entry in $hashes.PSObject.Properties) {
    $destination = Join-Path $pluginRoot $entry.Name
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot $entry.Name) -Destination $destination -Force
}
foreach ($name in 'README.md','VERIFICATION.md','THIRD_PARTY_NOTICES.md','runtime.sha256.json') {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination (Join-Path $pluginRoot $name) -Force
}
$catalog = @{
    name = 'cotemu-local'
    interface = @{ displayName = $manifest.extensions.'com.openai'.interface.displayName }
    plugins = $otherPlugins + @(@{
        name = 'cotemu-usage-ball'
        source = @{ source = 'local'; path = './plugins/cotemu-usage-ball' }
        policy = @{ installation = 'AVAILABLE'; authentication = 'ON_USE' }
        category = 'Productivity'
    })
}
[IO.File]::WriteAllText($catalogFile, ($catalog | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
& $CodexPath plugin marketplace add $catalogRoot --json
if ($LASTEXITCODE -ne 0) { throw 'Marketplace registration failed.' }
& $CodexPath plugin add 'cotemu-usage-ball@cotemu-local' --json
if ($LASTEXITCODE -ne 0) { throw 'Plugin installation failed.' }
[PSCustomObject]@{ version = $manifest.version; installed = $true; accountApiKeyRequired = $false; source = 'GitHub shared snapshot'; restartRequired = $true } | ConvertTo-Json
