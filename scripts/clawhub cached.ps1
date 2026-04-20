# clawhub-cached.ps1 — Wrapper that caches ClawHub API responses
# Mitigates rate limits by caching search results and skill metadata
param(
  [Parameter(Position=0)]
  [string]$Action = "search",
  
  [Parameter(Position=1)]
  [string]$Query = "",
  
  [int]$CacheTTL = 3600,
  [switch]$SkipCache
)

$ErrorActionPreference = "Continue"

$CacheDir = "C:\Users\Administrator\.openclaw\.clawhub_cache"
$CacheDB = Join-Path $CacheDir "clawhub_cache.json"

function Get-CacheEntry {
  param([string]$Key)
  
  if (-not (Test-Path $CacheDB)) { return $null }
  
  $cache = Get-Content $CacheDB -Raw | ConvertFrom-Json -AsHashtable
  $entry = $cache[$Key]
  
  if ($null -eq $entry) { return $null }
  
  # Check expiration
  if ($entry.expiresAt -lt [DateTimeOffset]::Now.ToUnixTimeSeconds()) {
    return $null
  }
  
  return $entry.data
}

function Set-CacheEntry {
  param([string]$Key, [object]$Data, [int]$TTL = 3600)
  
  if (-not (Test-Path $CacheDir)) {
    New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null
  }
  
  if (-not (Test-Path $CacheDB)) {
    @{} | ConvertTo-Json | Set-Content $CacheDB -Encoding UTF8
  }
  
  $cache = @{}
  if (Test-Path $CacheDB) {
    $content = Get-Content $CacheDB -Raw
    if ($content) {
      try {
        $cache = $content | ConvertFrom-Json -AsHashtable
      } catch { }
    }
  }
  
  $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
  $cache[$Key] = @{
    data = $Data
    cachedAt = $now
    expiresAt = $now + $TTL
  }
  
  $cache | ConvertTo-Json -Depth 10 | Set-Content $CacheDB -Encoding UTF8
}

function Clear-ExpiredCache {
  if (-not (Test-Path $CacheDB)) { return 0 }
  
  $cache = @{}
  if (Test-Path $CacheDB) {
    $content = Get-Content $CacheDB -Raw
    if ($content) {
      try {
        $cache = $content | ConvertFrom-Json -AsHashtable
      } catch { return 0 }
    }
  }
  
  $now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
  $removed = 0
  
  foreach ($key in @($cache.Keys)) {
    if ($cache[$key].expiresAt -lt $now) {
      $cache.Remove($key)
      $removed++
    }
  }
  
  if ($removed -gt 0) {
    $cache | ConvertTo-Json -Depth 10 | Set-Content $CacheDB -Encoding UTF8
  }
  
  return $removed
}

# Route actions
switch ($Action) {
  "search" {
    $cacheKey = "search:$Query"
    
    if (-not $SkipCache) {
      $cached = Get-CacheEntry -Key $cacheKey
      if ($cached) {
        Write-Host "[clawhub-cached] Cache HIT for search: $Query"
        $cached | ConvertTo-Json -Depth 10
        return
      }
    }
    
    Write-Host "[clawhub-cached] Cache MISS for search: $Query — calling API..."
    $result = npx clawhub search $Query 2>&1
    
    if ($LASTEXITCODE -eq 0) {
      Set-CacheEntry -Key $cacheKey -Data ($result | ConvertFrom-Json | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
      Write-Host "[clawhub-cached] Cached result for $CacheTTL seconds"
    }
    
    $result
  }
  
  "info" {
    $cacheKey = "info:$Query"
    
    if (-not $SkipCache) {
      $cached = Get-CacheEntry -Key $cacheKey
      if ($cached) {
        Write-Host "[clawhub-cached] Cache HIT for info: $Query"
        $cached | ConvertTo-Json -Depth 10
        return
      }
    }
    
    Write-Host "[clawhub-cached] Cache MISS for info: $Query — calling API..."
    $result = npx clawhub info $Query 2>&1
    
    if ($LASTEXITCODE -eq 0) {
      Set-CacheEntry -Key $cacheKey -Data ($result | ConvertFrom-Json | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
    }
    
    $result
  }
  
  "clear" {
    $expired = Clear-ExpiredCache
    Write-Host "[clawhub-cached] Cleared $expired expired entries"
  }
  
  default {
    Write-Host "[clawhub-cached] Unknown action: $Action"
    Write-Host "Usage: clawhub-cached.ps1 <search|info|clear> [query]"
  }
}
