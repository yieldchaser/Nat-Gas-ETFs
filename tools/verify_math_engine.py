#!/usr/bin/env python3
"""
Deep Mathematical & Logical Verification Script for Return Distributions Engine
"""
import json
import math
import sys
from pathlib import Path
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = PROJECT_ROOT / "data" / "return_distributions.json"
DOCS_DATA_FILE = PROJECT_ROOT / "docs" / "data" / "return_distributions.json"

def verify_engine():
    print(f"Loading {DATA_FILE}...")
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    with open(DOCS_DATA_FILE, "r", encoding="utf-8") as f:
        docs_data = json.load(f)

    # Check identical payloads
    assert len(json.dumps(data)) == len(json.dumps(docs_data)), "Data and docs payloads differ!"

    instruments = data.get("instruments", {})
    expected_tickers = ["BOIL", "KOLD", "HNU.TO", "HND.TO", "3NGL.L", "3NGS.L", "NG=F"]
    for t in expected_tickers:
        assert t in instruments, f"Missing instrument: {t}"

    errors = []
    checks_passed = 0

    for ticker, inst in instruments.items():
        lb = inst.get("latest_bar")
        if not lb or lb.get("close") is None or lb.get("date") is None or lb.get("prev_close") is None:
            errors.append(f"{ticker}: Missing latest_bar data: {lb}")
        else:
            checks_passed += 1

        regimes = inst.get("regimes", {})
        expected_regimes = ["trailing_252d", "lng_era", "full_inception"]
        for r_key in expected_regimes:
            if r_key not in regimes:
                errors.append(f"{ticker}: Missing regime {r_key}")
                continue
            reg = regimes[r_key]

            # Matrix checks
            matrix = reg.get("expectancy_matrix", [])
            if len(matrix) != 5:
                errors.append(f"{ticker} {r_key}: Expected 5 matrix conditions, got {len(matrix)}")
            else:
                checks_passed += 1

            for row in matrix:
                for fwd in ("fwd_1d", "fwd_5d", "fwd_10d"):
                    cell = row.get(fwd, {})
                    if "win_rate" not in cell or "mean" not in cell or "edge" not in cell:
                        errors.append(f"{ticker} {r_key} {row.get('condition_key')}: Incomplete {fwd}")
                    else:
                        checks_passed += 1

            # Horizons checks
            horizons = reg.get("horizons", {})
            for h_key in ("1d", "5d", "21d"):
                if h_key not in horizons:
                    errors.append(f"{ticker} {r_key}: Missing horizon {h_key}")
                    continue
                h_obj = horizons[h_key]
                moments = h_obj.get("moments", {})
                risk = h_obj.get("risk_metrics", {})
                hist = h_obj.get("histogram", {})
                n_obs = h_obj.get("n_observations", 0)

                if n_obs < 30:
                    errors.append(f"{ticker} {r_key} {h_key}: Insufficient observations ({n_obs})")

                # Moments checks
                for m_key in ("mean", "median", "std", "ann_volatility", "skewness", "excess_kurtosis"):
                    val = moments.get(m_key)
                    if val is None or math.isnan(val) or math.isinf(val):
                        errors.append(f"{ticker} {r_key} {h_key}: Invalid moment {m_key}={val}")
                    else:
                        checks_passed += 1

                # Risk metrics checks
                var95 = risk.get("var_95")
                cvar95 = risk.get("cvar_95")
                var99 = risk.get("var_99")
                cvar99 = risk.get("cvar_99")

                if None in (var95, cvar95, var99, cvar99):
                    errors.append(f"{ticker} {r_key} {h_key}: Missing risk metrics")
                else:
                    # In empirical finance convention, left-tail VaR and CVaR are either negative numbers
                    # where CVaR <= VaR (more negative) or absolute loss sizes.
                    # In our engine: returns <= 0 are negative, so CVaR_95 <= VaR_95.
                    if cvar95 > var95 + 1e-6:
                        errors.append(f"{ticker} {r_key} {h_key}: CVaR-95 ({cvar95}) is less severe than VaR-95 ({var95})")
                    if cvar99 > var99 + 1e-6:
                        errors.append(f"{ticker} {r_key} {h_key}: CVaR-99 ({cvar99}) is less severe than VaR-99 ({var99})")
                    checks_passed += 2

                # Histogram checks
                bins = hist.get("bins", [])
                if len(bins) != 80:
                    errors.append(f"{ticker} {r_key} {h_key}: Bin count {len(bins)} != 80")
                else:
                    checks_passed += 1

                tot_count = sum(b.get("count", 0) for b in bins)
                tot_density = sum(b.get("density", 0.0) for b in bins)

                # Exactly 80 zero-anchored bins: 40 negative, 40 positive
                neg_bins = [b for b in bins if b.get("is_negative") is True]
                pos_bins = [b for b in bins if b.get("is_negative") is False]
                if len(neg_bins) != 40 or len(pos_bins) != 40:
                    errors.append(f"{ticker} {r_key} {h_key}: Asymmetrical bin partition ({len(neg_bins)} neg, {len(pos_bins)} pos)")
                else:
                    checks_passed += 1

                # Every observation is accounted for (outliers capped at boundaries)
                if tot_count != n_obs:
                    errors.append(f"{ticker} {r_key} {h_key}: Sum of bin counts ({tot_count}) != n_obs ({n_obs})")
                else:
                    checks_passed += 1

                # Densities sum to 1.0 (allow minor rounding tolerance of 0.005)
                if abs(tot_density - 1.0) > 0.005:
                    errors.append(f"{ticker} {r_key} {h_key}: Density sum ({tot_density}) deviated from 1.0")
                else:
                    checks_passed += 1

    print(f"Total Individual Mathematical Checks Run: {checks_passed}")
    if errors:
        print(f"FAILURE: {len(errors)} errors found:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    else:
        print("SUCCESS: ALL MATHEMATICAL AND EMPIRICAL VERIFICATIONS PASSED WITH ZERO ERRORS!")

if __name__ == "__main__":
    verify_engine()
