import json, numpy as np, pandas as pd
from ww.engine import *
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import precision_score, recall_score, roc_auc_score

H = pd.read_csv("data/history/era5_winters.csv.gz")
routes = json.load(open("data/routes.json")); cells = json.load(open("data/cells.json"))
ref2cell = {r: (c["lat"], c["lon"]) for c in cells for r in c["routes"]}
H = H.sort_values(["cell_lat", "cell_lon", "time"])
by_cell = {k: g for k, g in H.groupby(["cell_lat", "cell_lon"])}

rows, feats = [], []
for r in routes:
    g = by_cell[ref2cell[r["ref"]]]
    a = adjust_to_route(g, g["cell_elev_m"].iloc[0], r["elev_mean_m"])
    a["ts"] = surface_temp(a)
    w = night_window(a)
    for (night, winter), n in w.groupby(["night", "winter"]):
        if len(n) < 15: continue
        res = assess_night(n); res.update(ref=r["ref"], night=str(night.date()), winter=winter)
        rows.append(res)
        f = night_features(n); f.update(ref=r["ref"], night=str(night.date()), winter=winter)
        damp = ((n["t_air"] - n["t_dew"]) <= CONFIG["moist_depression_c"]) | (n["precipitation"] >= 0.1)
        # independent label: modelled 0-7cm ground temperature <=1C while damp (not used by the rules)
        f["y"] = int(((n["soil_temperature_0_to_7cm"] - (CONFIG["lapse_air_c_per_m"]*(r["elev_mean_m"]-n["cell_elev_m"])) <= 1.0) & damp).any())
        feats.append(f)
N = pd.DataFrame(rows); F = pd.DataFrame(feats)
N.to_csv("data/backtest_nights.csv", index=False)

# ---- model: chronological split, last 2 winters held out
X = ["t_min", "t_mean", "dew_dep_at_min", "cloud_mean", "wind_mean", "precip_sum"]
test_w = ["2023/24", "2024/25"]
tr, te = F[~F.winter.isin(test_w)], F[F.winter.isin(test_w)]
sc = StandardScaler().fit(tr[X]); lr = LogisticRegression(C=1.0, max_iter=1000, class_weight="balanced").fit(sc.transform(tr[X]), tr.y)
p = lr.predict_proba(sc.transform(te[X]))[:, 1]; thr = 0.5
Nte = N[N.winter.isin(test_w)].merge(te[["ref", "night", "y"]], on=["ref", "night"])
rules_go = (Nte.status == "GO").astype(int)
metrics = {"train_winters": sorted(tr.winter.unique().tolist()), "test_winters": test_w,
    "n_train": int(len(tr)), "n_test": int(len(te)), "base_rate_test": float(te.y.mean()),
    "model_auc": float(roc_auc_score(te.y, p)),
    "model_precision": float(precision_score(te.y, p >= thr)), "model_recall": float(recall_score(te.y, p >= thr)),
    "rules_precision": float(precision_score(Nte.y, rules_go)), "rules_recall": float(recall_score(Nte.y, rules_go)),
    "agreement_rate": float(((p >= thr) == (te.merge(Nte[['ref','night','status']], on=['ref','night']).status == 'GO').values).mean())}
print(json.dumps(metrics, indent=1))
sc2 = StandardScaler().fit(F[X]); lr2 = LogisticRegression(C=1.0, max_iter=1000, class_weight="balanced").fit(sc2.transform(F[X]), F.y)
json.dump({"features": X, "mean": sc2.mean_.tolist(), "scale": sc2.scale_.tolist(), "coef": lr2.coef_[0].tolist(),
           "intercept": float(lr2.intercept_[0]), "threshold": thr, "metrics": metrics}, open("data/model.json", "w"), indent=1)
print(dict(zip(X, np.round(lr2.coef_[0], 2))))

# ---- Senior Engineer: nights per winter per route
S = N.assign(go=(N.status == "GO"), mg=(N.status == "MARGINAL")).groupby(["ref", "winter"]).agg(go=("go", "sum"), mg=("mg", "sum")).reset_index()
print(S.groupby("winter").go.mean().round(1).to_dict())
