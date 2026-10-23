// Builds dist/stoicheia-reader.html: the whole app in one file (no service worker),
// for sharing as a link. Fonts load from Google Fonts in this version.
//
//   node tools/build.mjs && node tools/bundle.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const read = (f) => readFileSync(new URL('../app/' + f, import.meta.url), 'utf8');
// Every book inline, so the single file works without loading anything else.
const inlineBooks = () => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII']
  .map((b) => '\n  <script>' + read(`books/${b}.js`) + '</script>').join('');
const css = read('styles.css').replace(/@font-face[^\n]*\n/g, '');
const html = read('index.html')
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="icon"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace('<link rel="stylesheet" href="styles.css">',
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gentium+Plus:wght@400;700&display=swap">\n  <style>\n' + css + '</style>')
  .replace('<script src="corpus.js"></script>', () => '<script>' + read('corpus.js') + 'window.STOICHEIA_NO_SW = true;</script>'
    + inlineBooks())
  .replace('<script src="app.js"></script>', () => '<script>' + read('app.js') + '</script>');
// Artifact pages get their own document skeleton and a dark-mode media block for the first frame.
const dark = css.match(/:root\[data-theme="dark"\] \{([^}]*)\}/)[1];
const page = html
  .replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, '')
  .replace(/<\/head>\s*<body>\s*/, '')
  .replace(/\s*<\/body>\s*<\/html>\s*$/, '\n')
  .replace(/\s*<meta charset[^>]*>|\s*<meta name="viewport"[^>]*>/g, '')
  .replace('</style>', `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {${dark}} }\nbody::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 11; background: var(--paper); }\n</style>`);
const titleFirst = page.replace(/^([\s\S]*?)(<title>[^<]*<\/title>\n?)/, '$2$1');
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/stoicheia-reader.html', import.meta.url), html);
writeFileSync(new URL('../dist/artifact.html', import.meta.url), titleFirst);
console.log('dist/stoicheia-reader.html', html.length, 'bytes; dist/artifact.html', titleFirst.length, 'bytes');
