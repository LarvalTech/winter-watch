(function () {
  const CHAT_URL = (window.WW_CONFIG || {}).chatUrl;
  let history = [], busy = false;
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^[-*] /gm, "• ")
    .replace(/\[(S\d{1,2}(?:\s*,\s*S\d{1,2})*)\]/g, (_, ids) => `<sup class="src" title="See Sources &amp; method" onclick="goSrc()">${ids.replace(/\s/g, "")}</sup>`).replace(/\n/g, "<br>");

  window.initChat = function (D, getFocus) {
    const el = document.getElementById("chat"); if (!el) return;
    const nrev = D.facts.n_review, level = D.confidence.level;
    const chips = [`Why is confidence ${level}?`, "Review the truck allocation", "How unusual is tonight compared with past winters?",
      nrev ? "Which routes disagree and why?" : null, "What does the council plan say about Priority 1 and 2?",
      "Which route should move up next winter, and why?", "How well has this tool matched real call-outs?"].filter(Boolean);
    el.innerHTML = `<h2>What can I help you with? <span class="tag">AI assistant</span></h2>
      <p class="mute">Would you like to investigate the confidence rating, review the truck route allocation, or dig into historical trends and past council practice?</p>
      <div class="chips">${chips.map(c => `<button class="qchip">${esc(c)}</button>`).join("")}</div>
      <div id="msgs" class="msgs" aria-live="polite"></div>
      <form id="chatform" class="chatform"><input id="chatin" maxlength="500" autocomplete="off" placeholder="${CHAT_URL ? "Ask a question about tonight, the history or council practice" : "Chat is not connected yet"}" ${CHAT_URL ? "" : "disabled"}>
        <button class="act ok" ${CHAT_URL ? "" : "disabled"}>Ask</button><button type="button" class="act ex" id="chatclear">Clear</button></form>
      <p class="mute" style="font-size:12px;margin:6px 0 0">${CHAT_URL ? "Answers use only this tool's data and the council documents listed under Sources. Check anything important, and please don't type personal information. You make the final decision."
        : "The assistant needs its proxy switched on first. Until then the rest of the page works as normal."}</p>`;
    const msgs = el.querySelector("#msgs"), input = el.querySelector("#chatin");
    const add = (role, html) => { const d = document.createElement("div"); d.className = "msg " + role; d.innerHTML = html; msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight; return d; };
    async function ask(q) {
      if (!CHAT_URL || busy || !q.trim()) return;
      busy = true; add("user", esc(q)); history.push({ role: "user", content: q });
      const wait = add("bot", '<span class="dots2"><i></i><i></i><i></i></span>');
      try {
        const r = await fetch(CHAT_URL, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history.slice(-12), focus: getFocus ? getFocus() : null }) });
        const j = await r.json();
        if (!r.ok || !j.reply) throw new Error(j.error || "No answer");
        wait.innerHTML = md(j.reply); history.push({ role: "assistant", content: j.reply });
      } catch (e) { wait.innerHTML = `<span class="mute">Sorry, I couldn't answer just now. ${esc(e.message || "")}</span>`; history.pop(); }
      busy = false; msgs.scrollTop = msgs.scrollHeight;
    }
    el.querySelectorAll(".qchip").forEach(b => b.onclick = () => ask(b.textContent));
    el.querySelector("#chatform").onsubmit = e => { e.preventDefault(); const q = input.value; input.value = ""; ask(q); };
    el.querySelector("#chatclear").onclick = () => { history = []; msgs.innerHTML = ""; };
  };
})();
