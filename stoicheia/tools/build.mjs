// Content pipeline: content/elements/*.json (all 13 books, automatic first pass)
//                 + content/corpus.mjs and content/lexicon.mjs (hand-checked passages, which win)
//                 -> app/corpus.js (index, lemmas, analyses) and app/books/<book>.js (text, one file per book).
// Tokenizes every paragraph, attaches one analysis per lexical token, and refuses to
// write output if any check fails (spec §14 and §20 "Corpus tests").
//
//   node tools/build.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { WORK, PASSAGES, FIGURES } from '../content/corpus.mjs';
import { LEMMAS, FORMS, POS, WORD, GROUPS, describe } from '../content/lexicon.mjs';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];
const elementsDir = new URL('../content/elements/', import.meta.url);
const GLOSSES = JSON.parse(readFileSync(new URL('glosses.json', elementsDir), 'utf8'));

const errors = [];
const analyses = [];
const analysisIndex = new Map();
const usedLemmas = new Set();

function analysisOf(lemma, code, where) {
  const key = lemma + '|' + code;
  if (analysisIndex.has(key)) return analysisIndex.get(key);
  try { describe(code); } catch (e) { errors.push(`${where}: ${e.message}`); return -1; }
  usedLemmas.add(lemma);
  analyses.push([lemma, code]);
  analysisIndex.set(key, analyses.length - 1);
  return analyses.length - 1;
}

// Hand passages: word#variant looks up lexicon.mjs.
function handAnalysis(surface, variant, where) {
  const keys = variant ? [surface + variant, surface.toLowerCase() + variant] : [surface, surface.toLowerCase()];
  for (const k of keys) {
    const entry = FORMS[k];
    if (!entry) continue;
    if (!LEMMAS[entry[0]]) errors.push(`lemma "${entry[0]}" (form ${k}) missing from LEMMAS`);
    return analysisOf(entry[0], entry[1], where);
  }
  errors.push(`${where}: no analysis for "${keys[0]}"`);
  return -1;
}

