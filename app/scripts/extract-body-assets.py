#!/usr/bin/env python3
"""코드로 그리는 책 몸체(BookBody)에 입힐 평평한 그림 자산을 시안 원본에서 뽑는다.

책의 형태(크기·윤곽·옆면·윗면·명암)는 코드가 그리고, 여기서는 색을 뺀 재료만 만든다.
- assets/body/brush-detail.png : 책 표면의 붓결·종이 결(명암만, 128 = 변화 없음). 이음새 없이 반복된다.
- assets/body/motif/<id>.png   : 책등 모티프(투명 배경)
- src/domain/body-art.generated.ts : 책별 앞면 색, 모티프 위치(책 높이 비율)

[임시] 시안 원본(assets/source/books-source.png)에서 뽑은 개발용 재료. 최종 재장정 아트로 교체한다.
실행: python3 app/scripts/extract-body-assets.py
"""
import json
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SRC = os.path.join(ROOT, "assets/source/books-source.png")
OUT = os.path.join(ROOT, "assets/body")
TS = os.path.join(ROOT, "src/domain/body-art.generated.ts")

# 재료를 뽑을 예시 자리(시안 원본 px 윤곽 박스). 새 예시 책(실제 책)이 이 자리의 색·모티프를 물려받는다.
# rot: 원본에서 기울어져 있는 책을 똑바로 세울 각도(PIL 반시계 도)
SPINES = {
    "b01": dict(box=(59, 258, 144, 647)),
    "b02": dict(box=(147, 225, 251, 647)),
    "b03": dict(box=(246, 252, 340, 646), art_from=0.56),
    "b05": dict(box=(620, 242, 709, 646)),
    "b17": dict(box=(711, 255, 800, 648), rot=-3, art_from=0.55, fx=0.2),
    "b06": dict(box=(800, 280, 900, 647), rot=-7, fx=0.22, thr=7),
    "b08": dict(box=(416, 724, 497, 1107)),
    "b09": dict(box=(498, 735, 567, 1107), art_from=0.59),
    "b10": dict(box=(568, 727, 654, 1107), art_from=0.76),
    "b18": dict(box=(656, 714, 746, 1107), art_from=0.74),
    "b11": dict(box=(770, 730, 890, 1100), rot=-7, art_from=0.61),
    "b14": dict(box=(478, 1163, 555, 1458), art_from=0.68),
    "b15": dict(box=(557, 1168, 620, 1458), art_from=0.61),
}
# 누운 책: 책등 면(윗면 아래)과 모티프 x 범위
HORIZONTALS = {
    "b12": dict(face=(60, 1366, 455, 1452), motif_x=(355, 410)),
    "b13": dict(face=(75, 1292, 440, 1358), motif_x=(330, 400)),
}
# 앞표지: 안쪽 그림 영역과 지울 제목 영역
COVERS = {
    "b04": dict(inner=(353, 288, 609, 643), title=(405, 376, 570, 470)),
    "b07": dict(inner=(90, 736, 376, 1104), title=(166, 820, 314, 878)),
    "b16": dict(inner=(647, 1184, 879, 1457), title=(658, 1203, 879, 1272)),
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


def measure_grain(img):
    """시안 책 면의 결 세기(밝기 대비 표준편차)."""
    stds = []
    for (x0, y0, x1, y1) in GRAIN_PATCHES:
        patch = img[y0:y1, x0:x1].mean(axis=2)
        detail = (patch - cv2.GaussianBlur(patch, (0, 0), 5)) / (patch.mean() + 1e-6)
        stds.append(float(np.clip(detail, -3 * detail.std(), 3 * detail.std()).std()))
    return stds


def _bands(t, k=1.0):
    """결을 굵기별로 나눈 세기: 미세(<0.5DU) / 중간(0.5~1.5DU) / 얼룩(1.5~4DU). k = 1DU의 px."""
    g = lambda s: cv2.GaussianBlur(t, (0, 0), s * k, borderType=cv2.BORDER_REFLECT)
    a, b, c = g(0.5), g(1.5), g(4)
    return np.array([(t - a).std(), (a - b).std(), (b - c).std()])


def brush_detail(img):
    """시안의 과슈 질감: 요철(빛 방향 음영) 없이 평평한 물감 얼룩 + 약간 비스듬한 결 + 드문 밝은 점·잔 긁힘.
    각 성분은 걸러 낸 잡음이라 타일 경계에서 이음새 없이 반복된다.
    굵기별 세기는 시안 책 면(데미안)에서 잰 비율에 맞춘다."""
    n = GRAIN_SIZE
    k = 941 / 390  # 1DU = 시안 px
    rng = np.random.default_rng(21)
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]

    def noise(sig, stretch=1.0, ang=0.0):
        # 가우시안으로 거른 흰 잡음(주파수 영역이라 둥글게 이어진다). stretch>1이면 ang 방향으로 길쭉.
        u = fx * np.cos(ang) + fy * np.sin(ang)
        v = -fx * np.sin(ang) + fy * np.cos(ang)
        filt = np.exp(-2 * np.pi**2 * sig**2 * ((u * stretch) ** 2 + (v) ** 2))
        out = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n))) * filt))
        return (out / out.std()).astype(np.float32)

    blot = noise(4.2) + 0.25 * noise(9.0)  # 물감 얼룩
    streak = noise(1.3, stretch=1.8, ang=np.radians(-55))  # 비스듬한 붓결(짧고 옅게)
    fine = noise(0.55)  # 종이 결
    marks = np.zeros((n, n), np.float32)
    yy, xx = np.mgrid[-10:11, -10:11].astype(np.float32)

    def stamp(cx, cy, kern):
        r = kern.shape[0] // 2
        ys = (np.arange(-r, r + 1) + int(cy)) % n
        xs = (np.arange(-r, r + 1) + int(cx)) % n
        marks[np.ix_(ys, xs)] += kern

    for _ in range(28):  # 밝은 점
        r = rng.uniform(0.5, 0.9)
        stamp(rng.uniform(0, n), rng.uniform(0, n), rng.uniform(0.6, 1.0) * np.exp(-(xx**2 + yy**2) / (r * r)))
    for _ in range(10):  # 잔 긁힘(가늘고 밝은 짧은 선)
        ang = np.radians(rng.normal(-55, 20))
        u = xx * np.cos(ang) + yy * np.sin(ang)
        v = -xx * np.sin(ang) + yy * np.cos(ang)
        stamp(rng.uniform(0, n), rng.uniform(0, n), 0.5 * np.exp(-((u / rng.uniform(3, 7)) ** 2) - (v / 0.45) ** 2))
    marks /= marks.std() + 1e-6
    # 물결치는 가는 결(붓자국 가장자리·종이 섬유): 부드럽게 휘는 짧은 곡선, 밝은 것과 어두운 것
    veins = np.zeros((n * 4, n * 4), np.uint8)
    for i in range(70):
        x, y = rng.uniform(0, n * 4), rng.uniform(0, n * 4)
        a = np.radians(rng.normal(-40, 35))
        pts = []
        for _ in range(int(rng.uniform(25, 60))):
            pts.append((x, y))
            a += rng.normal(0, 0.12)
            x += 4 * np.cos(a)
            y += 4 * np.sin(a)
        val = 200 if i % 3 else 60
        for dx in (-n * 4, 0, n * 4):
            for dy in (-n * 4, 0, n * 4):
                cv2.polylines(veins, [np.int32([(px + dx, py + dy) for px, py in pts])], False, val, 2, cv2.LINE_AA)
    vein = cv2.resize(veins.astype(np.float32), (n, n), interpolation=cv2.INTER_AREA)
    vein = np.where(vein > 0, vein - 0, 0)
    vein = (vein * (veins.reshape(n, 4, n, 4).max(axis=(1, 3)) >= 200) - vein * (veins.reshape(n, 4, n, 4).max(axis=(1, 3)) < 200))
    vein = cv2.GaussianBlur(np.pad(vein, 4, mode="wrap"), (0, 0), 0.6)[4:-4, 4:-4]
    vein /= vein.std() + 1e-6

    # 굵기별 세기(%). 시안 데미안 면을 확대해 본 인상에 맞춘 값: 얼룩은 은은하게, 잔결·긁힘이 먼저 보인다.
    # (시안 면을 그대로 재면 책등 명암·가장자리까지 섞여 얼룩 값이 부풀어서 쓰지 않는다)
    target = np.array([1.6, 1.5, 1.7]) / 100
    w = np.array([1.0, 1.0, 1.0, 0.6, 0.45])
    comps = [fine, streak, blot, marks, vein]
    for _ in range(8):
        tex = sum(wi * c for wi, c in zip(w, comps))
        got = _bands(tex, k)
        w[0] *= target[0] / got[0]
        w[1] *= target[1] / got[1]
        w[2] *= target[2] / got[2]
        w[3] = 0.6 * w[0]
        w[4] = 0.45 * w[0]
    tex = sum(wi * c for wi, c in zip(w, comps))
    tex -= tex.mean()
    print("grain bands(%)", np.round(_bands(tex, k) * 100, 2), "std", round(float(tex.std()), 4))
    # 명암 차를 5배로 담는다(앱에서 GRAIN_STRENGTH로 줄인다)
    tile = np.clip(128 + tex * 128 * 5.0, 0, 255).astype(np.uint8)
    Image.fromarray(np.dstack([tile, tile, tile, np.full_like(tile, 255)])).save(os.path.join(OUT, "brush-detail.png"), optimize=True)
    return tile.shape


