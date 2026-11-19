const $ = s => document.querySelector(s);
let L, SEN, MAP, GEO, layers = {}, selected = null;
const COL = {GO: "#e5484d", MARGINAL: "#f5a524", "NO-GO": "#30a46c"};
const src = (...ids) => `<sup class="src" title="Source ${ids.join(', ')}" onclick="goSrc()">${ids.join(",")}</sup>`;
const n = (v, u = "", ...ids) => `<span class="n">${v}${u}</span>${src(...ids)}`;
window.goSrc = () => tab("method");

function tab(t) {
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  ["duty", "senior", "method"].forEach(id => $("#" + id).hidden = id !== t);
  if (t === "duty" && MAP) setTimeout(() => MAP.invalidateSize(), 50);
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => tab(b.dataset.tab));

async function load() {
  [L, SEN, GEO] = await Promise.all(["latest", "senior", "routes"].map(f => fetch(`data/${f}.json`.replace("routes.json", "routes.geojson")).then(r => r.json())));
  const age = (Date.now() - new Date(L.generated_at)) / 36e5;
  $("#stamp").innerHTML = `Forecast fetched ${new Date(L.generated_at).toLocaleString("en-IE")} ${src("S1")}<br>` +
    (age > 6 ? `<b style="color:#f5a524">⚠ Data is ${age.toFixed(0)} h old, do not rely on it</b>` : `${age.toFixed(1)} h ago`);
  duty(); senior(); method();
}

function duty() {
  const f = L.facts;
  $("#banner").className = "b-" + L.decision; $("#banner").id = "banner";
  $("#banner").innerHTML = `${L.decision === "GO" ? "GRIT TONIGHT" : L.decision === "MARGINAL" ? "MARGINAL · engineer judgement" : "NO GRITTING NEEDED"}
    <small>Night ${L.night.from.slice(5, 16)} → ${L.night.to.slice(5, 16)} · ${n(f.n_go, "", "S5")} GO · ${n(f.n_marginal, "", "S5")} marginal · ${n(f.n_review, "", "S5", "S6")} to review · recommendation only</small>`;
  const b = L.briefing;
  $("#brief").innerHTML = `<h2>Briefing <span class="tag">${b.source === "llm" ? "AI-written · numbers validated" : "template (no AI)"}</span></h2><p>${b.text}</p>
    <p class="mute" style="font-size:12px">Every number in this text is checked against the computed data before display. ${b.detail}</p>`;
  $("#plan").innerHTML = `<tr><th>Route</th><th>Class</th><th>Status</th><th>Depart</th><th>Surface min</th><th>Ice from</th><th>km</th><th>Model p</th></tr>` +
    L.routes.map(r => `<tr class="row" data-ref="${r.ref}"><td><b>${r.ref}</b> <span class="mute">${r.name}</span></td><td>P${r.priority}</td>
    <td><span class="pill p-${r.status}">${r.status}</span>${r.review ? '<span class="chip" title="Rules engine and model disagree. Cautious call shown.">REVIEW</span>' : ""}</td>
    <td>${r.depart ? n(r.depart + (r.depart_is_now ? " now" : ""), "", "S1", "S5") : "–"}</td><td>${n(r.surface_min_c, "°C", "S1", "S4", "S5")}</td>
    <td>${r.ice_onset ? n(r.ice_onset, "", "S1", "S5") : "–"}</td><td>${n(r.length_km, "", "S2")}</td><td>${n(r.model_prob, "", "S3", "S6")}</td></tr>`).join("");
  document.querySelectorAll("#plan tr.row").forEach(tr => tr.onclick = () => pick(tr.dataset.ref));
  if (!MAP) {
    MAP = L_.map("map").setView([53.98, -7.35], 9);
    L_.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {attribution: "© OpenStreetMap contributors"}).addTo(MAP);
  }
  const by = Object.fromEntries(L.routes.map(r => [r.ref, r]));
  L_.geoJSON(GEO, {style: ft => ({color: COL[by[ft.properties.ref]?.status] || "#888", weight: 4, opacity: .9}),
    onEachFeature: (ft, ly) => { layers[ft.properties.ref] = ly; ly.on("click", () => pick(ft.properties.ref)); ly.bindTooltip(ft.properties.ref); }}).addTo(MAP);
  MAP.invalidateSize(); MAP.fitBounds(L_.geoJSON(GEO).getBounds()); pick(L.routes[0].ref); decideUI();
}

