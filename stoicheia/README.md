# Στοιχεῖα Reader (web prototype)

A working prototype of the app in `claude code/stoicheia_android_ui_spec.pdf`: read Euclid's Elements in Greek, tap any word to see its lemma and grammatical analysis, dismiss the sheet and keep reading.

It is built as an installable web app (PWA). It runs in any browser and installs to an Android home screen, where it opens full-screen and works offline. It covers spec milestones 0–2 plus most of milestone 4, so the interaction can be tried before writing the Kotlin/Compose app.

**Live:** https://wonseong-s1.github.io/stoicheia/app/ (https://wonseong-s1.github.io/stoicheia/ redirects there).

## How to open it

- **Quickest:** the live link above. It also installs and works offline.
- **On a computer:** `cd app && python3 -m http.server 8000`, then open http://localhost:8000.
- **Install on Android:** open the live link in Chrome on the phone, then Menu → *Add to Home screen* / *Install app*.

## What's in this version

| Spec area | Status |
|---|---|
| Books → Book contents → Reader → Figure view, with Back closing overlays first | Done |
| Tap a word → partial bottom sheet; tap another word updates it in place; swipe up for principal parts; swipe down, Back, Esc or tap paper to close | Done |
| Sheet never covers the selected word (minimal auto-scroll) | Done |
| All 13 books: every definition, postulate, common notion and proposition (478 passages, about 124,000 words) | Done |
| Parse for every word | Hand-checked for I.Def.1–16, I.Post, I.CN.1–5 and I.1–I.3; machine first pass everywhere else, to be corrected |
| English translation (Heath) under each definition and enunciation, and after each proof; switch in Settings | Done |
| Original data-driven vector diagrams for I.1–I.3, pinch/wheel zoom, double-tap 2×, Reset | Done |
| Exact position restore (paragraph + character offset), Continue Reading card, last-read bar | Done |
| Settings sheet: text size 18–30, line spacing, theme, keep screen awake, gloss (off by default), principal parts, high-contrast highlight | Done |
| Bookmarks, copy citation / passage / word analysis, citation jump (I.1, I.Def.4, I.Post.3; Ctrl+L) | Done |
| Two-pane layout on wide screens (figure + analysis beside the text) | Done |
| Bundled Gentium Plus font (OFL), offline service worker | Done |

## Not yet done

- Outside the hand-checked passages, the word analyses come from an automatic tagger and contain mistakes (wrong lemma, case or part of speech; words it could not analyse show as "not yet analysed"). Correct them as described below.
- Diagrams exist only for I.1–I.3.
- The native Android (Jetpack Compose) app from spec Part D. The corpus format here maps straight onto the spec's Room schema.

## Layout

```
content/elements/<book>.json   all 13 books: Greek, English, and one [word, lemma, code] line per word
content/elements/glosses.json  short glosses for lemmas
content/corpus.mjs             hand-checked passages (these win over content/elements); word#variant picks an analysis
content/lexicon.mjs            hand lemmas, glosses, principal parts, form → analysis table, feature codes
tools/import_perseus.py        one-time import that produced content/elements (re-running it overwrites corrections)
tools/lsj_glosses.py           extracts short glosses from the LSJ lexicon for the import
tools/build.mjs                tokenizes, attaches analyses, checks everything → app/corpus.js + app/books/*.js
tools/bundle.mjs               single-file build in dist/
app/                           the PWA: index.html, app.js, styles.css, sw.js, manifest, fonts, books/
```

### Correcting a word

Open `content/elements/<book>.json`, find the word in its passage, and change its line, e.g.
`["δύο", "γε", "M"]` → `["δύο", "δύο", "M nom f p"]`. The code is the part of speech followed by features, as listed at the top of `content/lexicon.mjs` (for example `V ptc aor pas gen f s`, `N acc f s`, `P +gen`). To give a lemma a better gloss or principal parts, add it to `LEMMAS` in `content/lexicon.mjs`.

Then run `node tools/build.mjs && node tools/bundle.mjs`. The build refuses to write output if a word list doesn't match its text, a code is unknown, or text isn't NFC.

### Sources

Greek text (Heiberg) and English translation (Heath): Perseus Digital Library, canonical-greekLit `tlg1799.tlg001`, CC BY-SA 4.0. Automatic lemmas and tags: G. Celano, LemmatizedAncientGreekXML (CC BY-NC 4.0: non-commercial use only, so replace or re-derive these before any paid release). Glosses: LSJ via Perseus (CC BY-SA 4.0).
