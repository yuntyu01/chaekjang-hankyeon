# 책 그림자 지도(2026-11-10 사용자 댓글 '그림자 좀 안 맞음'): 시안 벽의 빛·그늘을 바탕(plate)에 대한 비로 떠서
# 책 가장자리에 붙여 곱한다. 흐린 세 겹 그늘(이전 방식)은 그림자 윗선이 책 머리에서 평평하게 퍼져, 시안의 비스듬한 윗선과
# 책 오른쪽 위 밝은 벽을 못 그렸다. 이 지도는 시안 그대로라 시안 책 자리에서는 시안과 같고, 다른 책은 왼쪽 반은 왼쪽 끝에,
# 오른쪽 반은 오른쪽 끝에 붙여 옮긴다(share-scene.ts SHADE_SKSL).
#   T = 흐린 시안 / 흐린 바탕(책 화소는 빼고 흐림), 책 밑(보이지 않는 곳)은 둘레 값으로 메움
#   저장: assets/share/book-shade.png 회색 v = (T - 0.5) × 400 (T 0.5~1.1375, 한 단계 0.0025), 지도 자리는 MAP 상자
import os, sys, json
import numpy as np, cv2
from PIL import Image
HERE = os.path.dirname(__file__)
REF = os.environ.get('REF', os.path.join(HERE, '../../../docs/design/책 공유 시안 (빛·그림자 기준).png'))
PLATE = os.path.join(HERE, '../../assets/share/plate.png')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '../../assets/share/book-shade.png')

ref = np.asarray(Image.open(REF).convert('RGB')).astype(np.float32).mean(2)
pl = np.asarray(Image.open(PLATE).convert('RGB')).astype(np.float32).mean(2)
H, W = ref.shape
# 시안 책 모양(표지 239..672 × 224..840 + 오른쪽 속지 띠)
sil = np.zeros((H, W), np.uint8)
sil[224:841, 239:673] = 1
cv2.fillPoly(sil, [np.array([[672, 231], [699, 239], [699, 831], [672, 840]], np.int32)], 1)
book = cv2.dilate(sil, np.ones((5, 5), np.uint8)) > 0
SHELF_TOP = 827
valid = (~book).astype(np.float32)
valid[SHELF_TOP:] = 0


def nblur(img, w, s):
    return cv2.GaussianBlur(img * w, (0, 0), s) / np.maximum(cv2.GaussianBlur(w, (0, 0), s), 1e-4)


S = 2.5
T = nblur(ref, valid, S) / np.maximum(nblur(pl, valid, S), 1)
# 책 밑·선반: 둘레 값으로 점점 넓게 흐려 메운다(보이지 않지만 가장자리 섞임에 쓰인다)
need = ~(valid > 0)
f = T.copy()
w = valid.copy()
for s in (4, 8, 16, 32, 64):
    fill = nblur(np.where(w > 0, f, 0), (w > 0).astype(np.float32), s)
    f = np.where(w > 0, f, fill)
    w = np.maximum(w, (cv2.GaussianBlur((w > 0).astype(np.float32), (0, 0), s) > 0.02).astype(np.float32))
T = np.where(need, f, T)
# 지도 상자: 바탕을 메운 곳(plate.py 상자)을 넉넉히. 상자 끝 16px는 1로 부드럽게 줄인다
x0, y0, x1, y1 = 200, 180, 880, SHELF_TOP
M = T[y0:y1, x0:x1].copy()
hh, ww = M.shape
fx = np.clip(np.minimum(np.arange(ww), ww - 1 - np.arange(ww)) / 16, 0, 1)
fy = np.clip(np.arange(hh) / 16, 0, 1)  # 아래 끝(선반)은 그대로
fade = np.outer(fy, fx)
M = 1 + (M - 1) * fade
M = np.clip(M, 0.5, 1.1375)
v = np.round((M - 0.5) * 400).astype(np.uint8)
Image.fromarray(v).save(OUT)
print(json.dumps({'map': [x0, y0, x1 - x0, y1 - y0], 'min': float(M.min()), 'max': float(M.max()), 'out': OUT}))
