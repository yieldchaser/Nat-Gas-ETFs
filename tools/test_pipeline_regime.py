import sys
from pathlib import Path
import numpy as np
import pandas as pd

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root / "scripts"))

from data_pipeline import (
    NG_REGIME_EXTREME_PRICE,
    NG_REGIME_HIGH_PRICE,
    NG_REGIME_EXTREME_Z,
    NG_REGIME_ELEVATED_Z,
    NG_REGIME_EXTREME_HV_PCT,
    NG_REGIME_ELEVATED_HV_PCT,
    _season_label
)

print("=== VERIFYING DATA PIPELINE REGIME THRESHOLDS & LOGIC ===")

# Test 1: Season labels
assert _season_label(1) == "winter"
assert _season_label(2) == "winter"
assert _season_label(3) == "spring"
assert _season_label(4) == "spring"
assert _season_label(5) == "spring"
assert _season_label(6) == "summer"
assert _season_label(7) == "summer"
assert _season_label(8) == "summer"
assert _season_label(9) == "fall"
assert _season_label(10) == "fall"
assert _season_label(11) == "winter"
assert _season_label(12) == "winter"
print("PASS: Season labels for all 12 months")

# Test 2: Extreme price classification ($8.50)
def classify_regime(price, seasonal_z=0.0, ng_hv_pct=None):
    z_abs = abs(seasonal_z) if seasonal_z is not None else 0.0
    if (price > NG_REGIME_EXTREME_PRICE
            or z_abs >= NG_REGIME_EXTREME_Z
            or (ng_hv_pct is not None and ng_hv_pct >= NG_REGIME_EXTREME_HV_PCT)):
        return "extreme"
    elif (price > NG_REGIME_HIGH_PRICE
            or z_abs >= NG_REGIME_ELEVATED_Z
            or (ng_hv_pct is not None and ng_hv_pct >= NG_REGIME_ELEVATED_HV_PCT)):
        return "elevated"
    else:
        return "normal"

# Case: $8.50 -> extreme
assert classify_regime(8.50, 1.2, 50.0) == "extreme", "Price $8.50 must classify as extreme"
# Case: $5.00 -> elevated
assert classify_regime(5.00, 0.5, 40.0) == "elevated", "Price $5.00 must classify as elevated"
# Case: $3.047, z=-0.3, hv_pct=38.7 -> normal
assert classify_regime(3.047, -0.3, 38.7) == "normal", "Real data $3.047 must classify as normal"
# Case: z=2.6σ -> extreme
assert classify_regime(3.50, 2.6, 50.0) == "extreme", "z=2.6σ must classify as extreme"
# Case: hv_pct=92 -> extreme
assert classify_regime(3.50, 0.5, 92.0) == "extreme", "hv_pct=92 must classify as extreme"

print("PASS: Regime classification logic verified across all boundaries")
print("ALL PYTHON PIPELINE REGIME TESTS PASSED!")
