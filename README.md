# Visual Novel

A vanilla HTML/CSS/JS visual novel with typewriter dialogue, chapter scripts, and AI-driven interactive scenes.

## Local run (dev)

```powershell
npm install
copy .env.example .env    # add your Zhipu (or other) API key
npm start
# open http://localhost:8765
```

Do **not** open `index.html` directly — `/api/chat` will not work.

## Cloudflare Pages

Static assets + `functions/` API proxy.

```powershell
npm install
npx wrangler login
npm run pages:deploy
```

Secrets:

| Variable | Required | Notes |
|----------|----------|-------|
| `AI_API_KEY` | Yes | API key for dialogue |
| `AI_BASE_URL` | No | Default Zhipu OpenAI-compatible URL |
| `AI_MODEL` | No | Default `glm-4-flash` |
| `SITE_ACCESS_TOKEN` | No | Optional login gate |

## Structure

```
index.html / main.js / style.css   # game client
audio.js + audio/bgm|sfx/          # BGM/SFX — see audio/音频需求.md
functions/                         # Cloudflare Pages API proxy
server.js                          # local Express (not used on Pages)
data/story/                        # chapter JSON (English)
```

## Content language

Story, UI, and AI prompts are in **colloquial English**. Character names stay as Xian, Ringo, Miles, Teacher.

## Progress

Prologue → Chapter 1–3 → five endings. See in-game PROGRESS or `data/story/progress.json`.
