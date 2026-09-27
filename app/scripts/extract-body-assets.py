#!/usr/bin/env python3
"""코드로 그리는 책 몸체(BookBody)에 입힐 평평한 그림 자산을 시안 원본에서 뽑는다.

책의 형태(크기·윤곽·옆면·윗면·명암)는 코드가 그리고, 여기서는 색을 뺀 재료만 만든다.
- assets/body/brush-detail.png : 책 표면의 붓결·종이 결(명암만, 128 = 변화 없음). 이음새 없이 반복된다.
- assets/body/motif/<id>.png   : 책등 모티프(투명 배경)
- src/domain/body-art.generated.ts : 책별 앞면 색, 모티프 위치(책 높이 비율)

[임시] 시안 원본(assets/reference/books-source.png)에서 뽑은 개발용 재료. 최종 재장정 아트로 교체한다.
실행: python3 app/scripts/extract-body-assets.py
"""
import json
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "assets/reference/books-source.png")
OUT = os.path.join(ROOT, "assets/body")
TS = os.path.join(ROOT, "src/domain/body-art.generated.ts")

# 책등 앞면의 깨끗한 영역(제목·모티프를 피한 곳)과 모티프 영역. 원본 px.
# face: 앞면 좌우(x0, x1), top/bottom: 책 위·아래 끝, motif: (x0, y0, x1, y1)
BOOKS = {
    "b02": dict(face=(152, 222), top=229, bottom=646, clean=[(236, 318), (540, 600)], motif=(150, 425, 220, 632)),
}
# 붓결 통계를 잴 깨끗한 면(x0, y0, x1, y1): 여러 색의 책에서 제목·모티프를 피한 곳
GRAIN_PATCHES = [(154, 236, 222, 318), (154, 540, 222, 600), (64, 280, 132, 330), (628, 250, 696, 300), (580, 780, 640, 830)]
GRAIN_SIZE = 256  # 합성할 질감 크기(원본 px)

def load():
    return np.asarray(Image.open(SRC).convert("RGB")).astype(np.float32)


def hexc(c):
    return "#%02X%02X%02X" % tuple(int(round(v)) for v in c)


