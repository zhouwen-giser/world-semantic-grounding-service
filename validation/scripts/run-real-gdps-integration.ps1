param(
  [string]$SampleRoot = $env:GOWM_SAMPLE_ROOT,
  [string]$GatewayBaseUrl = "http://127.0.0.1:18063",
  [int]$DatabaseHostPort = 55464,
  [string]$GdpsArtifactRoot,
  [string]$DataScope,
  [ValidateSet(
    "E2E-SLOPE-POINT", "E2E-SLOPE-RANGE", "E2E-FLOOD-HIGH", "E2E-DRAINAGE-NEARBY",
    "E2E-HIGH-GROUND", "E2E-WETLAND", "E2E-LAND-COVER", "E2E-TRAVERSABILITY-EXPLAIN",
    "E2E-EXPLICIT-PRODUCT", "NEG-DESCRIPTOR-GAP", "NEG-DATA-GAP", "NEG-REFERENCE-AMBIGUITY",
    "NEG-UNIT-MISMATCH", "NEG-RECIPE-DRIFT", "NEG-TRUNCATED", "NEG-CURRENTNESS",
    "E2E-01", "E2E-02", "E2E-03", "E2E-04", "E2E-05", "E2E-06", "E2E-07"
  )]
  [string]$GdpsCaseId,
  [switch]$LegacyV02Evidence,
  [switch]$KeepDatabase
)

$ErrorActionPreference = "Stop"
$databaseContainer = "wsgs-gdps-postgres"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$evidenceDirectory = Join-Path $repositoryRoot $(if ($LegacyV02Evidence) {
  "reports\wsgs-v0.2-gdps"
} else {
  "reports\wsgs-v0.2-gdps-v0.2.1"
})
if (-not $GdpsArtifactRoot) {
  $GdpsArtifactRoot = Join-Path $repositoryRoot "contracts\generated\gdps-v0.2.1"
}
$operationLock = if ($LegacyV02Evidence) {
  Join-Path $repositoryRoot "reports\wsgs-v0.2-gdps\w26-combined-southbound-operation-lock.json"
} else {
  Join-Path $GdpsArtifactRoot "wsgs-southbound-operation-lock-v2.json"
}
$gdpsRecipeLock = Join-Path $GdpsArtifactRoot "wsgs-gdps-recipe-lock.json"
$gdpsConsumerSnapshot = Join-Path $GdpsArtifactRoot "gdps-consumer-snapshot.json"
$gdpsDescriptorRegistry = Join-Path $GdpsArtifactRoot "product-type-descriptors.json"
$gdpsVocabularyRegistry = Join-Path $GdpsArtifactRoot "product-vocabularies.json"
$gdpsConceptMap = Join-Path $repositoryRoot "config\gdps-semantic-concept-map.json"
$gdpsRecipePlan = Join-Path $repositoryRoot "config\gdps-recipe-plan.json"
$gdpsE2eCorpus = Join-Path $repositoryRoot "config\gdps-e2e-corpus.json"
$gdpsCapabilityLock = Join-Path $repositoryRoot "contracts\upstream\gdps-v0.2.1\GDPS_CAPABILITY_LOCK.json"
$gdpsGatewayBindingLock = Join-Path $repositoryRoot "contracts\upstream\gdps-v0.2.1\GOWM_GATEWAY_BINDING_LOCK.json"
$legacyGdpsCaseIds = @("E2E-01", "E2E-02", "E2E-03", "E2E-04", "E2E-05", "E2E-06", "E2E-07")
$expectedGdpsPatterns = @(
  "GDPS_LAND_COVER_AT_REFERENCE",
  "GDPS_WETLANDS_IN_AREA",
  "GDPS_OBSTACLES_NEAR_REFERENCE",
  "GDPS_BLOCKED_AREAS_IN_AREA",
  "GDPS_HIGH_GROUND_IN_AREA",
  "GDPS_ELEVATION_AT_REFERENCE",
  "GDPS_TRAVERSABILITY_EXPLAIN_AT_REFERENCE",
  "GDPS_GENERIC_SAMPLE_VALUE",
  "GDPS_GENERIC_PROFILE_VALUE",
  "GDPS_GENERIC_FIND_CLASS",
  "GDPS_GENERIC_FIND_RANGE",
  "GDPS_GENERIC_VECTOR_IN_AREA",
  "GDPS_GENERIC_VECTOR_NEARBY",
  "GDPS_GENERIC_VECTOR_INTERSECTS"
)

