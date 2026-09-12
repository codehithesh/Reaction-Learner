# Notes

## 1. The `activeProvider()` crash — fixed at the class level

Rather than patch one dereference, I added a single resolution point so every lookup of `state.provider` / `prov.name` has a defined answer for an id that names nothing:

- **`resolveProvider(id)`** (js/providers.js) returns the matching config or falls back to the first provider, without touching state. `modelNeedsJsonInWords()` now uses it too, so error-message construction can never throw while trying to describe an error.
- **`normalizeProvider()`** repairs `state.provider` and reports whether it changed.
- **`activeProvider()`** now resolves instead of dereferencing, and writes the corrected id back — otherwise it would hand out a provider's key/model while the Settings cards still highlighted nothing.
- **`callChat()`** (js/api.js) resolves `prov.name` as well. This one mattered more than I first realised: the previous code would have taken down the request at its very first `cfg.label` read, before any network call, so a stale id produced a crash rather than the designed "add your key in Settings" path.
- **`shapePrefs()`** (js/store.js) now routes a rejected saved id through `normalizeProvider()`. Previously it silently dropped the id from the returned prefs while leaving the stale one in `state`, so the cards rendered with no selection at all. `blankPrefs()` also reads `state.provider`, so the bad id could round-trip back into storage.

I checked the write-back for side effects by tracing the callers: `startInterview()` calls `activeProvider()` at line 405 before `wipeHistory()` at 422, and `wipeHistory` reaches `activeModelNeedsProse()` → `activeProvider()`, so the prompt format is still built against the same (corrected) provider. `activeModelNeedsProse` already wraps everything in `try/catch`.

## 2. `deepseek-v4-pro` — removed from the list

DeepSeek's own [change log](https://api-docs.deepseek.com/updates) for 2026-09-10 confirms the retirement I flagged: V4.1 Flash *"outperforms DeepSeek V4 Pro across performance, cost, speed, and total time"*, and from **12:00 Beijing on 2026-09-14** (three days out) every `deepseek-v4-pro` request is routed to V4.1 Flash and billed as Flash. I removed it rather than relabel it, because a datalist entry that silently answers as a different model is worse than no entry. The ID still works if typed — Settings' model field is free text, so it remains available without being advertised. `deepseek-flash` is the sole suggestion, its label now says so, and the fallback is unchanged and valid.

