import numpy as np, sys
import os
REF=os.environ.get('REF', os.path.join(os.path.dirname(__file__), '../../../docs/design/책 공유 시안 (빛·그림자 기준).png'))
from PIL import Image
def load(p): return np.asarray(Image.open(p).convert('L')).astype(float)
ref=load(REF); out=load(sys.argv[1])
boxes={'title':(60,990,700,1100,120),'author':(60,1100,400,1170,200),'note1':(60,1200,800,1275,150),'note2':(60,1275,800,1345,150),'stars':(60,1385,310,1445,200),'rating':(300,1385,460,1445,200),'foot':(380,1540,560,1600,150)}
def bbox(a,x0,y0,x1,y1,th):
    s=a[y0:y1,x0:x1]; ys,xs=np.where(s<th)
    if len(ys)==0: return None
    bx=(x0+xs.min(),y0+ys.min(),x0+xs.max(),y0+ys.max())
    sub=a[bx[1]:bx[3]+1,bx[0]:bx[2]+1]; bg=np.percentile(a[y0:y1,x0:x1],95)
    cov=((bg-sub)/bg).clip(0,1).mean()
    return bx,round(cov,3)
for k,(x0,y0,x1,y1,th) in boxes.items():
    print(k.ljust(7),'ref',bbox(ref,x0,y0,x1,y1,th),' out',bbox(out,x0,y0,x1,y1,th))
