# ❄ Winter Watch · County Cavan

Decision-support page for the roads team. Duty Engineer: grit tonight? which routes, when do trucks leave. Senior Engineer: which route should move up a priority next winter. **Advisory only; a person decides.**

Live page: `https://<your-username>.github.io/winter-watch/`

## How it works
- `scripts/fetch_roads.py`, `build_routes.py`: OSM roads (N and R routes) with elevation (Open-Meteo / Copernicus DEM)
- `scripts/fetch_history.py`: 7 winters (Oct 2018 to Mar 2025) of ERA5 hourly weather for 22 grid cells
- `ww/engine.py`: rules engine (lapse rate, surface temp estimate, GO / MARGINAL / NO-GO, departure time)
- `scripts/backtest_and_train.py`: backtest and cross-check logistic regression model (held-out winters)
- `scripts/build_senior.py`: route promotion analysis
- `ww/scheduler.py`: assigns roads to trucks as chained runs, each finished before forecast ice
- `scripts/apply_official_list.py`: applies Cavan County Council's designated Priority 1 and 2 routes
- `scripts/run_forecast.py`: live forecast, decision, briefing, writes `docs/data/latest.json`
- `.github/workflows/forecast.yml`: runs daily in the afternoon. The AI key lives only in GitHub Secrets and is read only by this job. The browser only ever sees the finished JSON.

## AI key (optional)
Repo → Settings → Secrets and variables → Actions: add secret `LLM_API_KEY`; optional variables `LLM_PROVIDER` (`gemini`, `anthropic` or `openai`) and `LLM_MODEL`. Without a key a fixed template briefing is used. AI text containing any number not in the data is rejected and replaced by the template.

## Limitations
See the "Sources & method" tab.
