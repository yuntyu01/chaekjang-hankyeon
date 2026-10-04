"""Read interface ink calibration; write JSON, without altering the PNG."""
from pathlib import Path
import json
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[1]
a=np.asarray(Image.open(root/'assets/reference/bookshelf-original.png').convert('RGB')).astype(float)
boxes={'heading':[56,127,191,51], 'shelfIcon':[141,1695,52,52],
       'bookmarkIcon':[400,1695,52,52], 'readIcon':[660,1695,52,52],
       'shelfLabel':[142,1762,49,28], 'bookmarkLabel':[404,1762,43,26], 'readLabel':[664,1762,43,26]}
out={}
for name,(x,y,w,h) in boxes.items():
    roi=a[y:y+h,x:x+w]
    ink=np.percentile(roi.reshape(-1,3),2,axis=0).round()
    bg=float(np.percentile(roi[:,:,0],95))-2
    out[name]={'bounds':[x,y,w,h],'ink':ink.astype(int).tolist(),'alpha':[-255/(bg-ink[0]),bg/(bg-ink[0])]}
(root/'src/ui/art/reference-ui.generated.json').write_text(json.dumps(out,separators=(',',':')),encoding='utf-8')
print('Original interface marks:',len(out))
