import os, re, json, requests

def template_briefing(f):
    lines = []
    if f["decision"] == "GO":
        lines.append(f"Recommendation: GRIT TONIGHT. {f['n_go']} of {f['n_routes']} routes are forecast to reach icy-road conditions.")
    elif f["decision"] == "MARGINAL":
        lines.append(f"Recommendation: MARGINAL. No route is clearly icy, but {f['n_marginal']} routes are borderline. Engineer judgement needed.")
    else:
        lines.append("Recommendation: NO GRITTING NEEDED on current forecast.")
    if f.get("first_departure"):
        lines.append(f"First truck should leave at {f['first_departure']} ({f['first_route']}).")
    if f.get("coldest_route"):
        lines.append(f"Coldest route is {f['coldest_route']} with a forecast road surface minimum of {f['coldest_ts']} C.")
    if f["n_review"]:
        lines.append(f"{f['n_review']} routes are flagged REVIEW because the rules engine and the trained model disagree.")
    lines.append("This is a recommendation only. The Duty Engineer makes the final decision.")
    return " ".join(lines)

NUM = re.compile(r"\d+(?:\.\d+)?")

def validate(text, facts):
    allowed = {float(x) for x in NUM.findall(json.dumps(facts))} | {0.0}
    bad = [x for x in NUM.findall(text) if float(x) not in allowed]
    return (len(bad) == 0), bad

def llm_briefing(facts):
    key = os.environ.get("LLM_API_KEY")
    if not key: return None, "no LLM_API_KEY set"
    provider = os.environ.get("LLM_PROVIDER", "anthropic")
    model = os.environ.get("LLM_MODEL", "claude-haiku-4-5")
    system = ("You write a 3-5 sentence gritting briefing for a roads Duty Engineer in County Cavan. "
              "Use ONLY the numbers in the JSON facts, copied exactly. Never compute or estimate new numbers. "
              "State that the engineer makes the final decision. Plain text, no markdown.")
    user = json.dumps(facts)
    try:
        if provider == "anthropic":
            r = requests.post("https://api.anthropic.com/v1/messages", timeout=60,
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": model, "max_tokens": 400, "system": system, "messages": [{"role": "user", "content": user}]})
            r.raise_for_status(); text = r.json()["content"][0]["text"]
        else:
            base = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
            r = requests.post(f"{base}/chat/completions", timeout=60, headers={"Authorization": f"Bearer {key}"},
                json={"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
            r.raise_for_status(); text = r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        return None, f"LLM call failed: {type(e).__name__}"
    ok, bad = validate(text, facts)
    return (text.strip(), model) if ok else (None, f"validator rejected numbers {bad}")
