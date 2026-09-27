import sys
sys.path.insert(0, sys.argv[0].rsplit('/',1)[0])
from shmap import shadow_map
import numpy as np
from PIL import Image
def prof(path, plank_top_du, edge_du, label):
    m,im=shadow_map(path); W=im.shape[1]; k=W/390
    L=im.astype(float).mean(2); ch=im.max(2)-im.min(2)
    rows=[]
    for h in (5,15,30,50,70,90,110):
        y=int((plank_top_du-h)*k)
        # 책 가장자리: edge_du+12 에서 왼쪽으로, 채도>18 또는 밝기 급변(책 테두리) 첫 지점
        x=min(W-1,int((edge_du+14)*k))
        while x>int((edge_du-25)*k) and ch[y,x]<22: x-=1
        vals=[]
        for dx in (2,6,12,20):
            xx=x+int(dx*k)
            if xx>=W-2: vals.append('-'); continue
            v=m[y-2:y+3,xx-2:xx+3]; v=v[~np.isnan(v)]
            vals.append(int(np.median(v)) if v.size>4 else '·')
        rows.append((h,vals))
    print(label, ' '.join(f'{h}DU:{v}' for h,v in rows))
ref, app = sys.argv[1], sys.argv[2]
prof(ref,460,381,'시안 2줄(너라는 계절) 판위 높이별 [책오른쪽 2/6/12/20DU]:')
prof(app,534,322,'앱   2줄(너라는 계절)                       :')
prof(ref,603,370,'시안 3줄(우리가)                            :')
prof(app,752,343,'앱   3줄(우리가)                            :')