function chart(r) {
  const h = r.hourly, W = 400, H = 150, P = 28, ys = h.flatMap(x => [x.surface_c, x.air_c]);
  const lo = Math.min(-1, ...ys) - 1, hi = Math.max(3, ...ys) + 1, X = i => P + i * (W - P - 6) / (h.length - 1), Y = v => H - 18 - (v - lo) / (hi - lo) * (H - 28);
  const line = k => h.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 ${W} ${H}"><line x1="${P}" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="#6ea8fe" stroke-dasharray="3"/>
  <text x="2" y="${Y(0) + 4}" fill="#6ea8fe" font-size="10">0°</text><path d="${line("air_c")}" fill="none" stroke="#93a4bd" stroke-width="1.5"/>
  <path d="${line("surface_c")}" fill="none" stroke="${COL[r.status]}" stroke-width="2.5"/>
  ${h.map((x, i) => i % 3 ? "" : `<text x="${X(i)}" y="${H - 4}" fill="#93a4bd" font-size="9" text-anchor="middle">${x.t}</text>`).join("")}</svg>`;
}
function pick(ref) {
  selected = ref; const r = L.routes.find(x => x.ref === ref);
  document.querySelectorAll("#plan tr.row").forEach(t => t.classList.toggle("sel", t.dataset.ref === ref));
  Object.entries(layers).forEach(([k, ly]) => ly.setStyle({weight: k === ref ? 8 : 4}));
  $("#detail").innerHTML = `<h2>${r.ref} ${r.name} <span class="pill p-${r.status}">${r.status}</span></h2>
  <div class="mute">Estimated road surface (colour) vs air temperature (grey) tonight ${src("S1", "S5")}</div>${chart(r)}
  <p>Rules engine: <b>${r.rules_status}</b>${src("S5")} · Model: ${n(Math.round(r.model_prob * 100), "% ice risk", "S6")} · Air min ${n(r.air_min_c, "°C", "S1")} · Precip ${n(r.precip_mm, " mm", "S1")}<br>
  Mean elevation ${n(r.elev_mean_m, " m", "S4")} · ${n(r.length_km, " km", "S2")} ${r.review ? "<br><b>Rules and model disagree. The cautious call is shown. Please review.</b>" : ""}</p>`;
}

const LOGK = "winterwatch_decisions";
function decideUI() {
  const log = JSON.parse(localStorage.getItem(LOGK) || "[]");
  $("#decide").innerHTML = `<h2>Duty Engineer decision <span class="tag">you decide</span></h2>
  <p class="mute">Tool recommends: <b>${L.decision}</b>. Record your decision. It is saved in this browser only and can be exported.</p>
  <input id="who" placeholder="Your name"><textarea id="why" rows="2" placeholder="Reason (required if you override)"></textarea>
  <select id="ov"><option value="">Override to…</option><option>GO</option><option>MARGINAL</option><option>NO-GO</option></select>
  <button class="act ok" id="acc">Accept recommendation</button><button class="act ov" id="ovr">Override</button><button class="act ex" id="exp">Export log</button>
  <div id="log" class="mute" style="margin-top:8px">${log.slice(-5).reverse().map(e => `${e.time.slice(0, 16)} · ${e.who || "?"} · ${e.action} ${e.final} ${e.reason ? "· " + e.reason : ""}`).join("<br>")}</div>`;
  const save = (action, final) => {
    if (action === "OVERRIDE" && (!final || !$("#why").value.trim())) return alert("Choose a decision and give a reason.");
    log.push({time: new Date().toISOString(), who: $("#who").value, action, final, tool: L.decision, reason: $("#why").value, forecast_fetched: L.generated_at});
    localStorage.setItem(LOGK, JSON.stringify(log)); decideUI();
  };
  $("#acc").onclick = () => save("ACCEPT", L.decision); $("#ovr").onclick = () => save("OVERRIDE", $("#ov").value);
  $("#exp").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(log, null, 1)], {type: "application/json"})); a.download = "winterwatch_decisions.json"; a.click(); };
}

function senior() {
  const rec = SEN.routes.find(r => r.ref === SEN.recommendation); const mx = Math.max(...SEN.routes.flatMap(r => Object.values(r.go_nights_by_winter)));
  const heat = v => `<span class="heat" style="background:hsl(${210 - 210 * v / mx},70%,60%)" title="${v} grit-worthy nights">${v}</span>`;
  $("#senior").innerHTML = `<div class="card rec"><h2>Recommendation for next winter</h2>${rec ? `<p style="font-size:18px"><b>Move ${rec.ref} ${rec.name} up from Priority ${rec.current_priority} to Priority 1.</b></p>
  <p>Over ${SEN.winters.length} winters (${SEN.winters[0]} to ${SEN.winters.at(-1)}) it needed gritting on ${n(rec.go_nights_mean, " nights a winter", "S3", "S4", "S5")} on average. The median Priority 1 route needed ${n(SEN.p1_median_go_nights, "", "S3", "S5")}. It beat that median in ${n(rec.winters_above_p1_median, " of " + SEN.winters.length + " winters", "S3", "S5")}. Mean elevation ${n(rec.elev_mean_m, " m", "S4")}, peak ${n(rec.elev_max_m, " m", "S4")}.</p>
  <p class="mute">Other candidates: ${SEN.candidates.filter(c => c !== rec.ref).join(", ") || "none"}. Weather need only: traffic volume, collision history and depot location are not included. The Senior Engineer decides.</p>` : "No route meets the promotion test."}</div>
  <div class="card"><h2>All routes ranked by modelled gritting need</h2><div class="scroll"><table><tr><th>#</th><th>Route</th><th>Current</th><th>Elev (m)</th><th>Avg nights</th><th>By winter (${SEN.winters.join(" ")})</th><th>Flag</th></tr>
  ${SEN.routes.map(r => `<tr><td>${r.need_rank}</td><td><b>${r.ref}</b> <span class="mute">${r.name}</span></td><td>P${r.current_priority}</td><td>${n(r.elev_mean_m, "", "S4")}</td><td>${n(r.go_nights_mean, "", "S3", "S5")}</td>
  <td>${SEN.winters.map(w => heat(r.go_nights_by_winter[w])).join("")}</td><td>${r.flag ? `<span class="chip">${r.flag.replaceAll("_", " ")}</span>` : ""}</td></tr>`).join("")}</table></div></div>`;
}

function method() {
  const m = L.sources.S6.metrics, T = L.thresholds, pc = x => (x * 100).toFixed(0) + "%";
  $("#method").innerHTML = `<div class="card"><h2>Data sources</h2><table>${Object.entries(L.sources).map(([k, s]) => `<tr><td><b>${k}</b></td><td>${s.name}${s.url ? ` · <a style="color:#6ea8fe" href="${s.url}">${s.url}</a>` : ""}<br><span class="mute">${s.what}${s.fetched_at ? " · fetched " + s.fetched_at : ""}</span></td></tr>`).join("")}</table></div>
  <div class="card"><h2>How the call is made</h2><ol>
  <li>Forecast air temperature and dew point are adjusted to each route's elevation (${T.lapse_air_c_per_m} °C/m air, ${T.lapse_dew_c_per_m} °C/m dew point).</li>
  <li>Road surface temperature is <b>estimated</b>, not measured: air temperature minus up to ${T.clear_sky_cooling_c} °C of night-time cooling on clear, calm nights.</li>
  <li><b>GO</b>: surface ≤ ${T.go_surface_c} °C while damp (rain, or air within ${T.moist_depression_c} °C of dew point). <b>MARGINAL</b>: cold but dry, or ≤ ${T.marginal_surface_c} °C and damp. Otherwise NO-GO.</li>
  <li>Departure = ice onset minus drive time (route length at ${T.truck_speed_kmh} km/h) minus ${T.mobilise_min} min mobilisation.</li>
  <li>A logistic-regression model trained on history gives an independent second opinion. If the two disagree the route is marked REVIEW and the more cautious call is shown.</li>
  <li>An AI model, when a key is configured, only turns the numbers into a short briefing. A validator rejects any text containing a number not in the data. If it fails, a fixed template is used.</li></ol></div>
  <div class="card"><h2>Cross-check model accuracy (held-out winters ${m.test_winters.join(", ")})</h2>
  <p>AUC ${n(m.model_auc.toFixed(2), "", "S6")} · model precision ${n(pc(m.model_precision), "", "S6")}, recall ${n(pc(m.model_recall), "", "S6")} · rules precision ${n(pc(m.rules_precision), "", "S5")}, recall ${n(pc(m.rules_recall), "", "S5")} · agreement ${n(pc(m.agreement_rate), "", "S5", "S6")}.<br>
  <span class="mute">Truth label is modelled ground temperature (ERA5-Land) while damp, which is not measured road ice. Trained on ${m.n_train} route-nights, tested on ${m.n_test}.</span></p></div>
  <div class="card"><h2>Limitations</h2><ul><li>Routes are built from OpenStreetMap road classes (N = Priority 1, R = Priority 2), not Cavan County Council's official list.</li>
  <li>No road-weather-station or thermal-mapping data. Surface temperature is a simple estimate.</li><li>History is reanalysis (ERA5, about 9 to 25 km grid), not station readings.</li>
  <li>Need ranking uses weather and elevation only, with no traffic, collisions or depot locations.</li><li>Decisions are logged in the browser only.</li></ul></div>`;
}
const L_ = window.L; 
load().then(() => { const h = location.hash.slice(1); if (["duty","senior","method"].includes(h)) tab(h); });
