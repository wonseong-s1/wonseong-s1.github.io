# Στοιχεῖα Reader (web prototype)

A working prototype of the app in `claude code/stoicheia_android_ui_spec.pdf`: read Euclid's Elements in Greek, tap any word to see its lemma and grammatical analysis, dismiss the sheet and keep reading.

It is built as an installable web app (PWA). It runs in any browser and installs to an Android home screen, where it opens full-screen and works offline. It covers spec milestones 0–2 plus most of milestone 4, so the interaction can be tried before writing the Kotlin/Compose app.

## How to open it

- **Quickest:** the shared link (the published artifact). No install, but no offline mode or home-screen install.
- **On a computer:** `cd app && python3 -m http.server 8000`, then open http://localhost:8000.
- **Install on Android:** host the `app/` folder on any HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages), open it in Chrome on the phone, then Menu → *Add to Home screen* / *Install app*.

## What's in this version

| Spec area | Status |
|---|---|
| Books → Book contents → Reader → Figure view, with Back closing overlays first | Done |
| Tap a word → partial bottom sheet; tap another word updates it in place; swipe up for principal parts; swipe down, Back, Esc or tap paper to close | Done |
| Sheet never covers the selected word (minimal auto-scroll) | Done |
| Context-specific parse for every word (534 tokens, 78 lemmas) | Done, hand-annotated, not yet scholar-reviewed |
| Original data-driven vector diagrams for I.1–I.3, pinch/wheel zoom, double-tap 2×, Reset | Done |
| Exact position restore (paragraph + character offset), Continue Reading card, last-read bar | Done |
| Settings sheet: text size 18–30, line spacing, theme, keep screen awake, gloss (off by default), principal parts, high-contrast highlight | Done |
| Bookmarks, copy citation / passage / word analysis, citation jump (I.1, I.Def.4, I.Post.3; Ctrl+L) | Done |
| Two-pane layout on wide screens (figure + analysis beside the text) | Done |
| Bundled Gentium Plus font (OFL), offline service worker | Done |

**Content in this preview:** Book I Definitions 1–16, Postulates 1–5, Common notions 1–5, and Propositions 1–3. I.4 onward show as "planned" (never as empty clickable rows).

## Not yet done

- The Greek text was typed for the prototype following the Heiberg text. Before release it must be replaced by the Perseus canonical Greek TEI (CC BY-SA 4.0), per spec §13. The build is the place to plug that in.
- Morphology needs review by a competent Greek reader (spec §20).
- The native Android (Jetpack Compose) app from spec Part D. The corpus format here maps straight onto the spec's Room schema.

## Layout

```
content/corpus.mjs     Greek passages; word#variant picks a context-specific analysis
content/lexicon.mjs    lemmas, glosses, principal parts, and form → analysis table
tools/build.mjs        tokenizes, attaches analyses, checks coverage → app/corpus.js
tools/bundle.mjs       single-file build in dist/ (used for the shared link)
app/                   the PWA: index.html, app.js, styles.css, sw.js, manifest, fonts
```

After editing content: `node tools/build.mjs && node tools/bundle.mjs`. The build refuses to write output if any word lacks an analysis, a lemma is missing, or text isn't NFC.