def seamless(tile):
    """가운데가 원본, 가장자리는 반 칸 밀린 사본과 섞어 이음새를 없앤다."""
    h, w = tile.shape
    rolled = np.roll(np.roll(tile, h // 2, axis=0), w // 2, axis=1)
    wy = np.sin(np.linspace(0, np.pi, h))[:, None]
    wx = np.sin(np.linspace(0, np.pi, w))[None, :]
    wgt = (wy * wx) ** 0.6
    return tile * wgt + rolled * (1 - wgt)


def brush_detail(img):
    """여러 책 면의 결에서 주파수 분포(결의 방향·굵기)만 재서, 무작위 위상으로 같은 성질의 질감을 합성한다.
    한 조각을 반복하지 않으므로 반복 무늬가 없고, 푸리에 합성이라 이음새 없이 반복된다."""
    n = 48
    spec = np.zeros((n, n))
    stds = []
    win = np.outer(np.hanning(n), np.hanning(n))
    for (x0, y0, x1, y1) in GRAIN_PATCHES:
        patch = img[y0:y1, x0:x1].mean(axis=2)
        detail = (patch - cv2.GaussianBlur(patch, (0, 0), 5)) / (patch.mean() + 1e-6)
        detail = np.clip(detail, -3 * detail.std(), 3 * detail.std())  # 튀는 점(반사광·먼지) 제외
        stds.append(detail.std())
        for yy in range(0, detail.shape[0] - n + 1, 12):
            for xx in range(0, detail.shape[1] - n + 1, 12):
                w = detail[yy:yy + n, xx:xx + n] * win
                spec += np.abs(np.fft.fft2(w)) ** 2
    amp = np.sqrt(np.fft.fftshift(spec))
    amp = cv2.resize(amp, (GRAIN_SIZE, GRAIN_SIZE), interpolation=cv2.INTER_CUBIC)
    amp = np.fft.ifftshift(amp)
    rng = np.random.default_rng(7)
    phase = np.exp(2j * np.pi * rng.random((GRAIN_SIZE, GRAIN_SIZE)))
    tex = np.real(np.fft.ifft2(amp * phase))
    tex = tex / tex.std() * float(np.median(stds))
    tile = np.clip(128 + tex * 128 * 5.0, 0, 255).astype(np.uint8)
    rgba = np.dstack([tile, tile, tile, np.full_like(tile, 255)])
    Image.fromarray(rgba).save(os.path.join(OUT, "brush-detail.png"), optimize=True)
    print("grain std(ratio)", [round(v, 4) for v in stds])
    return tile.shape


def motif(img, face_color, box):
    x0, y0, x1, y1 = box
    region = img[y0:y1, x0:x1]
    lab = cv2.cvtColor(region.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    bg = cv2.cvtColor(np.array(face_color, np.uint8).reshape(1, 1, 3), cv2.COLOR_RGB2LAB).astype(np.float32)[0, 0]
    d = np.linalg.norm(lab - bg, axis=2)
    alpha = np.clip((d - 22) / 18, 0, 1)
    # 작은 잡티 제거
    n, lab_, stats, _ = cv2.connectedComponentsWithStats((alpha > 0.4).astype(np.uint8), connectivity=8)
    keep = np.zeros_like(alpha)
    for i in range(1, n):
        if stats[i][4] >= 12:
            keep[lab_ == i] = 1
    keep = cv2.dilate(keep, np.ones((3, 3), np.uint8))
    alpha = alpha * keep
    bgc = np.array(face_color, np.float32)
    a3 = np.maximum(alpha[..., None], 1e-3)
    color = np.clip((region - bgc * (1 - a3)) / a3, 0, 255)
    ys, xs = np.nonzero(alpha > 0.1)
    by0, by1, bx0, bx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([color, alpha * 255])[by0:by1, bx0:bx1].astype(np.uint8)
    return Image.fromarray(rgba), (x0 + bx0, y0 + by0, x0 + bx1, y0 + by1)


def main():
    os.makedirs(os.path.join(OUT, "motif"), exist_ok=True)
    img = load()
    tile = brush_detail(img)
    meta = {}
    for bid, b in BOOKS.items():
        fx0, fx1 = b["face"]
        rows = np.concatenate([img[y0:y1, fx0:fx1].reshape(-1, 3) for y0, y1 in b["clean"]])
        face = np.median(rows, axis=0)
        m, (mx0, my0, mx1, my1) = motif(img, face, b["motif"])
        m.save(os.path.join(OUT, "motif", f"{bid}.png"), optimize=True)
        h = b["bottom"] - b["top"]
        meta[bid] = dict(
            face=hexc(face),
            motifTop=round((my0 - b["top"]) / h, 4),
            motifBottom=round((my1 - b["top"]) / h, 4),
            motifCx=round(((mx0 + mx1) / 2 - fx0) / (fx1 - fx0), 4),
        )
    lines = [
        "// 자동 생성: app/scripts/extract-body-assets.py. 직접 고치지 말 것.",
        "// [임시 자산] 시안 원본에서 뽑은 책 몸체 재료(색·모티프·붓결). 최종 재장정 아트로 교체한다.",
        "",
        "export type BodyArt = { face: string; motif: number; motifTop: number; motifBottom: number; motifCx: number };",
        "",
        "export const BRUSH_DETAIL = require('../../assets/body/brush-detail.png');",
        f"export const BRUSH_TILE_PX = {tile[1]}; // 원본 px(시안 941px 폭 기준)",
        "",
        "export const BODY_ART: Record<string, BodyArt> = {",
    ]
    for bid, m in meta.items():
        lines.append(
            f"  {bid}: {{ face: '{m['face']}', motif: require('../../assets/body/motif/{bid}.png'), "
            f"motifTop: {m['motifTop']}, motifBottom: {m['motifBottom']}, motifCx: {m['motifCx']} }},"
        )
    lines += ["};", ""]
    with open(TS, "w") as f:
        f.write("\n".join(lines))
    print(json.dumps(meta, ensure_ascii=False), "tile", tile)


if __name__ == "__main__":
    main()
