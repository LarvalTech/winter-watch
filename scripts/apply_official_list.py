"""Apply Cavan County Council's designated priority routes (Winter Service Plan 2023/24, Table 1)."""
import json
P1 = {"N3", "N54", "N55", "N87"}
P2 = set("R188 R198 R154 R199 R203 R194 R191 R178 R935 R192 R162 R190 R201 R202 R205 R165 R164 R197 R200 R207 R206 R212".split())
EXCLUDED = {"N16"}   # on the plan as Priority 1 but salted by Leitrim County Council
for p in ["data/routes.json", "docs/data/routes.json"]:
    d = [r for r in json.load(open(p)) if r["ref"] not in EXCLUDED]
    for r in d:
        r["current_priority"] = 1 if r["ref"] in P1 else 2 if r["ref"] in P2 else 3
        r["designated"] = r["ref"] in P1 | P2
    json.dump(d, open(p, "w"), indent=1 if p.startswith("data") else None)
g = json.load(open("docs/data/routes.geojson"))
g["features"] = [f for f in g["features"] if f["properties"]["ref"] not in EXCLUDED]
json.dump(g, open("docs/data/routes.geojson", "w"))
print(len(d), "routes;", sum(r["designated"] for r in d), "designated;", [r["ref"] for r in d if not r["designated"]])
