"""
heartbeat_skills_health.py — Run as part of heartbeat every 72h.
Audits skill quality, triggers, and reports actionable alerts.
"""
import sys
import json
import subprocess
from pathlib import Path

WORKSPACE = Path("C:/Users/Administrator/.openclaw/workspace")
AUDIT_REPORT = WORKSPACE / "memory" / "skill-audit.json"
SKILL_INDEX = WORKSPACE / "memory" / "skill_index.json"

def run():
    # Run audit
    result = subprocess.run(
        [sys.executable, str(WORKSPACE / "modules" / "audit_skills.py")],
        cwd=str(WORKSPACE),
        capture_output=True,
        text=True,
        timeout=30,
    )
    
    # Load latest report
    if not AUDIT_REPORT.exists():
        return {"alert": "No audit report found", "action": "Run audit_skills.py manually"}
    
    report = json.loads(AUDIT_REPORT.read_text(encoding="utf-8"))
    summary = report.get("summary", {})
    skills = report.get("skills", [])
    
    alerts = []
    actions = []
    
    # Check quality
    avg = summary.get("avgScore", 0)
    if avg < 70:
        alerts.append(f"Average skill quality LOW: {avg}/100")
    elif avg < 80:
        alerts.append(f"Average skill quality OK: {avg}/100")
    else:
        pass  # Good
    
    # Check no triggers
    no_trigger = summary.get("noTrigger", 0)
    if no_trigger > 0:
        alerts.append(f"{no_trigger} skills missing triggers — not auto-matchable")
        # Get list
        missing = [s["id"] for s in skills if s["triggerCount"] == 0]
        actions.append(f"Fix: python modules/add_triggers.py")
    
    # Check low quality
    low = summary.get("lowQuality", 0)
    if low > 0:
        alerts.append(f"{low} skills below 70/100 quality")
    
    # Check for newly added skills (quality=0 or very low)
    quality_zero = [s["id"] for s in skills if s["qualityScore"] < 50]
    if quality_zero:
        alerts.append(f"{len(quality_zero)} skills critically low: {', '.join(quality_zero[:5])}")
    
    # Overall status
    total = summary.get("total", 0)
    status = "HEALTHY" if avg >= 80 and no_trigger == 0 else "NEEDS_ATTENTION" if avg >= 60 else "CRITICAL"
    
    return {
        "status": status,
        "total": total,
        "avgScore": avg,
        "noTrigger": no_trigger,
        "lowQuality": low,
        "alerts": alerts,
        "actions": actions,
        "reportPath": str(AUDIT_REPORT),
    }

if __name__ == "__main__":
    result = run()
    print(json.dumps(result, indent=2, ensure_ascii=False))
