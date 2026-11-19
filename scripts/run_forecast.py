import json, datetime as dt, numpy as np, pandas as pd, requests, zoneinfo
from ww.engine import *
from ww.scheduler import schedule, PARAMS as SCHED
from ww.briefing import template_briefing, llm_briefing
UA = {"User-Agent": "winter-watch-college-project/0.1"}
routes = json.load(open("data/routes.json")); cells = json.load(open("data/cells.json")); model = json.load(open("data/model.json"))
now = dt.datetime.now(zoneinfo.ZoneInfo("Europe/Dublin")).replace(tzinfo=None, microsecond=0)
fetched_iso = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
night_day = now.date() if now.hour >= 9 else now.date() - dt.timedelta(days=1)
n0 = pd.Timestamp(night_day) + pd.Timedelta(hours=CONFIG["night_start_hour"])
n1 = n0 + pd.Timedelta(hours=CONFIG["night_end_hour"] + 24 - CONFIG["night_start_hour"])

VARS = "temperature_2m,dew_point_2m,precipitation,cloud_cover,wind_speed_10m"
URL = "https://api.open-meteo.com/v1/forecast"
resp = requests.get(URL, headers=UA, timeout=60, params=dict(
    latitude=",".join(str(c["lat"]) for c in cells), longitude=",".join(str(c["lon"]) for c in cells),
    hourly=VARS, timezone="Europe/Dublin", forecast_days=3, past_days=1, wind_speed_unit="ms"))
resp.raise_for_status(); J = resp.json(); J = J if isinstance(J, list) else [J]
cellfc = {}
for c, j in zip(cells, J):
    d = pd.DataFrame(j["hourly"]); d["time"] = pd.to_datetime(d["time"]); d["cell_elev_m"] = j["elevation"]
    cellfc[tuple(c["routes"])] = d
ref2df = {ref: d for k, d in cellfc.items() for ref in k}

def predict(feat):
    x = (np.array([feat[k] for k in model["features"]]) - model["mean"]) / model["scale"]
    return float(1 / (1 + np.exp(-(x @ np.array(model["coef"]) + model["intercept"]))))

out_routes = []; onset_dt = {}
for r in routes:
    g = ref2df[r["ref"]]; a = adjust_to_route(g, g["cell_elev_m"].iloc[0], r["elev_mean_m"]); a["ts"] = surface_temp(a)
    w = a[(a.time >= n0) & (a.time <= n1)]
    if len(w) < 14: continue
    res = assess_night(w); p = predict(night_features(w))
    model_risky = p >= model["threshold"]; rules_go = res["status"] == "GO"
    review = model_risky != rules_go
    final = "GO" if (rules_go or (model_risky and res["status"] != "NO-GO")) else res["status"]
    if review and model_risky and res["status"] == "NO-GO": final = "MARGINAL"   # cautious side
    onset_dt[r["ref"]] = (pd.Timestamp(res["onset"]) if res["onset"] and final != "NO-GO" else None, r["centroid"])
    out_routes.append({"ref": r["ref"], "name": r["name"], "priority": r["current_priority"], "designated": r["designated"], "length_km": r["length_km"],
        "elev_mean_m": r["elev_mean_m"], "status": final, "rules_status": res["status"], "model_prob": round(p, 2),
        "review": bool(review), "surface_min_c": round(res["ts_min"], 1), "air_min_c": round(res["t_air_min"], 1),
        "precip_mm": round(res["precip_mm"], 1), "ice_onset": res["onset"][11:16] if res["onset"] else None,
        "depart": None, "depart_is_now": False, "truck": None, "treat_end": None, "slack_min": None,
        "hourly": [{"t": str(t)[11:16], "surface_c": round(float(s), 1), "air_c": round(float(x), 1)} for t, s, x in zip(w["time"], w["ts"], w["t_air"])]})

