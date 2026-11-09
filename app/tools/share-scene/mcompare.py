import numpy as np, cv2, sys
from PIL import Image
ref=np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.float32); out=np.asarray(Image.open(sys.argv[2]).convert('RGB')).astype(np.float32)
H,W,_=ref.shape
def ssim(a,b,s=1.5):
    C1=(0.01*255)**2; C2=(0.03*255)**2
    mu1=cv2.GaussianBlur(a,(0,0),s); mu2=cv2.GaussianBlur(b,(0,0),s)
    s11=cv2.GaussianBlur(a*a,(0,0),s)-mu1**2; s22=cv2.GaussianBlur(b*b,(0,0),s)-mu2**2; s12=cv2.GaussianBlur(a*b,(0,0),s)-mu1*mu2
    return ((2*mu1*mu2+C1)*(2*s12+C2))/((mu1**2+mu2**2+C1)*(s11+s22+C2))
La=ref.mean(2); Lb=out.mean(2)
Ba=cv2.GaussianBlur(La,(0,0),3); Bb=cv2.GaussianBlur(Lb,(0,0),3)
Sb=ssim(Ba,Bb,4); S=ssim(La,Lb)
regs={'바탕(글자 밖)':None,'문장':(100,540,900,1000),'제목·저자·쪽수':(100,940,900,1300),'맨 아래':(250,1520,900,1600),'전체':(0,0,W,H)}
for k,r in regs.items():
    m=np.zeros((H,W),bool)
    if r is None:
        m[:]=True; m[540:1000,100:900]=False; m[940:1300,100:900]=False; m[1520:1600,250:900]=False
    else: m[r[1]:r[3],r[0]:r[2]]=True
    print(f'{k:12s} 빛·그늘 SSIM {Sb[m].mean()*100:6.2f}%  밝기차 {np.abs(Ba-Bb)[m].mean():5.2f}  모양 SSIM {S[m].mean()*100:6.2f}%')
