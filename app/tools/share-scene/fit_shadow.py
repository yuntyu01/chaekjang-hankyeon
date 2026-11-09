import numpy as np, cv2, json
import os
REF=os.environ.get('REF', os.path.join(os.path.dirname(__file__), '../../../docs/design/책 공유 시안 (빛·그림자 기준).png'))
from PIL import Image
from scipy.optimize import least_squares
ref=np.asarray(Image.open(REF).convert('RGB')).astype(np.float32).mean(2)
pl=np.asarray(Image.open('plate.png').convert('RGB')).astype(np.float32).mean(2)
R=cv2.GaussianBlur(ref,(0,0),2)/np.maximum(cv2.GaussianBlur(pl,(0,0),2),1)
H,W=ref.shape
sil=np.zeros((H,W),np.float32)
sil[224:841,239:673]=1
pts=np.array([[672,231],[699,239],[699,831],[672,840]],np.int32); cv2.fillPoly(sil,[pts],1)
# 맞출 곳: 벽(책 바깥, 선반 위)
fit=np.zeros((H,W),bool); fit[200:826,236:860]=True
fit&=cv2.dilate(sil,np.ones((3,3)))==0
yy,xx=np.where(fit)
sub=(slice(150,900),slice(150,940))
def shade(p):
    a1,dx1,dy1,s1,a2,dx2,dy2,s2,a3,dx3,dy3,s3=p
    out=np.ones((H,W),np.float32)
    for a,dx,dy,s in ((a1,dx1,dy1,s1),(a2,dx2,dy2,s2),(a3,dx3,dy3,s3)):
        M=np.float32([[1,0,dx],[0,1,dy]]); sh=cv2.warpAffine(sil,M,(W,H))
        out-=a*cv2.GaussianBlur(sh,(0,0),max(s,0.5))
    return out
def res(p):
    return (shade(p)[yy,xx]-R[yy,xx])
p0=[0.15,8,6,6,0.12,30,20,30,0.1,3,2,3]
r=least_squares(res,p0,bounds=([0,-20,-20,0.5,0,-60,-60,3,0,-10,-10,0.5],[0.6,40,40,40,0.6,120,120,120,0.6,20,20,12]),diff_step=0.05,max_nfev=200)
print('params',np.round(r.x,2).tolist(),'rms',np.sqrt(np.mean(r.fun**2)))
json.dump(dict(zip(['a1','dx1','dy1','s1','a2','dx2','dy2','s2','a3','dx3','dy3','s3'],[float(v) for v in r.x])),open('shadow.json','w'))
S=shade(r.x)
v=np.hstack([np.clip(R[150:900,150:940],0.6,1.05),np.clip(S[150:900,150:940],0.6,1.05)])
Image.fromarray(((v-0.6)/0.45*255).astype(np.uint8)).resize((790,375)).save('shadow-fit.png')
