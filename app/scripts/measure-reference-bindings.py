"""Read blank print-free strips of the reference; emit native gradient metadata."""
import json
import math
from pathlib import Path
import numpy as np
from PIL import Image

root=Path(__file__).resolve().parents[1]
pixels=np.asarray(Image.open(root/'assets/reference/bookshelf-original.png').convert('RGB'))
# Color, printed face coordinates, clean interval along the book's height.
bindings=[
 (['#FDF0E0','#FEF1DF','#FDF0DF'],(61,350,62,340,0),(160,205)),
 (['#5E6D5B','#627260','#3D5F57'],(125,307,79,383,0),(210,275)),
 (['#FBD392','#FDD594'],(207,305,83,385,0),(225,245)),
 (['#CE886F','#CF886E','#BE5D47'],(548,309,74,381,0),(240,277)),
 (['#88A4BA','#8CA5BA','#8DA5B9','#B4C8D6'],(623,325,86,365,0),(216,259)),
 (['#819AB1','#B5C7D7'],(369,803,69,355,0),(244,275)),
 (['#FDECD4','#FDECD5'],(440,801,70,357,0),(245,274)),
 (['#3E5374'],(510,802,102,356,0),(23,44)),
 (['#A7AF95','#929D7B','#4E6B60'],(611,790,85,368,0),(270,285)),
 (['#F0BDA0','#F8C69F'],(692,826,65,335,-7),(221,238)),
 (['#8D4F4E','#893E41'],(393,1250,75,321,0),(221,236)),
 (['#F3B497','#E39E8A'],(37,1482,353,88,90),(231,255)),
 (['#F8E6CF'],(46,1411,343,69,90),(15,31)),
]
out={}
for aliases,(x,y,w,h,angle),(y0,y1) in bindings:
    count=round(h if angle==90 else w)
    colors=[]
    for i in range(count):
        samples=[]
        for j in range(y0,y1):
            if angle==90: sx,sy=x+j,y+h-1-i
            else:
                a=math.radians(angle)
                sx=x+math.cos(a)*i-math.sin(a)*j
                sy=y+math.sin(a)*i+math.cos(a)*j
            samples.append(pixels[round(sy),round(sx)])
        rgb=np.median(samples,axis=0).round().astype(int)
        colors.append('#'+''.join(f'{c:02X}' for c in rgb))
    profile={'colors':colors,'positions':[round(i/(count-1),6) for i in range(count)],'horizontal':angle==90}
    for alias in aliases:out[alias]=profile

# The blue jacket in the three-pose reference has its own soft binding roll.
# Its clean strip avoids the printed title and moon, and the pale paper head.
poses=np.asarray(Image.open(root/'assets/reference/book-poses-original.png').convert('RGB'))
colors=['#'+''.join(f'{v:02X}' for v in np.median(poses[481:513,x,:],axis=0).round().astype(int)) for x in range(725,810)]
profile={'colors':colors,'positions':[round(i/(len(colors)-1),6) for i in range(len(colors))],'horizontal':False}
for alias in ['#475B7A','#4B6080','#1D426B','#1E4260']:out[alias]=profile
target=root/'src/scene-config/reference-bindings.generated.json'
target.write_text(json.dumps(out,separators=(',',':')),encoding='utf-8')
print('Original binding materials:',len(bindings)+1,'recognized colors:',len(out),'bytes:',target.stat().st_size)