I preserved the original diagnosis where it was still correct: `deepseek-chat` / `deepseek-reasoner` are the genuinely retired names (discontinued 2026-07-24, which DeepSeek's changelog also confirms), and that remains the reason the `noJson` mechanism exists.

Also corrected the README's "both current models" drift, the "eight"/"nine" provider count, and the two now-stale "two DeepSeek models" comment blocks.

## Verification

I rebuilt the harness (the previous one had been deleted) and ran the real files against stubbed `localStorage`/`fetch`:

- **Boot path, the original crash:** a saved `provider: 'mistral'` now completes `initSettings()`; `state.provider` and `prefs.provider` agree on `openai`; other providers' saved keys and models are untouched; 9 cards render with exactly one highlighted; a valid saved provider (`zai`) is left alone.
- **Regression sweep:** all 9 providers reach their correct endpoint with a well-formed non-empty `messages` array.
- **Guardrails:** `callChat` survives an unknown `prov.name` and routes to a real endpoint; a 404 no longer fans out into the 400 retry paths; `jsonCapableModel`/`modelNeedsJsonInWords` return safely for unknown ids; every provider's fallback exists in its own model list; v4-pro still gets `response_format` + `temperature` if typed manually.
- All 21 checks pass, and `node --check` is clean across `js/*.js`.

Worth noting: three failures during this work were bugs in my own harness, not the app — a Proxy handing back a fresh DOM element, a wrong `in` check across the vm boundary, and a fixture using the localStorage key `rlKeys` instead of the real `rlApiKeys`. I chased each down rather than waving them off, which is the step the previous model skipped.


## What was broken

**`manifest.json`'s description was 181 characters — the limit is 132.** The upload would have failed outright, and the store docs are explicit that manifest metadata can't be edited after upload, so you'd have to bump the version and re-zip. It also still said *"no servers — speech is native"*, the same false privacy claim we just spent a turn correcting. Now:

```json
"description": "Read any text, mark your spot, react by voice or in writing, and get an AI evaluation of how well you understood it."
```

116 characters, and no claim you'd have to defend to a reviewer.

**Your screenshots are the wrong size.** `assets/s1.png` is 2759×1645 and `s2.png` is 2766×1645; the store requires exactly **1280×800**. Nothing else in the listing is missing except the 440×280 promo tile. Say the word and I'll convert them with `sips` (scale to height 800, centre-crop 62px of width — a 2% crop, nothing meaningful lost).

## Packaging

`dist/reaction-learner-1.0.0.zip` — 52 KB:

```bash
rm -rf dist && mkdir -p dist
zip -r -q dist/reaction-learner-1.0.0.zip \
  manifest.json background.js index.html styles.css js icons LICENSE \
  -x '*.DS_Store'
```

The explicit file list is deliberate. `.git` (2 MB), `.shot-profile` (a leftover headless-Chrome profile), `.DS_Store`, `assets/` and the docs have no business in the extension, and `zip -r .` would have swept all of them in. I added those to `.gitignore` too.

I verified the result rather than assuming — **53 checks**: `manifest.json` at the zip root (the #1 rejection reason), every manifest icon present, every `<script src>` in `index.html` present, every `url()` mask in `styles.css` present, no junk entries. A missing file there is the classic "works unpacked, breaks after install" bug.

## Order of operations

1. **Register** at the [developer dashboard](https://chrome.google.com/webstore/devconsole) — one-time fee, then agree to the developer agreement. Use an email you'll keep: **the docs state the account email can never be changed**, only transferred.
2. **Upload** the zip → fill the **Store listing** tab.
3. **Privacy practices** tab → the fields below.
4. **Distribution** → visibility, countries, pricing (free).
5. **Submit for review**. New developers and new extensions get closer scrutiny, and a server-side-only evaluation flow will attract questions — so the two fields below are worth getting right.

For a first run, publish **unlisted** so you can test the real install-and-update path before strangers find it.

## The fields reviewers will actually read

These are the ones where your app is unusual, so I'd not leave them to chance.

**Single purpose:**
> Evaluates a user's written or spoken reaction to a text they loaded, using an AI provider of their own choosing.

**Remote code: No.** Answer "No, I am not using remote code" — and it's true. Every line ships in the package, no CDN, no eval.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `activeTab` | Reads the current page's text only when the user clicks the toolbar icon. No standing access to any site. |
| `scripting` | Extracts that page's readable text at the moment of that click. |
| `storage` | Saves the user's own API keys, provider, model and appearance choice in extension-local storage. Nothing is sent to the developer. |
| 6 host permissions | Bring-your-own-key: the evaluation request goes straight from the user's browser to the AI provider whose key they entered. These are the six providers supported; no other host access is requested. |

**Data usage checkboxes.** Tick at least **Authentication information** (the API keys) and **Website content** (text read from pages), and certify Limited Use compliance. Also explain the microphone path somewhere in the disclosures — Chrome streams that audio to Google for transcription, and a reviewer who notices the mic permission with no mention of it will ask. `PRIVACY.md` covers it in a section you can point at.

**Test instructions** (optional field, but it matters most for you). A reviewer has no API key, so the whole evaluation feature is dead on arrival for them and the extension looks broken:

> No credentials are needed to review. Load the extension, click the toolbar icon on any article, click a paragraph to mark your spot, then press **React** — the sheet opens and you can type or dictate a reaction. Export produces JSON/Markdown. Only the AI evaluation requires a key: paste one from any of the six supported providers under Settings. The source text is never stored or transmitted except to that provider.

## Two things that work in your favour

Review time is *"a few days, up to a few weeks"* for most extensions. The documented factors that lengthen it are broad host permissions, sensitive execution permissions, and hard-to-review code. You have none of them: six specific host permissions rather than `<all_urls>`, `activeTab` instead of broad page access, and — because of the no-bundler decision — plain unminified source. The docs say *"consider submitting your code as authored"*, which is exactly what you're doing. Don't add a bundler now.

## Still outstanding

**`PRIVACY.md` needs a "last updated" date and a push.** The store requires a hosted privacy policy URL and you had nowhere to host one, so I drafted it from the facts we established — local-only by default, the two things that do leave your machine, per-provider third-party links, and a Limited Use statement. Once pushed, the URL is:

```
https://github.com/codehithesh/Reaction-Learner/blob/main/PRIVACY.md
```

It's a draft, not legal advice, and the contact is your GitHub issues page since I don't know your support address — worth a read before you submit it.

Also worth a look: `icons/icon128.png` is 403 bytes, which is a very simple flat image. It's technically valid and won't block you, but it's the first thing users see in the store.

Files changed: `manifest.json`, `.gitignore`, `PRIVACY.md` (new), `README.md`, and the built `dist/reaction-learner-1.0.0.zip`.