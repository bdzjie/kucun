# reload-hooks.ps1 — Reload workspace hooks by restarting gateway
# Usage: .\reload-hooks.ps1 [-SkipHealthCheck]
param(
  [switch]$SkipHealthCheck,
  [string]$GatewayToken = "chen00jie",
  [string]$GatewayUrl = "ws://127.0.0.1:18789"
)

$ErrorActionPreference = "Stop"

Write-Host "[reload-hooks] Restarting gateway to reload hooks..."

# Record pre-restart state
$preHealth = $null
if (-not $SkipHealthCheck) {
  try {
    $preHealth = openclaw gateway call health --token $GatewayToken --url $GatewayUrl 2>&1
    if ($preHealth -match '"ok":\s*true') {
      Write-Host "[reload-hooks] Gateway is running"
    }
  } catch {
    Write-Host "[reload-hooks] Warning: Could not get pre-restart health"
  }
}

# Trigger restart
Write-Host "[reload-hooks] Calling openclaw gateway restart..."
$restartOutput = openclaw gateway restart --json 2>&1
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
  Write-Host "[reload-hooks] ERROR: Restart command failed with exit code $exitCode"
  Write-Host $restartOutput
  exit $exitCode
}

Write-Host "[reload-hooks] Restart triggered, waiting for gateway to come back..."

# Wait for gateway to restart
$maxWait = 60
$interval = 3
$attempts = 0

while ($attempts -lt ($maxWait / $interval)) {
  Start-Sleep -Seconds $interval
  
  try {
    $health = openclaw gateway call health --token $GatewayToken --url $GatewayUrl 2>&1
    if ($health -match '"ok":\s*true') {
      $took = $attempts * $interval
      Write-Host "[reload-hooks] Gateway is back online after ~${took}s"
      exit 0
    }
  } catch {
    # Gateway not ready yet
  }
  
  $attempts++
  Write-Host "[reload-hooks] Waiting... ($attempts/$([int]($maxWait/$interval)))"
}

Write-Host "[reload-hooks] ERROR: Gateway did not restart within ${maxWait}s"
Write-Host "[reload-hooks] Please check: openclaw gateway status"
exit 1
