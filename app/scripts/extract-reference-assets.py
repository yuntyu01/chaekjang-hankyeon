#!/usr/bin/env python3
"""시안(docs/design/home-reference.png)에서 온보딩 예시 18권의 개발용 샘플 자산을 뽑는다.

- 책마다 책등/표지/가로 책등 면을 잘라내고, 그림에 박힌 제목 글자는 지운다(inpaint). 제목은 앱이 다시 조판한다.
- 모티프(잎·꽃 등)는 책 바탕색을 빼서 투명 PNG로 만든다(형태가 바뀌어도 같은 그림을 쓰려고).
- 책 종이 질감을 타일로 만든다(코드로 그리는 책에 겹쳐 쓴다).
- 치수(설계 단위 DU, 폭 390 기준)·바탕색·제목 위치/크기/색을 src/domain/onboarding-sample.generated.ts 로 쓴다.

실행: python3 app/scripts/extract-reference-assets.py  (opencv-python-headless, numpy, pillow 필요)
"""
import json
import math
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF = os.path.join(ROOT, "docs/design/home-reference.png")
OUT = os.path.join(ROOT, "app/assets/temp-reference")  # 임시 자산(TEMP): 최종 재장정 아트로 교체 대상
TS = os.path.join(ROOT, "app/src/domain/onboarding-sample.generated.ts")
S = 390 / 941  # 시안 px → 설계 단위

# kind: spine | cover | horizontal
# box: 책이 차지하는 칸(시안 px). tilt 책은 똑바로 세운 뒤(pivot 기준 회전) 좌표.
# title: 제목 글자가 있는 영역(x0, y0, x1, y1). motif: 모티프 영역(y0, y1) — 없으면 None
BOOKS = [
    # 1번 선반 (바닥 646)
    dict(id="b01", title="모순", author="양귀자", kind="spine", box=(58, 260, 144, 646), title_box=(62, 318, 135, 410), motif=(470, 632), motif_xr=(66, 124), shelf=1),
    dict(id="b02", title="데미안", author="헤르만 헤세", kind="spine", box=(144, 228, 244, 646), title_box=(150, 312, 235, 420), motif=(425, 638), motif_xr=(160, 220), shelf=1),
    dict(id="b03", title="어린왕자", author="생텍쥐페리", kind="spine", box=(244, 254, 336, 646), title_box=(250, 338, 335, 466), motif=None, shelf=1),
    dict(id="b04", title="달과 나", kind="cover", box=(341, 276, 617, 646), title_box=(420, 392, 585, 442), shelf=1),
    dict(id="b05", title="문장 수집", kind="spine", box=(619, 241, 709, 646), foreign=[(619, 241), (635, 241), (635, 480), (619, 480)], title_box=(620, 295, 700, 472), motif=(470, 642), motif_xr=(655, 702), shelf=1),
    dict(id="b17", title="느린 하루", kind="spine", box=(709, 255, 805, 646), foreign=[(784, 255), (806, 255), (806, 646), (811, 646), (784, 284)], foreign_from="left", title_box=(715, 328, 800, 465), motif=(488, 642), motif_xr=(762, 800), shelf=1),
    dict(id="b06", title="흰", author="한강", kind="spine", box=(820, 290, 899, 646), title_box=(840, 345, 892, 404), motif=(398, 640), motif_xr=(833, 899), motif_thr=6,
         tilt=-7, pivot=(810, 646), shelf=1),
    # 2번 선반 (바닥 1107)
    dict(id="b07", title="여름의 숲", kind="cover", box=(79, 724, 386, 1107), title_box=(170, 835, 330, 882), shelf=2),
    dict(id="b08", title="여행의 이유", author="김영하", kind="spine", box=(415, 724, 497, 1107), title_box=(420, 770, 492, 928), motif=None, shelf=2),
    dict(id="b09", title="작은 것들의 깊이", kind="spine", box=(497, 734, 567, 1107), title_box=(502, 780, 562, 956), motif=None, shelf=2),
    dict(id="b10", title="사람의 마음이란", kind="spine", box=(567, 726, 654, 1107), title_box=(575, 843, 648, 1006), motif=None, shelf=2),
    dict(id="b18", title="아주 보통의 하루", kind="spine", box=(654, 714, 746, 1107), title_box=(662, 768, 740, 978), motif=(1000, 1100), motif_xr=(672, 732), shelf=2),
    dict(id="b11", title="너라는 계절", kind="spine", box=(786, 738, 905, 1108), title_box=(800, 800, 890, 962), motif=(972, 1098), motif_xr=(822, 888),
         tilt=-7, pivot=(787, 1110), poly=[(786, 744), (873, 738), (905, 1104), (786, 1108)], shelf=2),
    # 3번 선반 (바닥 1459)
    dict(id="b12", title="찰나의 마음", kind="horizontal", box=(42, 1338, 460, 1456), poly=[(62, 1338), (452, 1338), (460, 1350), (460, 1456), (42, 1456), (42, 1360)], title_box=(80, 1382, 260, 1430), motif_x=(360, 405), stack=0, shelf=3),
    dict(id="b13", title="좋은 문장은 이렇게 온다", kind="horizontal", box=(61, 1264, 449, 1361), poly=[(112, 1265), (446, 1265), (449, 1272), (449, 1361), (61, 1361), (61, 1291)], title_box=(82, 1302, 305, 1345), motif_x=(330, 400), stack=1, shelf=3),
    dict(id="b14", title="고요한 우연", kind="spine", box=(479, 1161, 555, 1459), title_box=(484, 1198, 550, 1338), motif=(1350, 1444), motif_xr=(493, 537), shelf=3),
    dict(id="b15", title="아무튼, 독서", kind="spine", box=(555, 1165, 620, 1459), title_box=(560, 1208, 615, 1332), motif=(1350, 1446), motif_xr=(562, 613), shelf=3),
    dict(id="b16", title="우리가 빛의 속도로 갈 수 없다면", author="김초엽", kind="cover", box=(634, 1173, 891, 1459), title_box=(655, 1210, 875, 1275),
         cover_lines="우리가\n빛의 속도로 갈 수 없다면", shelf=3),
]

