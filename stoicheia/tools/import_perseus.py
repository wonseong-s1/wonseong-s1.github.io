# One-time importer: Perseus TEI (Greek + Heath's English) + automatic lemmatisation -> content/elements/*.json
#
# The output is a machine first pass: every word gets the analysis of an automatic tagger, so expect
# mistakes. Correct them by editing content/elements/<book>.json (one word per line), then rebuild.
# Re-running this script overwrites those files, so only run it again on purpose.
#
#   python3 tools/import_perseus.py GREEK.xml ENGLISH.xml LEMMATIZED.xml LSJ_GLOSSES.json
#
# Inputs (download first):
#   GREEK.xml       PerseusDL/canonical-greekLit  data/tlg1799/tlg001/tlg1799.tlg001.perseus-grc2.xml
#   ENGLISH.xml     PerseusDL/canonical-greekLit  data/tlg1799/tlg001/tlg1799.tlg001.perseus-eng2.xml
#   LEMMATIZED.xml  gcelano/LemmatizedAncientGreekXML  texts/tlg1799.tlg001.perseus-grc2.xml
#   LSJ_GLOSSES     {lemma: short gloss} extracted from PerseusDL/lexica LSJ (see tools/lsj_glosses.py)

import json, re, sys, unicodedata
from collections import Counter, defaultdict
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'content' / 'elements'
NS = {'t': 'http://www.tei-c.org/ns/1.0'}
T = '{http://www.tei-c.org/ns/1.0}'
ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII']

# Same rule as tools/build.mjs: a word is letters/marks plus an optional elision mark.
WORD = re.compile(r"(?:[^\W\d_]|[̀-ͯ])+[’ʼ]?")
LABEL = re.compile(r'^[Α-Ω]+$')


