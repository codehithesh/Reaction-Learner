# Reaction Learner — Chrome Extension

Read any text, mark where you are, then react — in writing or by just speaking —
and get an AI evaluation of your understanding versus the source text.

**No accounts, no servers, no session persistence.** Source text, reactions and
evaluations live only in the memory of the running page — close the tab and
they're gone. The only thing that persists is what you explicitly **Save** in
Settings: your BYOK API keys plus your provider, model and light/dark
preferences (extension-private browser storage; keys erased on request).
JSON/Markdown export happens in-browser.

## Features

| Area | How it works |
| --- | --- |
| Source | Paste any text with the **+** button in the top bar, **or** click the toolbar icon while on a webpage to load that page's readable text |
| Position marker (T) | Click the paragraph you've read up to; the text before it becomes the evaluation context |
| Reaction sheet | The floating **React** button opens the reactions sheet **full screen** — identical on desktop and mobile — so the source text is covered and you write from memory, with the caret already in the composer. **✕** (or `Esc`) lifts it |
| Reaction | Type it in the auto-growing composer, or speak it — **native** `webkitSpeechRecognition`, no speech API, nothing uploaded |
| Read aloud | **Native** `speechSynthesis` with OS voices, highlight + auto-advancing marker, pause/stop to react |
| Evaluation | BYOK across **OpenAI** (`o3-mini` / `o4-mini` / `gpt-4o`), **Claude** (`claude-sonnet-5` / `claude-opus-5` / `claude-haiku-4-5` / `claude-fable-5-1`), **Google Gemini** (`gemini-3.8-flash` / `gemini-3.1-pro` / …), **DeepSeek** (`deepseek-reasoner` / `deepseek-chat`), **Kimi** (`kimi-k3` / `kimi-k2.6`) and **Mistral**; unsupported models/params fall back automatically |
| Scoring | Accuracy · Understanding · Coverage · Unsupported inference · Incorrect claims · Missed points · Overall — plus a **suggested better summary** |
| Export | **Export** dropdown in the reactions sheet header → JSON + Markdown downloaded directly from the browser |
| Storage | Session data: none — page memory only. Settings: written only when you press **Save** (extension-private `chrome.storage.local`), deleted completely by “Forget saved keys” |

## Files

```
manifest.json       MV3 manifest (activeTab, scripting, storage)
background.js       toolbar click → grabs current tab text → hands it to the app tab
index.html          page shell: reader pane, source modal, and the two pane mount points
styles.css          styling
icons/              UI glyphs (16/48/128 app icons + masked SVG icons)

js/view.js          mounts a pane's markup into its placeholder
js/settings-view.js   Settings pane markup  (own file)
js/reactions-view.js  Reactions pane markup (own file)

js/state.js         all session state + runtime constants
js/utils.js         pure helpers (formatting, slug, escaping)
js/dom.js           element cache, modals, toast
js/theme.js         System / Light / Dark appearance
js/providers.js     the six BYOK providers + their key/model inputs
js/api.js           the API call functions — the only network layer
js/tts.js           text-to-speech (native, no API)
js/stt.js           speech-to-text (native, no API)
js/store.js         reading/writing saved preferences
js/settings.js      Settings behaviour: draft, Save, Forget keys
js/marker.js        the position marker and paragraph highlighting
js/composer.js      the auto-growing composer + which controls are enabled
js/reader.js        source text: paste, segment, render, grabbed page text
js/evaluation.js    the scoring rubric, prompt and result rendering
js/export.js        JSON / Markdown export
js/reactions.js     the reactions sheet and the send-and-evaluate flow
js/main.js          boot: wires the modules together and starts the app
```

### How the split works

The two panes that used to be inline in `index.html` now keep their markup in
their own file (`js/settings-view.js`, `js/reactions-view.js`) and mount it into a
placeholder on load. Everything else is split by responsibility, so each file
owns one job — the API calls, text-to-speech and speech-to-text each live in
their own file.

Scripts are plain `<script src>` tags in dependency order, **not ES modules, and
nothing is fetched**. That is deliberate: `index.html` must keep working when
opened straight from disk, and a `file://` page is not allowed to load module
scripts or read other local files. A plain script has no such restriction, which
is why each pane's markup travels inside a script rather than in a fetched
`.html` partial. Load order is the only ordering rule — `js/main.js` runs last and
does the wiring.

> One thing to expect when opening `index.html` from disk: the masked UI icons
> (`icons/*.svg`, applied via `mask-image` in `styles.css`) cannot be loaded
> cross-origin from a `file://` page, so the buttons show without their glyphs.
> That is a pre-existing `file://` limitation, unrelated to this layout — load the
> folder as the unpacked extension (or serve it over `http://`) to see them.

> `chrome.storage.session` is used only as a transient, in-memory handoff buffer
> for tab text passed from the toolbar click to the app page. It is deleted the
> moment the app reads it and is cleared automatically when Chrome restarts.
> It is never the session store.

## Load it (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select this folder
4. Click the Reaction Learner toolbar icon on any webpage, or open
   `index.html` inside the extension and press the **+** button to paste text

## How to use

1. **Load text** — press the **+** button in the top bar and paste it, or click the extension's
   toolbar icon on a webpage to load its readable text automatically.
2. **Read** — optionally hit **▶ Read** in the reader bar for native read-aloud
   (pick an OS voice). The marker advances as it reads.
3. **Mark** — click the paragraph you've read up to in the script pane
   (dimmed text = not read yet).
4. **React** — the floating button slides the reactions sheet up **full screen**,
   covering the text so you recall what you read from memory, and drops the caret
   straight into the composer. Type in the one-line box (it grows as you write) or
   press the **mic icon** and speak — while recording it shows **Recording**. Only
   what you read (¶ 0 → marker) is sent as context. Nothing in the sheet is greyed
   out: if something is missing, it tells you why. **✕** (or `Esc`) returns
   to the reading pane.
5. **Evaluate** — open **⚙ Settings** (top bar, icon only), pick a provider card
   (OpenAI, Claude, Gemini, DeepSeek, Kimi, Mistral), paste its key, choose a
   model, then press **Save** and hit **Send**. Scores + suggested summary appear
   in the reactions sheet.
6. **Export** — the **Export** dropdown in the sheet header writes JSON/Markdown
   anytime while the session is open.

## Saved settings

Nothing is written to storage while you type. The Settings modal edits a draft,
and **Save** (in the modal header, next to **✕**) commits all of it:

- the API key of every provider you filled in,
- which provider card is selected,
- the model you picked for each provider,
- your **System / Light / Dark** appearance choice.

Closing the modal without saving discards the draft and restores the last saved
state. “Forget saved keys” erases the keys from the browser and leaves the
provider, model and appearance preferences alone.

## Privacy

- Source text, reactions, and evaluations exist **only in page memory**.
- Speech-to-text and text-to-speech are **native browser features** — audio and
  speech never leave your machine.
- The only network calls go from your chosen key to that provider's API
  endpoint (e.g. `api.openai.com`, `api.anthropic.com`,
  `generativelanguage.googleapis.com`, `api.deepseek.com`, `api.moonshot.ai`,
  `api.mistral.ai`) when you run an evaluation.
- API keys are read on demand from the Settings inputs and only ever sent to the
  provider you picked. They are written to storage **only when you press Save**.
  Once saved they live in this extension's private `chrome.storage.local` —
  sites and other extensions cannot read that area — and **Forget saved keys**
  deletes them from the browser entirely.

## License

MIT — see [LICENSE](LICENSE).
