"""Measure original print bounds and alpha calibration for the native renderer.

The PNG is read only. Output is JSON metadata, never an edited raster.
"""
from pathlib import Path
import json
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
pixels = np.asarray(Image.open(ROOT/'assets/reference/bookshelf-original.png').convert('RGB')).astype(float)
# Face origin, size, angle; print bounds are coordinates in the original PNG.
SLOTS = {
 'b01': ('모순', (61,350,62,340,0), (78,432,29,58), 'dark', (75,570,31,77), 'blossom'),
 'b02': ('데미안', (125,307,79,383,0), (149,400,33,80), 'light', (147,610,35,41), 'asterisk'),
 'b03': ('어린 왕자', (207,305,83,385,0), (229,390,35,132), 'dark', (229,559,34,36), 'star-solid'),
 'b05': ('문장 수집', (548,309,74,381,0), (570,388,32,157), 'light', (569,601,40,72), 'sprig'),
 'b17': ('느린 하루', (623,325,86,365,0), (647,395,39,128), 'light', (647,594,44,31), 'cloud'),
 'b06': ('흰', (709,359,61,334,-7), (735,463,43,46), 'dark', (750,586,42,78), 'daisy'),
 'b08': ('여행의 이유', (369,803,69,355,0), (387,892,34,148), 'light', (380,1094,48,31), 'wave'),
 'b09': ('작은 것들의 기쁨', (440,801,70,357,0), (458,866,36,192), 'dark', (455,1080,35,62), 'sprig'),
 'b10': ('사람의 마음이란', (510,802,102,356,0), (542,857,41,212), 'light', (545,1071,38,47), 'moon'),
 'b18': ('아주 보통의 하루', (611,790,85,368,0), (638,859,38,195), 'dark', (634,1078,42,66), 'seedling'),
 'b11': ('너라는 계절', (692,826,65,335,-7), (710,887,69,145), 'dark', (740,1072,39,64), 'blossom'),
 'b14': ('고요한 우연', (393,1250,75,321,0), (411,1314,36,157), 'light', (411,1490,39,61), 'seedling'),
 'b15': ('아무튼, 독서', (469,1240,75,331,0), (490,1313,38,157), 'dark', (490,1509,37,41), 'book'),
 'b12': ('찰나의 마음', (37,1482,353,88,90), (84,1511,156,39), 'dark', (312,1496,40,55), 'seedling'),
 'b13': ('좋은 문장은 이렇게 온다', (46,1411,343,69,90), (85,1428,232,36), 'dark', (325,1417,48,57), 'feather'),
}

# Include the entire final syllable, including Hangul's bottom consonant.
# These clear print bands stop before the ornament and avoid jacket edges.
TITLE_BANDS = {
 'b01':(76,410,32,105),'b02':(145,385,42,180),'b03':(227,378,40,170),
 'b05':(568,378,36,197),'b17':(645,385,42,169),'b06':(735,455,43,75),
 'b08':(385,868,40,190),'b09':(455,850,43,225),'b10':(540,841,46,231),
 'b18':(636,840,44,237),'b11':(710,871,69,188),'b14':(408,1297,43,183),
 'b15':(487,1285,44,217),
}

# Calibrate the flat print to the jacket's visible face, which is narrower
# than its full rounded silhouette. Bounds were measured at the 853px target;
# the resulting source-space matrix scales with every native book size.
PRINT_REGISTRATION = {
 'b01':((81,436,102,485),(80,439,100,487)),
 'b02':((154,404,175,489),(154,403,174,488)),
 'b03':((235,393,256,520),(234,395,254,521)),
 'b05':((575,391,597,509),(575,391,594,509)),
 'b17':((659,399,679,516),(659,398,679,515)),
 'b08':((394,895,413,1033),(393,902,411,1036)),
 'b09':((466,870,484,1051),(466,873,483,1053)),
 'b10':((553,861,573,1054),(553,862,571,1055)),
 'b18':((647,865,666,1049),(646,867,663,1051)),
 'b14':((421,1321,441,1450),(420,1325,438,1451)),
 'b15':((498,1319,517,1457),(497,1320,514,1457)),
}

