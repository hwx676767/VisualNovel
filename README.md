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
Resources/Art/                     # character + NPC art (loaded via data/sprites.json)
data/prompts/NPC投喂培训模板.md      # how to train / feed AI characters
functions/                         # Cloudflare Pages API proxy
server.js                          # local Express (not used on Pages)
data/story/                        # chapter JSON (English)
```

## Limited freedom (interrupt)

- System `interactive` beats = free talk.
- During scripted lines (click-to-continue), press **Interrupt** to cut in (costs 1).
- A-segment: 5 per chapter. B-segment (RV): 2. Unused charges expire when the segment changes.

## Content language

Story, UI, and AI prompts are in **colloquial English**. Character names stay as Xian, Ringo, Miles, Teacher.

## Progress

Prologue → Chapter 1–3 → five endings. See in-game PROGRESS or `data/story/progress.json`.

Phase A (portfolio demo): character sprites under `characters/`, limited Interrupt, AI talk. Background PNGs (`backgrounds/`) and audio mp3s (`audio/bgm|sfx/`) are optional drop-ins — missing files show placeholders / SETTINGS MISSING, game still plays.
