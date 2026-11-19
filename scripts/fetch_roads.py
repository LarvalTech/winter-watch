import requests, json, time
Q = """[out:json][timeout:180];
area["name"="County Cavan"]["boundary"="administrative"]->.a;
way(area.a)["highway"~"^(trunk|primary|secondary)$"]["ref"];
out geom tags;"""
for url in ["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter"]:
    try:
        r = requests.post(url, data={"data": Q}, timeout=200)
        r.raise_for_status()
        break
    except Exception as e:
        print("fail", url, e); time.sleep(3)
json.dump(r.json(), open("data/osm_roads_raw.json","w"))
print(len(r.json()["elements"]), "ways")