function Get-ExactContainerId {
  $id = docker ps -aq --filter "name=^/$databaseContainer$"
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the isolated WSGS database container" }
  return $id
}

function Assert-ExactContainer([string]$id) {
  if (-not $id) { return }
  $name = docker inspect --format "{{.Name}}" $id
  if ($LASTEXITCODE -ne 0 -or $name -ne "/$databaseContainer") {
    throw "Refusing to manage an unexpected database container"
  }
}

function Remove-ExactDatabaseContainer {
  $id = Get-ExactContainerId
  if ($id) {
    Assert-ExactContainer $id
    docker rm -f $id | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to remove the isolated WSGS database container" }
  }
}

function Import-ProcessEnvironment([string]$path) {
  foreach ($line in Get-Content -LiteralPath $path) {
    if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $name = $Matches[1]
    $value = $Matches[2]
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path "Env:$name" -Value $value
  }
}

function Get-RequiredArtifactSha256([string]$path, [string]$label) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "$label is missing; run the approved GDPS v0.2.1 intake before enabling GDPS"
  }
  $resolved = (Resolve-Path -LiteralPath $path).Path
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolved).Hash.ToLowerInvariant()
  if ($hash -notmatch '^[a-f0-9]{64}$') { throw "$label SHA-256 is invalid" }
  return @($resolved, "sha256:$hash")
}

