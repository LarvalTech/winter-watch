[out:json][timeout:180];
area["name"="County Cavan"]["boundary"="administrative"]->.a;
way(area.a)["highway"~"^(trunk|primary|secondary)$"]["ref"];
out geom tags;
