# audit-skills.ps1 — Audit all skills for eligibility, missing deps, trigger quality
param(
  [switch]$Fix,
  [switch]$Json
)

$ErrorActionPreference = "Continue"

$SkillsDir = "C:\Users\Administrator\.openclaw\workspace\skills"
$WorkspaceIndex = "C:\Users\Administrator\.openclaw\workspace\memory\skill_index.json"

function Get-SkillQuality {
  param([string]$SkillPath)
  
  $skillMd = Join-Path $SkillPath "SKILL.md"
  if (-not (Test-Path $skillMd)) {
    return @{ score = 0; issues = @("No SKILL.md") }
  }
  
  $content = Get-Content $skillMd -Raw
  $issues = @()
  $score = 100
  
  # Check frontmatter
  if ($content -notmatch '^---\n') {
    $issues += "Missing frontmatter"
    $score -= 20
  }
  
  # Check required fields
  $required = @('name', 'description')
  foreach ($field in $required) {
    if ($content -notmatch "^$field:\s*") {
      $issues += "Missing field: $field"
      $score -= 15
    }
  }
  
  # Check triggers
  if ($content -notmatch 'triggers:') {
    $issues += "No triggers defined"
    $score -= 10
  }
  
  # Check for description length
  if ($content -match 'description:\s*>(.+?)(?:\n---|\n#)') {
    $desc = $matches[1].Trim()
    if ($desc.Length -lt 30) {
      $issues += "Description too short (<30 chars)"
      $score -= 5
    }
    if ($desc.Length -gt 500) {
      $issues += "Description too long (>500 chars)"
      $score -= 5
    }
  }
  
  # Check for handler
  $hasHandler = (Test-Path (Join-Path $SkillPath "handler.js"))
  $hasRef = (Test-Path (Join-Path $SkillPath "references"))
  
  if (-not $hasHandler -and -not $hasRef) {
    $issues += "No handler.js or references/"
    $score -= 10
  }
  
  # Check for skill.yaml (GEPA manifest)
  if (Test-Path (Join-Path $SkillPath "skill.yaml")) {
    $score += 5  # Bonus for structured manifest
  }
  
  # Count files
  $fileCount = (Get-ChildItem $SkillPath -File | Where-Object { $_.Name -ne 'SKILL.md' }).Count
  if ($fileCount -eq 0) {
    $issues += "No supporting files (references/, scripts/, etc.)"
    $score -= 5
  }
  
  return @{
    score = [Math]::Max(0, $score)
    issues = $issues
    hasHandler = $hasHandler
    hasRef = $hasRef
    hasManifest = (Test-Path (Join-Path $SkillPath "skill.yaml"))
    fileCount = $fileCount
  }
}

function Get-SkillFrontmatter {
  param([string]$SkillPath)
  
  $skillMd = Join-Path $SkillPath "SKILL.md"
  if (-not (Test-Path $skillMd)) { return @{} }
  
  $content = Get-Content $skillMd -Raw -Encoding UTF8
  $fm = @{}
  
  if ($content -match '(?s)^---\n(.+?)\n---') {
    foreach ($line in $matches[1].Split("`n")) {
      if ($line -match '^(\w+):\s*(.*)') {
        $fm[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
      }
    }
  }
  
  return $fm
}

# Audit all workspace skills
$skills = Get-ChildItem $SkillsDir -Directory | Where-Object { $_.Name -notmatch '^\.' }

$report = @()
$totalScore = 0

foreach ($skill in $skills) {
  $quality = Get-SkillQuality -SkillPath $skill.FullName
  $fm = Get-SkillFrontmatter -SkillPath $skill.FullName
  
  $triggers = @()
  if ($fm.Contains('triggers')) {
    $triggersStr = $fm['triggers']
    if ($triggersStr) {
      if ($triggersStr -match '^\[.*\]$') {
        try {
          $triggers = @($triggersStr.Trim('[]') -split ',' | ForEach-Object { $_.Trim().Trim('"') })
        } catch { }
      } else {
        $triggers = @($triggersStr -split ',' | ForEach-Object { $_.Trim() })
      }
    }
  }
  
  $obj = @{
    id = $skill.Name
    name = $fm.Get_Item('name') ?: $skill.Name
    description = $fm.Get_Item('description') ?: ""
    triggers = $triggers
    triggerCount = $triggers.Count
    qualityScore = $quality.score
    issues = $quality.issues
    hasHandler = $quality.hasHandler
    hasRef = $quality.hasRef
    hasManifest = $quality.hasManifest
    fileCount = $quality.fileCount
  }
  
  $report += $obj
  $totalScore += $quality.score
}

# Sort by quality
$report = $report | Sort-Object { $_.qualityScore },@{Expression={$_.triggerCount};Descending=$false}

# Summary
$avgScore = if ($report.Count -gt 0) { [Math]::Round($totalScore / $report.Count, 1) } else { 0 }
$noTrigger = ($report | Where-Object { $_.triggerCount -eq 0 }).Count
$lowQuality = ($report | Where-Object { $_.qualityScore -lt 70 }).Count

if ($Json) {
  $report | ConvertTo-Json -Depth 10
  return
}

Write-Host "=== Skill Quality Audit ===" -ForegroundColor Cyan
Write-Host "Total skills: $($report.Count)"
Write-Host "Average quality score: $avgScore / 100"
Write-Host "No triggers: $noTrigger"
Write-Host "Low quality (<70): $lowQuality"
Write-Host ""

# Show worst offenders first
Write-Host "=== Bottom 10 (Needs Improvement) ===" -ForegroundColor Yellow
$report[0..[Math]::Min(9, $report.Count-1)] | ForEach-Object {
  $issuesStr = if ($_.issues.Count -gt 0) { " | " + ($_.issues -join ", ") } else { "" }
  Write-Host "[$($_.qualityScore)] $($_.id)$issuesStr"
}

Write-Host ""
Write-Host "=== Skills Missing Triggers ===" -ForegroundColor Magenta
$report | Where-Object { $_.triggerCount -eq 0 } | ForEach-Object {
  Write-Host "  - $($_.id): $($_.description.Substring(0, [Math]::Min(60, $_.description.Length)))..."
}

Write-Host ""
Write-Host "=== Top 10 (Good Quality) ===" -ForegroundColor Green
$report[-1..-10] | Sort-Object { $_.qualityScore } -Descending | Select-Object -First 10 | ForEach-Object {
  $triggersStr = if ($_.triggers.Count -gt 0) { " | " + ($_.triggers -join ", ") } else { " (no triggers)" }
  Write-Host "[$($_.qualityScore)] $($_.id)$triggersStr"
}

# Save detailed report
$reportPath = "C:\Users\Administrator\.openclaw\workspace\memory\skill-audit.json"
$reportJson = @{
  generated = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
  summary = @{
    total = $report.Count
    avgScore = $avgScore
    noTrigger = $noTrigger
    lowQuality = $lowQuality
  }
  skills = $report
} | ConvertTo-Json -Depth 10
$reportJson | Set-Content $reportPath -Encoding UTF8

Write-Host ""
Write-Host "Detailed report: $reportPath"
