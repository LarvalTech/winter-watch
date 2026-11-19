const $ = s => document.querySelector(s);
let L, SEN, MAP, GEO, layers = {}, selected = null;
const COL = {GO: "#e5484d", MARGINAL: "#f5a524", "NO-GO": "#30a46c"};
const src = (...ids) => `<sup class="src" title="Source ${ids.join(', ')}" onclick="goSrc()">${ids.join(",")}</sup>`;
const n = (v, u = "", ...ids) => `<span class="n">${v}${u}</span>${src(...ids)}`;
const D2 = v => String(v).padStart(2, "0");
const fmtLocal = t => { const m = String(t).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : t; };
const fmtUTC = t => { const d = new Date(t); return d.toLocaleString("en-GB", {timeZone: "Europe/Dublin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false}).replace(",", ""); };
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
  $("#stamp").innerHTML = `Forecast fetched ${fmtUTC(L.generated_at)} ${src("S1")}<br>` +
    (age > 6 ? `<b style="color:#f5a524">⚠ Data is ${age.toFixed(0)} h old, do not rely on it</b>` : `${age.toFixed(1)} h ago`);
  duty(); senior(); method();
}

function duty() {
  const f = L.facts;
  const PL = L.routes.filter(r => r.designated);
  const go = PL.filter(r => r.status === "GO"), mg = PL.filter(r => r.status === "MARGINAL");
  const T = L.trucks || [], first = T[0];
  const verdict = {GO: ["❄", "GRIT TONIGHT", first ? `First truck leaves the yard at <b>${first.leaves_yard}</b>. ${go.length} routes need gritting, using <b>${L.fleet.trucks_used} of ${L.fleet.trucks_available}</b> trucks.` : `${go.length} routes need gritting.`],
    MARGINAL: ["⚠", "BORDERLINE · YOUR CALL", `No route is clearly icy, but ${mg.length} are borderline. Check the routes below and decide.`],
    "NO-GO": ["✓", "NO GRITTING NEEDED", "No route is forecast to reach icy conditions tonight."]}[L.decision];
  $("#banner").className = "b-" + L.decision;
  const C = L.confidence;
  if (L.decision === "GO" && C.level === "LOW") verdict[1] = 'GRIT TONIGHT <span class="cautious">(cautious call)</span>';
  const dots = {HIGH: 3, MEDIUM: 2, LOW: 1}[C.level];
  $("#banner").innerHTML = `<span class="bigicon">${verdict[0]}</span><div><div class="verdict">${verdict[1]}</div><div class="action">${verdict[2]}</div>
    <div class="conf" title="Share of routes where the rules engine and the trained model agree: ${C.agree} of ${C.total}">Confidence <span class="dots">${"●".repeat(dots)}<span class="off">${"●".repeat(3 - dots)}</span></span> <b>${C.level}</b>
    <span class="why">· rules and model agree on ${C.agree} of ${C.total} routes${C.level === "LOW" ? ", so check the flagged routes" : ""}</span></div></div>`;
  const cold = PL.reduce((m, r) => r.surface_min_c < m.surface_min_c ? r : m);
  const tile = (big, label, sub, cls = "") => `<div class="tile ${cls}"><div class="big">${big}</div><div class="lab">${label}</div><div class="sub">${sub}</div></div>`;
  $("#tiles").innerHTML =
    tile(`${n(go.length, "", "S5")}<span class="of"> / ${PL.length}</span>`, "routes to grit", `${n(mg.length, "", "S5")} borderline`, go.length ? "t-GO" : "t-NO-GO") +
    tile(first ? n(first.leaves_yard, "", "S1", "S5") : "–", "first truck leaves", first ? `Truck 1 starts on ${first.stops[0].ref}` : "no departures needed") +
    tile(n(cold.surface_min_c, "°C", "S1", "S4", "S5"), "coldest road surface", `${cold.ref} ${cold.name}`) +
    tile(n(L.facts.n_review, "", "S5", "S6"), "routes to review", L.facts.n_review ? "rules and model disagree" : "rules and model agree", L.facts.n_review ? "t-MARGINAL" : "");
  const F = L.fleet, mins = t => { const [h, m] = t.split(":").map(Number); return (h < 12 ? h + 24 : h) * 60 + m; };
  const hm = m => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`, A = F.assumptions;
  const fleetNote = `<div class="fleet ${F.over_capacity ? "over" : ""}"><b>${F.over_capacity ? "⚠ Not every road can be finished before ice, even with all trucks: " + F.late_routes.join(", ") + "." : "✓ Fits the fleet."}</b>
    Uses ${n(F.trucks_used, " of " + F.trucks_available + " trucks", "S5", "S7")}. Each truck does a chained run of several roads, longest ${n(hm(F.longest_run_min), "", "S5")}. The council quotes 4 to 6 hours for a run ${src("S9")}. Roads are treated just before ice is forecast, with a ${A.safety_margin_min} minute margin. ${F.over_capacity ? "Priority 1 roads were scheduled first." : ""}</div>`;
  if (!T.length) { $("#timeline").innerHTML = ""; }
  else {
    const lo = Math.min(...T.map(t => mins(t.leaves_yard))) - 15, hi = Math.max(...T.map(t => mins(t.finish))) + 15, span = hi - lo, pos = m => ((m - lo) / span * 100).toFixed(2) + "%";
    const ticks = []; for (let m = Math.ceil(lo / 60) * 60; m <= hi; m += 60) ticks.push(m);
    const lane = t => {
      let prev = mins(t.leaves_yard), seg = "";
      t.stops.forEach(s => {
        const st = mins(s.start), en = mins(s.end);
        if (st > prev) seg += `<span class="drive" style="left:${pos(prev)};width:${((st - prev) / span * 100).toFixed(2)}%" title="Driving ${s.drive_min} min"></span>`;
        seg += `<button class="seg c-${s.status}${s.late ? " late" : ""}" style="left:${pos(st)};width:${Math.max((en - st) / span * 100, 2.2).toFixed(2)}%" onclick="pick('${s.ref}')" title="${s.ref} ${s.name}: ${s.start} to ${s.end}, ice from ${s.ice_onset} (${s.slack_min} min to spare)">${s.ref}</button><span class="ice" style="left:${pos(mins(s.ice_onset))}" title="${s.ref} ice from ${s.ice_onset}">▾</span>`;
        prev = en;
      });
      return `<div class="lane"><div class="lhead"><b>Truck ${t.truck}</b><span class="mute"> leaves ${t.leaves_yard}${t.leave_now ? " (now)" : ""}</span></div><div class="track">${ticks.map(m => `<i class="tick" style="left:${pos(m)}"></i>`).join("")}${seg}</div></div>`;
    };
    const rows = t => `<tr><td><b>Truck ${t.truck}</b></td><td>${n(t.leaves_yard, "", "S5")}</td><td>${n(t.finish, "", "S5")}</td><td>${n(hm(t.run_min), "", "S5")}</td><td>${n(t.km, " km", "S2")}</td>
      <td>${t.stops.map(s => `<button class="rchip c-${s.status}" onclick="pick('${s.ref}')" title="${s.name}">${s.ref}${s.priority === 1 ? " ★" : ""}</button><span class="mute" style="font-size:12px">${s.start} to ${s.end}${s.drive_min >= 5 ? ", " + s.drive_min + " min drive" : ""}, ${s.slack_min} min spare</span>`).join(" → ")}</td></tr>`;
    $("#timeline").innerHTML = fleetNote + `<h2>Truck plan tonight <span class="mute" style="font-weight:400">· ${fmtLocal(L.night.from)} to ${fmtLocal(L.night.to)} · click a road for detail</span></h2>
      <div class="axis"><div class="lhead"></div><div class="track">${ticks.map(m => `<span class="tl" style="left:${pos(m)}">${String(Math.floor(m / 60) % 24).padStart(2, "0")}:00</span>`).join("")}</div></div>
      ${T.map(lane).join("")}
      <div class="mute" style="font-size:12px;margin:6px 0 10px">Coloured blocks = roads being treated (red GO, amber borderline) · grey = driving between roads · ▾ = when ice is forecast on that road · each truck starts at the yard (assumed Cavan town, exact location not published)</div>
      <div class="scroll"><table class="lim"><tr><th>Truck</th><th>Leaves yard</th><th>Finishes</th><th>Run</th><th>Treats</th><th>Roads in order ★ = Priority 1</th></tr>${T.map(rows).join("")}</table></div>`;
  }
  const b = L.briefing;
  $("#brief").innerHTML = `<h2>Written summary <span class="tag">${b.source === "llm" ? "AI-written · numbers validated" : "template (no AI)"}</span></h2><p class="mute">${b.text}</p>
    <p class="mute" style="font-size:12px">Every number in this text is checked against the computed data before display. ${b.detail}</p>`;
  $("#plan").innerHTML = `<tr><th>Route</th><th>Class</th><th>Status</th><th>Truck · starts</th><th>Surface min</th><th>Ice from</th><th>km</th><th>Model p</th></tr>` +
    PL.map(r => `<tr class="row" data-ref="${r.ref}"><td><b>${r.ref}</b> <span class="mute">${r.name}</span></td><td>P${r.priority}</td>
    <td><span class="pill p-${r.status}">${r.status}</span>${r.review ? '<span class="chip" title="Rules engine and model disagree. Cautious call shown.">REVIEW</span>' : ""}</td>
    <td>${r.depart ? "T" + r.truck + " · " + n(r.depart, "", "S1", "S5") : "–"}</td><td>${n(r.surface_min_c, "°C", "S1", "S4", "S5")}</td>
    <td>${r.ice_onset ? n(r.ice_onset, "", "S1", "S5") : "–"}</td><td>${n(r.length_km, "", "S2")}</td><td>${n(r.model_prob, "", "S3", "S6")}</td></tr>`).join("");
  document.querySelectorAll("#plan tr.row").forEach(tr => tr.onclick = () => pick(tr.dataset.ref));
  if (!MAP) {
    MAP = L_.map("map").setView([53.98, -7.35], 9);
    L_.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {attribution: "© OpenStreetMap contributors"}).addTo(MAP);
  }
  const by = Object.fromEntries(L.routes.map(r => [r.ref, r]));
  L_.geoJSON(GEO, {style: ft => ({color: by[ft.properties.ref]?.designated ? COL[by[ft.properties.ref].status] : "#6b7a93", weight: by[ft.properties.ref]?.designated ? 4 : 2, opacity: by[ft.properties.ref]?.designated ? .9 : .6, dashArray: by[ft.properties.ref]?.designated ? null : "4 4"}),
    onEachFeature: (ft, ly) => { layers[ft.properties.ref] = ly; ly.on("click", () => pick(ft.properties.ref)); ly.bindTooltip(ft.properties.ref); }}).addTo(MAP);
  MAP.invalidateSize(); MAP.fitBounds(L_.geoJSON(GEO).getBounds()); pick(PL[0].ref); decideUI();
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
window.pick = pick;
function pick(ref) {
  selected = ref; const r = L.routes.find(x => x.ref === ref);
  document.querySelectorAll("#plan tr.row").forEach(t => t.classList.toggle("sel", t.dataset.ref === ref));
  Object.entries(layers).forEach(([k, ly]) => ly.setStyle({weight: k === ref ? 8 : 4}));
  const pct = Math.round(r.model_prob * 100), modelSays = r.model_prob >= 0.5 ? "icy" : "not icy";
  const kv = (label, val) => `<div class="kv"><div class="k">${label}</div><div class="v">${val}</div></div>`;
  $("#detail").innerHTML = `<h2>${r.ref} ${r.name} <span class="pill p-${r.status}">${r.status}</span></h2>
  ${r.review ? `<div class="flagbox"><span class="flag">⚑</span><div><b>Rules and model disagree</b><br>Rules engine says <b>${r.rules_status}</b>, model says ${modelSays} (${n(pct, "% ice risk", "S6")}). The cautious call (<b>${r.status}</b>) is shown. Please review.</div></div>` : ""}
  <div class="mute">Estimated road surface (colour) vs air temperature (grey) tonight ${src("S1", "S5")}</div>${chart(r)}
  <div class="grp"><h3>Road features</h3><div class="kvs">${kv("Mean elevation", n(r.elev_mean_m, " m", "S4"))}${kv("Length", n(r.length_km, " km", "S2"))}</div></div>
  <div class="grp"><h3>Weather prediction</h3><div class="kvs">${kv("Air minimum", n(r.air_min_c, "°C", "S1"))}${kv("Precipitation", n(r.precip_mm, " mm", "S1"))}</div></div>
  <div class="grp"><h3>Status prediction</h3><div class="kvs">${kv("Rules engine", `<span class="pill p-${r.rules_status}">${r.rules_status}</span>${src("S5")}`)}${kv("Model ice risk", n(pct, "%", "S6"))}</div></div>`;
}

const LOGK = "winterwatch_decisions";
function decideUI() {
  const log = JSON.parse(localStorage.getItem(LOGK) || "[]");
  $("#decide").innerHTML = `<h2>Duty Engineer decision <span class="tag">you decide</span></h2>
  <p class="mute">Tool recommends: <b>${L.decision}</b>. Record your decision. It is saved in this browser only and can be exported.</p>
  <input id="who" placeholder="Your name"><textarea id="why" rows="2" placeholder="Reason (required if you override)"></textarea>
  <select id="ov"><option value="">Override to…</option><option>GO</option><option>MARGINAL</option><option>NO-GO</option></select>
  <button class="act ok" id="acc">Accept recommendation</button><button class="act ov" id="ovr">Override</button><button class="act ex" id="exp">Export log</button>
  <div id="log" class="mute" style="margin-top:8px">${log.slice(-5).reverse().map(e => `${fmtUTC(e.time)} · ${e.who || "?"} · ${e.action} ${e.final} ${e.reason ? "· " + e.reason : ""}`).join("<br>")}</div>`;
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
  <div class="capbox"><b>Capacity check before deciding.</b> Moving ${rec.ref} up would grow Priority 1 from ${n(SEN.p1_km, " km", "S2")} to ${n(SEN.p1_km_after, " km", "S2")} (+${n(rec.length_km, " km", "S2")}) out of ${n(SEN.network_km, " km", "S2")} of modelled routes. Cavan's salting run has to finish in about 4 to 6 hours with the trucks and crews available, so a promotion only works if it fits that window or another route moves down. The council's plan lists one Machinery Yard with ${n(SEN.fleet.trucks, " trucks", "S7")} and salt storage for about ${n(SEN.fleet.salt_runs_capacity, " runs", "S7")}, but this tool does not know crew availability or current salt stock. <a href="#" onclick="tab('method');return false">See limits on the plan</a>.</div>
  <p class="mute">Other candidates: ${SEN.candidates.filter(c => c !== rec.ref).join(", ") || "none"}. Weather need only: traffic volume, collision history and depot location are not included. The Senior Engineer decides.</p>` : "No route meets the promotion test."}</div>
  <div class="card"><h2>All routes ranked by modelled gritting need</h2><div class="scroll"><table><tr><th>#</th><th>Route</th><th>Current</th><th>Elev (m)</th><th>Avg nights</th><th>By winter (${SEN.winters.join(" ")})</th><th>Flag</th></tr>
  ${SEN.routes.map(r => `<tr><td>${r.need_rank}</td><td><b>${r.ref}</b> <span class="mute">${r.name}</span></td><td>${r.current_priority === 3 ? "Not on plan" : "P" + r.current_priority}</td><td>${n(r.elev_mean_m, "", "S4")}</td><td>${n(r.go_nights_mean, "", "S3", "S5")}</td>
  <td>${SEN.winters.map(w => heat(r.go_nights_by_winter[w])).join("")}</td><td>${r.flag ? `<span class="chip">${r.flag.replaceAll("_", " ")}</span>` : ""}</td></tr>`).join("")}</table></div></div>`;
}

function method() {
  const m = L.sources.S6.metrics, T = L.thresholds, pc = x => (x * 100).toFixed(0) + "%";
  $("#method").innerHTML = `<div class="card"><h2>Data sources, documents and council policy</h2><p class="mute">S1 to S6 are data and models. S7 to S10 are the council documents, public statements and comparison plans that shape how the tool is set up and what it says about limits. The Cavan plan is the 2023/24 edition, the latest linked on the council website when checked on 19/11/2026, and may have changed since.</p><table class="lim src">${Object.entries(L.sources).map(([k, s]) => `<tr><td><b>${k}</b></td><td>${s.name}${s.url ? ` · <a style="color:#6ea8fe" href="${s.url}">${s.url}</a>` : ""}<br><span class="mute">${s.what}${s.fetched_at ? " · fetched " + fmtUTC(s.fetched_at) : ""}</span>${s.policy ? `<br><span class="policy"><b>Policy:</b> ${s.policy}</span>` : ""}</td></tr>`).join("")}</table></div>
  <div class="card"><h2>How the call is made</h2><ol>
  <li>Forecast air temperature and dew point are adjusted to each route's elevation (${T.lapse_air_c_per_m} °C/m air, ${T.lapse_dew_c_per_m} °C/m dew point).</li>
  <li>Road surface temperature is <b>estimated</b>, not measured: air temperature minus up to ${T.clear_sky_cooling_c} °C of night-time cooling on clear, calm nights.</li>
  <li><b>GO</b>: surface ≤ ${T.go_surface_c} °C while damp (rain, or air within ${T.moist_depression_c} °C of dew point). <b>MARGINAL</b>: cold but dry, or ≤ ${T.marginal_surface_c} °C and damp. Otherwise NO-GO.</li>
  <li><b>Truck plan:</b> each road gets a deadline, its forecast ice onset minus ${L.fleet.assumptions.safety_margin_min} minutes. Roads are assigned to trucks, Priority 1 first, and each truck chains several roads in deadline order, driving between them. A road is treated at ${L.fleet.assumptions.treat_kmh} km/h (this includes turning and salt reloads), the driving between roads is straight-line distance x ${L.fleet.assumptions.road_factor} at ${L.fleet.assumptions.deadhead_kmh} km/h, and each run is capped at ${L.fleet.assumptions.max_run_min / 60} hours including ${L.fleet.assumptions.mobilise_min} minutes of mobilisation. A new truck is used only when a road cannot be added to an existing run without finishing late, up to the ${L.fleet.trucks_available} trucks the plan lists. Trucks leave as late as possible so that every road is finished just before ice.</li>
  <li class="mute">These timings are assumptions, not council data. The 20 km/h rate was chosen so that a long run on the fleet takes about 4 to 6 hours, the window the council quotes (S9). The yard is assumed to be in Cavan town because the council does not publish its exact location, and the plan ignores crew rosters, breakdowns and Municipal District mini salters.</li>
  <li>A logistic-regression model trained on history gives an independent second opinion. If the two disagree the route is marked REVIEW and the more cautious call is shown.</li>
  <li>An AI model, when a key is configured, only turns the numbers into a short briefing. A validator rejects any text containing a number not in the data. If it fails, a fixed template is used.</li></ol></div>
  <div class="card"><h2>Cross-check model accuracy (held-out winters ${m.test_winters.join(", ")})</h2>
  <p>AUC ${n(m.model_auc.toFixed(2), "", "S6")} · model precision ${n(pc(m.model_precision), "", "S6")}, recall ${n(pc(m.model_recall), "", "S6")} · rules precision ${n(pc(m.rules_precision), "", "S5")}, recall ${n(pc(m.rules_recall), "", "S5")} · agreement ${n(pc(m.agreement_rate), "", "S5", "S6")}.<br>
  <span class="mute">Truth label is modelled ground temperature (ERA5-Land) while damp, which is not measured road ice. Trained on ${m.n_train} route-nights, tested on ${m.n_test}.</span></p></div>
  ${SEN.validation ? `<div class="card"><h2>Checked against real gritting call-outs</h2>
  <p>Cavan's plan lists how many nights crews were called out each winter (${src("S7")}). The tool counts nights when at least one designated route is a GO.</p>
  <table><tr><th>Winter</th><th>Actual call-outs</th><th>Tool: nights with a GO route</th></tr>${SEN.validation.rows.map(r => `<tr><td>${r.winter}</td><td>${n(r.actual_callouts, "", "S7")}</td><td>${n(r.tool_nights, "", "S3", "S5")}</td></tr>`).join("")}</table>
  <p>Correlation ${n(SEN.validation.correlation, "", "S3", "S5", "S7")}. Average ${n(SEN.validation.tool_mean, "", "S5")} nights for the tool against ${n(SEN.validation.actual_mean, "", "S7")} actual, so the tool undercounts by about ${Math.round((1 - SEN.validation.tool_mean / SEN.validation.actual_mean) * 100)}%.
  <span class="mute">Only 5 winters, so this supports the method but does not prove it. The council's season runs October to April and ours stops at March, and crews may grit on marginal nights.</span></p></div>` : ""}
  <div class="card"><h2>Limits on the Council's gritting plan</h2>
  <p class="mute">Cavan, like other Irish councils, treats a priority network rather than every road. Real constraints that this tool cannot see or resolve:</p>
  <table class="lim">
  <tr><td><b>Priority network only</b></td><td>Priority 1 is N3, N54, N55 and N87 (N16 is also listed but is salted by Leitrim County Council, so the tool leaves it out). Priority 2 is 22 named regional roads plus some local roads (S7). Six roads in the tool (R179, R181, R195, R196, R394, R901) are not on the plan and are shown greyed on the map. Local roads are not treated routinely. Roughly 500 to 650 km is salted per night, about 20% of Cavan's 3,000+ km. <a style="color:#6ea8fe" href="https://www.cavancoco.ie/services/roads-transportation/severe-weather/current-salting-routes/">Cavan County Council</a>, <a style="color:#6ea8fe" href="https://www.anglocelt.ie/2026/02/01/it-is-not-physically-possible-to-salt-all-routes-council/">Anglo Celt, 01/02/2026</a>, <a style="color:#6ea8fe" href="https://www.northernsound.ie/news/beyond-the-operation-capacity-to-add-more-roads-to-cavan-road-salting-network-188407">Northern Sound, 25/01/2022</a></td></tr>
  <tr><td><b>Time window</b></td><td>A salting run takes about 4 to 6 hours, so routes cannot all be treated at once and a long route needs an early start. Source: Cavan Director of Services (Anglo Celt, 01/02/2026).</td></tr>
  <tr><td><b>Fleet, crews, budget, salt</b></td><td>The Machinery Yard has 9 trucks (11 spreaders) plus 7 mini salters and 2 tractor spreaders across the Municipal Districts, and salt storage for about 30 runs (S7). The council says it is "at the limit of what can be done" and about 90 tonnes of salt is used on a night's run (S8, S9). The Duty view compares each night's plan with the 9 trucks.</td></tr>
  <tr><td><b>Forecast accuracy</b></td><td>Many Irish nights are marginal, close to 0 °C. Mayo County Council's plan notes Met Éireann guarantees about 80% forecast accuracy. <a style="color:#6ea8fe" href="https://www.mayo.ie/getmedia/8b901efa-7151-4fad-87a9-d41a8d74b16c/Winter-Service-Plan-2025-2026.pdf">Mayo Winter Service Plan 2025/26</a></td></tr>
  <tr><td><b>Rain after salting</b></td><td>Heavy rain can wash salt away, and frost after rain can undo the treatment. Source: Cavan County Council salting page.</td></tr>
  <tr><td><b>Severe, prolonged cold</b></td><td>Councils reduce treatment to Priority 1 only when resources run short. Mayo and Monaghan plans say so explicitly.</td></tr>
  <tr><td><b>Local discretion</b></td><td>School bus routes, emergency access and traffic data influence decisions on local roads, and none of that is in this tool.</td></tr></table></div>
  <div class="card"><h2>Limitations</h2><ul><li>Routes are built from OpenStreetMap trunk, primary and secondary roads and matched to the council's designated list (S7, 2023/24 edition). The list is only a route list; the council's own map has the exact roads, including local roads that this tool does not model.</li>
  <li>No road-weather-station or thermal-mapping data. Surface temperature is a simple estimate.</li><li>History is reanalysis (ERA5, about 9 to 25 km grid), not station readings.</li>
  <li>Need ranking uses weather and elevation only, with no traffic, collisions or depot locations.</li><li>Decisions are logged in the browser only.</li></ul></div>`;
}
const L_ = window.L; 
load().then(() => { const h = location.hash.slice(1); if (["duty","senior","method"].includes(h)) tab(h); });
