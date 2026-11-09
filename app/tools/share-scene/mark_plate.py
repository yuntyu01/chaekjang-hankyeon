# 갈피 시안에서 글자를 지운 바탕: 글자 상자마다 둘레 띠(넓힌 상자 바깥 40px)의 흐린 밝기로 2차 곡면을 맞춰 채우고, 같은 그림의 깨끗한 종이 잔무늬를 옮긴다
# usage: mark_plate.py <ref.png> <out.png> '<json boxes [[x0,y0,x1,y1],...]>' '<json texture src [x0,y0,x1,y1]>'
import sys, json
import numpy as np, cv2
from PIL import Image
ref=np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.float32)
boxes=json.loads(sys.argv[3]); srcbox=json.loads(sys.argv[4])
H,W,_=ref.shape
out=ref.copy()
low=cv2.GaussianBlur(ref,(0,0),5)
hp=ref-low
sx0,sy0,sx1,sy1=srcbox; src=hp[sy0:sy1,sx0:sx1]; sh,sw=src.shape[:2]
rng=np.random.default_rng(5)
P=64; win=np.outer(np.hanning(P),np.hanning(P)).astype(np.float32)+1e-3
allm=np.zeros((H,W),bool)
for (x0,y0,x1,y1) in boxes:
    X0,Y0,X1,Y1=max(x0-26,0),max(y0-24,0),min(x1+26,W-1),min(y1+26,H-1)
    m=np.zeros((H,W),bool); m[Y0:Y1,X0:X1]=True
    R0,Q0,R1,Q1=max(X0-40,0),max(Y0-40,0),min(X1+40,W-1),min(Y1+40,H-1)
    ring=np.zeros((H,W),bool); ring[Q0:Q1,R0:R1]=True; ring&=~m
    for (a0,b0,a1,b1) in boxes:   # 다른 글자 상자는 둘레에서 뺀다
        ring[max(b0-30,0):b1+30,max(a0-30,0):a1+30]=False
    ys,xs=np.where(ring)
    cx,cy=(R0+R1)/2,(Q0+Q1)/2; sxn,syn=(R1-R0)/2,(Q1-Q0)/2
    def F(xx,yy):
        u=(xx-cx)/sxn; v=(yy-cy)/syn
        return np.stack([np.ones_like(u),u,v,u*u,v*v,u*v],-1)
    A=F(xs,ys)
    yy,xx=np.mgrid[Y0:Y1,X0:X1]
    fill=np.zeros((Y1-Y0,X1-X0,3),np.float32)
    for c in range(3):
        coef,_,_,_=np.linalg.lstsq(A,low[ys,xs,c],rcond=None); fill[...,c]=F(xx,yy)@coef
    tex=np.zeros_like(fill); tw=np.zeros(fill.shape[:2],np.float32)
    for by in range(-P,Y1-Y0+P,P//2):
        for bx in range(-P,X1-X0+P,P//2):
            py=rng.integers(0,sh-P); px=rng.integers(0,sw-P)
            a0,b0=max(by,0),max(bx,0); a1,b1=min(by+P,Y1-Y0),min(bx+P,X1-X0)
            if a1<=a0 or b1<=b0: continue
            tex[a0:a1,b0:b1]+=src[py+a0-by:py+a1-by,px+b0-bx:px+b1-bx]*win[a0-by:a1-by,b0-bx:b1-bx,None]
            tw[a0:a1,b0:b1]+=win[a0-by:a1-by,b0-bx:b1-bx]
    tex/=np.maximum(tw,1e-4)[...,None]; tex*=src.std()/max(tex.std(),1e-3)
    out[Y0:Y1,X0:X1]=fill+tex
    allm|=m
soft=np.clip(cv2.GaussianBlur(allm.astype(np.float32),(0,0),5)*1.6,0,1)[...,None]
res=ref*(1-soft)+out*soft
Image.fromarray(np.clip(res,0,255).astype(np.uint8)).save(sys.argv[2])
g=cv2.GaussianBlur(res.mean(2),(0,0),4); r=cv2.GaussianBlur(ref.mean(2),(0,0),4)
for (x0,y0,x1,y1) in boxes:
    inner=g[y0:y1,x0:x1].mean(); ring=np.concatenate([g[max(y0-70,0):y0-40,x0:x1].ravel(),g[y1+40:y1+70,x0:x1].ravel()]).mean()
    print((x0,y0),'inner-ring %.2f'%(inner-ring))
