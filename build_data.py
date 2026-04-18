"""Aggregate benchmark CSVs into a single data.json for the static site.

Run from the repo root:
    python docs/site/build_data.py
"""

from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from pathlib import Path
from statistics import mean, pstdev

ROOT = Path(__file__).resolve().parents[2]
BENCH = ROOT / "results" / "benchmark"
OUT = Path(__file__).resolve().parent / "data.json"

STRATEGIES = ["block", "gists", "grabs"]
RHO_DIR_RE = re.compile(r"^(\d+)pct$")

NUMERIC_COLS = [
    "test_rmse", "test_mae", "val_rmse", "val_mae",
    "training_wall_time_s", "n_train_samples",
    "codecarbon_energy_total_kwh", "codecarbon_cpu_energy_kwh",
    "codecarbon_gpu_energy_kwh", "codecarbon_ram_energy_kwh",
    "nvml_gpu_energy_kwh", "energy_per_sample_kwh",
    "final_epoch",
]


def _read_rows(csv_path: Path) -> list[dict]:
    with csv_path.open() as fh:
        reader = csv.DictReader(fh)
        rows = []
        for r in reader:
            for k in NUMERIC_COLS:
                if k in r and r[k] not in ("", None):
                    try:
                        r[k] = float(r[k])
                    except ValueError:
                        pass
            rows.append(r)
    return rows


def _rho_dirs(strategy_dir: Path) -> list[tuple[int, Path]]:
    out = []
    for d in sorted(strategy_dir.iterdir()):
        m = RHO_DIR_RE.match(d.name)
        if m:
            out.append((int(m.group(1)), d))
    return sorted(out, key=lambda t: t[0])


def _collect_means() -> list[dict]:
    """Return per-(strategy, rho, arch, capacity) mean rows."""
    all_rows: list[dict] = []
    for strategy in STRATEGIES:
        strat_dir = BENCH / strategy
        if not strat_dir.is_dir():
            continue
        for rho_pct, rho_dir in _rho_dirs(strat_dir):
            f = rho_dir / "benchmark_final_means.csv"
            if not f.exists():
                continue
            rows = _read_rows(f)
            for r in rows:
                r["_strategy"] = strategy
                r["_rho"] = rho_pct / 100.0
                r["_rho_pct"] = rho_pct
                all_rows.append(r)
    return all_rows


def _agg_by(rows: list[dict], keys: list[str], metric: str) -> dict:
    g: dict[tuple, list[float]] = defaultdict(list)
    for r in rows:
        v = r.get(metric)
        if isinstance(v, (int, float)):
            g[tuple(r.get(k) for k in keys)].append(v)
    return {k: {"mean": mean(v), "std": pstdev(v) if len(v) > 1 else 0.0, "n": len(v)}
            for k, v in g.items()}


def main():
    rows = _collect_means()
    if not rows:
        raise SystemExit("No benchmark CSVs found under results/benchmark/")

    archs = sorted({r["model"] for r in rows if r.get("model")})
    caps = sorted({r["model_subtype"] for r in rows if r.get("model_subtype")})
    rhos = sorted({r["_rho_pct"] for r in rows})

    # --- per-strategy, per-rho averaged over arch x capacity --------------
    by_sr = _agg_by(rows, ["_strategy", "_rho_pct"], "test_rmse")
    energy_sr = _agg_by(rows, ["_strategy", "_rho_pct"], "codecarbon_energy_total_kwh")
    time_sr = _agg_by(rows, ["_strategy", "_rho_pct"], "training_wall_time_s")
    eps_sr = _agg_by(rows, ["_strategy", "_rho_pct"], "energy_per_sample_kwh")
    co2_sr = _agg_by(rows, ["_strategy", "_rho_pct"], "codecarbon_gpu_energy_kwh")

    summary = []
    for strategy in STRATEGIES:
        for rho_pct in rhos:
            key = (strategy, rho_pct)
            if key not in by_sr:
                continue
            summary.append({
                "strategy": strategy,
                "rho_pct": rho_pct,
                "rmse": by_sr[key],
                "energy_kwh": energy_sr.get(key),
                "time_s": time_sr.get(key),
                "energy_per_sample_kwh": eps_sr.get(key),
                "gpu_energy_kwh": co2_sr.get(key),
            })

    # --- per-architecture breakdown (avg over capacities) -----------------
    by_sra_rmse = _agg_by(rows, ["_strategy", "_rho_pct", "model"], "test_rmse")
    by_sra_en = _agg_by(rows, ["_strategy", "_rho_pct", "model"], "codecarbon_energy_total_kwh")
    by_sra_time = _agg_by(rows, ["_strategy", "_rho_pct", "model"], "training_wall_time_s")

    per_arch = []
    for strategy in STRATEGIES:
        for rho_pct in rhos:
            for arch in archs:
                key = (strategy, rho_pct, arch)
                if key not in by_sra_rmse:
                    continue
                per_arch.append({
                    "strategy": strategy,
                    "rho_pct": rho_pct,
                    "architecture": arch,
                    "rmse": by_sra_rmse[key],
                    "energy_kwh": by_sra_en.get(key),
                    "time_s": by_sra_time.get(key),
                })

    # --- per-capacity detail (strategy, rho, arch, capacity) --------------
    detail = []
    for r in rows:
        detail.append({
            "strategy": r["_strategy"],
            "rho_pct": r["_rho_pct"],
            "architecture": r.get("model"),
            "capacity": r.get("model_subtype"),
            "rmse": r.get("test_rmse"),
            "mae": r.get("test_mae"),
            "energy_kwh": r.get("codecarbon_energy_total_kwh"),
            "gpu_energy_kwh": r.get("codecarbon_gpu_energy_kwh"),
            "time_s": r.get("training_wall_time_s"),
            "n_train_samples": r.get("n_train_samples"),
            "energy_per_sample_kwh": r.get("energy_per_sample_kwh"),
        })

    payload = {
        "strategies": STRATEGIES,
        "architectures": archs,
        "capacities": caps,
        "rho_pcts": rhos,
        "summary": summary,
        "per_arch": per_arch,
        "detail": detail,
        "co2_factor_g_per_kwh": 475.0,  # global avg used for illustrative CO2 derivation
    }

    OUT.write_text(json.dumps(payload, indent=2))
    print(f"Wrote {OUT} — {len(rows)} rows, {len(summary)} summary points, "
          f"{len(per_arch)} per-arch points, {len(detail)} detail rows.")


if __name__ == "__main__":
    main()
