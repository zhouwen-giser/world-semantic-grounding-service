param(
  [ValidateSet("Start", "Stop", "Status")]
  [string]$Action = "Start",
  [string]$SampleRoot = $env:GOWM_SAMPLE_ROOT,
  [string]$GdpsRoot = $env:GDPS_ROOT,
  [int]$HostPort = 18064
)

$ErrorActionPreference = "Stop"
$containerName = "wsgs-gdps-combined-gateway"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$outputDirectory = Join-Path $repositoryRoot "reports\wsgs-v0.2-gdps"

function Get-ExactContainerId {
  $id = docker ps -aq --filter "name=^/$containerName$"
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect Docker containers" }
  return $id
}

function Assert-ExactContainer([string]$id) {
  if (-not $id) { return }
  $name = docker inspect --format "{{.Name}}" $id
  if ($LASTEXITCODE -ne 0 -or $name -ne "/$containerName") {
    throw "Refusing to manage an unexpected container"
  }
}

if ($Action -eq "Stop") {
  $id = Get-ExactContainerId
  if ($id) {
    Assert-ExactContainer $id
    docker rm -f $id | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to remove the integration Gateway container" }
  }
  Write-Output "WSGS_GDPS_COMBINED_GATEWAY_STOPPED"
  exit 0
}

if ($Action -eq "Status") {
  $id = Get-ExactContainerId
  if (-not $id) {
    Write-Output "WSGS_GDPS_COMBINED_GATEWAY_ABSENT"
    exit 1
  }
  Assert-ExactContainer $id
  $running = docker inspect --format "{{.State.Running}}" $id
  if ($running -ne "true") {
    Write-Output "WSGS_GDPS_COMBINED_GATEWAY_STOPPED"
    exit 1
  }
  $ready = Invoke-RestMethod -Uri "http://127.0.0.1:$HostPort/health/ready" -TimeoutSec 5
  if ($ready.status -ne "ok") { throw "Combined Gateway is not ready" }
  Write-Output "WSGS_GDPS_COMBINED_GATEWAY_READY capabilities=$($ready.capabilityCount)"
  exit 0
}

if (-not $SampleRoot -or -not (Test-Path -LiteralPath $SampleRoot -PathType Container)) {
  throw "GOWM_SAMPLE_ROOT must identify the authorized Sample World checkout"
}
if (-not $GdpsRoot -or -not (Test-Path -LiteralPath $GdpsRoot -PathType Container)) {
  throw "GDPS_ROOT must identify the GDPS checkout"
}

$existing = Get-ExactContainerId
if ($existing) {
  Assert-ExactContainer $existing
  $running = docker inspect --format "{{.State.Running}}" $existing
  if ($running -eq "true") {
    $ready = Invoke-RestMethod -Uri "http://127.0.0.1:$HostPort/health/ready" -TimeoutSec 5
    if ($ready.status -eq "ok") {
      Write-Output "WSGS_GDPS_COMBINED_GATEWAY_READY capabilities=$($ready.capabilityCount)"
      exit 0
    }
    throw "Existing combined Gateway is running but not ready"
  }
  docker rm $existing | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to remove the stopped integration Gateway container" }
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$gdpsContainer = "geospatial-data-product-service-gdps-1"
$gdpsContainerEnvironment = (docker inspect $gdpsContainer | ConvertFrom-Json)[0].Config.Env
if ($LASTEXITCODE -ne 0) { throw "The real GDPS Provider container is unavailable" }
$tokenEntry = $gdpsContainerEnvironment |
  Where-Object { $_ -like "GDPS_BEARER_TOKEN=*" } |
  Select-Object -First 1
if (-not $tokenEntry) { throw "The real GDPS Provider transport credential is unavailable" }

$baseline = Get-Content -Raw (Join-Path $outputDirectory "w20-source-baseline.json") | ConvertFrom-Json
$env:GDPS_PROVIDER_TRANSPORT_TOKEN = $tokenEntry.Substring("GDPS_BEARER_TOKEN=".Length)
$env:GDPS_APPROVED_MANIFEST_HASH = $baseline.gdps.manifestHash
try {
  $script = Join-Path $repositoryRoot "validation\scripts\gdps-combined-gateway.mjs"
  $manifest = Join-Path $GdpsRoot "reports\GDPS_GOWM_APPROVED_MANIFEST.json"
  $composeEnvironment = Join-Path $SampleRoot ".runtime\wsgs-sample\compose.env"
  foreach ($requiredPath in @($script, $manifest, $composeEnvironment)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
      throw "Required integration input is missing: $requiredPath"
    }
  }
  $containerId = docker run -d `
    --name $containerName `
    --network gowm-wsgs-sample_sample-internal `
    -p "127.0.0.1:${HostPort}:8090" `
    --env-file $composeEnvironment `
    -e GDPS_PROVIDER_TRANSPORT_TOKEN `
    -e GDPS_APPROVED_MANIFEST_HASH `
    --mount "type=bind,src=$script,dst=/integration/gdps-combined-gateway.mjs,readonly" `
    --mount "type=bind,src=$manifest,dst=/integration/gdps-manifest.json,readonly" `
    --mount "type=bind,src=$outputDirectory,dst=/integration-output" `
    gowm-wsgs-sample:0.6.3 `
    node /integration/gdps-combined-gateway.mjs
  if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw "Unable to create the combined Gateway container" }
} finally {
  Remove-Item Env:GDPS_PROVIDER_TRANSPORT_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:GDPS_APPROVED_MANIFEST_HASH -ErrorAction SilentlyContinue
}

docker network connect geospatial-data-product-service_default $containerName
if ($LASTEXITCODE -ne 0) { throw "Unable to attach the combined Gateway to the GDPS network" }

$deadline = (Get-Date).AddSeconds(75)
do {
  Start-Sleep -Milliseconds 500
  $running = docker inspect --format "{{.State.Running}}" $containerName
  if ($LASTEXITCODE -ne 0 -or $running -ne "true") {
    docker logs --tail 80 $containerName
    throw "Combined Gateway exited during startup"
  }
  try {
    $ready = Invoke-RestMethod -Uri "http://127.0.0.1:$HostPort/health/ready" -TimeoutSec 2
  } catch {
    $ready = $null
  }
} until (($ready -and $ready.status -eq "ok") -or (Get-Date) -gt $deadline)

if (-not $ready -or $ready.status -ne "ok") {
  docker logs --tail 80 $containerName
  throw "Combined Gateway did not become ready"
}
$runtime = Get-Content -Raw (Join-Path $outputDirectory "w28-integration-instance.json") | ConvertFrom-Json
Write-Output "WSGS_GDPS_COMBINED_GATEWAY_READY capabilities=$($ready.capabilityCount) required=$($runtime.requiredOperations.Count) lock=$($runtime.exactOperationLockHash)"