def print_registration(key, face):
    if key not in PRINT_REGISTRATION: return None
    target, actual = PRINT_REGISTRATION[key]
    sx=(target[2]-target[0]+1)/(actual[2]-actual[0]+1)
    sy=(target[3]-target[1]+1)/(actual[3]-actual[1]+1)
    cx=(target[0]+target[2])/2; cy=(target[1]+target[3])/2
    dx=(target[0]+target[2]-actual[0]-actual[2])/2*face[2]/(face[2]-3)
    dy=(target[1]+target[3]-actual[1]-actual[3])/2
    return [round(v,7) for v in [sx,0,cx*(1-sx)+dx,0,sy,cy*(1-sy)+dy,0,0,1]]

def alpha_mask(bounds, mode):
    x,y,w,h=bounds; a=pixels[y:y+h,x:x+w]
    axis=[1,-1,0] if mode=='orange' else [0,1,0] if mode=='gold' else [1,0,0]
    channel=a@np.array(axis)
    light=mode in ('light','orange')
    bg=float(np.percentile(channel, 50))
    ink=float(np.percentile(channel, 99 if light else 1))
    gain=255/(ink-bg) if abs(ink-bg)>5 else 0
    return {'bounds':bounds,'alpha':[round(q*gain,7) for q in axis]+[round(-bg/(ink-bg),7) if gain else 0]}

out={}
motifs={}
glyphs={}
for key,(title,face,box,mode,motif_box,motif) in SLOTS.items():
    box=TITLE_BANDS.get(key,box)
    modes=['green','orange'] if motif in ('blossom','daisy') else ['gold'] if motif in ('star-solid','book') else ['green'] if key in ('b09','b13') else ['light']
    paths=[]
    for color in modes:
        paths.append({**alpha_mask(motif_box,color),'color':('#EDBB63' if motif=='daisy' else '#EDA75F') if color=='orange' else None})
    out[title]={'slot':key,'face':face,'pose':'horizontal' if face[4]==90 else 'spine','title':alpha_mask(box,mode),'motif':motif,'decoration':paths}
    registration=print_registration(key,face)
    if registration: out[title]['registration']=registration
    if motif not in motifs:
        motifs[motif]={'face':[*motif_box,0],'decoration':paths}
    if face[4]==0 and ',' not in title:
        x,y,w,h=box; layer=out[title]['title']; k=np.array(layer['alpha'][:3]); offset=layer['alpha'][3]
        alpha=pixels[y:y+h,x:x+w]@k/255+offset
        rows=np.flatnonzero((alpha>.22).sum(axis=1)>1)
        chunks=[]
        for row in rows:
            if not chunks or row-chunks[-1][-1]>2: chunks.append([int(row)])
            else: chunks[-1].append(int(row))
        chars=[c for c in title if not c.isspace()]
        while len(chunks)>len(chars):
            i=min(range(len(chunks)-1),key=lambda i:chunks[i+1][0]-chunks[i][-1])
            chunks[i:i+2]=[chunks[i]+chunks[i+1]]
        if len(chunks)==len(chars):
            for ch,rows in zip(chars,chunks):
                ya=max(0,rows[0]-1); yb=min(h,rows[-1]+2)
                yy,xx=np.nonzero(alpha[ya:yb]>.18)
                if not len(xx):continue
                xa=max(0,int(xx.min())-1);xb=min(w,int(xx.max())+2)
                g={'bounds':[x+xa,y+ya,xb-xa,yb-ya],'alpha':layer['alpha']}
                if ch not in glyphs or g['bounds'][3]>glyphs[ch]['bounds'][3]:glyphs[ch]=g
target=ROOT/'src/ui/art/reference-print.generated.json'
target.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('Original ink sampling templates:',len(out),'Bytes:',target.stat().st_size)
(ROOT/'src/ui/art/reference-motifs.generated.json').write_text(json.dumps(motifs,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
(ROOT/'src/ui/art/reference-glyphs.generated.json').write_text(json.dumps(glyphs,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('Reusable original characters:',len(glyphs))
