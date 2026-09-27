import sys
from PIL import Image
import numpy as np
def shadow_map(path, W0=(251,246,237)):
    im=np.asarray(Image.open(path).convert('RGB')).astype(float)
    W=np.array(W0,float); d=np.array([40,55,65],float); d/=np.linalg.norm(d)
    v=W-im; proj=v@d; res=np.linalg.norm(v-proj[...,None]*d,axis=2)
    wall=(res<9)&(proj>-6)
    return np.where(wall,np.clip(proj,0,120),np.nan), im
if __name__=='__main__':
    src,out,w=sys.argv[1],sys.argv[2],int(sys.argv[3])
    m,im=shadow_map(src)
    vis=np.where(np.isnan(m),40,255-np.nan_to_num(m)*3).clip(0,255)
    img=Image.fromarray(vis.astype(np.uint8)).convert('RGB')
    arr=np.asarray(img).copy(); arr[np.isnan(m)]=(40,60,90)
    Image.fromarray(arr).resize((w,int(arr.shape[0]*w/arr.shape[1]))).save(out)
