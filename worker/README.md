# Winter Watch chat proxy (Cloudflare Worker)

The chat box on the page cannot hold a Gemini key (GitHub Pages is public). This Worker holds the key and answers questions.
It loads the tool's data itself from the public site, so the browser only ever sends the conversation.

## One-time setup (about 10 minutes, free)
1. Make a free account at <https://dash.cloudflare.com>. No card is needed for the free Workers plan.
2. **Workers & Pages → Create → Create Worker.** Name it `winter-watch-chat`, click *Deploy*, then *Edit code*.
3. Delete the sample code, paste in the whole of `worker/worker.js` from this repo, and click *Deploy*.
4. Open the Worker's **Settings → Variables and Secrets** and add:
   - Secret `GEMINI_API_KEY` = your Gemini key. Best to make a **second key** in AI Studio for this, so you can revoke it separately.
   - Text variable `ALLOWED_ORIGIN` = `https://larvaltech.github.io`
   - Text variable `SITE_URL` = `https://larvaltech.github.io/winter-watch`
   - Optional text variable `MODEL` = `gemini-3.5-flash-lite` (the default)
5. Copy the Worker's address (it looks like `https://winter-watch-chat.<your-name>.workers.dev`).
6. Paste it into `docs/config.js` as `chatUrl`, commit and push.

## What it protects
- The key is a Worker secret. It is never in the repo, the page, or the prompt.
- Only requests from your site's address are accepted (plus localhost for testing).
- Each visitor is limited to 15 questions a minute, and conversations are capped at 12 messages of 1,500 characters.
- Answers use only the tool's data and the council knowledge file (`docs/data/knowledge.json`). To teach it more, add facts there with a source id.
- Free-tier Gemini may use prompts to improve Google's products. Only public weather, road and council data is sent. Visitors are told not to type personal information.
