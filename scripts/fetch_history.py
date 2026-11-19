import json, time, requests, pandas as pd
UA = {"User-Agent": "winter-watch-college-project/0.1"}
routes = json.load(open("data/routes.json"))
cells = {}
for r in routes:
    c = (round(r["centroid"][0], 1), round(r["centroid"][1], 1))
    cells.setdefault(c, []).append(r["ref"])
json.dump([{"lat": k[0], "lon": k[1], "routes": v} for k, v in cells.items()], open("data/cells.json", "w"), indent=1)
print(len(cells), "grid cells")
VARS = "temperature_2m,dew_point_2m,precipitation,cloud_cover,wind_speed_10m,soil_temperature_0_to_7cm"
WINTERS = [(y, f"{y}-10-01", f"{y+1}-03-31") for y in range(2018, 2025)]
frames = []
for (lat, lon) in cells:
    for y, s, e in WINTERS:
        for attempt in range(8):
            r = requests.get("https://archive-api.open-meteo.com/v1/archive", headers=UA, timeout=90, params=dict(
                latitude=lat, longitude=lon, start_date=s, end_date=e, hourly=VARS, timezone="UTC", wind_speed_unit="ms"))
            if r.ok: break
            time.sleep(10 * (attempt + 1))
        r.raise_for_status()
        j = r.json(); df = pd.DataFrame(j["hourly"]); df["cell_lat"] = lat; df["cell_lon"] = lon
        df["cell_elev_m"] = j["elevation"]; df["winter"] = f"{y}/{str(y+1)[2:]}"
        frames.append(df); time.sleep(1.0)
    print("done cell", lat, lon, flush=True)
out = pd.concat(frames); out.to_csv("data/history/era5_winters.csv.gz", index=False)
print(out.shape, out.time.min(), out.time.max(), out.isna().sum().to_dict())
