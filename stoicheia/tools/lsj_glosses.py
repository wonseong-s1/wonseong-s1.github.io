# Extract short English glosses from Perseus LSJ (PerseusDL/lexica, betacode keys) -> {unicode lemma: gloss}
#   python3 tools/lsj_glosses.py DIR OUT.json   (DIR holds grc.lsj.perseus-eng1..27.xml saved as lsj1..27.xml)
import re, sys, json, glob, unicodedata, html
BASE = {'a':'α','b':'β','g':'γ','d':'δ','e':'ε','z':'ζ','h':'η','q':'θ','i':'ι','k':'κ','l':'λ','m':'μ','n':'ν','c':'ξ','o':'ο','p':'π','r':'ρ','s':'σ','t':'τ','u':'υ','f':'φ','x':'χ','y':'ψ','w':'ω','v':'ϝ'}
DIA = {')':'\u0313','(':'\u0314','/':'\u0301','\\':'\u0300','=':'\u0342','|':'\u0345','+':'\u0308'}
def beta2uni(b):
    b = b.lower()
    out=[]; pend=[]
    for ch in b:
        if ch in BASE: out.append(BASE[ch])
        elif ch in DIA and out: out.append(DIA[ch])
        elif ch == '*': pass
        elif ch in "'": out.append('’')
        else: out.append(ch)
    s=''.join(out)
    s=re.sub(r'σ(?=$|[^\w\u0300-\u036f])','ς',s)
    # reorder: combining marks must follow letter; betacode puts them after letter already
    return unicodedata.normalize('NFC', s)
TAG=re.compile(r'<[^>]+>')
res={}
for f in sorted(glob.glob(sys.argv[1]+'/lsj*.xml')):
    t=open(f,encoding='utf-8').read()
    for m in re.finditer(r'<entryFree\b([^>]*)>(.*?)</entryFree>', t, re.S):
        km=re.search(r'key="([^"]+)"', m.group(1))
        if not km: continue
        key=re.sub(r'\d+$','',km.group(1))
        body=m.group(2)
        trs=[]
        for tr in re.findall(r'<tr\b[^>]*>(.*?)</tr>', body, re.S):
            s=html.unescape(TAG.sub('',tr)).strip(' ,.;:\n\t')
            s=re.sub(r'\s+',' ',s)
            if s and s not in trs and len(s)<60: trs.append(s)
            if len(trs)>=3: break
        if not trs: continue
        u=beta2uni(key)
        g=', '.join(trs)
        if u not in res: res[u]=g
json.dump(res, open(sys.argv[2],'w',encoding='utf-8'), ensure_ascii=False)
print(len(res), [ (k,res[k]) for k in ['γραμμή','εὐθύς','τέμνω','ἴσος','τρίγωνον','εἰμί','ὁ','σημεῖον'] if k in res])