DARK, LIGHT = "#1F2533", "#F2EADB"
# 제목 조판 값: 시안 격자(2배 확대, 20px 눈금)에서 직접 읽었다. 자동 측정은 붓결·그림 때문에 흔들려서 쓰지 않는다.
# spine/cover: top=첫 글자 윗단(책 높이 비율), cx=글자 가운데(책 폭 비율), size=글자 크기(DU)
# horizontal: left=첫 글자 왼쪽(책 길이 비율), cy=글자 가운데(책 두께 비율)
TITLES = {
    "b01": dict(top=0.195, cx=0.44, size=12.3, ink=DARK),
    "b02": dict(top=0.218, cx=0.455, size=11.9, ink=LIGHT),
    "b03": dict(top=0.233, cx=0.43, size=10.8, ink=DARK),
    "b04": dict(top=0.33, cx=0.52, size=13.2, ink="#F3EEE3"),
    "b05": dict(top=0.151, cx=0.587, size=10.8, ink="#F6E9D8"),
    "b17": dict(top=0.205, cx=0.56, size=10.3, ink=DARK),
    "b06": dict(top=0.24, cx=0.64, size=11.0, ink=DARK),
    "b07": dict(top=0.303, cx=0.528, size=12.4, ink=DARK),
    "b08": dict(top=0.138, cx=0.49, size=9.5, ink=DARK),
    "b09": dict(top=0.137, cx=0.47, size=7.9, ink=DARK),
    "b10": dict(top=0.317, cx=0.55, size=7.8, ink="#E8E2D6"),
    "b18": dict(top=0.162, cx=0.48, size=9.1, ink="#EFE6D2"),
    "b11": dict(top=0.18, cx=0.555, size=9.9, ink=DARK),
    "b12": dict(left=0.121, cy=0.66, size=9.8, ink="#2A2530"),
    "b13": dict(left=0.075, cy=0.63, size=7.9, ink="#2A2E38"),
    "b14": dict(top=0.157, cx=0.5, size=8.5, ink="#F0E2DC"),
    "b15": dict(top=0.17, cx=0.54, size=8.4, ink=DARK),
    "b16": dict(top=0.164, cx=0.52, size=7.8, ink="#2B2B38", line=1.65),
}

