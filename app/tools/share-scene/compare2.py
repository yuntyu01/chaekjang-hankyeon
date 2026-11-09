# 시안 비교(사람 눈 기준 세 가지): 빛·그늘 = 흐리게(σ3) 본 밝기의 SSIM·평균차, 재질 = 잔무늬 세기 비(높은 주파수 표준편차), 모양 = 원래 SSIM
import os
REF=os.environ.get('REF', os.path.join(os.path.dirname(__file__), '../../../docs/design/책 공유 시안 (빛·그림자 기준).png'))
import numpy as np, cv2, sys, json
from PIL import Image
ref=np.asarray(Image.open(REF).convert('RGB')).astype(np.float32)
out=np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.float32)[:ref.shape[0]]
cov=json.loads(sys.argv[2]) if len(sys.argv)>2 else None
H,W,_=ref.shape
def ssim(a,b,s=1.5):
    C1=(0.01*255)**2; C2=(0.03*255)**2
    mu1=cv2.GaussianBlur(a,(0,0),s); mu2=cv2.GaussianBlur(b,(0,0),s)
    s11=cv2.GaussianBlur(a*a,(0,0),s)-mu1**2; s22=cv2.GaussianBlur(b*b,(0,0),s)-mu2**2; s12=cv2.GaussianBlur(a*b,(0,0),s)-mu1*mu2
    return ((2*mu1*mu2+C1)*(2*s12+C2))/((mu1**2+mu2**2+C1)*(s11+s22+C2))
La=ref.mean(2); Lb=out.mean(2)
Ba=cv2.GaussianBlur(La,(0,0),3); Bb=cv2.GaussianBlur(Lb,(0,0),3)
Sb=ssim(Ba,Bb,4); S=ssim(La,Lb)
ha=La-cv2.GaussianBlur(La,(0,0),2); hb=Lb-cv2.GaussianBlur(Lb,(0,0),2)
ex=np.zeros((H,W),bool); ex[230:834,245:666]=True
if cov: ex[int(cov['y'])+6:int(cov['y']+cov['h'])-6,int(cov['x'])+6:int(cov['x']+cov['w'])-6]=True
regions={'벽·빛(위)':(0,0,W,215),'책 둘레·그림자':(150,180,900,826),'선반':(0,820,W,960),'글자':(60,990,W,1610),'전체':(0,0,W,H)}
tot=[]
for k,(x0,y0,x1,y1) in regions.items():
    m=np.zeros((H,W),bool); m[y0:y1,x0:x1]=True; m&=~ex
    tex=hb[m].std()/max(ha[m].std(),1e-6)
    print(f'{k:12s} 빛·그늘 SSIM {Sb[m].mean()*100:6.2f}%  밝기차 {np.abs(Ba-Bb)[m].mean():5.2f}  재질 세기비 {tex:5.2f}  모양 SSIM {S[m].mean()*100:6.2f}%')
