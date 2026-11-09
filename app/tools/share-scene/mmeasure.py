import numpy as np, sys
from PIL import Image
def lines(a,x0,x1,y0,y1,th):
    rows=(a[y0:y1,x0:x1]<th).any(1); out=[];s=None
    for i,v in enumerate(rows):
        if v and s is None: s=i
        if not v and s is not None: out.append((y0+s,y0+i-1)); s=None
    if s is not None: out.append((y0+s,y1-1))
    res=[]
    for (ya,yb) in out:
        cols=np.where((a[ya:yb+1,x0:x1]<th).any(0))[0]
        res.append((int(x0+cols.min()),ya,int(x0+cols.max()),yb))
    return res
ref=np.asarray(Image.open(sys.argv[1]).convert('L')).astype(int); out=np.asarray(Image.open(sys.argv[2]).convert('L')).astype(int)
x0,x1,y0,y1,th=[int(v) for v in sys.argv[3:8]]
r=lines(ref,x0,x1,y0,y1,th); o=lines(out,x0,x1,y0,y1,th)
for i in range(max(len(r),len(o))):
    print('ref',r[i] if i<len(r) else None,' out',o[i] if i<len(o) else None)
