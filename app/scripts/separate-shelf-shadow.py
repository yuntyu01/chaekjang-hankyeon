#!/usr/bin/env python3
"""그림자가 구워진 선반 PNG에서 나무판(윗면·앞면과 그 자체 명암)만 남긴다. 바깥 그림자는 코드(ShelfShadow)가 그린다.

입력: assets/bookshelf/source/shelf-single-v4-shadowed.png (받은 원본, 2172×724 RGBA, 앱 번들에는 안 들어감)
출력: assets/bookshelf/shelf-plank.png (같은 캔버스 크기 → 좌표·정규화 메타데이터가 원본과 그대로 맞는다)

방법: 불투명(alpha ≥ 240) 픽셀의 가장 큰 연결 덩어리 = 나무판 본체. 구멍은 메우고, 가장자리만 0.7px 부드럽게.
본체 밖 픽셀은 알파 0(구워진 그림자 제거). 마지막에 본체 밖에 남은 알파가 없는지 검사한다.

실행: python3 app/scripts/separate-shelf-shadow.py && python3 app/scripts/measure-shelf.py
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "assets/bookshelf/source/shelf-single-v4-shadowed.png")
OUT = os.path.join(ROOT, "assets/bookshelf/shelf-plank.png")


def main():
    img = np.asarray(Image.open(SRC).convert("RGBA")).copy()
    a = img[..., 3]
    n, lab, stats, _ = cv2.connectedComponentsWithStats((a >= 240).astype(np.uint8), connectivity=8)
    body = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask = (lab == body).astype(np.uint8)
    # 구멍 메우기(나무결 속 약간 투명한 점)
    flood = mask.copy()
    h, w = mask.shape
    ff = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(flood, ff, (0, 0), 1)
    mask = mask | (1 - flood)
    soft = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 0.7)
    alpha = np.clip(soft * 1.4 - 0.2, 0, 1)
    img[..., 3] = (alpha * 255).astype(np.uint8)
    # 가장자리 반투명 픽셀의 색은 가장 가까운 본체 색으로(구워진 그림자 색이 테두리에 번지지 않게)
    ring = (alpha > 0) & (mask == 0)
    if ring.any():
        inpaint_mask = (ring * 255).astype(np.uint8)
        bgr = cv2.cvtColor(img[..., :3], cv2.COLOR_RGB2BGR)
        fixed = cv2.inpaint(bgr, inpaint_mask, 2, cv2.INPAINT_TELEA)
        img[..., :3] = np.where(ring[..., None], cv2.cvtColor(fixed, cv2.COLOR_BGR2RGB), img[..., :3])
    Image.fromarray(img).save(OUT, optimize=True)

    # 검사: 본체에서 2px 넘게 떨어진 곳에 알파가 남으면 실패
    far = cv2.dilate(mask, np.ones((5, 5), np.uint8)) == 0
    leftover = int((img[..., 3][far] > 0).sum())
    x, y, bw, bh = (int(v) for v in stats[body][:4])
    print(f"plank bbox x={x}..{x + bw} y={y}..{y + bh} ({bw}×{bh}), baked shadow removed, leftover alpha px={leftover}")
    if leftover:
        sys.exit(1)


if __name__ == "__main__":
    main()
