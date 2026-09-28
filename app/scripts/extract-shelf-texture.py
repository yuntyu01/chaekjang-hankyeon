"""선반 PNG(assets/bookshelf/shelf-plank.png)에서 나무 질감만 잘라 낸다.

선반 모양(윗면·앞면·옆면)은 코드가 3D 꼭짓점을 투영해 만들고, 여기서는 면 안을 채울 재질만 만든다.
PNG의 사다리꼴 외곽·투명 여백·원근이 그려진 양 끝·모서리 광택/어두운 가장자리·바깥 그림자는 쓰지 않는다.

  윗면 띠: plankTopY ~ frontTopY 사이, 뒤·앞 가장자리 몇 줄을 뺀 안쪽
  앞면 띠: frontTopY ~ frontBottomY 사이, 위 광택 줄·아래 흐린 줄을 뺀 안쪽
  가로: 양 끝 사다리꼴(윗면 뒤 모서리가 좁아지는 곳)보다 안쪽

출력: assets/bookshelf/shelf-top.png, assets/bookshelf/shelf-front.png (불투명)
"""
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets/bookshelf/shelf-plank.png"
OUT = ROOT / "assets/bookshelf"


def opaque_rows(a, x):
    ys = np.where(a[:, x, 3] > 250)[0]
    return ys


def main():
    im = Image.open(SRC).convert("RGBA")
    a = np.array(im)
    h, w = a.shape[:2]
    x = w // 2
    col = a[:, x, :3].astype(float)
    ys = opaque_rows(a, x)
    top0, bottom = ys[0], ys[-1]
    # 윗면/앞면 경계: 세로로 가장 크게 어두워지는 곳
    lum = col @ [0.299, 0.587, 0.114]
    d = np.diff(lum[top0 : bottom + 1])
    edge = top0 + int(np.argmin(d)) + 1  # 앞면 첫 줄
    m = 4  # 가장자리 제외 줄 수(광택·흐린 줄)
    # 윗면 뒤 모서리 줄에서도 불투명한 가로 범위 = 양 끝 사다리꼴 안쪽
    xs = np.where(a[top0 + m, :, 3] > 250)[0]
    x0, x1 = xs[0] + 24, xs[-1] - 24
    top = im.crop((x0, top0 + m, x1, edge - m)).convert("RGB")
    front = im.crop((x0, edge + m, x1, bottom - m)).convert("RGB")
    top.save(OUT / "shelf-top.png", optimize=True)
    front.save(OUT / "shelf-front.png", optimize=True)
    print(f"top {top.size} rows {top0 + m}..{edge - m}, front {front.size} rows {edge + m}..{bottom - m}, x {x0}..{x1}")
    print("mean top", np.array(top).reshape(-1, 3).mean(0).round(1), "front", np.array(front).reshape(-1, 3).mean(0).round(1))


if __name__ == "__main__":
    main()