function Assert-V021OperationLock([string]$path) {
  if ($LegacyV02Evidence) { return }
  if (-not (Test-Path -LiteralPath $gdpsCapabilityLock -PathType Leaf)) {
    throw "The authoritative GDPS v0.2.1 capability lock is missing; run the approved handoff intake first"
  }
  if (-not (Test-Path -LiteralPath $gdpsGatewayBindingLock -PathType Leaf)) {
    throw "The authoritative GOWM Gateway binding lock is missing; run the approved handoff intake first"
  }
  try {
    $consumerLock = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
    $providerLock = Get-Content -Raw -LiteralPath $gdpsCapabilityLock | ConvertFrom-Json
    $gatewayDocument = Get-Content -Raw -LiteralPath $gdpsGatewayBindingLock | ConvertFrom-Json
  } catch {
    throw "The GDPS v0.2.1 operation, capability, or Gateway binding lock is invalid JSON"
  }
  $gatewayBinding = if ($gatewayDocument.gateway) { $gatewayDocument.gateway } else { $gatewayDocument }
  if ($consumerLock.contractCatalogRevision -ne $gatewayBinding.contractCatalogRevision -or
      $consumerLock.semanticCatalogHash -ne $gatewayBinding.semanticCatalogHash) {
    throw "The verified southbound lock is not bound to the approved GOWM Gateway catalog"
  }
  $consumerOperations = @($consumerLock.defaultOperations) + @($consumerLock.previewOperations)
  $providerOperations = @($providerLock.operations)
  $stableOperationIds = @(
    "reference.get", "reference.resolve", "world.get-current-state", "world.get-geometry",
    "world.get-provenance", "catalog.get", "catalog.search", "spatial.find-nearby",
    "spatial.find-in-area", "spatial.find-intersections", "reference.validate", "result.validate"
  )
  if ($providerOperations.Count -ne 30) {
    throw "The authoritative GDPS v0.2.1 capability lock must contain exactly 30 operations"
  }
  $consumerKeys = @($consumerOperations | ForEach-Object { "$($_.operationId)@$($_.operationVersion)" })
  $actualStableIds = @($consumerLock.defaultOperations | ForEach-Object { [string]$_.operationId } | Sort-Object)
  if ($consumerLock.schemaVersion -ne "2.0" -or
      @($consumerLock.defaultOperations).Count -ne 12 -or
      @($consumerLock.previewOperations).Count -ne 30 -or
      @($consumerKeys | Sort-Object -Unique).Count -ne 42 -or
      (Compare-Object ($stableOperationIds | Sort-Object) $actualStableIds).Count -ne 0) {
    throw "The live-projected southbound lock must contain exact 12 stable plus 30 GDPS preview operations"
  }
  foreach ($providerOperation in $providerOperations) {
    $matches = @($consumerOperations | Where-Object {
      $_.operationId -eq $providerOperation.operationId -and
      $_.operationVersion -eq $providerOperation.operationVersion
    })
    if ($matches.Count -ne 1) {
      throw "The verified southbound lock does not cover the exact 30-operation GDPS v0.2.1 inventory"
    }
    $consumerOperation = $matches[0]
    foreach ($field in @("inputSchemaHash", "outputSchemaHash", "semanticProfileHash", "maturity")) {
      if ($consumerOperation.$field -ne $providerOperation.$field) {
        throw "The verified southbound lock differs from the GDPS v0.2.1 capability lock"
      }
    }
    $permissions = @($consumerOperation.requiredPermissions)
    if ($consumerOperation.maturity -ne "PREVIEW" -or
        $consumerOperation.snapshotSupport -notin @("NONE", "BEST_EFFORT", "CONSISTENT_AT_START", "PINNED") -or
        $permissions.Count -eq 0 -or @($permissions | Sort-Object -Unique).Count -ne $permissions.Count -or
        @($permissions | Where-Object { $_ -notmatch '^[a-z][a-z0-9._:-]*$' }).Count -ne 0) {
      throw "The verified southbound lock violates the GDPS v0.2.1 consumer policy"
    }
  }
}

function Assert-ExactGdpsPatternPlan {
  if (-not (Test-Path -LiteralPath $gdpsRecipePlan -PathType Leaf)) {
    throw "The locked WSGS GDPS recipe plan is missing"
  }
  try {
    $plan = Get-Content -Raw -LiteralPath $gdpsRecipePlan | ConvertFrom-Json
  } catch {
    throw "The locked WSGS GDPS recipe plan is invalid JSON"
  }
  $actual = @($plan.activeRuntimeRecipes | ForEach-Object { [string]$_.semanticPattern })
  if ($actual.Count -ne $expectedGdpsPatterns.Count) {
    throw "The locked WSGS GDPS recipe plan must contain exactly 14 active patterns"
  }
  for ($index = 0; $index -lt $expectedGdpsPatterns.Count; $index++) {
    if ($actual[$index] -ne $expectedGdpsPatterns[$index]) {
      throw "The locked WSGS GDPS recipe plan differs from the exact 14-pattern allowlist"
    }
  }
}

