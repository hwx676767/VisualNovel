# Restore full AI prompt pack

This folder is the pre-slim backup (full director rules + acting examples + `ai.js` builder).

## Rollback (from repo root)

```powershell
Copy-Item backups\ai-prompt-full\ai.js ai.js -Force
Copy-Item backups\ai-prompt-full\director.json data\prompts\director.json -Force
Copy-Item backups\ai-prompt-full\acting_examples.json data\prompts\acting_examples.json -Force
```

Then bump cache in `index.html` (`ai.js?v=...`) and redeploy:

```powershell
npm run pages:deploy
```

Keep this folder even after further prompt edits so you can always return to the liveness-heavy pack.
