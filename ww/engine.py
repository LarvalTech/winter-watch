"""Winter Watch rules engine. One implementation, used by the backtest and the live forecast."""
import numpy as np, pandas as pd

CONFIG = {
    "lapse_air_c_per_m": 0.0065,      # standard environmental lapse rate
    "lapse_dew_c_per_m": 0.002,       # dew point falls more slowly with height
    "clear_sky_cooling_c": 1.5,       # max road-surface cooling below air temp (clear, calm)
    "wind_damping_ms": 4.0,
    "go_surface_c": 1.0,
    "marginal_surface_c": 2.0,
    "moist_depression_c": 1.5,        # air within this of its dew point counts as damp
    "precip_mm": 0.1,
    "night_start_hour": 18,
    "night_end_hour": 8,
    "truck_speed_kmh": 35.0,          # assumed spreading speed
    "mobilise_min": 30,
}

def adjust_to_route(df, cell_elev_m, route_elev_m, c=CONFIG):
    d = route_elev_m - cell_elev_m
    out = df.copy()
    out["t_air"] = out["temperature_2m"] - c["lapse_air_c_per_m"] * d
    out["t_dew"] = np.minimum(out["dew_point_2m"] - c["lapse_dew_c_per_m"] * d, out["t_air"])
    return out

def surface_temp(df, c=CONFIG):
    cool = c["clear_sky_cooling_c"] * (1 - df["cloud_cover"] / 100.0) / (1 + df["wind_speed_10m"] / c["wind_damping_ms"])
    h = pd.to_datetime(df["time"]).dt.hour
    night = (h >= c["night_start_hour"]) | (h <= c["night_end_hour"])
    return df["t_air"] - cool.where(night, 0.0)

def night_window(df, c=CONFIG):
    t = pd.to_datetime(df["time"]); h = t.dt.hour
    m = (h >= c["night_start_hour"]) | (h <= c["night_end_hour"])
    d = df[m].copy(); d["night"] = (pd.to_datetime(d["time"]) - pd.Timedelta(hours=c["night_start_hour"])).dt.floor("D")
    return d

def assess_night(win, c=CONFIG):
    """win: hourly rows for ONE route-night with t_air,t_dew,ts,precip. Returns dict."""
    win = win.sort_values("time")
    ts = win["ts"].values
    damp = ((win["t_air"] - win["t_dew"]) <= c["moist_depression_c"]) | (win["precipitation"] >= c["precip_mm"])
    cold_go = ts <= c["go_surface_c"]
    cold_mg = ts <= c["marginal_surface_c"]
    go_hours = cold_go & damp.values
    if go_hours.any(): status = "GO"
    elif cold_go.any() or (cold_mg & damp.values).any(): status = "MARGINAL"
    else: status = "NO-GO"
    onset = None
    if status != "NO-GO":
        idx = np.where(go_hours if go_hours.any() else (cold_go if cold_go.any() else cold_mg))[0][0]
        onset = win["time"].iloc[idx]
    return {"status": status, "ts_min": float(ts.min()), "t_air_min": float(win["t_air"].min()),
            "precip_mm": float(win["precipitation"].sum()), "damp_hours": int(damp.sum()),
            "cold_hours": int(cold_go.sum()), "onset": None if onset is None else str(onset)}

def departure(onset_iso, length_km, now_iso, c=CONFIG):
    onset = pd.Timestamp(onset_iso); now = pd.Timestamp(now_iso)
    lead = pd.Timedelta(hours=length_km / c["truck_speed_kmh"], minutes=c["mobilise_min"])
    dep = (onset - lead).floor("15min")
    return max(dep, now.ceil("15min")), dep < now

def night_features(win):
    """Forecast-style aggregates for one route-night (used by the cross-check model)."""
    i = win["t_air"].values.argmin()
    return {"t_min": win["t_air"].min(), "t_mean": win["t_air"].mean(),
            "dew_dep_at_min": float(win["t_air"].values[i] - win["t_dew"].values[i]),
            "cloud_mean": win["cloud_cover"].mean(), "wind_mean": win["wind_speed_10m"].mean(),
            "precip_sum": win["precipitation"].sum(), "month": pd.Timestamp(win["time"].iloc[0]).month}