def greek_numeral(n):
    units = ['', 'α', 'β', 'γ', 'δ', 'ε', 'ϛ', 'ζ', 'η', 'θ']
    tens = ['', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ϙ']
    hundreds = ['', 'ρ']
    return hundreds[n // 100] + tens[n // 10 % 10] + units[n % 10] + 'ʹ'


def norm(w):
    w = unicodedata.normalize('NFD', w.lower())
    w = ''.join(c for c in w if not unicodedata.combining(c))
    return w.replace('ς', 'σ').rstrip('’ʼ\'')


def clean(s):
    s = unicodedata.normalize('NFC', re.sub(r'\s+', ' ', s)).strip()
    s = s.replace('ʼ', '’')
    s = re.sub(r'#\d*', '', s)  # stray betacode symbols in the source
    s = re.sub(r'\s+([,.·;\]])', r'\1', s)
    s = re.sub(r'\[\s+', '[', s)
    return s


def greek_text(el):
    out = [el.text or '']
    for c in el:
        tag = c.tag.replace(T, '')
        if tag == 'del':
            out.append('[' + greek_text(c) + ']')
        elif tag in ('num', 'add'):
            out.append(greek_text(c))
        out.append(c.tail or '')
    return ''.join(out)


def english_text(el):
    out = [el.text or '']
    for c in el:
        tag = c.tag.replace(T, '')
        if tag not in ('label', 'note', 'figure', 'pb', 'lb', 'bibl'):
            out.append(english_text(c))
        out.append(c.tail or '')
    return ''.join(out)


# ---------- automatic analyses ----------
POS = {'n': 'N', 'v': 'V', 'a': 'A', 'd': 'D', 'l': 'T', 'g': 'X', 'c': 'C', 'r': 'P', 'p': 'R', 'm': 'M', 'i': 'I'}
MOOD = {'i': 'ind', 's': 'sub', 'o': 'opt', 'n': 'inf', 'm': 'imp', 'p': 'ptc'}
TENSE = {'p': 'pres', 'i': 'impf', 'r': 'perf', 'l': 'plpf', 't': 'futperf', 'f': 'fut', 'a': 'aor'}
VOICE = {'a': 'act', 'p': 'pas', 'm': 'mid', 'e': 'mp'}
CASE = {'n': 'nom', 'g': 'gen', 'd': 'dat', 'a': 'acc', 'v': 'voc'}
GENDER = {'m': 'm', 'f': 'f', 'n': 'n', 'c': 'c'}
NUMBER = {'s': 's', 'p': 'p', 'd': 'du'}
DEGREE = {'c': 'comp', 's': 'sup'}


def code_of(tag, surface):
    tag = (tag or '').ljust(9, '-')
    pos = POS.get(tag[0])
    if not pos:
        return 'U'
    f = [pos]
    nominal = lambda: [x for x in (CASE.get(tag[7]), GENDER.get(tag[6]), NUMBER.get(tag[2])) if x]
    if pos == 'V':
        mood = MOOD.get(tag[4])
        f += [x for x in (mood, TENSE.get(tag[3]), VOICE.get(tag[5])) if x]
        if mood == 'ptc':
            f += nominal()
        elif mood != 'inf':
            f += [x for x in (tag[1] if tag[1] in '123' else None, NUMBER.get(tag[2])) if x]
    elif pos == 'P':
        if surface.endswith(('’', 'ʼ')):
            f.append('elided')
    elif pos in ('C', 'D', 'X', 'I'):
        pass
    else:
        if DEGREE.get(tag[8]):
            f.append(DEGREE[tag[8]])
        f += nominal()
    return ' '.join(f)


# Inflected forms the tagger left as their own lemma, and tagger lemmas with homograph numbers.
LEMMA_FIX = {
    'τριγώνων': 'τρίγωνον', 'τρίγων': 'τρίγωνον', 'δυσὶ': 'δύο', 'μίαν': 'εἷς', 'μία': 'εἷς', 'μιᾷ': 'εἷς', 'ἑνὶ': 'εἷς',
    'ἑνί': 'εἷς', 'ἕνος': 'εἷς', 'τριῶν': 'τρεῖς', 'ῥηταί': 'ῥητός', 'ῥηταὶ': 'ῥητός', 'ῥητῆς': 'ῥητός', 'μέσαι': 'μέσος',
    'μέσης': 'μέσος', 'μέση': 'μέσος', 'μέσοι': 'μέσος', 'δυναμένη': 'δύναμαι', 'συγκείμενον': 'σύγκειμαι',
    'συγκειμένῳ': 'σύγκειμαι', 'μεγέθη': 'μέγεθος', 'τετμήσθω': 'τέμνω', 'τετμήσθωσαν': 'τέμνω',
    'παραβεβλήσθω': 'παραβάλλω', 'τριπλασίων': 'τριπλάσιος', 'ποιοῦν': 'ποιέω', 'ἐκκειμένῃ': 'ἔκκειμαι',
    'ἐκκείσθωσαν': 'ἔκκειμαι', 'ὑποκειμένῳ': 'ὑπόκειμαι', 'ὑποκείμενον': 'ὑπόκειμαι', 'ἡμίσεια': 'ἥμισυς',
    'τουτέστιν': 'τουτέστι', 'διήχθω': 'διάγω', 'κύβας': 'κύβος', 'ἤχθωσαν': 'ἄγω', 'γεγονέτω': 'γίγνομαι',
    'ἐκβεβλήσθω': 'ἐκβάλλω', 'συμπεπληρώσθω': 'συμπληρόω', 'ἡγούμενον': 'ἡγέομαι', 'ἡγούμενος': 'ἡγέομαι',
    'ἡγουμένων': 'ἡγέομαι', 'ἑπόμενον': 'ἕπομαι', 'ἑπόμενος': 'ἕπομαι', 'ἑπομένων': 'ἕπομαι',
    'προσευρεῖν': 'προσευρίσκω', 'δεκαγώνου': 'δεκάγωνος', 'ὀξύς2': 'ὀξύς', 'ὅτι2': 'ὅτι', 'μετρηθήσεται': 'μετρέω',
    'κείμενον': 'κεῖμαι', 'κείσθωσαν': 'κεῖμαι', 'εἰλήφθωσαν': 'λαμβάνω', 'ἀνεστάτω': 'ἀνίστημι',
    'ἐφεστῶσαι': 'ἐφίστημι', 'παραλληλεπιπέδων': 'παραλληλεπίπεδος', 'παραλληλεπίπεδον': 'παραλληλεπίπεδος',
    'συμπεσοῦνται': 'συμπίπτω', 'τινὸς': 'τις', 'τι': 'τις', 'κατεσκευάσθω': 'κατασκευάζω', 'τυχὸν': 'τυγχάνω',
    'συμπιπτέτωσαν': 'συμπίπτω', 'πλευρόν': 'πλευρά', 'διάμετρον': 'διάμετρος', 'ἕκτη': 'ἕκτος',
    'συναμφότερος': 'συναμφότεροι', 'ὀρθογώνιον': 'ὀρθογώνιος', 'ἄκρον': 'ἄκρος', 'ἀπεναντίον': 'ἀπεναντίος',
}

# The tagger often mislabels the article; when the lemma is ὁ, use its commonest reading.
ARTICLE = {'ο': 'nom m s', 'η': 'nom f s', 'το': 'acc n s', 'του': 'gen m s', 'τησ': 'gen f s', 'τω': 'dat m s',
           'τη': 'dat f s', 'τον': 'acc m s', 'την': 'acc f s', 'οι': 'nom m p', 'αι': 'nom f p', 'τα': 'acc n p',
           'των': 'gen f p', 'τοισ': 'dat m p', 'ταισ': 'dat f p', 'τουσ': 'acc m p', 'τασ': 'acc f p'}


def load_lemmatized(path):
    """passage key -> list of (form, lemma or None, tag)"""
    by_p = defaultdict(list)
    for _, el in ET.iterparse(path):
        if el.tag != 't':
            continue
        o = el.get('o') or ''
        form = (el.findtext('f') or '').strip()
        if o.startswith('u') or not form or LABEL.match(form):
            el.clear()
            continue
        lem = None
        l = el.find('l')
        if l is not None:
            lem = l.findtext('l1') or l.findtext('l2')
        lem = unicodedata.normalize('NFC', lem.strip()) if lem and lem.strip() else None
        by_p[el.get('p')].append((unicodedata.normalize('NFC', form), lem, o))
        el.clear()
    return by_p


def main(grc, eng, lem, lsj):
    hand = json.loads(sys.stdin.read()) if not sys.stdin.isatty() else {'forms': {}, 'lemmas': {}}
    hand_forms = hand['forms']
    glosses = json.load(open(lsj, encoding='utf-8'))
    lemmatized = load_lemmatized(lem)

    # most frequent lemma per normalised form, to fill gaps
    vote = defaultdict(Counter)
    for toks in lemmatized.values():
        for form, l, _ in toks:
            if l:
                vote[norm(form)][l] += 1

    g_ed = ET.parse(grc).getroot().find('.//t:body/t:div', NS)
    e_ed = ET.parse(eng).getroot().find('.//t:body/t:div', NS)
    eng_map = {}
    for b in e_ed.findall('t:div', NS):
        for ty in b.findall('t:div', NS):
            for d in ty.findall('t:div', NS):
                paras = [clean(english_text(p)) for p in d.findall('t:p', NS)]
                eng_map[(b.get('n'), ty.get('n').replace('_', ''), d.get('n'))] = [p for p in paras if p]

    stats = Counter()
    used_lemmas = set()

    def analyse(paragraphs, key):
        """Attach one analysis per word, aligning with the tagger's tokens for this passage."""
        toks = lemmatized.get(key, [])
        j = 0
        out = []
        for text in paragraphs:
            words = []
            for m in WORD.finditer(text):
                w = m.group(0)
                if LABEL.match(w):
                    continue
                hit = None
                for k in range(0, 6):
                    if j + k < len(toks) and norm(toks[j + k][0]) == norm(w):
                        hit = toks[j + k]
                        j += k + 1
                        break
                # The tagger read the word in context, so its analysis wins; the hand lexicon only
                # fills a lemma the tagger could not find.
                fill = hand_forms[w][0] if w in hand_forms else (vote[norm(w)].most_common(1)[0][0] if vote[norm(w)] else None)
                if hit:
                    # A lemma in the hand lexicon is checked, so it beats the tagger's guess.
                    lemma = (hand_forms[w][0] if w in hand_forms else None) or hit[1] or fill
                    code = code_of(hit[2], w)
                    if norm(w) in ARTICLE and lemma == 'ὁ' and not code.startswith('T'):
                        code = 'T ' + ARTICLE[norm(w)]
                    stats['tagged' if hit[1] else 'filled' if lemma else 'nolemma'] += 1
                elif w in hand_forms:
                    lemma, code = hand_forms[w]
                    stats['hand'] += 1
                else:
                    lemma = fill
                    code = 'U'
                    stats['unaligned'] += 1
                if not lemma:
                    lemma = unicodedata.normalize('NFC', w.lower().rstrip('’'))
                lemma = LEMMA_FIX.get(lemma, lemma)
                used_lemmas.add(lemma)
                words.append([w, lemma, code])
            out.append({'text': text, 'words': words})
        return out

    OUT.mkdir(parents=True, exist_ok=True)
    books = []
    for b in g_ed.findall('t:div', NS):
        bn = int(b.get('n'))
        book = ROMAN[bn - 1]
        passages = []
        for ty in b.findall('t:div', NS):
            tn = ty.get('n')
            kind_key = re.sub(r'\d', '', tn)
            group = re.sub(r'\D', '', tn)
            lem_type = {'def': 'Def', 'post': 'Post', 'comm_not': 'CN', 'prop': 'Prop'}[kind_key]
            divs = ty.findall('t:div', NS)
            if kind_key != 'prop':
                pid = {'def': 'Def', 'post': 'Post', 'comm_not': 'CN'}[kind_key] + group
                items, en = [], []
                for d in divs:
                    text = clean(' '.join(greek_text(p) for p in d.findall('t:p', NS)))
                    key = f"{bn}.{lem_type}{' ' + group if group else ''}.{d.get('n')}"
                    items.append(analyse([text], key)[0])
                    e = eng_map.get((b.get('n'), tn, d.get('n')))
                    en.append(' '.join(e) if e else None)
                title = {'def': 'Definitions', 'post': 'Postulates', 'comm_not': 'Common notions'}[kind_key]
                if group:
                    title += f' ({["", "first", "second", "third"][int(group)]} group)'
                passages.append({
                    'id': f'{book}.{pid}', 'kind': {'def': 'definitions', 'post': 'postulates', 'comm_not': 'common notions'}[kind_key],
                    'title': title, 'greekTitle': {'def': 'Ὅροι', 'post': 'Αἰτήματα', 'comm_not': 'Κοιναὶ ἔννοιαι'}[kind_key],
                    'items': items, 'english': en,
                })
                continue
            present = {int(d.get('n')) for d in divs}
            for d in divs:
                n = int(d.get('n'))
                key = f"{bn}.Prop{' ' + group if group else ''}.{n}"
                paras = [clean(greek_text(p)) for p in d.findall('t:p', NS)]
                paras = [p for p in paras if p]
                analysed = analyse(paras, key)
                # Perseus merges a few propositions into the previous one: split after its closing formula.
                chunks = [[]]
                for i, para in enumerate(analysed):
                    chunks[-1].append(para)
                    if re.search(r'ὅπερ ἔδει (δεῖξαι|ποιῆσαι)', para['text']) and i + 1 < len(analysed) \
                            and len(chunks) == 1 and n + 1 not in present and n + 1 < max(present):
                        chunks.append([])
                for k, chunk in enumerate(chunks):
                    num = n + k
                    if k:
                        stats['split'] += 1
                    full = ' '.join(p['text'] for p in chunk)
                    kind = 'Construction' if re.search(r'ἔδει ποιῆσαι', full) else 'Theorem' if re.search(r'ἔδει δεῖξαι', full) else 'Proposition'
                    passages.append({
                        'id': f'{book}.{num}', 'kind': 'proposition', 'type': kind,
                        'greekTitle': 'Πρότασις ' + greek_numeral(num),
                        'enunciation': chunk[0], 'paragraphs': chunk[1:],
                        'english': eng_map.get((b.get('n'), tn, str(num)), []),
                    })
        props = [p for p in passages if p['kind'] == 'proposition']
        books.append({'id': book, 'n': bn, 'count': len(props)})
        write_book(book, passages)
    lemmas = {l: glosses[l] for l in sorted(used_lemmas) if l in glosses}
    json.dump(lemmas, open(OUT / 'glosses.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(dict(stats), f'{len(used_lemmas)} lemmas, {len(lemmas)} with LSJ gloss')


def write_book(book, passages):
    """JSON with one word per line, so corrections are easy to make by hand."""
    def para(p, ind):
        words = (',\n' + ind + '  ').join(json.dumps(w, ensure_ascii=False) for w in p['words'])
        return f'{{"text": {json.dumps(p["text"], ensure_ascii=False)},\n{ind} "words": [\n{ind}  {words}\n{ind} ]}}'
    out = ['[']
    for i, p in enumerate(passages):
        head = {k: v for k, v in p.items() if k not in ('items', 'enunciation', 'paragraphs')}
        lines = ['  {' + json.dumps(head, ensure_ascii=False)[1:-1] + ',']
        if 'items' in p:
            lines.append('   "items": [\n    ' + ',\n    '.join(para(x, '    ') for x in p['items']) + '\n   ]}')
        else:
            lines.append('   "enunciation": ' + para(p['enunciation'], '   ') + ',')
            lines.append('   "paragraphs": [\n    ' + ',\n    '.join(para(x, '    ') for x in p['paragraphs']) + '\n   ]}')
        out.append('\n'.join(lines) + (',' if i < len(passages) - 1 else ''))
    out.append(']\n')
    (OUT / f'{book}.json').write_text('\n'.join(out), encoding='utf-8')


if __name__ == '__main__':
    main(*sys.argv[1:5])
