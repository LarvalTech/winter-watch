"""Assign roads to trucks as chained runs. Each truck treats roads in deadline order, drives between them,
and every road must be finished before its forecast ice onset."""
import math
import pandas as pd

YARD = (53.9908, -7.3606)   # assumed: Cavan town, near the Moynehall brine station (S7). Exact yard location not published.
PARAMS = {"treat_kmh": 20.0,      # effective treatment rate incl. turning and salt reloads
          "deadhead_kmh": 60.0, "road_factor": 1.3,   # driving between roads; straight line x 1.3
          "mobilise_min": 30, "max_run_min": 360,     # council quotes a 4 to 6 hour salting window (S9)
          "yard": YARD}

def _hav(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0]); dl = math.radians(b[1] - a[1]); dp = p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))

def evaluate(chain, now, P=PARAMS):
    chain = sorted(chain, key=lambda r: r["deadline"])
    t, pos, segs = 0.0, P["yard"], []
    for r in chain:
        dh = _hav(pos, r["c"]) * P["road_factor"] / P["deadhead_kmh"] * 60
        t += dh; s = t; t += r["km"] / P["treat_kmh"] * 60; segs.append((r, dh, s, t)); pos = r["c"]
    earliest = (now + pd.Timedelta(minutes=P["mobilise_min"])).ceil("15min")
    latest = min(r["deadline"] - pd.Timedelta(minutes=e) for r, _, _, e in segs)
    depart = max(latest.floor("15min"), earliest)
    stops = []
    for r, dh, s, e in segs:
        st = depart + pd.Timedelta(minutes=s); en = depart + pd.Timedelta(minutes=e)
        stops.append({**r, "deadhead_min": round(dh), "start": st, "end": en,
                      "slack_min": int((r["deadline"] - en).total_seconds() // 60)})
    return {"depart": depart, "leave_now": depart == earliest and latest.floor("15min") <= earliest, "total_min": t,
            "stops": stops, "late": [x for x in stops if x["slack_min"] < 0],
            "feasible": all(x["slack_min"] >= 0 for x in stops) and t + P["mobilise_min"] <= P["max_run_min"]}

def schedule(routes, now, n_trucks, P=PARAMS):
    """routes: dicts with ref, name, km, c (lat, lon), deadline (Timestamp), priority, status."""
    chains = []
    for r in sorted(routes, key=lambda r: (r["priority"], r["deadline"])):
        best = None
        for i, ch in enumerate(chains):
            ev = evaluate(ch + [r], now, P)
            if ev["feasible"]:
                cost = ev["total_min"] - evaluate(ch, now, P)["total_min"]
                if best is None or cost < best[0]: best = (cost, i)
        if best is not None: chains[best[1]].append(r); continue
        if len(chains) < n_trucks: chains.append([r]); continue
        i = min(range(len(chains)), key=lambda i: sum(-x["slack_min"] for x in evaluate(chains[i] + [r], now, P)["late"]))
        chains[i].append(r)
    trucks = []
    for ch in chains:
        ev = evaluate(ch, now, P)
        trucks.append(ev)
    trucks.sort(key=lambda t: t["depart"])
    return trucks
