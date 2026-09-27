import sys
from PIL import Image
import numpy as np
sys.path.insert(0, sys.argv[0].rsplit('/',1)[0])
from shmap import shadow_map
def planks(im,k):
    W=im.shape[1]; c=im[:, int(W*0.022)].astype(int)
    m=(c[:,0]>195)&(c[:,1]>155)&(c[:,1]<232)&(c[:,2]>110)&(c[:,2]<210)&(c[:,0]-c[:,2]>25)
    ys=np.nonzero(m)[0]; runs=[]
    for y in ys:
        if runs and y-runs[-1][1]<=3: runs[-1][1]=y
        else: runs.append([y,y])
    return [(r[0],r[1]+1) for r in runs if r[1]-r[0]>=int(8*k)]
def rep(path,name):
    m,im=shadow_map(path); W=im.shape[1]; k=W/390
    ps=planks(im,k)
    print(f'[{name}] 판(DU):',[(round(a/k),round(b/k)) for a,b in ps])
    res=[]
    for (a,b) in ps[:3]:
        prof=[]
        for dd in (1,3,6,10,15,20,25,30):
            y=int(b+dd*k); row=m[y-1:y+2,int(W*0.05):int(W*0.95)]; v=row[~np.isnan(row)]
            prof.append(int(np.median(v)) if v.size>30 else '·')
        # 맨 끝 책 오른쪽: 판 위 10DU 줄에서 벽이 아닌(책) 가장 오른쪽 픽셀
        # 오른쪽에서부터 벽이 아닌 픽셀이 4DU 넘게 이어지는 첫 구간 = 맨 끝 책
        yy=int(a-15*k); rowm=np.isnan(m[yy-2:yy+3, :].astype(float)).mean(axis=0)>0.6
        edge=int(W*0.9); run=0
        for x in range(W-1, 0, -1):
            run = run+1 if rowm[x] else 0
            if run>=int(4*k): edge=x+run; break
        right=[]
        for h in (5,20,40,60,80,100,120,140):
            y=int(a-h*k); blk=m[y-2:y+3,edge+int(2*k):min(W,edge+int(10*k))]; v=blk[~np.isnan(blk)]
            right.append(int(np.median(v)) if v.size>10 else '·')
        res.append((prof,right))
        print(f'   판 밑 1/3/6/10/15/20/25/30DU: {prof}   오른쪽끝 판위 5/20/40/60/80/100/120/140DU: {right}')
    return res
rep(sys.argv[1],'시안'); rep(sys.argv[2],'앱  ')
