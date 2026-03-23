from param_loader import partype


def validate_marker(marker: dict, param_config: dict) -> list[str]:
    errors  = []
    lake_id = marker.get("lake_id")
    lat     = marker.get("lat")
    lng     = marker.get("lng")
    params  = marker.get("parameters") or {}

    if not lake_id:
        errors.append("missing lake_id")

    if lat is None:
        errors.append(f"lake_id={lake_id}: missing lat")
    else:
        try:
            if not (-90.0 <= float(lat) <= 90.0):
                errors.append(f"lake_id={lake_id}: lat {lat} out of range")
        except (TypeError, ValueError):
            errors.append(f"lake_id={lake_id}: lat '{lat}' is not numeric")

    if lng is None:
        errors.append(f"lake_id={lake_id}: missing lng")
    else:
        try:
            if not (-180.0 <= float(lng) <= 180.0):
                errors.append(f"lake_id={lake_id}: lng {lng} out of range")
        except (TypeError, ValueError):
            errors.append(f"lake_id={lake_id}: lng '{lng}' is not numeric")

    if not isinstance(params, dict) or len(params) == 0:
        errors.append(f"lake_id={lake_id}: parameters must be a non-empty object")
        return errors

    eff_map  = param_config["eff_map"]
    cost_map = param_config["cost_map"]
    int_map  = param_config["int_map"]

    known = [p for p in params if partype(p, eff_map, int_map, cost_map) != ""]
    if not known:
        errors.append(
            f"lake_id={lake_id}: none of the submitted parameters "
            f"({list(params.keys())}) are defined in Parameters.xlsx"
        )

    return errors