# 키를 늘릴 때 늘려도 되는 빈 바탕 띠: 책등은 제목 끝~그림 시작 사이(자동), 그림 시작 줄을 모티프가 없는 책만 지정.
ART_Y = {"b03": 548, "b08": 930, "b09": 985, "b10": 1012}
# 표지 전시 책: 제목과 그림 사이의 하늘 띠(표지 높이 비율)
COVER_BAND = {"b04": (0.43, 0.5), "b07": (0.37, 0.43), "b16": (0.29, 0.4)}

# 가로 책의 보이는 윗면(표지 면) 높이(px)와 색 채취 영역
TOP_FACE = {"b13": (1265, 1290), "b12": (1340, 1360)}


def load():
    return np.asarray(Image.open(REF).convert("RGB"))


def upright(img, b):
    """기울어진 책은 pivot 기준으로 반대로 돌려 똑바로 세운다."""
    if not b.get("tilt"):
        return img
    pil = Image.fromarray(img)
    # 시안의 책은 왼쪽으로 기울어(반시계) 있다 → 시계 방향으로 되돌린다.
    return np.asarray(pil.rotate(b["tilt"], center=b["pivot"], resample=Image.BICUBIC))


def ink_mask(region):
    """제목 글자 픽셀: 영역 바탕색(중앙값)에서 멀리 떨어진 색."""
    lab = cv2.cvtColor(region, cv2.COLOR_RGB2LAB).astype(np.float32)
    bg = np.median(lab.reshape(-1, 3), axis=0)
    d = np.linalg.norm(lab - bg, axis=2)
    thr = max(18.0, np.percentile(d, 62))
    m = (d > thr).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return m


def mirror_fill(img, poly, side):
    """이웃 책이 겹쳐 그려진 영역을 자기 쪽 면을 거울처럼 비춰 채운다(inpaint는 이웃 색을 끌어와서 안 씀)."""
    fm = np.zeros(img.shape[:2], np.uint8)
    cv2.fillPoly(fm, [np.array(poly, np.int32)], 1)
    out = img.copy()
    for y in np.unique(np.nonzero(fm)[0]):
        xs = np.nonzero(fm[y])[0]
        if side == "right":  # 오른쪽(자기 면)에서 가져온다
            edge = xs.max() + 1
            for x in xs:
                out[y, x] = img[y, min(img.shape[1] - 1, 2 * edge - x)]
        else:
            edge = xs.min() - 1
            for x in xs:
                out[y, x] = img[y, max(0, 2 * edge - x)]
    return out


def remove_title(img, box):
    x0, y0, x1, y1 = box
    region = img[y0:y1, x0:x1]
    m = ink_mask(region)
    full = np.zeros(img.shape[:2], np.uint8)
    full[y0:y1, x0:x1] = cv2.dilate(m, np.ones((5, 5), np.uint8), iterations=2) * 255
    bgr = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    out = cv2.inpaint(bgr, full, 6, cv2.INPAINT_TELEA)
    return cv2.cvtColor(out, cv2.COLOR_BGR2RGB), m


def hexc(c):
    return "#%02X%02X%02X" % tuple(int(v) for v in c)


