# Notes

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