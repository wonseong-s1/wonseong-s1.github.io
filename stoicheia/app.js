// Stoicheia Reader: a web prototype of the Android UI spec.
// Routes: #/ (Books), #/book/I (Contents), #/read/I.1[?p=3] (Reader), #/figure/I.1 (Figure view).
// The morphology sheet, settings, menus and citation jump are overlays, never routes.
(() => {
  'use strict';
  const C = window.STOICHEIA;
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $('#app');
  const passageById = Object.fromEntries(C.passages.map((p) => [p.id, p]));
  const order = C.passages.map((p) => p.id);
  const tokenIndex = {};
  for (const p of C.passages) for (const para of p.paragraphs) for (const sp of para.spans) if (sp.id) tokenIndex[sp.id] = { p, para, sp };

  // ---------- storage (per-viewer only; the app works without it) ----------
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem('stoicheia.' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem('stoicheia.' + key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
  };
  const DEFAULTS = { size: 22, spacing: 'normal', theme: 'system', gloss: false, principalParts: true, contrast: 'normal', awake: false };
  let settings = { ...DEFAULTS, ...store.get('settings', {}) };
  let bookmarks = store.get('bookmarks', []);
  let position = store.get('position', null); // { passage, para, offset, pct }

  // ---------- icons ----------
  const ICON = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    more: '<circle cx="12" cy="5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/>',
    jump: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    star: '<path d="M12 3.6l2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16.6l-5.1 2.8 1.1-5.8-4.3-4 5.8-.7z"/>',
    figure: '<circle cx="9" cy="13" r="5.5"/><circle cx="15" cy="13" r="5.5"/>',
  };
  const icon = (name, label, attrs = '') =>
    `<button class="icon" aria-label="${label}" title="${label}" ${attrs}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg></button>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  // ---------- settings application ----------
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const hostTheme = document.documentElement.dataset.theme; // set by an embedding viewer, if any
  function applySettings() {
    const root = document.documentElement;
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && (hostTheme ? hostTheme === 'dark' : darkQuery.matches));
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.contrast = settings.contrast;
    root.style.setProperty('--text-size', settings.size + 'px');
    root.style.setProperty('--line', { compact: 1.4, normal: 1.55, relaxed: 1.75 }[settings.spacing]);
    $('meta[name=theme-color]').content = dark ? '#1D1C19' : '#F7F4EC';
    keepAwake(settings.awake);
  }
  darkQuery.addEventListener('change', applySettings);
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch { /* not supported or not allowed */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && settings.awake) keepAwake(true); });
  function saveSettings(patch) {
    const anchor = currentRoute.name === 'read' ? readAnchor() : null;
    settings = { ...settings, ...patch };
    store.set('settings', settings);
    applySettings();
    if (anchor) restoreAnchor(anchor); // a font change must not lose the reading place
    if (selected) renderMorph(false);
  }

  // ---------- routing ----------
  let currentRoute = { name: null };
  let routeKey = '';
  const listScroll = {};
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, query] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    const params = new URLSearchParams(query || '');
    if (parts[0] === 'book' && parts[1]) return { name: 'book', book: decodeURIComponent(parts[1]) };
    if (parts[0] === 'read' && passageById[decodeURIComponent(parts[1])]) return { name: 'read', passage: decodeURIComponent(parts[1]), item: params.get('p') };
    if (parts[0] === 'figure' && passageById[decodeURIComponent(parts[1])]) return { name: 'figure', passage: decodeURIComponent(parts[1]) };
    return { name: 'books' };
  }
  function go(hash, { replace = false } = {}) {
    const prev = location.hash || '#/';
    if (replace) history.replaceState({ prev: history.state && history.state.prev }, '', hash);
    else history.pushState({ prev }, '', hash);
    route(false);
  }
  let lastDepth = 0;
  const depthOf = (r) => ({ books: 0, book: 1, read: 2, figure: 3 })[r.name];
  function route(isPop) {
    const r = parseHash();
    const key = location.hash || '#/';
    if (key === routeKey && r.name === currentRoute.name) {
      // Same screen: only an overlay changed (e.g. Back closed the sheet).
      if (!(history.state && history.state.sheet) && selected) closeSheet(true);
      return;
    }
    if (currentRoute.name === 'read') savePosition();
    if (currentRoute.name === 'book') listScroll[routeKey] = scrollY;
    closeAllOverlays();
    const backward = depthOf(r) < lastDepth;
    lastDepth = depthOf(r);
    const prev = currentRoute;
    currentRoute = r;
    routeKey = key;
    if (r.name === 'books') renderBooks(backward);
    else if (r.name === 'book') renderContents(r.book, backward);
    else if (r.name === 'read') renderReader(r, backward, isPop, prev);
    else if (r.name === 'figure') renderFigure(r.passage);
  }
  addEventListener('popstate', () => route(true));
  addEventListener('hashchange', () => route(true));

  // ---------- Books ----------
  function renderBooks(backward) {
    const hint = !store.get('hintSeen', false);
    const cont = position && passageById[position.passage];
    const contText = cont ? firstWordsAt(cont, position.para) : '';
    const marks = bookmarks.filter((id) => passageById[id]);
    app.innerHTML = `
      <header class="bar"><div class="title left">Στοιχεῖα</div>${icon('more', 'More', 'data-act="books-menu"')}</header>
      <main class="screen ${backward ? 'back' : ''}">
        <div class="lib-head"><div class="greek">${esc(C.work.title)}</div><div class="meta">Greek text · offline</div></div>
        ${cont ? `<button class="card" data-act="continue">
            <div class="row1"><span class="label">CONTINUE READING</span><span class="meta">${position.pct || 0}%</span></div>
            <div class="cite">${esc(citeOf(cont, position.para))}</div>
            <div class="greek">${esc(contText)}</div></button>` : ''}
        ${hint ? `<div class="hint" role="note"><span>Tap any Greek word to parse it.</span><button class="textbtn" data-act="hint-ok">OK</button></div>` : ''}
        <div class="section">Books</div>
        <ul class="list">${C.books.map((b) => `<li><button class="rowbtn" data-go="#/book/${b.id}">
            <span class="main"><span class="primary">${esc(b.title)}</span><div class="secondary">${esc(b.summary)}</div></span><span class="chev">›</span></button></li>`).join('')}</ul>
        <div class="planned">More books planned</div>
        ${marks.length ? `<div class="section">Bookmarks</div><ul class="list">${marks.map((id) => `<li><button class="rowbtn" data-go="#/read/${id}">
            <span class="main"><span class="primary">${esc(passageLabel(passageById[id]))}</span><div class="secondary greek">${esc(passageById[id].firstWords)}</div></span><span class="chev">›</span></button></li>`).join('')}</ul>` : ''}
      </main>`;
    scrollTo(0, 0);
    document.title = 'Στοιχεῖα Reader';
  }

  // ---------- Book contents ----------
  function renderContents(bookId, backward) {
    const book = C.books.find((b) => b.id === bookId) || C.books[0];
    const ps = C.passages.filter((p) => p.book === book.id);
    const last = position && position.passage;
    const row = (p, primary, secondary, greek) => `<li><button class="rowbtn ${p.id === last ? 'last' : ''}" data-go="#/read/${p.id}">
        <span class="main"><span class="primary">${esc(primary)}</span><div class="secondary ${greek ? 'greek' : ''}">${esc(secondary)}</div></span>
        ${p.figure ? `<svg class="figmark" viewBox="0 0 24 24" aria-label="Has diagram"><g fill="none" stroke="currentColor" stroke-width="1.6">${ICON.figure}</g></svg>` : '<span class="chev">›</span>'}</button></li>`;
    const found = ps.filter((p) => p.kind !== 'proposition');
    const props = ps.filter((p) => p.kind === 'proposition');
    app.innerHTML = `
      <header class="bar">${icon('back', 'Back', 'data-act="back"')}<div class="title">${esc(book.title)}</div>${icon('jump', 'Jump to citation', 'data-act="jump"')}</header>
      <main class="screen ${backward ? 'back' : ''}">
        <div class="contents-head"><h1>${esc(book.title)}</h1><div class="greek">${esc(book.greekTitle)}</div></div>
        <div class="section">Foundations</div>
        <ul class="list">${found.map((p) => row(p, p.title, p.range + (p.planned ? ` · ${p.planned}` : ''))).join('')}</ul>
        <div class="section">Propositions</div>
        <ul class="list">${props.map((p) => row(p, `${p.id} · ${p.type}`, p.firstWords, true)).join('')}</ul>
        <div class="planned">${esc(C.planned.propositions)}</div>
      </main>`;
    scrollTo(0, listScroll['#/book/' + book.id] || 0);
    document.title = book.title + ' · Στοιχεῖα';
  }

  // ---------- Reader ----------
  const passageLabel = (p) => (p.kind === 'proposition' ? `${p.id} · ${p.type}` : `${p.title} · ${p.id}`);
  function citeOf(p, paraIdx) {
    if (p.kind === 'proposition') return p.id;
    const para = p.paragraphs[paraIdx || 0];
    return para && para.cite ? para.cite : p.id;
  }
  function firstWordsAt(p, paraIdx) {
    const para = p.paragraphs[paraIdx || 0] || p.paragraphs[0];
    return para.text.split(/\s+/).slice(0, 5).join(' ') + '…';
  }
  function paragraphHTML(para) {
    let out = '';
    let i = 0;
    for (const sp of para.spans) {
      out += esc(para.text.slice(i, sp.s));
      const s = esc(para.text.slice(sp.s, sp.e));
      out += sp.id ? `<span class="w" data-t="${sp.id}">${s}</span>` : `<span class="lbl">${s}</span>`;
      i = sp.e;
    }
    return out + esc(para.text.slice(i));
  }
  function renderReader(r, backward, isPop, prev) {
    const p = passageById[r.passage];
    const idx = order.indexOf(p.id);
    const prevP = passageById[order[idx - 1]];
    const nextP = passageById[order[idx + 1]];
    const marked = bookmarks.includes(p.id);
    const fig = p.figure ? `<button class="figure-inline in-text" data-act="figure" aria-label="Open diagram for ${p.id}">${figureSVG(C.figures[p.figure])}</button>` : '';
    let body = '';
    for (const [i, para] of p.paragraphs.entries()) {
      if (para.role === 'item') body += `<div class="item" id="${para.id}" data-i="${i}"><span class="icite">${para.cite}</span><span class="ptext">${paragraphHTML(para)}</span></div>`;
      else body += `<p id="${para.id}" data-i="${i}" class="${para.role === 'enunciation' ? 'enun' : ''}">${paragraphHTML(para)}</p>`;
      if (para.role === 'enunciation') body += fig;
    }
    const label = `${p.greekTitle.toUpperCase()} · ${p.id}`;
    app.innerHTML = `
      <header class="bar" id="rbar">${icon('back', 'Back to contents', 'data-act="back"')}<div class="title">${esc(p.id)}</div>
        <button class="icon ${marked ? 'on' : ''}" data-act="bookmark" aria-pressed="${marked}" aria-label="${marked ? 'Remove bookmark' : 'Bookmark'}" title="Bookmark"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON.star}</svg></button>
        ${icon('more', 'More', 'data-act="reader-menu"')}</header>
      <main class="screen reader reader-wide ${backward ? 'back' : ''}">
        <article>
          <div class="plabel">${esc(label)}</div>
          <div class="text" lang="grc" id="text">${body}</div>
          <nav class="pnav" aria-label="Passages">
            ${prevP ? `<button data-go="#/read/${prevP.id}">‹ ${esc(prevP.kind === 'proposition' ? prevP.id : prevP.paragraphs.at(-1).cite)}</button>` : '<span></span>'}
            ${nextP ? `<button data-go="#/read/${nextP.id}">${esc(nextP.id)} ›</button>` : `<span class="later">${esc(C.planned.next)}</span>`}
          </nav>
        </article>
        <aside class="side">${p.figure ? `<button class="figure-inline" data-act="figure" aria-label="Open diagram">${figureSVG(C.figures[p.figure])}</button>` : ''}<div id="side-morph"></div></aside>
      </main>`;
    document.title = `${p.id} · Στοιχεῖα`;
    store.set('hintSeen', true);
    // Where to land: an explicit item, the saved anchor for this passage, or the top.
    const saved = position && position.passage === p.id ? position : null;
    if (r.item) {
      const el = document.getElementById(`euclid.${p.id}.p${Number(r.item) - 1}`);
      requestAnimationFrame(() => { if (el) scrollTo(0, el.getBoundingClientRect().top + scrollY - 64); });
    } else if (saved && (isPop || prev.name !== 'read' || prev.passage === p.id)) {
      restoreAnchor(saved);
    } else scrollTo(0, 0);
    savePosition();
  }

  // Reading position = paragraph + character offset of the first visible character.
  function readAnchor() {
    const text = $('#text');
    if (!text) return null;
    const y = 64;
    const paras = [...text.querySelectorAll('[data-i]')];
    const para = paras.find((el) => el.getBoundingClientRect().bottom > y) || paras.at(-1);
    if (!para) return null;
    let offset = 0;
    const rect = para.getBoundingClientRect();
    if (rect.top < y) {
      // First word whose line is still visible below the app bar (no hit-testing, so overlays don't interfere).
      const words = [...para.querySelectorAll('.w, .lbl')];
      const first = words.find((w) => w.getBoundingClientRect().bottom > y);
      if (first) offset = textOffset(para, first.firstChild, 0);
    }
    const max = document.documentElement.scrollHeight - innerHeight;
    return { passage: currentRoute.passage, para: Number(para.dataset.i), offset, pct: max > 0 ? Math.round((scrollY / max) * 100) : 100 };
  }
  function paraTextRoot(para) { return para.querySelector('.ptext') || para; }
  function textOffset(para, node, off) {
    const root = paraTextRoot(para);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n = 0;
    while (walker.nextNode()) {
      if (walker.currentNode === node) return n + off;
      n += walker.currentNode.length;
    }
    return 0;
  }
  function restoreAnchor(a) {
    const para = document.querySelector(`#text [data-i="${a.para}"]`);
    if (!para) return;
    const doIt = () => {
      let top = para.getBoundingClientRect().top;
      if (a.offset > 0) {
        const walker = document.createTreeWalker(paraTextRoot(para), NodeFilter.SHOW_TEXT);
        let n = 0;
        while (walker.nextNode()) {
          const len = walker.currentNode.length;
          if (n + len > a.offset) {
            const range = document.createRange();
            range.setStart(walker.currentNode, a.offset - n);
            range.setEnd(walker.currentNode, Math.min(len, a.offset - n + 1));
            const rr = range.getBoundingClientRect();
            if (rr.height) top = rr.top;
            break;
          }
          n += len;
        }
      }
      scrollTo(0, Math.max(0, top + scrollY - 64));
    };
    doIt();
    document.fonts && document.fonts.ready.then(() => { if (currentRoute.name === 'read') doIt(); });
  }
  function savePosition() {
    if (currentRoute.name !== 'read') return;
    const a = readAnchor();
    if (a) { position = a; store.set('position', a); }
  }
  let saveTimer = 0;
  let lastY = 0;
  addEventListener('scroll', () => {
    const bar = $('.bar');
    if (bar) bar.classList.toggle('scrolled', scrollY > 4);
    if (currentRoute.name === 'read') {
      const rbar = $('#rbar');
      const dy = scrollY - lastY;
      if (rbar && Math.abs(dy) > 6) rbar.classList.toggle('hidden', dy > 0 && scrollY > 120);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(savePosition, 700);
    }
    lastY = scrollY;
  }, { passive: true });
  addEventListener('pagehide', savePosition);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePosition(); });

  // ---------- Morphology sheet ----------
  let selected = null; // token id
  let expanded = false;
  const isWide = () => matchMedia('(min-width: 960px)').matches;
  function selectToken(id) {
    const wasOpen = !!selected;
    document.querySelectorAll('.w.sel').forEach((el) => el.classList.remove('sel'));
    selected = id;
    const el = document.querySelector(`.w[data-t="${CSS.escape(id)}"]`);
    if (el) el.classList.add('sel');
    if (!wasOpen && !isWide()) history.pushState({ sheet: true, prev: history.state && history.state.prev }, '', location.href);
    renderMorph(wasOpen);
  }
  function morphHTML() {
    const { p, para, sp } = tokenIndex[selected];
    const a = C.analyses[sp.a];
    const lemma = C.lemmas[a.lemma] || {};
    const surface = para.text.slice(sp.s, sp.e);
    const showMore = expanded || isWide();
    return `<div class="morph" aria-live="polite">
      <div class="head"><span class="surface" lang="grc">${esc(surface)}</span><span class="cite">${esc(citeOf(p, p.paragraphs.indexOf(para)))}</span></div>
      <div class="lemma" lang="grc">${esc(a.lemma)}</div>
      <div class="parse"><div>${esc(a.line1)}</div>${a.line2 ? `<div>${esc(a.line2)}</div>` : ''}</div>
      ${settings.gloss && lemma.gloss ? `<div class="gloss"><b>Gloss</b>${esc(lemma.gloss)}</div>` : ''}
      ${showMore ? `<div class="more">
          ${settings.principalParts && lemma.pp ? `<h3>Principal parts</h3><p lang="grc">${esc(lemma.pp)}</p>` : ''}
          <h3>In this passage</h3><p class="src">Analysis chosen for this occurrence. Source: prototype hand annotation, not yet scholar-reviewed.</p></div>` : ''}
      <div class="actions">
        ${!isWide() && !expanded && lemma.pp && settings.principalParts ? '<button class="textbtn" data-act="expand">PRINCIPAL PARTS</button>' : ''}
        <button class="textbtn" data-act="copy-token">COPY</button>
        <button class="textbtn" data-act="toggle-gloss">${settings.gloss ? 'HIDE GLOSS' : 'SHOW GLOSS'}</button>
      </div></div>`;
  }
  function renderMorph(replace) {
    if (!selected) return;
    const html = morphHTML();
    if (isWide()) {
      const side = $('#side-morph');
      if (side) { side.innerHTML = html; if (replace) side.firstElementChild.classList.add('crossfade'); }
      return;
    }
    let sheet = $('#morph-sheet');
    if (!sheet) {
      sheet = document.createElement('section');
      sheet.id = 'morph-sheet';
      sheet.className = 'sheet entering';
      sheet.setAttribute('aria-label', 'Word analysis');
      document.body.appendChild(sheet);
      requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.remove('entering')));
      attachDrag(sheet, () => { expanded = true; renderMorph(true); }, () => closeSheet());
      $('.reader') && $('.reader').classList.add('sheet-pad');
    }
    sheet.innerHTML = '<span class="handle" aria-hidden="true"></span>' + html;
    if (replace) sheet.querySelector('.morph').classList.add('crossfade');
    requestAnimationFrame(keepSelectionVisible);
  }
  // The sheet must never cover the selected word: scroll the minimum needed.
  function keepSelectionVisible() {
    const el = document.querySelector('.w.sel');
    const sheet = $('#morph-sheet');
    if (!el || !sheet) return;
    const r = el.getBoundingClientRect();
    const limit = innerHeight - sheet.offsetHeight - 16;
    if (r.bottom > limit) scrollBy({ top: r.bottom - limit, behavior: 'smooth' });
    else if (r.top < 64) scrollBy({ top: r.top - 72, behavior: 'smooth' });
  }
  function closeSheet(fromPop = false) {
    if (!selected) return;
    selected = null;
    expanded = false;
    document.querySelectorAll('.w.sel').forEach((el) => el.classList.remove('sel'));
    const sheet = $('#morph-sheet');
    if (sheet) { sheet.classList.add('entering'); setTimeout(() => sheet.remove(), 200); }
    const side = $('#side-morph');
    if (side) side.innerHTML = '';
    $('.reader') && $('.reader').classList.remove('sheet-pad');
    if (!fromPop && history.state && history.state.sheet) history.back();
  }
  function attachDrag(sheet, onUp, onDown) {
    let startY = null;
    let dy = 0;
    sheet.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.handle') && sheet.scrollTop > 0) return;
      if (e.target.closest('button')) return;
      startY = e.clientY; dy = 0;
    });
    sheet.addEventListener('pointermove', (e) => {
      if (startY == null) return;
      dy = e.clientY - startY;
      if (dy > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`; }
    });
    const end = () => {
      if (startY == null) return;
      sheet.style.transition = ''; sheet.style.transform = '';
      if (dy > 70) onDown(); else if (dy < -40) onUp();
      startY = null;
    };
    sheet.addEventListener('pointerup', end);
    sheet.addEventListener('pointercancel', end);
  }

  // ---------- Figures (data-driven SVG, spec §9) ----------
  function figureSVG(fig) {
    const pts = fig.points;
    const circles = fig.circles.map((c) => {
      const [cx, cy] = pts[c.center];
      const [tx, ty] = pts[c.through];
      return { cx, cy, r: Math.hypot(tx - cx, ty - cy) };
    });
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    const grow = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
    Object.values(pts).forEach(([x, y]) => grow(x, y));
    circles.forEach((c) => { grow(c.cx - c.r, c.cy - c.r); grow(c.cx + c.r, c.cy + c.r); });
    const m = 0.22;
    const S = 100; // units -> svg px
    const X = (x) => ((x - minX + m) * S).toFixed(1);
    const Y = (y) => ((maxY - y + m) * S).toFixed(1);
    const w = (maxX - minX + 2 * m) * S;
    const h = (maxY - minY + 2 * m) * S;
    let out = `<svg viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" role="img" aria-label="Diagram with points ${Object.keys(pts).join(', ')}">`;
    circles.forEach((c) => { out += `<circle class="fig-line" cx="${X(c.cx)}" cy="${Y(c.cy)}" r="${(c.r * S).toFixed(1)}"/>`; });
    fig.segments.forEach(([a, b]) => { out += `<line class="fig-line" x1="${X(pts[a][0])}" y1="${Y(pts[a][1])}" x2="${X(pts[b][0])}" y2="${Y(pts[b][1])}"/>`; });
    Object.entries(fig.labels).forEach(([name, [dx, dy]]) => {
      const [x, y] = pts[name];
      out += `<text class="fig-label" x="${X(x + dx)}" y="${Y(y + dy)}" font-size="24" text-anchor="middle" dominant-baseline="central">${name}</text>`;
    });
    return out + '</svg>';
  }
  function renderFigure(passageId) {
    const p = passageById[passageId];
    app.innerHTML = `<div class="figview" role="dialog" aria-label="${p.id} figure">
        <header class="bar">${icon('back', 'Back to text', 'data-act="back"')}<div class="title">${p.id} Figure</div><button class="textbtn" data-act="fig-reset">Reset</button></header>
        <div class="figstage" id="stage">${figureSVG(C.figures[p.figure])}</div></div>`;
    setupZoom($('#stage'));
  }
  let zoomReset = null;
  function setupZoom(stage) {
    const svg = stage.querySelector('svg');
    let s = 1, tx = 0, ty = 0;
    const apply = (anim) => {
      svg.style.transition = anim ? 'transform 180ms ease' : 'none';
      svg.style.transform = `translate(${tx}px, ${ty}px) scale(${s}) translate(-50%, -50%)`;
    };
    const zoomAt = (ns, cx, cy, anim) => {
      ns = Math.min(6, Math.max(1, ns));
      const r = stage.getBoundingClientRect();
      const ox = cx - r.left - r.width / 2;
      const oy = cy - r.top - r.height / 2;
      tx = ox - ((ox - tx) * ns) / s;
      ty = oy - ((oy - ty) * ns) / s;
      s = ns;
      if (s === 1) { tx = 0; ty = 0; }
      apply(anim);
    };
    svg.style.left = '50%'; svg.style.top = '50%';
    // Use translate on centre: position the svg's centre at stage centre.
    svg.style.left = '0'; svg.style.top = '0';
    const centre = () => { const r = stage.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
    const base = () => { const [cx, cy] = centre(); svg.style.left = cx + 'px'; svg.style.top = cy + 'px'; };
    base();
    addEventListener('resize', base);
    zoomReset = () => { s = 1; tx = 0; ty = 0; apply(true); };
    apply(false);
    const pointers = new Map();
    let pinch = null;
    let lastTap = 0;
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2) {
        const [[x1, y1], [x2, y2]] = [...pointers.values()];
        pinch = { d: Math.hypot(x2 - x1, y2 - y1), s, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
      }
      const now = Date.now();
      if (pointers.size === 1 && now - lastTap < 300) zoomAt(s > 1.5 ? 1 : 2, e.clientX, e.clientY, true);
      lastTap = now;
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const [px, py] = pointers.get(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size === 2 && pinch) {
        const [[x1, y1], [x2, y2]] = [...pointers.values()];
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        zoomAt((pinch.s * Math.hypot(x2 - x1, y2 - y1)) / pinch.d, mx, my, false);
        tx += mx - pinch.mx; ty += my - pinch.my; pinch.mx = mx; pinch.my = my;
        apply(false);
      } else if (pointers.size === 1 && s > 1) {
        tx += e.clientX - px; ty += e.clientY - py; apply(false);
      }
    });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(s * Math.exp(-e.deltaY / 300), e.clientX, e.clientY, false); }, { passive: false });
  }

  // ---------- overlays: menus, settings, about, jump ----------
  function closeAllOverlays() {
    document.querySelectorAll('.overlay').forEach((el) => el.remove());
    const sheet = $('#morph-sheet');
    if (sheet) sheet.remove();
    selected = null; expanded = false;
  }
  function overlay(html) {
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  }
  function closeOverlay(el) { if (el) el.remove(); }
  function openMenu(items) {
    const el = overlay(`<div class="menu-scrim" data-act="close-overlay"></div><div class="menu" role="menu">${items.map(([label, act]) => `<button role="menuitem" data-act="${act}">${label}</button>`).join('')}</div>`);
    el.querySelector('.menu button').focus();
  }
  function openSheet(html, label) {
    const el = overlay(`<div class="scrim" data-act="close-overlay"></div><section class="sheet entering" aria-label="${label}"><span class="handle" aria-hidden="true"></span>${html}</section>`);
    const sheet = el.querySelector('.sheet');
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.remove('entering')));
    attachDrag(sheet, () => {}, () => closeOverlay(el));
    return el;
  }
  function settingsHTML() {
    const seg = (key, opts) => `<span class="seg" role="group">${opts.map(([v, l]) => `<button data-set="${key}" data-val="${v}" aria-pressed="${settings[key] === v}">${l}</button>`).join('')}</span>`;
    const sw = (key, label) => `<div class="setting"><span class="name" id="lbl-${key}">${label}</span><button class="switch" role="switch" aria-labelledby="lbl-${key}" aria-checked="${!!settings[key]}" data-toggle="${key}"></button></div>`;
    return `<div class="settings">
      <h2>Reading</h2>
      <div class="setting"><label for="size">Text size <span class="meta">${settings.size}</span></label><input id="size" type="range" min="18" max="30" step="1" value="${settings.size}"></div>
      <div class="setting"><span class="name">Line spacing</span>${seg('spacing', [['compact', 'Compact'], ['normal', 'Normal'], ['relaxed', 'Relaxed']])}</div>
      <div class="setting"><span class="name">Theme</span>${seg('theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])}</div>
      ${sw('awake', 'Keep screen awake')}
      <h2>Morphology</h2>
      ${sw('gloss', 'Show brief gloss')}
      ${sw('principalParts', 'Show principal parts')}
      <div class="setting"><span class="name">Selection highlight</span>${seg('contrast', [['normal', 'Paper'], ['high', 'High contrast']])}</div>
    </div>`;
  }
  let settingsEl = null;
  function openSettings() {
    settingsEl = openSheet(settingsHTML(), 'Settings');
    bindSettings();
  }
  function bindSettings() {
    const range = settingsEl.querySelector('#size');
    range.addEventListener('input', () => { saveSettings({ size: Number(range.value) }); range.previousElementSibling.querySelector('.meta').textContent = range.value; });
  }
  function refreshSettings() {
    if (!settingsEl) return;
    const sheet = settingsEl.querySelector('.sheet');
    sheet.innerHTML = '<span class="handle" aria-hidden="true"></span>' + settingsHTML();
    bindSettings();
  }
  function openAbout() {
    openSheet(`<div class="about">
      <h2 class="section" style="margin-top:4px">About</h2>
      <p>Stoicheia Reader: read Euclid in Greek, tap a form to see its lemma and grammatical analysis. Prototype build: Book I definitions 1–5, postulates, common notions and Proposition 1.</p>
      <h2 class="section">Text attribution</h2>
      <p class="greek">Euclid, Elements, Heiberg edition.</p>
      <p>The prototype text was typed following the Heiberg tradition and must be replaced by the Perseus Digital Library canonical Greek TEI (urn:cts:greekLit:tlg1799.tlg001, CC BY-SA 4.0) before release. Token annotations by the Stoicheia Reader project.</p>
      <p>Diagrams: original vector reconstructions by the Stoicheia Reader project.</p>
      <h2 class="section">Font</h2>
      <p>Gentium Plus © SIL International, licensed under the SIL Open Font License 1.1.</p>
      <button class="textbtn" data-act="copy-attribution">COPY ATTRIBUTION</button>
    </div>`, 'About');
  }
  function openJump() {
    const el = overlay(`<div class="dialog-wrap" data-act="close-dialog"><form class="dialog" role="dialog" aria-label="Jump to citation">
        <h2>Jump to citation</h2>
        <div class="fields">
          <select aria-label="Book" id="j-book">${C.books.map((b) => `<option value="${b.id}">Book ${b.id}</option>`).join('')}</select>
          <select aria-label="Type" id="j-type"><option value="">Proposition</option><option value="Def">Definition</option><option value="Post">Postulate</option><option value="CN">Common notion</option></select>
          <input aria-label="Number" id="j-num" inputmode="numeric" value="1">
        </div>
        <input class="typed" id="j-text" placeholder="or type I.1, I.Def.4, I.Post.3" aria-label="Citation" autocomplete="off">
        <div class="err" id="j-err" role="alert"></div>
        <div class="btns"><button type="button" class="textbtn" data-act="close-dialog">Cancel</button><button class="primary-btn" id="j-go">Go to I.1</button></div>
      </form></div>`);
    const f = el.querySelector('form');
    const fields = () => `${f.querySelector('#j-book').value}.${f.querySelector('#j-type').value ? f.querySelector('#j-type').value + '.' : ''}${f.querySelector('#j-num').value.trim()}`;
    const target = () => f.querySelector('#j-text').value.trim() || fields();
    const sync = () => { f.querySelector('#j-go').textContent = 'Go to ' + target(); f.querySelector('#j-err').textContent = ''; };
    f.addEventListener('input', sync);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const hash = resolveCitation(target());
      if (!hash) { f.querySelector('#j-err').textContent = `${target()} is not in this preview yet.`; return; }
      el.remove();
      go(hash);
    });
    f.querySelector('#j-text').focus();
  }
  function resolveCitation(text) {
    const t = text.replace(/\s+/g, '').replace(/^1\./, 'I.').replace(/^i\./i, 'I.');
    let m = t.match(/^I\.(\d+)$/);
    if (m) return passageById[`I.${m[1]}`] ? `#/read/I.${m[1]}` : null;
    m = t.match(/^I\.(def|post|cn)\.?(\d+)$/i);
    if (m) {
      const kind = { def: 'Def', post: 'Post', cn: 'CN' }[m[1].toLowerCase()];
      const p = passageById[`I.${kind}`];
      const n = Number(m[2]);
      return p && n >= 1 && n <= p.paragraphs.length ? `#/read/I.${kind}?p=${n}` : null;
    }
    return null;
  }

  // ---------- copy ----------
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove();
    }
    toast('Copied');
  }
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1600);
  }

  // ---------- events ----------
  function back() {
    const r = currentRoute;
    // Back always goes up the hierarchy, even when the page was opened directly.
    const up = r.name === 'figure' ? `#/read/${r.passage}` : r.name === 'read' ? `#/book/${passageById[r.passage].book}` : '#/';
    const st = history.state || {};
    if (st.sheet) closeSheet(true);
    if (st.prev === up) history.go(st.sheet ? -2 : -1);
    else go(up, { replace: !!st.sheet });
  }
  document.addEventListener('click', (e) => {
    const goEl = e.target.closest('[data-go]');
    if (goEl) { go(goEl.dataset.go); return; }
    const w = e.target.closest('.w');
    if (w) { selectToken(w.dataset.t); return; }
    const setBtn = e.target.closest('[data-set]');
    if (setBtn) { saveSettings({ [setBtn.dataset.set]: setBtn.dataset.val }); refreshSettings(); return; }
    const tog = e.target.closest('[data-toggle]');
    if (tog) { saveSettings({ [tog.dataset.toggle]: !settings[tog.dataset.toggle] }); refreshSettings(); return; }
    const act = e.target.closest('[data-act]');
    const a = act && act.dataset.act;
    const ov = e.target.closest('.overlay');
    switch (a) {
      case 'back': back(); return;
      case 'continue': if (position) go(`#/read/${position.passage}`); return;
      case 'hint-ok': store.set('hintSeen', true); act.closest('.hint').remove(); return;
      case 'books-menu': openMenu([['Settings', 'settings'], ['Attribution &amp; About', 'about']]); return;
      case 'reader-menu': openMenu([['Jump to citation', 'jump'], ['Copy citation', 'copy-cite'], ['Copy passage', 'copy-passage'], ['Settings', 'settings'], ['About', 'about']]); return;
      case 'settings': closeOverlay(ov); openSettings(); return;
      case 'about': closeOverlay(ov); openAbout(); return;
      case 'jump': closeOverlay(ov); openJump(); return;
      case 'copy-cite': closeOverlay(ov); copy(`Euclid, Elements ${currentRoute.passage}`); return;
      case 'copy-passage': {
        closeOverlay(ov);
        const p = passageById[currentRoute.passage];
        copy(p.paragraphs.map((x) => (x.cite ? x.cite + ' ' : '') + x.text).join('\n\n') + `\n\n(Euclid, Elements ${p.id})`);
        return;
      }
      case 'copy-attribution': copy('Greek text: Euclid, Elements, Heiberg edition, digital transcription derived from Perseus Digital Library canonical Greek resources, used under CC BY-SA 4.0. Modifications and token annotations by the Stoicheia Reader project.'); return;
      case 'close-overlay': closeOverlay(ov); settingsEl = null; return;
      case 'close-dialog': if (e.target === act || act.tagName === 'BUTTON') closeOverlay(ov); return;
      case 'bookmark': {
        const id = currentRoute.passage;
        bookmarks = bookmarks.includes(id) ? bookmarks.filter((x) => x !== id) : [...bookmarks, id];
        store.set('bookmarks', bookmarks);
        const on = bookmarks.includes(id);
        act.classList.toggle('on', on); act.setAttribute('aria-pressed', on); act.setAttribute('aria-label', on ? 'Remove bookmark' : 'Bookmark');
        toast(on ? `Bookmarked ${id}` : 'Bookmark removed');
        return;
      }
      case 'figure': savePosition(); go(`#/figure/${currentRoute.passage}`); return;
      case 'fig-reset': zoomReset && zoomReset(); return;
      case 'expand': expanded = true; renderMorph(true); return;
      case 'toggle-gloss': saveSettings({ gloss: !settings.gloss }); return;
      case 'copy-token': {
        const { para, sp } = tokenIndex[selected];
        const an = C.analyses[sp.a];
        copy(`${para.text.slice(sp.s, sp.e)} - ${an.lemma} - ${an.flat}`);
        return;
      }
      default:
    }
    // Tapping empty paper closes the sheet.
    if (selected && !e.target.closest('#morph-sheet, .side, .bar, .overlay')) closeSheet();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); if (!$('.dialog')) openJump(); return; }
    if (e.key === 'Escape') {
      const ov = document.querySelector('.overlay');
      if (ov) { ov.remove(); settingsEl = null; return; }
      if (selected) { closeSheet(); return; }
      if (currentRoute.name === 'figure') { back(); return; }
    }
    if (currentRoute.name === 'read' && !document.querySelector('.overlay') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      const i = order.indexOf(currentRoute.passage);
      if (e.key === 'ArrowLeft' && order[i - 1]) go(`#/read/${order[i - 1]}`);
      if (e.key === 'ArrowRight' && order[i + 1]) go(`#/read/${order[i + 1]}`);
    }
  });
  matchMedia('(min-width: 960px)').addEventListener('change', () => {
    if (!selected) return;
    const keep = selected;
    const sheet = $('#morph-sheet'); if (sheet) sheet.remove();
    const side = $('#side-morph'); if (side) side.innerHTML = '';
    selected = keep;
    renderMorph(false);
  });

  // ---------- launch ----------
  applySettings();
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    if (position && passageById[position.passage]) {
      // Returning reader: open at the saved place, with Back leading to Book Contents.
      const up = `#/book/${passageById[position.passage].book}`;
      history.replaceState({}, '', '#/');
      history.pushState({ prev: '#/' }, '', up);
      history.pushState({ prev: up }, '', `#/read/${position.passage}`);
      lastDepth = 1;
    } else history.replaceState({}, '', '#/');
  }
  route(true);
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.STOICHEIA_NO_SW) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