def rounded_alpha(w, h, r_top, r_bottom, poly=None, offset=(0, 0)):
    a = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(a)
    if poly:
        d.polygon([(x - offset[0], y - offset[1]) for x, y in poly], fill=255)
    else:
        d.rounded_rectangle([0, 0, w - 1, h - 1], radius=r_top, fill=255)
        d.rectangle([0, h // 2, w - 1, h - 1], fill=255)
        if r_bottom:
            bottom = Image.new("L", (w, h), 0)
            ImageDraw.Draw(bottom).rounded_rectangle([0, 0, w - 1, h - 1], radius=r_bottom, fill=255)
            a = Image.fromarray(np.minimum(np.asarray(a), np.asarray(bottom)))
    return a.filter(ImageFilter.GaussianBlur(0.6))


def body_color(img, b):
    """책 바탕색: 글자·그림을 뺀 가장 흔한 색(책 칸 가운데 세로 띠의 중앙값)."""
    x0, y0, x1, y1 = b["box"]
    w = x1 - x0
    strip = img[y0 + (y1 - y0) // 10 : y1 - (y1 - y0) // 10, x0 + w // 6 : x1 - w // 4]
    lab = cv2.cvtColor(strip, cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    med = np.median(lab, axis=0)
    d = np.linalg.norm(lab - med, axis=1)
    keep = strip.reshape(-1, 3)[d < np.percentile(d, 50)]
    return hexc(np.median(keep, axis=0))


def extract_motif(img, b, bg_hex, thr=17):
    """모티프 영역에서 바탕색을 빼 투명 PNG로."""
    x0, _, x1, _ = b["box"]
    pad = 3
    if b.get("motif_xr"):
        x0, x1, pad = b["motif_xr"][0], b["motif_xr"][1], 0
    my0, my1 = b["motif"]
    region = img[my0:my1, x0 + pad : x1 - pad].astype(np.float32)
    bg = np.array([int(bg_hex[i : i + 2], 16) for i in (1, 3, 5)], np.float32)
    lab_r = cv2.cvtColor(region.astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    lab_b = cv2.cvtColor(bg.reshape(1, 1, 3).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)[0, 0]
    d = np.linalg.norm(lab_r - lab_b, axis=2)
    alpha = np.clip((d - thr) / (20 if thr >= 12 else 7), 0, 1)
    alpha[:, :4] = 0
    alpha[:, -4:] = 0
    alpha[:3, :] = 0
    alpha[-3:, :] = 0
    # 알파가 있는 곳의 색을 바탕색에서 되살린다(un-premultiply)
    a3 = np.maximum(alpha[..., None], 1e-3)
    color = np.clip((region - bg * (1 - a3)) / a3, 0, 255)
    color = np.where(alpha[..., None] > 0.02, color, region)
    rgba = np.dstack([color, alpha * 255]).astype(np.uint8)
    # 책 옆면·모서리 선(좌우 끝에 붙은 가늘고 긴 성분)은 버린다
    n, lab, stats, _ = cv2.connectedComponentsWithStats((alpha > 0.3).astype(np.uint8), connectivity=8)
    H, W = alpha.shape
    def is_bar(i):
        # 책 모서리·옆면 선: 가장자리에 붙은 가늘고 긴 세로선, 또는 몇 px 두께의 가로선
        x, y, w, h, _ = stats[i]
        touches = x <= 5 or x + w >= W - 5
        return (touches and w <= 16 and h > 0.45 * H) or (h <= 4 and w > 0.5 * W)
    biggest = max([stats[i][4] for i in range(1, n) if not is_bar(i)] or [0])
    for i in range(1, n):
        area = stats[i][4]
        if is_bar(i) or area < max(8, 0.03 * biggest):
            alpha[lab == i] = 0
    # 남은 성분 근처(6px)만 살린다: 종이 결 잡티 제거
    keep = cv2.dilate((alpha > 0.3).astype(np.uint8), np.ones((13, 13), np.uint8))
    alpha = alpha * keep
    rgba[..., 3] = (alpha * 255).astype(np.uint8)
    # 여백 자르기
    ys, xs = np.nonzero(alpha > 0.15)
    if len(ys) == 0:
        return None
    rgba = rgba[max(0, ys.min() - 2) : ys.max() + 3, max(0, xs.min() - 2) : xs.max() + 3]
    return Image.fromarray(rgba)


def periodic_noise(n, sx, sy, seed):
    """FFT로 걸러낸 이음새 없는(주기적) 잡음. sx/sy는 가로/세로 결의 굵기(px)."""
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.standard_normal((n, n)))
    ky = np.fft.fftfreq(n)[:, None]
    kx = np.fft.fftfreq(n)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * ((kx * sx) ** 2 + (ky * sy) ** 2))
    out = np.real(np.fft.ifft2(f * g))
    return out / out.std()


def texture_tile(_img):
    """종이·붓 결 타일(256px, 이음새 없음). 시안 책 면의 결 세기(밝기 표준편차 2~6)에 맞춘다.
    밝아지는 곳은 흰색, 어두워지는 곳은 검정으로 알파만 준다(블렌드 모드 없이 겹쳐 쓰기)."""
    n = 256
    fine = periodic_noise(n, 0.8, 0.8, 1)
    strokes = periodic_noise(n, 1.2, 5.0, 2)  # 세로 붓결
    blotch = periodic_noise(n, 9.0, 9.0, 3)  # 물감 얼룩
    t = 0.5 * fine + 0.35 * strokes + 0.35 * blotch
    t /= t.std()
    a = np.clip(np.abs(t) * 7.5, 0, 60)  # 알파 0~60/255
    rgb = np.where(t[..., None] > 0, 255, 0).repeat(3, axis=2)
    return Image.fromarray(np.dstack([rgb, a]).astype(np.uint8))


def plain_band(crop, alpha):
    """책등에서 그림이 없는(바탕만 있는) 가장 긴 줄 구간. 제목은 이미 지워서 바탕이다.
    책 키를 늘릴 때 이 구간만 늘려 그림·모티프가 찌그러지지 않게 한다."""
    H, W = crop.shape[:2]
    x0, x1 = int(W * 0.25), int(W * 0.7)
    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).astype(np.float32)
    bg = np.median(lab[int(H * 0.1) : int(H * 0.9), x0:x1].reshape(-1, 3), axis=0)
    d = np.linalg.norm(lab[:, x0:x1] - bg, axis=2)
    busy = (d > 16).mean(axis=1) + (alpha[:, x0:x1] < 128).mean(axis=1)
    plain = busy < 0.07
    best, cur, start = (0, 0), 0, 0
    lo, hi = int(H * 0.12), int(H * 0.85)
    for y in range(lo, hi):
        if plain[y]:
            if cur == 0:
                start = y
            cur += 1
            if cur > best[1] - best[0]:
                best = (start, y + 1)
        else:
            cur = 0
    if best[1] - best[0] < 6:
        return None
    return (round(best[0] / H, 4), round(best[1] / H, 4))


def main():
    os.makedirs(OUT, exist_ok=True)
    src = load()
    meta = []
    for b in BOOKS:
        img = upright(src, b)
        if b.get("foreign"):
            img = mirror_fill(img, b["foreign"], b.get("foreign_from", "right"))
        clean, _ = remove_title(img, b["title_box"])
        tm = TITLES[b["id"]]
        x0, y0, x1, y1 = b["box"]
        color = body_color(img, b)
        # 책 윗면은 입체라 모서리가 깎여 있어 사각형으로 자르면 벽·옆 책이 섞인다.
        # 책등: 윗부분 T px와 왼쪽 2px을 잘라내고, 잘라낸 윗면은 앱이 책 색으로 다시 그린다(cap).
        # 표지·가로 책: 가장자리를 안쪽으로 잘라 벽 픽셀을 뺀다(둥근 모서리는 앱이 처리).
        cap = cap_w = 0
        cap_color = color
        if b["kind"] == "spine":
            T = max(7, round(0.035 * (y1 - y0)))
            cx0, cy0, cx1, cy1 = x0 + 2, y0 + T, x1, y1
        elif b["kind"] == "cover":
            cx0, cy0, cx1, cy1 = x0 + 2, y0 + 2, x1 - 2, y1 - 1
        else:
            cx0, cy0, cx1, cy1 = x0 + 2, y0 + 2, x1 - 1, y1 - 1
        w, h = cx1 - cx0, cy1 - cy0
        crop = clean[cy0:cy1, cx0:cx1]
        if b.get("poly"):
            alpha = rounded_alpha(w, h, 0, 0, poly=b["poly"], offset=(cx0, cy0))
        else:
            a = Image.new("L", (w, h), 255)
            alpha = a
        if b["kind"] == "spine":
            cap = (cy0 - y0) * S
            band = crop[0:6, int(w * 0.2) : int(w * 0.7)]
            cap_color = hexc(np.median(band.reshape(-1, 3), axis=0))
            row0 = np.nonzero(np.asarray(alpha)[0] > 128)[0]
            cap_w = (row0.max() + 1) / w if len(row0) else 1.0
        rgba = Image.fromarray(crop).convert("RGBA")
        rgba.putalpha(alpha)
        name = {"spine": "spine", "cover": "cover", "horizontal": "horizontal"}[b["kind"]]
        rgba.save(os.path.join(OUT, f"{b['id']}-{name}.png"), optimize=True)
        # 치수는 원래 칸 기준(윗면 cap 포함)
        if b["kind"] == "spine":
            w, h = cx1 - cx0, y1 - y0
        band = None
        if b["kind"] == "spine":
            band = plain_band(crop, np.asarray(alpha))
        elif b["kind"] == "cover":
            band = COVER_BAND.get(b["id"])
        entry = dict(id=b["id"], title=b["title"], author=b.get("author"), kind=b["kind"], shelf=b["shelf"],
                     w=round(w * S, 1), h=round(h * S, 1), color=color, title_meta=tm,
                     tilt=b.get("tilt", 0), stack=b.get("stack"), cover_lines=b.get("cover_lines"),
                     cap=round(cap, 2), cap_color=cap_color, cap_w=round(cap_w, 3), band=band)
        if b.get("motif"):
            mot = extract_motif(clean, b, color, b.get("motif_thr", 17))
            if mot:
                mot.save(os.path.join(OUT, f"{b['id']}-motif.png"), optimize=True)
                entry["motif"] = True
        if b["kind"] == "horizontal":
            mx0, mx1 = b["motif_x"]
            body_top = y0 + (26 if b["id"] == "b13" else 22)
            region = clean[body_top + 6 : y1 - 6, mx0:mx1]
            mot = extract_motif(region.copy(), dict(box=(0, 0, region.shape[1], 0), motif=(0, region.shape[0])), color)
            if mot:
                mot.save(os.path.join(OUT, f"{b['id']}-motif.png"), optimize=True)
                entry["motif"] = True
            ty0, ty1 = TOP_FACE[b["id"]]
            entry["top_face"] = hexc(np.median(src[ty0:ty1, x0 + 30 : x1 - 40].reshape(-1, 3), axis=0))
            entry["top_face_h"] = round((ty1 - ty0) * S, 1)
        meta.append(entry)
    texture_tile(src).save(os.path.join(ROOT, "app/assets/texture/paper-grain@3x.png"), optimize=True)  # 3x: 85dp 타일 → 기기 픽셀과 1:1에 가깝게
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    write_ts(meta)
    print(f"{len(meta)} books →", OUT)


def write_ts(meta):
    lines = [
        "// 자동 생성: app/scripts/extract-reference-assets.py. 직접 고치지 말 것.",
        "// [임시 자산 TEMP] 시안 이미지에서 잘라낸 개발용 샘플. 최종 재장정 아트(docs/assets.md 규격)로 교체한다.",
        "import type { SampleArt } from './types';",
        "",
        "export const SAMPLE_ART: Record<string, SampleArt> = {",
    ]
    for e in meta:
        t = e["title_meta"]
        parts = [f"kind: '{e['kind']}'", f"w: {e['w']}", f"h: {e['h']}", f"color: '{e['color']}'",
                 f"ink: '{t['ink']}'", f"titleSize: {t['size']}"]
        if t.get("line"):
            parts.append(f"titleLine: {t['line']}")
        if e["kind"] == "horizontal":
            parts += [f"titleLeft: {t['left']:.3f}", f"titleCy: {t['cy']:.3f}", f"topFace: '{e['top_face']}'", f"topFaceH: {e['top_face_h']}",
                      f"image: require('../../assets/temp-reference/{e['id']}-horizontal.png')"]
        else:
            parts += [f"titleTop: {t['top']:.3f}", f"titleCx: {t['cx']:.3f}"]
            if e["kind"] == "spine":
                parts += [f"cap: {e['cap']}", f"capColor: '{e['cap_color']}'", f"capW: {e['cap_w']}"]
            parts.append(f"image: require('../../assets/temp-reference/{e['id']}-{'cover' if e['kind'] == 'cover' else 'spine'}.png')")
        if e.get("motif"):
            parts.append(f"motif: require('../../assets/temp-reference/{e['id']}-motif.png')")
        if e.get("band"):
            parts.append(f"band: [{e['band'][0]}, {e['band'][1]}]")
        if e.get("cover_lines"):
            parts.append("coverLines: " + json.dumps(e["cover_lines"], ensure_ascii=False))
        lines.append(f"  {e['id']}: {{ {', '.join(parts)} }},")
    lines += ["};", ""]
    with open(TS, "w") as f:
        f.write("\n".join(lines))


if __name__ == "__main__":
    main()
