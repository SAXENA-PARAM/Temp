import pandas as pd


def find_col(df, candidates):
    for c in candidates:
        for col in df.columns:
            if col.strip().lower() == c.lower():
                return col
    return None


def load_parameters(xlsx_path: str) -> dict:
    xls = pd.ExcelFile(xlsx_path)

    def load_sheet(name):
        if name in xls.sheet_names:
            df = pd.read_excel(xls, sheet_name=name)
            df.columns = [str(c).strip() for c in df.columns]
            return df
        return pd.DataFrame()

    eff_df      = load_sheet("Efficiency")
    cost_df     = load_sheet("Cost")
    interval_df = load_sheet("Interval")
    ess_df      = load_sheet("Essential")

    # ── efficiency map ────────────────────────────────────────────────────
    eff_map = {}
    eff_param_col    = find_col(eff_df, ["Parameter"])
    eff_standard_col = find_col(eff_df, ["Standard Value"])
    eff_ideal_col    = find_col(eff_df, ["Ideal Value"])

    if eff_param_col:
        for _, r in eff_df.iterrows():
            pname = str(r[eff_param_col]).strip()
            if not pname or pname.lower() == "nan":
                continue
            standard = r[eff_standard_col] if eff_standard_col and not pd.isna(r[eff_standard_col]) else None
            ideal    = r[eff_ideal_col]    if eff_ideal_col    and not pd.isna(r[eff_ideal_col])    else None
            eff_map[pname] = {
                "standard": float(standard) if standard is not None else None,
                "ideal":    float(ideal)    if ideal    is not None else None,
            }

    # ── cost map ──────────────────────────────────────────────────────────
    cost_map = {}
    cost_param_col = find_col(cost_df, ["Parameter"])
    cost_limit_col = find_col(cost_df, ["Upper Limit"])

    if cost_param_col:
        for _, r in cost_df.iterrows():
            pname = str(r[cost_param_col]).strip()
            if not pname or pname.lower() == "nan":
                continue
            limit = r[cost_limit_col] if cost_limit_col and not pd.isna(r[cost_limit_col]) else None
            cost_map[pname] = {"limit": float(limit) if limit is not None else None}

    # ── interval map ──────────────────────────────────────────────────────
    int_map = {}
    int_param_col = find_col(interval_df, ["Parameter"])
    int_lower_col = find_col(interval_df, ["Lower limit"])
    int_upper_col = find_col(interval_df, ["Upper limit"])

    if int_param_col:
        for _, r in interval_df.iterrows():
            pname = str(r[int_param_col]).strip()
            if not pname or pname.lower() == "nan":
                continue
            a = r[int_lower_col] if int_lower_col and not pd.isna(r[int_lower_col]) else None
            b = r[int_upper_col] if int_upper_col and not pd.isna(r[int_upper_col]) else None
            int_map[pname] = {
                "a": float(a) if a is not None else None,
                "b": float(b) if b is not None else None,
            }

    # ── essential params ──────────────────────────────────────────────────
    essential_params = []
    if not ess_df.empty:
        first_col = ess_df.columns[0]
        essential_params = [
            str(v).strip()
            for v in ess_df[first_col].dropna()
            if str(v).strip() != ""
        ]

    return {
        "eff_map":          eff_map,
        "cost_map":         cost_map,
        "int_map":          int_map,
        "essential_params": essential_params,
    }


def partype(pname: str, eff_map: dict, int_map: dict, cost_map: dict) -> str:
    if pname in eff_map:
        return "efficiency"
    if pname in int_map:
        return "interval"
    if pname in cost_map:
        return "cost"
    return ""