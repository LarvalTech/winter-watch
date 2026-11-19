import json, pandas as pd, numpy as np
N = pd.read_csv("data/backtest_nights.csv"); routes = json.load(open("data/routes.json"))
des = {r["ref"] for r in routes if r["designated"]}
D = N[N.ref.isin(des)].copy(); D["go"] = D.status == "GO"
per_night = D.groupby(["winter", "night"]).agg(n_go=("go", "sum"), coldest=("ts_min", "min")).reset_index()
per_night["month"] = pd.to_datetime(per_night.night).dt.month
winters = {}
for w, g in per_night.groupby("winter"):
    c = g.loc[g.coldest.idxmin()]
    winters[w] = {"nights_any_go": int((g.n_go > 0).sum()), "nights_10plus_routes": int((g.n_go >= 10).sum()),
                  "nights_20plus_routes": int((g.n_go >= 20).sum()), "avg_routes_go_on_go_nights": round(float(g[g.n_go > 0].n_go.mean()), 1),
                  "coldest_night": c.night, "coldest_surface_c": round(float(c.coldest), 1), "nights_total": int(len(g))}
month_names = {10: "Oct", 11: "Nov", 12: "Dec", 1: "Jan", 2: "Feb", 3: "Mar"}
by_month = {month_names[m]: int(((per_night.month == m) & (per_night.n_go > 0)).sum()) for m in [10, 11, 12, 1, 2, 3]}
k_table = {str(k): int((per_night.n_go >= k).sum()) for k in range(1, len(des) + 1)}
coldest = per_night.sort_values("coldest").head(8)[["night", "winter", "coldest", "n_go"]]
out = {"source": "S3 + S5 backtest of the rules engine on ERA5 weather, designated routes only (not observed road conditions)",
       "winters_covered": sorted(winters), "nights_total": int(len(per_night)), "designated_routes": len(des),
       "per_winter": winters, "any_go_nights_by_month_all_winters": by_month,
       "nights_with_at_least_k_routes_GO": k_table,
       "coldest_nights": [{"night": r.night, "winter": r.winter, "coldest_surface_c": round(float(r.coldest), 1), "routes_go": int(r.n_go)} for r in coldest.itertuples()],
       "note": "Seasons here run Oct to Mar. Council call-outs (S7) run Oct to Apr and are not the same measure."}
json.dump(out, open("docs/data/history.json", "w"), indent=1)
print(json.dumps({k: out[k] for k in ["per_winter", "any_go_nights_by_month_all_winters"]}, indent=0)[:900]); print(k_table)
