import json, math, time, requests, collections, statistics as st
UA = {"User-Agent": "winter-watch-college-project/0.1"}
els = json.load(open("data/osm_roads_raw.json"))["elements"]

def hav(a, b):
    R = 6371.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1]); dp = p2 - p1
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))

routes = collections.defaultdict(lambda: {"ways": [], "names": collections.Counter()})
for w in els:
    r = routes[w["tags"]["ref"]]
    r["ways"].append([(p["lat"], p["lon"]) for p in w["geometry"]])
    r["highway"] = w["tags"]["highway"]
    if w["tags"].get("name"): r["names"][w["tags"]["name"]] += 1

samples = []  # (ref, lat, lon)
for ref, r in routes.items():
    r["length_km"] = sum(hav(a, b) for way in r["ways"] for a, b in zip(way, way[1:]))
    acc = 0.0
    for way in r["ways"]:
        for a, b in zip(way, way[1:]):
            acc += hav(a, b)
            if acc >= 1.0:
                samples.append((ref, b[0], b[1])); acc = 0.0
    if not any(s[0] == ref for s in samples):
        w0 = r["ways"][0]; samples.append((ref, *w0[len(w0)//2]))
print(len(samples), "elevation samples,", round(sum(r["length_km"] for r in routes.values())), "km")

elev = []
for i in range(0, len(samples), 100):
    chunk = samples[i:i+100]
    q = {"latitude": ",".join(f"{s[1]:.5f}" for s in chunk), "longitude": ",".join(f"{s[2]:.5f}" for s in chunk)}
    for attempt in range(5):
        resp = requests.get("https://api.open-meteo.com/v1/elevation", params=q, headers=UA, timeout=60)
        if resp.ok: break
        time.sleep(5 * (attempt + 1))
    resp.raise_for_status()
    elev += resp.json()["elevation"]; time.sleep(0.5)

byref = collections.defaultdict(list)
for s, e in zip(samples, elev): byref[s[0]].append(e)

feats, table = [], []
for ref, r in sorted(routes.items()):
    e = byref[ref]
    name = r["names"].most_common(1)[0][0] if r["names"] else ""
    tier = 1 if ref.startswith("N") else 2
    pts = [p for way in r["ways"] for p in way]
    clat = sum(p[0] for p in pts)/len(pts); clon = sum(p[1] for p in pts)/len(pts)
    rec = {"ref": ref, "name": name, "class": r["highway"], "current_priority": tier,
           "length_km": round(r["length_km"], 1), "elev_mean_m": round(st.mean(e)), "elev_max_m": round(max(e)),
           "elev_min_m": round(min(e)), "n_elev_samples": len(e), "centroid": [round(clat, 4), round(clon, 4)]}
    table.append(rec)
    feats.append({"type": "Feature", "properties": {"ref": ref},
                  "geometry": {"type": "MultiLineString",
                               "coordinates": [[[round(p[1], 4), round(p[0], 4)] for p in way[::3] + [way[-1]]] for way in r["ways"]]}})
json.dump(table, open("data/routes.json", "w"), indent=1)
json.dump(table, open("docs/data/routes.json", "w"))
json.dump({"type": "FeatureCollection", "features": feats}, open("docs/data/routes.geojson", "w"))
for t in table: print(t["ref"], t["name"][:28].ljust(28), t["length_km"], t["elev_mean_m"], t["elev_max_m"])