order = {"GO": 0, "MARGINAL": 1, "NO-GO": 2}
out_routes.sort(key=lambda x: (order[x["status"]], x["priority"], x["ref"]))
plan = [x for x in out_routes if x["designated"]]
go = [x for x in plan if x["status"] == "GO"]; mg = [x for x in plan if x["status"] == "MARGINAL"]
decision = "GO" if go else ("MARGINAL" if mg else "NO-GO")
fleet = json.load(open("data/fleet.json"))
jobs = [{"ref": x["ref"], "name": x["name"], "km": x["length_km"], "c": onset_dt[x["ref"]][1], "deadline": onset_dt[x["ref"]][0] - pd.Timedelta(minutes=15), "onset": onset_dt[x["ref"]][0],
         "priority": x["priority"], "status": x["status"]} for x in plan if x["status"] != "NO-GO" and onset_dt[x["ref"]][0] is not None]
trucks = schedule(jobs, pd.Timestamp(now), fleet["trucks"]) if jobs else []
byref = {x["ref"]: x for x in out_routes}
truck_out = []
for i, t in enumerate(trucks, 1):
    stops = []
    for k, st in enumerate(t["stops"]):
        x = byref[st["ref"]]; x["depart"] = st["start"].strftime("%H:%M"); x["truck"] = i; x["treat_end"] = st["end"].strftime("%H:%M"); x["slack_min"] = st["slack_min"] + 15
        x["depart_is_now"] = bool(t["leave_now"] and k == 0)
        stops.append({"ref": st["ref"], "name": st["name"], "priority": st["priority"], "status": st["status"], "km": st["km"],
                      "start": x["depart"], "end": x["treat_end"], "ice_onset": st["onset"].strftime("%H:%M"), "slack_min": st["slack_min"] + 15,
                      "drive_min": st["deadhead_min"], "late": st["slack_min"] < 0})
    truck_out.append({"truck": i, "leaves_yard": t["depart"].strftime("%H:%M"), "leave_now": bool(t["leave_now"]), "finish": t["stops"][-1]["end"].strftime("%H:%M"),
                      "km": round(sum(s["km"] for s in stops), 1), "run_min": round(t["total_min"] + SCHED["mobilise_min"]), "stops": stops})
late_routes = [s["ref"] for t in truck_out for s in t["stops"] if s["late"]]
fl = {"trucks_available": fleet["trucks"], "trucks_used": len(truck_out), "late_routes": late_routes, "over_capacity": bool(late_routes),
      "longest_run_min": max([t["run_min"] for t in truck_out], default=0), "total_km": round(sum(t["km"] for t in truck_out)),
      "edition": fleet["edition"], "assumptions": {"safety_margin_min": 15, "treat_kmh": SCHED["treat_kmh"], "deadhead_kmh": SCHED["deadhead_kmh"], "road_factor": SCHED["road_factor"],
      "mobilise_min": SCHED["mobilise_min"], "max_run_min": SCHED["max_run_min"], "yard": "Cavan town (assumed)"}}
first_t = truck_out[0] if truck_out else None
cold = min(plan, key=lambda x: x["surface_min_c"])
facts = {"decision": decision, "n_routes": len(plan), "n_go": len(go), "n_marginal": len(mg),
         "n_review": sum(x["review"] for x in plan), "trucks_used": fl["trucks_used"], "trucks_available": fleet["trucks"], "n_late": len(late_routes), "first_departure": first_t["leaves_yard"] if first_t else None,
         "first_route": first_t["stops"][0]["ref"] if first_t else None, "coldest_route": cold["ref"], "coldest_ts": cold["surface_min_c"]}
