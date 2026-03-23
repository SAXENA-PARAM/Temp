"""
Original EWQI logic — faithful to EWQI.py.

The only change from the original:
  - Input  : list of marker dicts  (was Data.csv)
  - Output : list of WQI floats    (was WQI.csv)

Everything else — entropy calculation, weight derivation,
scoring formulas — is copied line-for-line from EWQI.py.
"""

import math
import numpy as np
import pandas as pd

from param_loader import partype


LOG_PARAMS = [
    "Fecal Streptococci [MPN/100mL]",
    "Fecal Coliform [MPN/100mL]",
    "Total Coliforms [MPN/100mL]",
]
BOD_PARAM = "Biochemical Oxygen Demand (BOD) over 3 days at 27° C [mg/L]"


def safe_div(a, b, default=0.0):
    return a / b if b not in (0, None, np.nan) else default


def run_ewqi(markers: list[dict], param_config: dict) -> tuple[list[float | None], dict]:
    """
    markers      : list of dicts, each is one marker's parameters
                   e.g. [{"pH": 7.2, "Turbidity [NTU]": 3.1}, ...]
    param_config : output of load_parameters()
    
    Returns      : list of WQI values, one per marker (None if not computable)
    """
    eff_map         = param_config["eff_map"]
    cost_map        = param_config["cost_map"]
    int_map         = param_config["int_map"]
    essential_params = param_config["essential_params"]

    # ── build DataFrame from markers (mirrors reading Data.csv) ───────────
    data_df = pd.DataFrame(markers)

    # keep only columns that exist in any parameter map
    all_known = set(eff_map) | set(cost_map) | set(int_map)
    param_cols = [c for c in data_df.columns if c in all_known]

    # convert to numeric (mirrors EWQI.py line 37)
    for c in param_cols:
        data_df[c] = pd.to_numeric(data_df[c], errors="coerce")

    n = len(data_df)

    # ── Phase 1: entropy (EWQI.py lines 119–184) ─────────────────────────
    y_norm      = {p: [] for p in param_cols}
    data_counts = {}
    entropy     = {p: 1.0 for p in param_cols}

    for p in param_cols:
        col_vals  = data_df[p].dropna().to_numpy(dtype=float)
        dataCount = len(col_vals)
        data_counts[p] = dataCount
        datarate  = safe_div(dataCount, n, default=0.0)

        if dataCount == 0:
            entropy[p] = 1.0
            continue
        if datarate < 0.5:
            entropy[p] = 1.0
            continue
        if datarate < 0.7 and p not in essential_params:
            entropy[p] = 1.0
            continue

        minV = float(np.min(col_vals))
        maxV = float(np.max(col_vals))

        if maxV == minV:
            entropy[p] = 0.0
            y_norm[p]  = (np.ones(dataCount) / dataCount).tolist()
            continue

        ptype  = partype(p, eff_map, int_map, cost_map)
        yvals  = []

        if ptype == "efficiency":
            for v in col_vals:
                y = (v - minV) / (maxV - minV)
                yvals.append(max(0.0, y))

        elif ptype == "cost":
            for v in col_vals:
                y = (maxV - v) / (maxV - minV)
                yvals.append(max(0.0, y))

        else:  # interval
            iv = int_map.get(p, {})
            a  = iv.get("a")
            b  = iv.get("b")
            for v in col_vals:
                if v < a:
                    denom = (a - minV) if (a - minV) != 0 else 1e-9
                    y = 1.0 - (a - v) / denom
                elif v > b:
                    denom = (maxV - b) if (maxV - b) != 0 else 1e-9
                    y = 1.0 - (v - b) / denom
                else:
                    y = 1.0
                yvals.append(max(0.0, y))

        yvals = np.array(yvals, dtype=float)
        s     = np.sum(yvals)

        if s == 0:
            y_norm[p] = (np.ones(dataCount) / dataCount).tolist()
            entropy[p] = 1.0
        else:
            y_norm[p]  = (yvals / s).tolist()
            y_nonzero  = yvals[yvals > 0]
            ent = -1.0 / math.log(dataCount) * np.sum(
                (y_nonzero / s) * np.log(y_nonzero / s)
            )
            entropy[p] = float(ent)

    # ── weights (EWQI.py lines 187–193) ──────────────────────────────────
    one_minus_e = np.array([1 - entropy[p] for p in param_cols], dtype=float)
    den         = float(np.sum(one_minus_e))

    if den == 0:
        weights_arr = np.ones(len(param_cols)) / len(param_cols)
    else:
        weights_arr = one_minus_e / den

    weights = {p: float(weights_arr[i]) for i, p in enumerate(param_cols)}

    # ── Phase 2: scores (EWQI.py lines 196–256) ──────────────────────────
    scores = pd.DataFrame(index=data_df.index, columns=param_cols, dtype=float)

    for p in param_cols:
        col       = data_df[p]
        ptype     = partype(p, eff_map, int_map, cost_map)
        eff       = eff_map.get(p, {})
        standard  = eff.get("standard")
        ideal     = eff.get("ideal")
        limit     = cost_map.get(p, {}).get("limit")
        a         = int_map.get(p, {}).get("a")
        b         = int_map.get(p, {}).get("b")

        for idx, v in col.items():
            if pd.isna(v):
                scores.at[idx, p] = np.nan
                continue
            v = float(v)

            if ptype == "efficiency":
                if standard is None:
                    scores.at[idx, p] = np.nan
                    continue
                if ideal is not None:
                    denom = (standard - ideal) or 1e-9
                    scores.at[idx, p] = float((v - ideal) / denom * 100.0)
                else:
                    if v == 0:
                        scores.at[idx, p] = np.nan
                        continue
                    scores.at[idx, p] = float(standard / v * 100.0)

            elif ptype == "cost":
                if p in LOG_PARAMS:
                    log_v = np.log10(v + 1)
                    log_l = np.log10(limit + 1)
                    denom = log_v + 6 * log_l
                    scores.at[idx, p] = float((700 * log_v) / denom) if denom else np.nan
                elif p == BOD_PARAM:
                    scores.at[idx, p] = float(100.0 * (v / limit) ** 0.5)
                else:
                    if limit is None:
                        scores.at[idx, p] = np.nan
                        continue
                    scores.at[idx, p] = float((v / limit) * 100.0)

            else:  # interval
                if v < a:
                    scores.at[idx, p] = float((a - v) / a * 100.0) if a else np.nan
                elif v > b:
                    scores.at[idx, p] = float((v - b) / b * 100.0) if b else np.nan
                else:
                    scores.at[idx, p] = 0.0

    scores = scores.replace([np.inf, -np.inf], np.nan)

    # ── WQI per row (EWQI.py lines 259–278) ──────────────────────────────
    wqi_list = []
    for idx, row in data_df.iterrows():
        available = [p for p in param_cols if not pd.isna(row.get(p, np.nan))]
        if not available:
            wqi_list.append(None)
            continue

        num = denom = 0.0
        for p in available:
            s = scores.at[idx, p]
            if pd.isna(s):
                continue
            w    = weights.get(p, 0.0)
            num   += w * s
            denom += w

        wqi_list.append(round(float(num / denom), 4) if denom > 0 else None)

    return wqi_list, weights