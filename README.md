# Reaction Learner — Chrome Extension

Read any text, mark where you are, then react — in writing or by just speaking —
and get an AI evaluation of your understanding versus the source text.

**No accounts, no servers, no persistence.** Everything (source text, reactions,
evaluations, API keys) lives only in the memory of the running page. Close the
tab and it's gone. JSON/Markdown export happens in-browser.

## Features

| Area | How it works |
| --- | --- |
| Source | Paste any text, **or** click the toolbar icon while on a webpage to load that page's readable text |
| Position marker (T) | Click the paragraph you've read up to; the text before it becomes the evaluation context |
| Reaction | Type it, or speak it — **native** `webkitSpeechRecognition`, no speech API, nothing uploaded |
| Read aloud | **Native** `speechSynthesis` with OS voices, highlight + auto-advancing marker, pause/stop to react |
| Evaluation | BYOK **DeepSeek** (`deepseek-reasoner` / `deepseek-chat`) **or** OpenAI (`o3-mini` / `o4-mini` / `gpt-4o`); reasoning models fall back automatically |
| Scoring | Accuracy · Understanding · Coverage · Unsupported inference · Incorrect claims · Missed points · Overall — plus a **suggested better summary** |
| Export | JSON + Markdown downloaded directly from the browser |
| Storage | None. No localStorage, no IndexedDB, no database. Keys are never stored |

## Files

```
manifest.json   MV3 manifest (activeTab, scripting, storage)
background.js   toolbar click → grabs current tab text → hands it to the app tab
index.html      app page UI
styles.css      styling
app.js          all logic (state, marker, native STT/TTS, eval, export)
icons/          16/48/128 placeholder icons
```

> `chrome.storage.session` is used only as a transient, in-memory handoff buffer
> for tab text passed from the toolbar click to the app page. It is deleted the
> moment the app reads it and is cleared automatically when Chrome restarts.
> It is never the session store.

## Load it (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select this folder
4. Click the Reaction Learner toolbar icon on any webpage (or just open
   `index.html` inside the extension and paste text)

## How to use

1. **Load text** — paste it, or open the extension from a webpage you're reading.
2. **Read** — optionally press **▶ Read from marker** to have it read aloud
   (native voices, pick yours in the dropdown). The marker advances as it reads.
3. **Mark** — click the paragraph you've read up to (dimmed text = not read yet).
4. **✍ React here** — type or press the mic and speak. Only what you read
   (¶ 0 → marker) is sent as context.
5. **Evaluate** — pick **DeepSeek** or **OpenAI** on the left, paste your key,
   choose a model, hit **Send**. Evaluation scores + suggested summary appear in
   Activity.
6. **Export** — JSON/Markdown anytime while the session is open.

## Privacy

- Source text, reactions, and evaluations exist **only in page memory**.
- Speech-to-text and text-to-speech are **native browser features** — audio and
  speech never leave your machine.
- The only network calls go from your chosen API key to `api.openai.com` or
  `api.deepseek.com` (chat completions) when you run an evaluation.
- API keys are read from the inputs on demand and kept in memory only.

## License

MIT — see [LICENSE](LICENSE).