function Assert-ExactGdpsCaseSelection {
  if ($LegacyV02Evidence) {
    if ($GdpsCaseId -and $GdpsCaseId -notin $legacyGdpsCaseIds) {
      throw "Legacy GDPS v0.2 evidence accepts only E2E-01 through E2E-07"
    }
    return
  }
  if (-not (Test-Path -LiteralPath $gdpsE2eCorpus -PathType Leaf)) {
    throw "The frozen GDPS v0.2.1 E2E corpus is missing"
  }
  try {
    $corpus = Get-Content -Raw -LiteralPath $gdpsE2eCorpus | ConvertFrom-Json
  } catch {
    throw "The frozen GDPS v0.2.1 E2E corpus is invalid JSON"
  }
  $caseIds = @($corpus.cases | ForEach-Object { [string]$_.id })
  if ($corpus.schemaVersion -ne "wsgs-gdps-e2e-corpus/2.0" -or $caseIds.Count -ne 16 -or
      (@($caseIds | Sort-Object -Unique)).Count -ne 16) {
    throw "The frozen GDPS v0.2.1 E2E corpus must contain exactly 16 unique cases"
  }
  if ($GdpsCaseId -and $GdpsCaseId -notin $caseIds) {
    throw "The requested GDPS case is not present in the frozen v0.2.1 corpus"
  }
  $corpusHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $gdpsE2eCorpus).Hash.ToLowerInvariant()
  if ($corpusHash -ne "b9717b9af929fbd82bf0509f9648379aae601a8a0f567ce1d520ad970a8f6525") {
    throw "The frozen GDPS v0.2.1 E2E corpus hash has drifted"
  }
  $unsupportedDrivers = @("NEG-RECIPE-DRIFT", "NEG-CURRENTNESS")
  if (-not $GdpsCaseId -or $GdpsCaseId -in $unsupportedDrivers) {
    throw "GDPS v0.2.1 full-corpus execution is blocked until the isolated recipe-drift and two-stage currentness drivers are implemented"
  }
}

function Get-CleanSourceCommit {
  $dirty = @(git -C $repositoryRoot status --porcelain=v1 --untracked-files=normal)
  if ($LASTEXITCODE -ne 0) { throw "Unable to inspect WSGS source provenance" }
  if ($dirty.Count -ne 0) { throw "WSGS source must be clean before recording real GDPS evidence" }
  $commit = (git -C $repositoryRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') {
    throw "Unable to resolve exact WSGS source commit"
  }
  return $commit
}

if (-not $SampleRoot -or -not (Test-Path -LiteralPath $SampleRoot -PathType Container)) {
  throw "GOWM_SAMPLE_ROOT must identify the authorized Sample World checkout"
}
if (-not (Test-Path -LiteralPath $operationLock -PathType Leaf)) {
  throw "The live-projected GDPS v0.2.1 southbound operation lock is missing; W44 remains NOT_RUN"
}
Assert-ExactGdpsPatternPlan
Assert-ExactGdpsCaseSelection
$sourceCommit = Get-CleanSourceCommit
$gdpsRecipeLockArtifact = Get-RequiredArtifactSha256 $gdpsRecipeLock "The generated GDPS recipe lock"
$gdpsConsumerSnapshotArtifact = Get-RequiredArtifactSha256 $gdpsConsumerSnapshot "The generated GDPS consumer snapshot"
$gdpsDescriptorRegistryArtifact = Get-RequiredArtifactSha256 $gdpsDescriptorRegistry "The generated GDPS descriptor registry"
$gdpsVocabularyRegistryArtifact = Get-RequiredArtifactSha256 $gdpsVocabularyRegistry "The generated GDPS vocabulary registry"
$gdpsConceptMapArtifact = Get-RequiredArtifactSha256 $gdpsConceptMap "The locked WSGS GDPS semantic concept map"
Assert-V021OperationLock $operationLock

$consumerEnvironment = Join-Path $SampleRoot ".runtime\wsgs-sample\wsgs-consumer-host.env"
$handoffDirectory = Join-Path $SampleRoot "output\wsgs-sample-handoff"
if (-not (Test-Path -LiteralPath $consumerEnvironment -PathType Leaf) -or
    -not (Test-Path -LiteralPath $handoffDirectory -PathType Container)) {
  throw "The authorized Sample World consumer handoff is incomplete"
}

$ready = Invoke-RestMethod -Uri "$GatewayBaseUrl/health/ready" -TimeoutSec 5
if ($ready.status -ne "ok") { throw "The isolated combined Gateway is not ready" }

