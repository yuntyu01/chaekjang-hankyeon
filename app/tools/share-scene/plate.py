# 레퍼런스에서 책·글자·책 그림자를 지운 바탕(벽·창빛·선반) 만들기
import os
REF=os.environ.get('REF', os.path.join(os.path.dirname(__file__), '../../../docs/design/책 공유 시안 (빛·그림자 기준).png'))
import numpy as np, cv2
from PIL import Image
im=np.asarray(Image.open(REF).convert('RGB')).astype(np.float32)
H,W,_=im.shape
mask_wall=np.zeros((H,W),np.uint8)
# 책(표지+속지) + 오른쪽 그림자 번짐 + 위쪽 약간
cv2.rectangle(mask_wall,(232,214),(706,846),1,-1)
cv2.rectangle(mask_wall,(700,222),(845,850),1,-1)
# 글자들(여백 10)
for (x0,y0,x1,y1) in [(89,1025,277,1088),(90,1114,181,1144),(91,1215,349,1265),(92,1285,540,1331),(92,1398,293,1427),(324,1403,372,1427),(412,1558,528,1585),(296,1560,645,1579)]:
    cv2.rectangle(mask_wall,(x0-12,y0-12),(x1+12,y1+12),1,-1)
# 선반 영역(벽 처리에서 빼고 따로)
shelf=np.zeros((H,W),bool); shelf[826:904,44:895]=True
mw=(mask_wall>0)&~shelf
# 낮은 주파수: 가린 곳을 뺀 정규화 흐림 → 빈 곳은 라플라스 메움
valid=(~mw)&~shelf
sig=9
def nblur(img,w,s):
    num=cv2.GaussianBlur(img*w[...,None],(0,0),s); den=cv2.GaussianBlur(w.astype(np.float32),(0,0),s)[...,None]
    return num/np.maximum(den,1e-4), den[...,0]
low=np.zeros_like(im)
lw,den=nblur(im,valid.astype(np.float32),sig)
low[:]=lw
need=(den<0.35)|mw
# 라플라스(조화) 메움: 반복 평균
fill=low.copy()
fill[need]=np.nan
known=~need
f=fill.copy()
f[need]=np.nanmean(fill[known&~shelf],axis=0)
for it in range(1500):
    avg=(np.roll(f,1,0)+np.roll(f,-1,0)+np.roll(f,1,1)+np.roll(f,-1,1))/4
    f[need]=avg[need]
low=f
# 질감(높은 주파수): 깨끗한 벽에서 옮겨 온다. 원본 - 정규화 흐림
lw_all,_=nblur(im,valid.astype(np.float32),sig)
high=im-lw_all
# 질감 원천: 맨 위 띠(y 0..200, 모든 x)와 아래 오른쪽(x 660..940, y 960..1660)
src=[(0,0,941,205),(660,960,940,1660),(0,960,84,1660)]
out=im.copy()
rng=np.random.default_rng(7)
tex=np.zeros_like(im); tw=np.zeros((H,W),np.float32)
P=64; step=40
ys,xs=np.where(mw)
y0,y1,x0,x1=ys.min(),ys.max(),xs.min(),xs.max()
win=np.outer(np.hanning(P),np.hanning(P)).astype(np.float32)+1e-3
for by in range(y0-P,y1+P,step):
    for bx in range(x0-P,x1+P,step):
        sx0,sy0,sx1,sy1=src[rng.integers(0,1)] if True else src[0]
        sx=rng.integers(sx0,sx1-P); sy=rng.integers(sy0,sy1-P)
        patch=high[sy:sy+P,sx:sx+P]
        ty0,tx0=max(by,0),max(bx,0); ty1,tx1=min(by+P,H),min(bx+P,W)
        if ty1<=ty0 or tx1<=tx0: continue
        py0,px0=ty0-by,tx0-bx
        pp=patch[py0:py0+(ty1-ty0),px0:px0+(tx1-tx0)]; ww=win[py0:py0+(ty1-ty0),px0:px0+(tx1-tx0)]
        tex[ty0:ty1,tx0:tx1]+=pp*ww[...,None]; tw[ty0:ty1,tx0:tx1]+=ww
tex=tex/np.maximum(tw,1e-4)[...,None]
# 겹쳐 평균하면 질감이 약해지므로 원래 세기로 맞춘다
ref_std=high[0:205].std(); tex*=ref_std/max(tex[mw].std(),1e-3)
# 가장자리를 부드럽게 섞는다
soft=cv2.GaussianBlur(mw.astype(np.float32),(0,0),3)
soft=np.clip(soft*1.6,0,1)
soft[shelf]=0
out=out*(1-soft[...,None])+(low+tex)*soft[...,None]
Image.fromarray(np.clip(out,0,255).astype(np.uint8)).save('plate.png')
np.save('mask_wall.npy',mw)
print('ok')