agree = sum(not x["review"] for x in plan); share = agree / len(plan)
conf = {"level": "HIGH" if share >= 0.75 else "MEDIUM" if share >= 0.5 else "LOW", "agree": agree, "total": len(plan), "percent": round(share * 100)}
facts["confidence"] = conf["level"]
text, info = llm_briefing(facts)
source = "llm"
if text is None: text, source = template_briefing(facts), "template"
senior = json.load(open("docs/data/senior.json"))
latest = {"generated_at": fetched_iso, "decision_time_local": now.isoformat(), "night": {"from": str(n0), "to": str(n1)},
  "decision": decision, "confidence": conf, "fleet": fl, "trucks": truck_out, "facts": facts, "briefing": {"text": text, "source": source, "detail": info if source == "llm" else f"template fallback ({info})"},
  "routes": out_routes, "senior_recommendation": senior["recommendation"], "thresholds": CONFIG,
  "sources": {
    "S1": {"name": "Open-Meteo forecast API", "url": URL, "fetched_at": fetched_iso, "what": "hourly air temp, dew point, precipitation, cloud, wind at 22 grid cells"},
    "S2": {"name": "OpenStreetMap (Overpass), filtered to the council's designated routes", "url": "https://overpass-api.de", "what": "trunk/primary/secondary roads in County Cavan with ref tags; routes built by grouping on ref. Priority 1 and 2 follow S7. N16 is excluded (salted by Leitrim County Council). Six R roads are not on the council plan (R179, R181, R195, R196, R394, R901) and are kept for analysis only."},
    "S3": {"name": "ERA5 / ERA5-Land via Open-Meteo archive", "url": "https://open-meteo.com/en/docs/historical-weather-api", "what": "7 winters Oct 2018 - Mar 2025, used for backtest and model training"},
    "S4": {"name": "Copernicus DEM via Open-Meteo elevation API", "url": "https://open-meteo.com/en/docs/elevation-api", "what": "route elevation sampled about every 1 km"},
    "S5": {"name": "Winter Watch rules engine", "what": "lapse-rate adjustment, road surface estimate, GO/MARGINAL/NO-GO thresholds (see thresholds), and the truck scheduler (ww/scheduler.py) that chains roads into runs for the 9-truck fleet"},
"S6": {"name": "Winter Watch cross-check model", "what": "logistic regression trained on S3", "metrics": model["metrics"]},
    "S7": {"name": "Cavan County Council Winter Service Plan 2023/2024 (October 2023)", "url": fleet["url"], "what": "PRIMARY DOCUMENT. Table 1: designated Priority 1 and 2 routes and levels of service. A7: Duty Engineer decision-making, Met Eireann forecasts, Vaisala Manager, two road weather stations on the N3 (Virginia, Butlersbridge), forecasting accurate to about 85% at best. A8: resources, one Machinery Yard with 9 trucks and 11 spreaders, 7 mini salters in the three Municipal Districts, 2,750 t salt storage (about 30 runs). A9: call-outs per winter 2007/08 to 2022/23, used to validate the backtest.", "policy": "Priority 1 treated during all weather events. Priority 2 treated in normal winter service but may be interrupted in severe weather. Priority 1 treated to the exclusion of all others when resources are limited. Priority 3 only intermittent at Municipal District Engineers' discretion."},
    "S8": {"name": "Cavan County Council: Current Salting Routes and Winter Service Plan pages", "url": "https://www.cavancoco.ie/services/roads-transportation/severe-weather/current-salting-routes/", "what": "Public statements: Priority 1 is N3, N54, N55, N87; about 90 tonnes of salt covers about 500 km a night; Ice Cast alerts; salt does not guarantee safe speeds and frost after rain can undo treatment."},
    "S9": {"name": "Press reports of council statements", "url": "https://www.anglocelt.ie/2026/02/01/it-is-not-physically-possible-to-salt-all-routes-council/", "what": "Anglo Celt 01/02/2026 (645 km salted per night, 4 to 6 hour salting window, 'not physically possible to salt all routes'); Northern Sound 25/01/2022 (about 20% of network salted, no capacity to extend); Anglo Celt 12/12/2024 (councillor requests to extend routes, rain undoing salting)."},
    "S10": {"name": "Other councils' Winter Service Plans, used for comparison only", "url": "https://monaghan.ie/roadtransport/wp-content/uploads/sites/15/2025/10/WinterServicePlan-website2025-2026.pdf", "what": "Monaghan 2025/26 (8 gritters, about 610 km, treatment time 2 to 5 hours), Mayo 2025/26 (Met Eireann about 80% forecast accuracy, 10% of regional roads and 95% of local roads not salted), Galway 2025/26 and Louth. Not used in any calculation."}}}
json.dump(latest, open("docs/data/latest.json", "w"), indent=1)
print(decision, facts, "\n", text)