Remove-ExactDatabaseContainer
$databasePassword = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
$env:POSTGRES_PASSWORD = $databasePassword
try {
  $containerId = docker run -d `
    --name $databaseContainer `
    -p "127.0.0.1:${DatabaseHostPort}:5432" `
    --tmpfs "/var/lib/postgresql/data:rw,noexec,nosuid,size=512m" `
    -e POSTGRES_PASSWORD `
    -e POSTGRES_USER=wsgs `
    -e POSTGRES_DB=wsgs `
    postgres:17.10-alpine3.23
  if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw "Unable to create the isolated WSGS database" }

  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 500
    docker exec $databaseContainer pg_isready -U wsgs -d wsgs | Out-Null
    $databaseReady = $LASTEXITCODE -eq 0
  } until ($databaseReady -or (Get-Date) -gt $deadline)
  if (-not $databaseReady) { throw "The isolated WSGS database did not become ready" }

  Import-ProcessEnvironment $consumerEnvironment
  $effectiveDataScope = if ($DataScope) {
    $DataScope.Trim()
  } elseif ($LegacyV02Evidence) {
    $env:GATEWAY_DATA_SCOPE_CLAIM
  } else {
    "scope-gdps-v021-baseline"
  }
  if (-not $effectiveDataScope -or $effectiveDataScope.Contains("*")) {
    throw "The GDPS integration data scope must be one exact non-wildcard claim"
  }
  $randomBytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Fill($randomBytes)
  $env:WSGS_REQUEST_ENCRYPTION_KEY_BASE64 = [Convert]::ToBase64String($randomBytes)
  $env:DATABASE_URL = "postgresql://wsgs:${databasePassword}@127.0.0.1:${DatabaseHostPort}/wsgs"
  $env:ALLOW_REAL_DEVELOPMENT_PIPELINE_GATE = "YES"
  $env:WSGS_RUN_GDPS_INTEGRATION_CASES = "YES"
  if ($LegacyV02Evidence) {
    Remove-Item Env:WSGS_GDPS_E2E_CORPUS_FILE -ErrorAction SilentlyContinue
  } else {
    $env:WSGS_GDPS_E2E_CORPUS_FILE = $gdpsE2eCorpus
  }
  if ($GdpsCaseId) { $env:WSGS_GDPS_CASE_ID = $GdpsCaseId }
  $env:WSGS_GATE_RUN_ID = "gdps-" + [Guid]::NewGuid().ToString("N").Substring(0, 16)
  $env:WSGS_EVIDENCE_SOURCE_COMMIT = $sourceCommit
  $env:WSGS_DEVELOPMENT_EVIDENCE_DIR = $evidenceDirectory
  $env:GOWM_SAMPLE_HANDOFF_DIR = $handoffDirectory
  $env:GOWM_GATEWAY_BASE_URL = $GatewayBaseUrl
  $env:GOWM_GATEWAY_TOKEN = $env:GOWM_WSGS_SAMPLE_TOKEN
  $env:GOWM_GATEWAY_TIMEOUT_MS = "120000"
  $env:GOWM_GATEWAY_MAX_RETRIES = "2"
  $env:GOWM_SOUTHBOUND_LOCK_FILE = $operationLock
  $operationLockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $operationLock).Hash.ToLowerInvariant()
  $env:GOWM_SOUTHBOUND_LOCK_SHA256 = "sha256:$operationLockHash"
  $env:GOWM_DELEGATION_ISSUER = $env:GATEWAY_DELEGATION_ISSUER
  $env:GOWM_DELEGATION_AUDIENCE = $env:GATEWAY_DELEGATION_AUDIENCE
  $env:GOWM_DELEGATION_SERVICE_PRINCIPAL_ID = $env:GATEWAY_RUNTIME_PRINCIPAL_REF
  $env:GOWM_DELEGATION_PRIVATE_KEY_FILE = $env:GOWM_WSGS_DELEGATION_PRIVATE_KEY_PATH
  $env:WSGS_READINESS_ACTOR_ID = "wsgs-gdps-readiness"
  $env:WSGS_READINESS_DATA_SCOPE = $effectiveDataScope
  $env:WSGS_READINESS_DATASET_SCOPES = $env:GATEWAY_DATASET_SCOPE_CLAIM
  $env:WSGS_READINESS_PERMISSIONS = "data:read,dataset:read,grounding.read"
  $env:WSGS_READINESS_TIMEOUT_MS = "120000"
  $env:WSGS_ALLOW_PREVIEW_CAPABILITIES = "YES"
  $env:WSGS_GDPS_PREVIEW_RECIPE_ALLOWLIST = $expectedGdpsPatterns -join ","
  $env:WSGS_GDPS_RECIPE_LOCK_FILE = $gdpsRecipeLockArtifact[0]
  $env:WSGS_GDPS_RECIPE_LOCK_SHA256 = $gdpsRecipeLockArtifact[1]
  $env:WSGS_GDPS_CONSUMER_SNAPSHOT_FILE = $gdpsConsumerSnapshotArtifact[0]
  $env:WSGS_GDPS_CONSUMER_SNAPSHOT_SHA256 = $gdpsConsumerSnapshotArtifact[1]
  $env:WSGS_GDPS_DESCRIPTOR_REGISTRY_FILE = $gdpsDescriptorRegistryArtifact[0]
  $env:WSGS_GDPS_DESCRIPTOR_REGISTRY_SHA256 = $gdpsDescriptorRegistryArtifact[1]
  $env:WSGS_GDPS_VOCABULARY_REGISTRY_FILE = $gdpsVocabularyRegistryArtifact[0]
  $env:WSGS_GDPS_VOCABULARY_REGISTRY_SHA256 = $gdpsVocabularyRegistryArtifact[1]
  $env:WSGS_GDPS_SEMANTIC_CONCEPT_MAP_FILE = $gdpsConceptMapArtifact[0]
  $env:WSGS_GDPS_SEMANTIC_CONCEPT_MAP_SHA256 = $gdpsConceptMapArtifact[1]
  $env:WSGS_MODEL_POLICY = "MODEL_REQUIRED"
  $env:MODEL_BASE_URL = "http://127.0.0.1:11434/v1"
  $env:MODEL_API_KEY = "local-test-only"
  $env:MODEL_NAME = "qwen2.5:latest"
  $env:MODEL_OUTPUT_MODE = "CHAT_COMPLETIONS_JSON"
  $env:MODEL_TIMEOUT_MS = "180000"
  $env:MODEL_MAX_RETRIES = "3"

  Push-Location $repositoryRoot
  try {
    npm.cmd run gate:real:development
    if ($LASTEXITCODE -ne 0) { throw "The real GDPS integration gate failed" }
  } finally {
    Pop-Location
  }
} finally {
  Remove-Item Env:POSTGRES_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_REQUEST_ENCRYPTION_KEY_BASE64 -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_CASE_ID -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_E2E_CORPUS_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_PREVIEW_RECIPE_ALLOWLIST -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_RECIPE_LOCK_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_RECIPE_LOCK_SHA256 -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_CONSUMER_SNAPSHOT_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_CONSUMER_SNAPSHOT_SHA256 -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_DESCRIPTOR_REGISTRY_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_DESCRIPTOR_REGISTRY_SHA256 -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_VOCABULARY_REGISTRY_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_VOCABULARY_REGISTRY_SHA256 -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_SEMANTIC_CONCEPT_MAP_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:WSGS_GDPS_SEMANTIC_CONCEPT_MAP_SHA256 -ErrorAction SilentlyContinue
  if (-not $KeepDatabase) { Remove-ExactDatabaseContainer }
}

Write-Output "WSGS_GDPS_REAL_INTEGRATION_GATE_FINISHED"