// A word: letters and combining marks, optional elision mark, optional #variant.
const TOKEN = /([\p{L}\p{M}]+[’ʼ]?)(#\w+)?/gu;
const isLabel = (w) => /^[Α-Ω]+$/u.test(w);

let tokenCount = 0;
// words: for automatic passages, the [surface, lemma, code] list in reading order (labels excluded).
function tokenize(source, citation, words) {
  if (source.normalize('NFC') !== source) errors.push(`${citation}: text is not NFC`);
  let text = '';
  const spans = [];
  let last = 0;
  let w = 0;
  for (const m of source.matchAll(TOKEN)) {
    text += source.slice(last, m.index);
    const surface = m[1];
    const start = text.length;
    text += surface;
    last = m.index + m[0].length;
    if (isLabel(surface)) {
      if (m[2]) errors.push(`${citation}: label ${surface} has a variant marker`);
      spans.push([start, text.length]);
      continue;
    }
    let a;
    if (words) {
      const entry = words[w++];
      if (!entry || entry[0] !== surface) { errors.push(`${citation}: word ${w} is "${surface}" in the text but "${entry && entry[0]}" in the word list`); continue; }
      a = analysisOf(entry[1], entry[2], citation);
    } else a = handAnalysis(surface, m[2], citation);
    if (a < 0) continue;
    spans.push([start, text.length, a]);
    tokenCount++;
  }
  if (words && w !== words.length) errors.push(`${citation}: word list has ${words.length} words, text has ${w}`);
  text += source.slice(last);
  return { text, spans };
}

const firstWords = (text, n = 4) => text.split(/\s+/).slice(0, n).join(' ').replace(/[.,·;]$/, '') + '…';

function greekNumeral(n) {
  const units = ['', 'α', 'β', 'γ', 'δ', 'ε', 'ϛ', 'ζ', 'η', 'θ'];
  const tens = ['', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ϙ'];
  return (n >= 100 ? 'ρ' : '') + tens[Math.floor(n / 10) % 10] + units[n % 10] + 'ʹ';
}

const hand = Object.fromEntries(PASSAGES.map((p) => [p.id, p]));
const index = [];
const books = [];
mkdirSync(new URL('../app/books/', import.meta.url), { recursive: true });
for (const f of readdirSync(new URL('../app/books/', import.meta.url))) rmSync(new URL('../app/books/' + f, import.meta.url));

for (const [n0, bookId] of ROMAN.entries()) {
  const auto = JSON.parse(readFileSync(new URL(bookId + '.json', elementsDir), 'utf8'));
  const text = {};
  for (const ap of auto) {
    const h = hand[ap.id];
    const base = `euclid.${ap.id}`;
    const paragraphs = [];
    let english = [];
    if (ap.items) {
      ap.items.forEach((item, i) => {
        const cite = `${ap.id}.${i + 1}`;
        const useHand = h && i < h.items.length;
        const t = useHand ? tokenize(h.items[i], cite) : tokenize(item.text, cite, item.words);
        paragraphs.push({ role: 'item', cite, ...t, en: ap.english[i] || null, hand: !!useHand });
      });
    } else {
      const src = h ? [h.enunciation, ...h.paragraphs] : [ap.enunciation, ...ap.paragraphs];
      src.forEach((para, i) => {
        const t = h ? tokenize(para, ap.id) : tokenize(para.text, ap.id, para.words);
        paragraphs.push({ role: i ? 'text' : 'enunciation', ...t, hand: !!h });
      });
      paragraphs[0].en = ap.english[0] || null;
      english = ap.english.slice(1);
    }
    const figure = h && h.figure ? h.figure : null;
    if (figure && !FIGURES[figure]) errors.push(`${ap.id}: figure ${figure} missing`);
    const range = ap.items ? `${ap.id}.1–${ap.id}.${ap.items.length}` : ap.id;
    paragraphs.forEach((p, i) => { p.id = `${base}.p${i}`; });
    text[ap.id] = { paragraphs: paragraphs.map(({ hand: _, ...p }) => p), english };
    index.push({
      id: ap.id, book: bookId, kind: ap.kind, type: (h && h.type) || ap.type || null,
      title: ap.title || ap.id, greekTitle: ap.greekTitle, range, count: ap.items ? ap.items.length : null, figure,
      firstWords: firstWords(paragraphs[0].text), checked: paragraphs.every((p) => p.hand),
    });
  }
  const props = auto.filter((p) => p.kind === 'proposition').length;
  const found = auto.filter((p) => p.kind !== 'proposition').map((p) => p.title.replace(/ \(.*\)$/, '').toLowerCase());
  const summary = [...new Set(found)].join(', ');
  books.push({
    id: bookId, n: n0 + 1, title: `Book ${bookId}`, greekTitle: `Στοιχείων Εὐκλείδου ${greekNumeral(n0 + 1)}`,
    summary: (summary ? summary[0].toUpperCase() + summary.slice(1) + ', ' : '') + `${props} propositions`,
  });
  text.__file = bookId;
  writeFileSync(new URL(`../app/books/${bookId}.js`, import.meta.url),
    `// Generated by tools/build.mjs. Do not edit by hand.\n(window.STOICHEIA_TEXT = window.STOICHEIA_TEXT || {})[${JSON.stringify(bookId)}] = ${JSON.stringify(text)};\n`);
}

for (const id of Object.keys(hand)) if (!index.some((p) => p.id === id)) errors.push(`hand passage ${id} has no place in the Elements`);
const ids = index.map((p) => p.id);
if (new Set(ids).size !== ids.length) errors.push('duplicate passage citation');

if (errors.length) {
  console.error(`Build failed with ${errors.length} problem(s):\n  ` + errors.slice(0, 50).join('\n  '));
  process.exit(1);
}

const lemmas = {};
for (const l of [...usedLemmas].sort()) {
  const h = LEMMAS[l] || {};
  const gloss = h.gloss || GLOSSES[l];
  lemmas[l] = { ...(gloss ? { gloss } : {}), ...(h.pp ? { pp: h.pp } : {}) };
}

const out = {
  version: 2,
  work: WORK, books, figures: FIGURES, passages: index,
  lemmas, analyses, labels: { POS, WORD, GROUPS },
};
writeFileSync(new URL('../app/corpus.js', import.meta.url), `// Generated by tools/build.mjs. Do not edit by hand.\nwindow.STOICHEIA = ${JSON.stringify(out)};\n`);
console.log(`OK: ${books.length} books, ${index.length} passages, ${tokenCount} analysed tokens, ${analyses.length} distinct analyses, ${usedLemmas.size} lemmas`);
