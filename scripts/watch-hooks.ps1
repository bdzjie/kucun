# watch-hooks.ps1 — Monitor workspace hooks/ for changes, trigger gateway restart
# Usage: .\watch-hooks.ps1 [-HookDir <path>] [-GatewayToken <token>]
param(
  [string]$HookDir = "C:\Users\Administrator\.openclaw\workspace\hooks",
  [string]$GatewayToken = "chen00jie",
  [string]$GatewayUrl = "ws://127.0.0.1:18789",
  [switch]$Verbose
)

$ErrorActionPreference = "Continue"

function Get-HookFiles {
  param([string]$Dir)
  if (-not (Test-Path $Dir)) { return @() }
  Get-ChildItem $Dir -Filter "*.js" -Recurse | Select-Object FullName, LastWriteTime
}

function Watch-Hooks {
  Write-Host "[watch-hooks] Monitoring: $HookDir"
  Write-Host "[watch-hooks] Press Ctrl+C to stop"
  
  $lastState = @{}
  $lastState = Get-HookFiles $HookDir | ForEach-Object { @{ $_.FullName = $_.LastWriteTime } | ConvertTo-Json -Compress }
  
  $watcher = New-Object System.IO.FileSystemWatcher
  $watcher.Path = $HookDir
  $watcher.Filter = "*.js"
  $watcher.IncludeSubdirectories = $true
  $watcher.EnableRaisingEvents = $true
  
  $changed = Register-ObjectEvent $watcher "Changed" -Action {
    $path = $Event.SourceEventArgs.FullPath
    $changeType = $Event.SourceEventArgs.ChangeType
    $time = $Event.TimeGenerated
    Write-Host "[watch-hooks] [$time] $changeType: $path"
  }
  
  $renamed = Register-ObjectEvent $watcher "Renamed" -Action {
    $path = $Event.SourceEventArgs.FullPath
    $changeType = $Event.SourceEventArgs.ChangeType
    $time = $Event.TimeGenerated
    Write-Host "[watch-hooks] [$time] $changeType: $path"
  }
  
  try {
    while ($true) {
      Start-Sleep -Seconds 5
      
      # Check if any hook file changed
      $current = Get-HookFiles $HookDir
      $changed = $false
      
      foreach ($file in $current) {
        $key = $file.FullName
        $lastWrite = $lastState[$key]
        if ($null -eq $lastWrite -or $file.LastWriteTime -gt $lastWrite) {
          Write-Host "[watch-hooks] Detected change: $key"
          $changed = $true
          $lastState[$key] = $file.LastWriteTime
        }
      }
      
      if ($changed) {
        Write-Host "[watch-hooks] Hook files changed — triggering restart..."
        
        # Restart gateway service
        $restart = openclaw gateway restart --json 2>&1
        if ($LASTEXITCODE -eq 0) {
          Write-Host "[watch-hooks] Gateway restart triggered successfully"
          
          # Wait for gateway to come back
          Write-Host "[watch-hooks] Waiting for gateway to reconnect..."
          $attempts = 0
          while ($attempts -lt 30) {
            Start-Sleep -Seconds 2
            try {
              $health = openclaw gateway call health --token $GatewayToken --url $GatewayUrl 2>&1
              if ($health -match '"ok":\s*true') {
                Write-Host "[watch-hooks] Gateway is back online"
                break
              }
            } catch { }
            $attempts++
          }
          
          if ($attempts -ge 30) {
            Write-Host "[watch-hooks] WARNING: Gateway did not reconnect within 60s"
          }
        } else {
          Write-Host "[watch-hooks] ERROR: Restart failed: $restart"
        }
        
        # Reset state after restart
        $lastState = @{}
        $current | ForEach-Object { $lastState[$_.FullName] = $_.LastWriteTime }
      }
    }
  }
  finally {
    $watcher.EnableRaisingEvents = $false
    $watcher.Dispose()
    Unregister-Event -SubscriptionId $changed.Id -ErrorAction SilentlyContinue
    Unregister-Event -SubscriptionId $renamed.Id -ErrorAction SilentlyContinue
    Write-Host "[watch-hooks] Stopped"
  }
}

Watch-Hooks
