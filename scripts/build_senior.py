import json, pandas as pd, numpy as np
N = pd.read_csv("data/backtest_nights.csv"); routes = {r["ref"]: r for r in json.load(open("data/routes.json"))}
N["go"] = N.status == "GO"; N["mg"] = N.status == "MARGINAL"
per = N.groupby(["ref", "winter"]).go.sum().unstack()
winters = list(per.columns)
rows = []
for ref, r in routes.items():
    v = per.loc[ref]
    rows.append({"ref": ref, "name": r["name"], "current_priority": r["current_priority"], "length_km": r["length_km"],
                 "elev_mean_m": r["elev_mean_m"], "elev_max_m": r["elev_max_m"],
                 "go_nights_mean": round(float(v.mean()), 1), "go_nights_by_winter": {w: int(v[w]) for w in winters},
                 "go_nights_min": int(v.min()), "go_nights_max": int(v.max())})
df = pd.DataFrame(rows).sort_values("go_nights_mean", ascending=False).reset_index(drop=True)
df["need_rank"] = df.index + 1
t1_floor = df[df.current_priority == 1].go_nights_mean.min()
t1_median = df[df.current_priority == 1].go_nights_mean.median()
# a lower-tier route is a promotion candidate if it needs gritting more often than the median Priority-1 route,
# and does so consistently (more than the P1 median in at least 5 of 7 winters)
p1_by_w = {w: per[w][[k for k, r in routes.items() if r["current_priority"] == 1]].median() for w in winters}
def consistent(ref): return sum(per.loc[ref, w] > p1_by_w[w] for w in winters)
df["winters_above_p1_median"] = df.ref.map(consistent)
df["flag"] = ""
df.loc[(df.current_priority == 2) & (df.go_nights_mean > t1_median) & (df.winters_above_p1_median >= 5), "flag"] = "PROMOTE_CANDIDATE"
df.loc[(df.current_priority == 1) & (df.go_nights_mean < df[df.current_priority == 2].go_nights_mean.median()), "flag"] = "REVIEW_WEATHER_NEED_LOW"
cand = df[df.flag == "PROMOTE_CANDIDATE"].sort_values(["winters_above_p1_median", "go_nights_mean"], ascending=False)
p1_km = float(df[df.current_priority == 1].length_km.sum()); total_km = float(df.length_km.sum())
rec_row = None if cand.empty else cand.iloc[0]
out = {"p1_km": round(p1_km), "network_km": round(total_km),
       "rec_km": None if rec_row is None else float(rec_row["length_km"]),
       "p1_km_after": None if rec_row is None else round(p1_km + float(rec_row["length_km"])),
       "winters": winters, "p1_median_go_nights": round(float(t1_median), 1), "routes": df.to_dict("records"),
       "recommendation": None if cand.empty else cand.iloc[0]["ref"], "candidates": cand.ref.tolist()}
json.dump(out, open("docs/data/senior.json", "w"), indent=1)
print(df[["ref", "current_priority", "elev_mean_m", "go_nights_mean", "winters_above_p1_median", "flag"]].head(14).to_string())
print("recommend:", out["recommendation"], out["candidates"])
