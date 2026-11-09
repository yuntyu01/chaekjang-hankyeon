# 레퍼런스 책에서 '책 오버레이'를 뽑는다: 표지 색 c(0..255)에 대해 out = c*M + A
import os
REF=os.environ.get('REF', os.path.join(os.path.dirname(__file__), '../../../docs/design/책 공유 시안 (빛·그림자 기준).png'))
#  M: 곱하는 빛(큰 기울기·가장자리 그늘·종이 질감), A: 더하는 빛(왼쪽 위 은은한 빛·가장자리 반사)
# 표지 자리(레퍼런스): x 239..672, y 224..840 → 433x616. 속지 띠: x 672..698
import numpy as np, cv2, json
from PIL import Image
ref=np.asarray(Image.open(REF).convert('RGB')).astype(np.float32)
X0,Y0,CW,CH=239,224,433,616
C=ref[Y0:Y0+CH,X0:X0+CW]; L=C.mean(2)
r,g,b=C[...,0],C[...,1],C[...,2]
pink=(r>215)&(g>150)&(g<235)&(b>150)&(b<235)&(np.abs(g-b)<14)&(r-g>25)
pink=cv2.erode(pink.astype(np.uint8),np.ones((5,5)))>0
U=(np.arange(CW)+0.5)/CW; V=(np.arange(CH)+0.5)/CH
uu,vv=np.meshgrid(U,V)
# 1) 더하는 빛(왼쪽이 밝은 은은한 빛): 검은 띠 왼쪽 24 → 오른쪽 14, 분홍 기울기와 함께 풀어 A0을 얻는다(아래 수치는 측정값)
A0=8.0
Alow=A0*(1-uu)
# 2) 곱하는 빛(큰 흐름): 분홍에서 A를 뺀 비율을 부드럽게 펴고, 분홍이 없는 곳은 조화 메움
P=np.median(L[pink]-Alow[pink])
ratio=(L-Alow)/P
# 표지 그림(목·머리 둘레 그늘)이 섞이지 않게 2차 곡면으로 맞춘다(가장자리 30px 안쪽 분홍만)
sel=pink.copy(); sel[:, :32]=False; sel[:, -14:]=False; sel[:12]=False
ys,xs=np.where(sel)
uS,vS=U[xs],V[ys]
Amat=np.stack([np.ones_like(uS),uS,vS,uS*uS,vS*vS,uS*vS],1)
coef,_,_,_=np.linalg.lstsq(Amat,ratio[ys,xs],rcond=None)
print('Mlow coef',np.round(coef,4))
Mlow=coef[0]+coef[1]*uu+coef[2]*vv+coef[3]*uu*uu+coef[4]*vv*vv+coef[5]*uu*vv
Mlow/=np.median(Mlow)
# 3) 가장자리: 왼쪽(분홍·검정 짝으로 M·A를 함께 푼다)
rows_p=[y for y in range(10,500) if pink[y,2:34].mean()>0.9]
blk=(L<60)
rows_k=[y for y in range(505,605) if blk[y,0:34].mean()>0.85]
p=L[rows_p][:,0:34].mean(0); q=L[rows_k][:,0:34].mean(0)
p0=L[rows_p][:,30:34].mean(); q0=L[rows_k][:,30:34].mean()
Mx=np.ones(CW); Ax=np.zeros(CW)
Mx[:30]=(p[:30]-q[:30])/(p0-q0); Ax[:30]=p[:30]-p0*Mx[:30]
# 오른쪽 끝(분홍만 확실: 밝으면 더하고 어두우면 곱한다)
rows_pr=[y for y in range(60,500) if pink[y,CW-40:CW-1].mean()>0.95]
pr=L[rows_pr][:,CW-40:].mean(0); pr0=pr[:12].mean()
for i in range(40):
    d=pr[i]/pr0; x=CW-40+i
    if x<CW-40+12: continue
    if d<1: Mx[x]*=d
    else: Ax[x]+=pr[i]-pr0
# 위 끝(분홍 열)
cols=[x for x in range(30,340) if pink[8:40,x].mean()>0.7]
pt=L[0:40][:,cols].mean(1); pt0=pt[25:40].mean()
My=np.ones(CH); Ay=np.zeros(CH)
for y in range(0,25):
    d=pt[y]/pt0
    if d<1: My[y]=d
    else: Ay[y]=pt[y]-pt0
# 아래 끝(검은 띠, 글자 없는 열)
colsb=[x for x in range(0,CW) if blk[CH-30:CH-2,x].mean()>0.95]
pb=L[CH-30:CH][:,colsb].mean(1); pb0=pb[:12].mean()
for i in range(30):
    y=CH-30+i
    if i<12: continue
    if pb[i]>=pb0: Ay[y]=pb[i]-pb0
    else: My[y]=pb[i]/pb0
# 4) 종이 질감: 깨끗한 벽(바탕)의 높은 주파수를 상대값으로, 레퍼런스 표지 질감 세기(벽의 0.7배, 중앙값 편차로 잼)
plate=np.asarray(Image.open('plate.png').convert('RGB')).astype(np.float32).mean(2)
ph=(plate-cv2.GaussianBlur(plate,(0,0),2.5))/np.maximum(cv2.GaussianBlur(plate,(0,0),2.5),1)
T=ph[20:20+CH,300:300+CW]*0.7
# 맨 위 줄·왼쪽 첫 열은 벽과 섞인 가장자리(안티에일리어싱)라 다음 줄 값을 쓴다
My[0]=My[1]; Ay[0]=Ay[1]
M=np.clip(Mlow*Mx[None,:]*My[:,None]*(1+T),0.3,1.2)
A=np.clip(Alow+Ax[None,:]+Ay[:,None],-20,40)
print('P',P,'p0',p0,'q0',q0,'M range',M.min(),M.max(),'A range',A.min(),A.max())
np.save('M.npy',M.astype(np.float32)); np.save('A.npy',A.astype(np.float32))
# 앱 자산: M*128, A+64 (회색 PNG)
Image.fromarray(np.clip(M*128,0,255).astype(np.uint8)).save('book-mul.png')
Image.fromarray(np.clip(A+64,0,255).astype(np.uint8)).save('book-add.png')
# 속지 띠(RGBA): x 672..698, 위·아래 기운 끝은 투명
PX0,PW=672,27
strip=ref[Y0-2:Y0+CH+2,PX0:PX0+PW].copy()
alpha=np.zeros(strip.shape[:2],np.float32)
for i in range(PW):
    x=PX0+i
    top=227+(x-673)*0.65; bot=840-(x-673)*0.43
    yy=np.arange(strip.shape[0])+Y0-2
    alpha[:,i]=np.clip(yy-top+0.5,0,1)*np.clip(bot-yy+0.5,0,1)
alpha[:, PW-1]*=0.5
rgba=np.dstack([strip,alpha*255]).astype(np.uint8)
Image.fromarray(rgba,'RGBA').save('book-pages.png')
json.dump({'cover':[X0,Y0,CW,CH],'pages':[PX0,Y0-2,PW,CH+4]},open('book-geom.json','w'))
v=np.hstack([np.clip((M-0.8)/0.4,0,1),np.clip(A/40+0.3,0,1)])
Image.fromarray((v*255).astype(np.uint8)).save('overlay-view.png')
