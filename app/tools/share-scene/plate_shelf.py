# 선반 윗면(책이 가리고 그늘진 곳)을 다시 메운다: 밝기(가로로 흐린 값)는 왼쪽·오른쪽 깨끗한 열 사이를 잇고, 결(가로 흐림을 뺀 값)은 왼쪽 판에서 이어진 덩어리로 옮긴다
import os
REF=os.environ.get('REF', os.path.join(os.path.dirname(__file__), '../../../docs/design/책 공유 시안 (빛·그림자 기준).png'))
import numpy as np, cv2
from PIL import Image
im=np.asarray(Image.open(REF).convert('RGB')).astype(np.float32)
out=np.asarray(Image.open('plate.png').convert('RGB')).astype(np.float32)
y0,y1=824,855
gx0,gx1=228,792
band=im[y0:y1].copy()
low=cv2.blur(band,(41,1))
grain=band-low
cl=low[:,gx0-24:gx0-4].mean(1); cr=low[:,gx1+4:gx1+24].mean(1)
src=grain[:,64:220]; bw=src.shape[1]; fade=20
for x in range(gx0,gx1):
    t=(x-gx0)/(gx1-gx0)
    base=cl*(1-t)+cr*t
    k=(x-gx0)%(bw-fade)
    g=src[:,k]
    if k<fade and x-gx0>=bw-fade:
        w=k/fade; g=src[:,k+bw-fade]*(1-w)+g*w
    out[y0:y1,x]=base+g
Image.fromarray(np.clip(out,0,255).astype(np.uint8)).save('plate.png')
c=np.clip(out,0,255).astype(np.uint8)
r=np.asarray(Image.open(REF).convert('RGB'))
Image.fromarray(np.vstack([r[812:862,40:420],c[812:862,40:420]])).resize((1140,300)).save('shelf-top-cmp.png')
Image.fromarray(c[780:960,0:941]).save('plate-shelf.png')
print('ok')
