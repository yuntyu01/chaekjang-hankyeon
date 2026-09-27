#!/usr/bin/env python3
"""선반 PNG(assets/bookshelf/shelf-single.png)를 실제로 측정해 정규화 메타데이터를 만든다.
그리고 종이 배경(paper-background.png)이 이음새 없이 반복 가능한지 검사한다.

- plankTopY: 윗면(상판) 뒤쪽 모서리가 시작되는 줄
- frontTopY: 윗면이 끝나고 앞면(앞턱)이 시작되는 줄(밝기가 크게 꺾이는 곳)
- frontBottomY: 앞면이 끝나는 줄(불투명 → 반투명 그림자)
- contactY: 책 밑면이 닿는 기준선. 윗면 앞쪽 가장자리에서 윗면 깊이의 CONTACT_INSET 만큼 안쪽.
- usableLeft/usableRight: 앞턱이 불투명한 좌우 범위(둥근 모서리 반경만큼 안쪽)
모든 값은 이미지 전체 폭/높이로 나눈 비율(투명 여백 포함).

실행: python3 app/scripts/measure-shelf.py → src/domain/shelf-asset.generated.ts
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SHELF = os.path.join(ROOT, "assets/bookshelf/shelf-single.png")
PAPER = os.path.join(ROOT, "assets/bookshelf/paper-background.png")
OUT = os.path.join(ROOT, "src/domain/shelf-asset.generated.ts")
CONTACT_INSET = 0.3  # 윗면 깊이의 30%만큼 앞턱에서 안쪽에 책이 선다(시안: 책 앞에 상판이 얇게 보임)


def measure_shelf():
    img = np.asarray(Image.open(SHELF).convert("RGBA")).astype(np.float32)
    H, W = img.shape[:2]
    a = img[..., 3]
    lum = img[..., :3].mean(axis=2)
    # 가운데 60% 폭의 줄별 중앙값
    band = slice(int(W * 0.2), int(W * 0.8))
    a_row = np.median(a[:, band], axis=1)
    l_row = np.median(lum[:, band], axis=1)
    opaque = np.nonzero(a_row > 240)[0]
    plank_top, plank_bottom = int(opaque.min()), int(opaque.max())
    # 윗면→앞면 경계: 불투명 구간에서 밝기가 가장 크게 떨어지는 줄
    seg = l_row[plank_top : plank_bottom + 1]
    diff = np.diff(seg)
    front_top = plank_top + int(np.argmin(diff)) + 1
    contact = front_top - CONTACT_INSET * (front_top - plank_top)
    # 좌우: 앞면 가운데 줄에서 불투명한 범위
    mid = (front_top + plank_bottom) // 2
    cols = np.nonzero(a[mid] > 240)[0]
    left, right = int(cols.min()), int(cols.max())
    # 윗면 줄에서의 범위(책이 올라가는 곳)
    top_mid = int((plank_top + front_top) / 2)
    tcols = np.nonzero(a[top_mid] > 240)[0]
    # 그림자 끝(알파 > 8)
    shadow = np.nonzero(a_row > 8)[0]
    meta = dict(
        width=W,
        height=H,
        plankTopY=round(plank_top / H, 4),
        frontTopY=round(front_top / H, 4),
        frontBottomY=round((plank_bottom + 1) / H, 4),
        contactY=round(contact / H, 4),
        shadowBottomY=round((shadow.max() + 1) / H, 4),
        usableLeft=round(max(left, tcols.min()) / W, 4),
        usableRight=round(min(right, tcols.max()) / W, 4),
        frontLeft=round(left / W, 4),
        frontRight=round(right / W, 4),
    )
    return meta


def seam_report():
    """배경을 반복할 때 이음새: 가장자리 두 줄 사이 차이를 내부 이웃 줄 차이와 비교."""
    p = np.asarray(Image.open(PAPER).convert("RGB")).astype(np.float32)
    inner_x = np.abs(np.diff(p, axis=1)).mean()
    inner_y = np.abs(np.diff(p, axis=0)).mean()
    seam_x = np.abs(p[:, 0] - p[:, -1]).mean()
    seam_y = np.abs(p[0] - p[-1]).mean()
    # 저주파(밝기 기울기) 차이: 좌우/상하 끝 32px 평균 밝기
    edge_lr = abs(p[:, :32].mean() - p[:, -32:].mean())
    edge_tb = abs(p[:32].mean() - p[-32:].mean())
    return dict(size=p.shape[:2][::-1], inner_x=inner_x, seam_x=seam_x, inner_y=inner_y, seam_y=seam_y,
                mean_edge_lr=edge_lr, mean_edge_tb=edge_tb,
                seamless=bool(seam_x < inner_x * 1.6 and seam_y < inner_y * 1.6 and edge_lr < 1.0 and edge_tb < 1.0))


def main():
    meta = measure_shelf()
    seam = seam_report()
    print(json.dumps(meta, indent=1))
    print({k: (round(v, 2) if isinstance(v, float) else v) for k, v in seam.items()})
    lines = [
        "// 자동 생성: app/scripts/measure-shelf.py 가 assets/bookshelf/shelf-single.png 를 실제로 측정한 값. 직접 고치지 말 것.",
        "// 모든 값은 이미지 전체 폭/높이 대비 비율(투명 여백 포함).",
        f"export const SHELF_ASSET = {json.dumps(meta, indent=2)} as const;",
        "",
        f"// 종이 배경 이음새 검사: 가장자리 차이 x={seam['seam_x']:.2f}/y={seam['seam_y']:.2f}, 내부 이웃 차이 x={seam['inner_x']:.2f}/y={seam['inner_y']:.2f},",
        f"// 끝 32px 평균 밝기 차 좌우={seam['mean_edge_lr']:.2f}/상하={seam['mean_edge_tb']:.2f} → seamless={str(seam['seamless']).lower()}",
        f"export const PAPER_SEAMLESS = {str(seam['seamless']).lower()};",
        "",
    ]
    with open(OUT, "w") as f:
        f.write("\n".join(lines))


if __name__ == "__main__":
    main()
