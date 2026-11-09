# 글자 지운 자리 다시 메우기: 아래쪽 벽(y 950~) 밝기를 2차 곡면(+약한 가로·세로 흐름)으로 맞추고, 넓힌 글자 자리를 곡면 + 깨끗한 벽 잔무늬로 채운다
import os
import numpy as np, cv2
from PIL import Image
REF=os.environ.get('REF','../ref/ref.png')
ref=np.asarray(Image.open(REF).convert('RGB')).astype(np.float32)
out=np.asarray(Image.open('plate.png').convert('RGB')).astype(np.float32)
H,W,_=ref.shape
boxes=[(89,1025,277,1088),(90,1114,181,1144),(91,1215,349,1265),(92,1285,540,1331),(92,1398,293,1427),(324,1403,372,1427),(412,1558,528,1585),(296,1560,645,1579)]
m=np.zeros((H,W),np.uint8)
for (x0,y0,x1,y1) in boxes: cv2.rectangle(m,(x0-26,y0-24),(x1+26,y1+26),1,-1)
m=m>0
Y0=950
reg=np.zeros((H,W),bool); reg[Y0:,:]=True
valid=reg&~m
ys,xs=np.where(valid)
u=xs/W; v=(ys-Y0)/(H-Y0)
Amat=np.stack([np.ones_like(u),u,v,u*u,v*v,u*v,u**3,v**3],1)
lowimg=cv2.GaussianBlur(ref,(0,0),6)
fit=np.zeros((H,W,3),np.float32)
yy,xx=np.mgrid[Y0:H,0:W]; uu=xx/W; vv=(yy-Y0)/(H-Y0)
F=np.stack([np.ones_like(uu),uu,vv,uu*uu,vv*vv,uu*vv,uu**3,vv**3],-1)
for c in range(3):
    coef,_,_,_=np.linalg.lstsq(Amat,lowimg[ys,xs,c],rcond=None)
    fit[Y0:,:,c]=F@coef
# 잔무늬: 깨끗한 아래 벽의 높은 주파수를 옮긴다(오른쪽 x 660..930)
hp=ref-cv2.GaussianBlur(ref,(0,0),6)
src=hp[960:1660,660:930]
sh,sw=src.shape[:2]
tex=np.zeros_like(ref); tw=np.zeros((H,W),np.float32)
P=64; win=np.outer(np.hanning(P),np.hanning(P)).astype(np.float32)+1e-3
rng=np.random.default_rng(11)
ys2,xs2=np.where(m)
for by in range(ys2.min()-P,ys2.max()+P,P//2):
    for bx in range(xs2.min()-P,xs2.max()+P,P//2):
        sy=rng.integers(0,sh-P); sx=rng.integers(0,sw-P)
        y0,x0=max(by,0),max(bx,0); y1,x1=min(by+P,H),min(bx+P,W)
        if y1<=y0 or x1<=x0: continue
        pp=src[sy+y0-by:sy+y1-by,sx+x0-bx:sx+x1-bx]; ww=win[y0-by:y1-by,x0-bx:x1-bx]
        tex[y0:y1,x0:x1]+=pp*ww[...,None]; tw[y0:y1,x0:x1]+=ww
tex/=np.maximum(tw,1e-4)[...,None]
tex*=hp[960:1660,660:930].std()/max(tex[m].std(),1e-3)
soft=np.clip(cv2.GaussianBlur(m.astype(np.float32),(0,0),6)*1.5,0,1)[...,None]
out=out*(1-soft)+(fit+tex)*soft
Image.fromarray(np.clip(out,0,255).astype(np.uint8)).save('plate.png')
B=cv2.GaussianBlur(out.mean(2),(0,0),4)[980:1620,40:900]
Image.fromarray(np.clip((B-232)/(250-232)*255,0,255).astype(np.uint8)).resize((430,320)).save('plate-text-area.png')
print('ok')