def motif(img, face_color, box, thr=22):
    x0, y0, x1, y1 = box
    region = img[y0:y1, x0:x1]
    lab = cv2.cvtColor(region.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    bg = cv2.cvtColor(np.array(face_color, np.uint8).reshape(1, 1, 3), cv2.COLOR_RGB2LAB).astype(np.float32)[0, 0]
    d = np.linalg.norm(lab - bg, axis=2)
    alpha = np.clip((d - thr) / (18 if thr >= 15 else 8), 0, 1)
    # 작은 잡티 제거
    n, lab_, stats, _ = cv2.connectedComponentsWithStats((alpha > 0.4).astype(np.uint8), connectivity=8)
    keep = np.zeros_like(alpha)
    H = alpha.shape[0]
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        edge_line = w <= 6 and h > 0.35 * H  # 책 가장자리 세로선
        if area >= 12 and not edge_line:
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


def upright(img, box, rot):
    if not rot:
        return img, box
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    pil = Image.fromarray(img.astype(np.uint8)).rotate(rot, center=(cx, cy), resample=Image.BICUBIC)
    return np.asarray(pil).astype(np.float32), box


def face_color(region):
    lab = cv2.cvtColor(region.astype(np.uint8), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    med = np.median(lab, axis=0)
    d = np.linalg.norm(lab - med, axis=1)
    return np.median(region.reshape(-1, 3)[d < np.percentile(d, 50)], axis=0)


def spine_art(img, bid, b):
    img, (x0, y0, x1, y1) = upright(img, b["box"], b.get("rot", 0))
    w, h = x1 - x0, y1 - y0
    fx0, fx1 = x0 + int(w * b.get("fx", 0.08)), x0 + int(w * 0.74)
    face = face_color(img[y0 + int(h * 0.08) : y0 + int(h * 0.95), fx0:fx1])
    # 그림은 책 아래쪽 절반(제목은 위쪽). 앞면 폭 안에서만.
    ay0 = y0 + int(h * b.get("art_from", 0.5))
    m, (mx0, my0, mx1, my1) = motif(img, face, (fx0, ay0, fx1, y1 - 4), b.get("thr", 22))
    m.save(os.path.join(OUT, "motif", f"{bid}.png"), optimize=True)
    scene = (mx1 - mx0) > 0.8 * (fx1 - fx0)
    return dict(
        face=hexc(face),
        motifTop=round((my0 - y0) / h, 4),
        motifBottom=round((my1 - y0) / h, 4),
        motifCx=round(((mx0 + mx1) / 2 - x0) / (w * 0.765), 4),
        scene=bool(scene),
    )


def horizontal_art(img, bid, b):
    x0, y0, x1, y1 = b["face"]
    face = face_color(img[y0 + 8 : y1 - 8, x0 + 20 : b["motif_x"][0] - 10])
    m, _ = motif(img, face, (b["motif_x"][0], y0 + 4, b["motif_x"][1], y1 - 4))
    m.save(os.path.join(OUT, "motif", f"{bid}.png"), optimize=True)
    return dict(face=hexc(face), motifTop=0.2, motifBottom=0.8, motifCx=0.5, scene=False)


def cover_art(img, bid, b):
    x0, y0, x1, y1 = b["inner"]
    tx0, ty0, tx1, ty1 = b["title"]
    region = img[ty0:ty1, tx0:tx1]
    lab = cv2.cvtColor(region.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    bg = np.median(lab.reshape(-1, 3), axis=0)
    d = np.linalg.norm(lab - bg, axis=2)
    ink = (d > max(18.0, np.percentile(d, 60))).astype(np.uint8)
    full = np.zeros(img.shape[:2], np.uint8)
    full[ty0:ty1, tx0:tx1] = cv2.dilate(ink, np.ones((5, 5), np.uint8), iterations=2) * 255
    bgr = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_RGB2BGR)
    clean = cv2.cvtColor(cv2.inpaint(bgr, full, 7, cv2.INPAINT_TELEA), cv2.COLOR_BGR2RGB)
    crop = clean[y0:y1, x0:x1]
    Image.fromarray(crop).save(os.path.join(OUT, "cover", f"{bid}.png"), optimize=True)
    ink_c = np.median(region[ink > 0], axis=0) if ink.any() else np.array([30, 30, 40])
    return dict(
        titleTop=round((ty0 - y0) / (y1 - y0), 4),
        ink=hexc(ink_c),
        dark=bool(np.mean(crop[: int(crop.shape[0] * 0.4)]) < 110),
    )


def main():
    os.makedirs(os.path.join(OUT, "motif"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "cover"), exist_ok=True)
    img = load()
    tile = brush_detail(img)
    bodies = {bid: spine_art(img, bid, b) for bid, b in SPINES.items()}
    bodies.update({bid: horizontal_art(img, bid, b) for bid, b in HORIZONTALS.items()})
    covers = {bid: cover_art(img, bid, b) for bid, b in COVERS.items()}
    lines = [
        "// 자동 생성: app/scripts/extract-body-assets.py. 직접 고치지 말 것.",
        "// [임시 자산] 시안 원본에서 뽑은 평평한 재료(색·모티프·책등 그림·표지 그림·붓결). 최종 재장정 아트로 교체한다.",
        "",
        "export type BodyArt = { face: string; motif: number; motifTop: number; motifBottom: number; motifCx: number; scene: boolean };",
        "export type CoverArt = { image: number; titleTop: number; ink: string };",
        "",
        "export const BRUSH_DETAIL = require('../../assets/body/brush-detail.png');",
        f"export const BRUSH_TILE_PX = {tile[1]}; // 원본 px(시안 941px 폭 기준)",
        "",
        "export const BODY_ART: Record<string, BodyArt> = {",
    ]
    for bid, m in bodies.items():
        lines.append(
            f"  {bid}: {{ face: '{m['face']}', motif: require('../../assets/body/motif/{bid}.png'), motifTop: {m['motifTop']}, "
            f"motifBottom: {m['motifBottom']}, motifCx: {m['motifCx']}, scene: {str(m['scene']).lower()} }},"
        )
    lines += ["};", "", "export const COVER_ART: Record<string, CoverArt> = {"]
    for bid, c in covers.items():
        lines.append(f"  {bid}: {{ image: require('../../assets/body/cover/{bid}.png'), titleTop: {c['titleTop']}, ink: '{c['ink']}' }},")
    lines += ["};", ""]
    with open(TS, "w") as f:
        f.write("\n".join(lines))
    print(json.dumps({**bodies, **covers}, ensure_ascii=False, indent=0))


if __name__ == "__main__":
    main()
