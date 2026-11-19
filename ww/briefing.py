import os, re, json, requests

def template_briefing(f):
    lines = ["Hello Duty Engineer."]
    if f["decision"] == "GO":
        lines.append(f"Recommendation: GRIT TONIGHT. {f['n_go']} of {f['n_routes']} routes are forecast to reach icy-road conditions.")
    elif f["decision"] == "MARGINAL":
        lines.append(f"Recommendation: MARGINAL. No route is clearly icy, but {f['n_marginal']} routes are borderline. Engineer judgement needed.")
    else:
        lines.append("Recommendation: NO GRITTING NEEDED on current forecast.")
    if f.get("first_departure"):
        lines.append(f"First truck leaves the yard at {f['first_departure']} and starts on {f['first_route']}.")
    if f.get("coldest_route"):
        lines.append(f"Coldest route is {f['coldest_route']} with a forecast road surface minimum of {f['coldest_ts']} C.")
    if f["n_review"]:
        lines.append(f"{f['n_review']} routes are flagged REVIEW because the rules engine and the trained model disagree.")
    if f.get("n_late", 0) > 0:
        lines.append(f"Even with all {f['trucks_available']} trucks, {f['n_late']} routes cannot be finished before ice is forecast, so Priority 1 should go first.")
    elif f.get("trucks_used"):
        lines.append(f"The plan uses {f['trucks_used']} of {f['trucks_available']} trucks.")
    lines.append(f"Confidence is {f['confidence']}: the rules engine and the trained model agree on most routes." if f["confidence"] != "LOW" else "Confidence is LOW: the rules engine and the trained model disagree on many routes, so check the flagged routes.")
    lines.append(CLOSING)
    return " ".join(lines)

CLOSING = "As always, you have the final say."
NUM = re.compile(r"\d+(?:\.\d+)?")

def validate(text, facts):
    allowed = {float(x) for x in NUM.findall(json.dumps(facts))} | {0.0}
    bad = [x for x in NUM.findall(text) if float(x) not in allowed]
    return (len(bad) == 0), bad

def llm_briefing(facts):
    key = os.environ.get("LLM_API_KEY")
    if not key: return None, "no LLM_API_KEY set"
    provider = os.environ.get("LLM_PROVIDER", "anthropic")
    default_model = {"anthropic": "claude-haiku-4-5", "gemini": "gemini-3.5-flash-lite"}.get(provider, "gpt-4o-mini")
    model = os.environ.get("LLM_MODEL") or default_model
    system = ("You write a short gritting briefing (4 to 6 plain sentences) for the Duty Engineer of County Cavan's roads team. "
              "Start with a short, friendly greeting that is not specific to the time of day, such as 'Hello Duty Engineer.' Never say morning, afternoon, evening or night greetings. "
              "Then give the call first (GRIT TONIGHT, BORDERLINE, or NO GRITTING NEEDED, matching the decision), how many routes need gritting out of the total, "
              "how many of the available trucks are used, when the first truck leaves and on which route, and the coldest road and its surface temperature. "
              "Mention the confidence level; if it is LOW, say the rules engine and the model disagree on many routes and the flagged ones should be checked. "
              "If any routes are late, say so. Use ONLY the numbers in the JSON facts, copied exactly. Never compute or estimate new numbers. "
              "Do not use the word 'designated'. Plain text, no markdown, no bullet points. "
              f"End with exactly this sentence: {CLOSING}")
    user = json.dumps(facts)
    try:
        if provider == "anthropic":
            r = requests.post("https://api.anthropic.com/v1/messages", timeout=60,
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": model, "max_tokens": 400, "system": system, "messages": [{"role": "user", "content": user}]})
            r.raise_for_status(); text = r.json()["content"][0]["text"]
        elif provider == "gemini":
            r = requests.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", timeout=60,
                headers={"x-goog-api-key": key, "content-type": "application/json"},
                json={"systemInstruction": {"parts": [{"text": system}]}, "contents": [{"role": "user", "parts": [{"text": user}]}],
                      "generationConfig": {"maxOutputTokens": 1000, "temperature": 0.2}})
            r.raise_for_status()
            parts = r.json()["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        else:
            base = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
            r = requests.post(f"{base}/chat/completions", timeout=60, headers={"Authorization": f"Bearer {key}"},
                json={"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
            r.raise_for_status(); text = r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        code = getattr(getattr(e, "response", None), "status_code", None)
        return None, f"LLM call failed: {type(e).__name__}" + (f" (HTTP {code})" if code else "")
    if not text.strip():
        return None, "LLM returned no text"
    ok, bad = validate(text, facts)
    if not ok: return None, f"validator rejected numbers {bad}"
    text = text.strip()
    if not text.endswith(CLOSING):
        text = " ".join(x for x in re.split(r"(?<=[.!?])\s+", text) if "final decision" not in x.lower() and "final say" not in x.lower())
        text = text.rstrip(". ") + ". " + CLOSING
    return text, model
