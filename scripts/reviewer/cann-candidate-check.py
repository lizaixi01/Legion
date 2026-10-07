"""Offline adapter for the existing CANN project_inventory checker; no evaluator runs.

The hook and explicit fallback call this same entry point. Only evidence files under
the pilot are written. Kernel files, platform requests and budgets are never changed.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True


def check(conditions_path):
    root = conditions_path.resolve().parent
    conditions = json.loads(conditions_path.read_text(encoding="utf-8"))
    evaluator_path = Path(conditions["evaluator"])
    spec = importlib.util.spec_from_file_location("cann_offline_inventory", evaluator_path)
    evaluator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evaluator)
    baseline = evaluator.project_inventory(Path(conditions["baseline"]))
    frozen = json.loads((root / "baseline-inventory.json").read_text(encoding="utf-8"))
    if baseline != frozen:
        raise ValueError("The verified baseline changed after pilot preparation")
    baseline_by_path = {item["path"]: item for item in baseline}
    results = []
    for name in conditions["candidates"]:
        directory = root / name / "candidate"
        inventory = evaluator.project_inventory(directory)
        by_path = {item["path"]: item for item in inventory}
        changed = [path for path in sorted(set(by_path) | set(baseline_by_path))
                   if by_path.get(path) != baseline_by_path.get(path)]
        # project_inventory covers the official manifest; also reject extra files.
        actual_files = sorted(p.relative_to(directory).as_posix()
                              for p in directory.rglob("*") if p.is_file())
        unexpected = sorted(set(actual_files) - set(baseline_by_path))
        status = changed == ["kernel.asc"] and not unexpected
        results.append({"candidate": name, "passed": status,
                        "changed_files": changed, "unexpected_files": unexpected,
                        "kernel_sha256": by_path["kernel.asc"]["sha256"],
                        "inventory": inventory})
    hashes = [entry["kernel_sha256"] for entry in results]
    distinct = len(set(hashes)) == len(hashes)
    return {"passed": all(entry["passed"] for entry in results) and distinct,
            "baseline_unchanged": True, "candidates_distinct": distinct,
            "checks": results,
            "scope": "Existing manifest/path/SHA checks and scaffold isolation only; "
                     "not CANN compilation, numerical correctness or performance."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--conditions", type=Path, required=True)
    parser.add_argument("--origin", choices=("explicit", "hook"), default="explicit")
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    result = {"checked_at": now.isoformat(), "origin": args.origin}
    try:
        if args.origin == "hook":
            event = json.load(sys.stdin)
            result["hook"] = {key: event.get(key) for key in
                              ("hook_event_name", "session_id", "tool_name", "cwd")}
            if event.get("hook_event_name") != "PostToolUse":
                raise ValueError("Expected an actual PostToolUse hook input")
        result.update(check(args.conditions))
    except Exception as exc:
        result.update(passed=False, error={"type": type(exc).__name__, "message": str(exc)})
    destination = args.conditions.resolve().parent / "checks"
    destination.mkdir(exist_ok=True)
    saved = destination / (args.origin + "-" + now.strftime("%Y%m%dT%H%M%S%fZ") + ".json")
    saved.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "origin": args.origin,
                      "evidence": str(saved)}, ensure_ascii=False))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
