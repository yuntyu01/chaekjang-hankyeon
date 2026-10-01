#!/usr/bin/env python3
"""비교용 예시 책장(시안 책장)의 앞표지 그림 세 장을 평면 벡터로 그린다.

시안('따뜻한 플랫 일러스트 책장', '느린 계절 3뷰')의 표지 구성(달·산·호수·나무 자리와 색)을 재서 새로 그린 그림이다.
참고 이미지를 잘라 붙이지 않았고, 원근·책 테두리·제본 홈·그림자·제목 글자가 없다(몸체와 제목은 앱이 그린다).
비율은 앱 표지 면과 같은 0.675(가로/세로).

- assets/source/covers/<name>.svg : 원본(벡터)
- assets/covers/<name>.png        : 앱이 읽는 그림(810x1200). SVG를 헤드리스 Chrome(또는 Edge)으로 그려 만든다.

실행: python app/scripts/flat-covers/make-covers.py
"""
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from svgkit import H, W, X, Y, blob, bumps, circle, column, cypress, foliage, glints, land, leaves, poly, ridge, svg  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "assets", "source", "covers")
OUT = os.path.join(ROOT, "assets", "covers")
PX = (810, 1200)


def slow_season():
    """느린 계절: 남색 밤하늘, 초승달, 겹친 산, 호수와 달빛 기둥, 왼쪽 소나무 세 그루와 앞 언덕(3뷰 정면 구성)."""
    SKY_T, SKY_B = "#46597A", "#4D6486"
    MOON, FAR, MID, TREES = "#F1D9A0", "#44597B", "#3B4E6B", "#34445B"
    LAKE, LAKE_HI, GLINT = "#5A7396", "#6880A2", "#E9CF9B"
    FG, FG2, PINE = "#405471", "#394B66", "#2F3D51"
    defs = (f'<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{SKY_T}"/><stop offset="0.72" stop-color="{SKY_B}"/></linearGradient>'
            f'<mask id="cres"><rect width="{W}" height="{H}" fill="#fff"/><circle cx="{X(0.457):.1f}" cy="{Y(0.41) - X(0.019):.1f}" r="{X(0.080):.1f}" fill="#000"/></mask>')
    b = [f'<rect width="{W}" height="{H}" fill="url(#sky)"/>',
         f'<circle cx="{X(0.497):.1f}" cy="{Y(0.41):.1f}" r="{X(0.080):.1f}" fill="{MOON}" mask="url(#cres)"/>']
    b.append(ridge([(0.36, 0.66), (0.46, 0.60), (0.56, 0.545), (0.66, 0.51), (0.76, 0.485), (0.84, 0.465), (0.91, 0.452), (0.96, 0.458), (1.0, 0.468)], 0.75, FAR))
    b.append(ridge([(0.0, 0.535), (0.07, 0.532), (0.15, 0.543), (0.24, 0.552), (0.32, 0.575), (0.40, 0.605), (0.47, 0.665)], 0.75, FAR))
    b.append(ridge([(0.0, 0.60), (0.07, 0.578), (0.15, 0.562), (0.22, 0.560), (0.29, 0.573), (0.37, 0.60), (0.45, 0.635), (0.52, 0.665), (0.58, 0.70), (0.62, 0.712)], 0.75, MID))
    b.append(ridge([(0.55, 0.712), (0.60, 0.69), (0.66, 0.665), (0.75, 0.655), (0.85, 0.645), (1.0, 0.64)], 0.75, TREES))
    b.append(bumps([(0.60, 0.668, 0.022), (0.635, 0.652, 0.026), (0.672, 0.646, 0.020), (0.70, 0.632, 0.028), (0.74, 0.640, 0.022), (0.77, 0.622, 0.030),
                    (0.81, 0.630, 0.024), (0.84, 0.612, 0.032), (0.88, 0.618, 0.026), (0.915, 0.600, 0.034), (0.955, 0.606, 0.028), (0.99, 0.596, 0.030)], 0.70, TREES))
    b.append(f'<rect x="0" y="{Y(0.71):.1f}" width="{W}" height="{Y(0.29):.1f}" fill="{LAKE}"/>')
    for u0, u1, v in [(0.64, 0.86, 0.735), (0.70, 0.97, 0.79), (0.62, 0.80, 0.905), (0.74, 0.96, 0.87)]:
        b.append(f'<rect x="{X(u0):.1f}" y="{Y(v):.1f}" width="{X(u1 - u0):.1f}" height="3" rx="1.5" fill="{LAKE_HI}"/>')
    b.append(column(0.712, 0.905, GLINT))
    b.append(glints([(0.33, 0.40, 0.752, 0.008), (0.62, 0.70, 0.735, 0.008), (0.35, 0.41, 0.80, 0.007), (0.60, 0.66, 0.79, 0.007), (0.40, 0.45, 0.85, 0.006)], GLINT))
    b.append(ridge([(0.0, 0.765), (0.08, 0.773), (0.16, 0.786), (0.24, 0.803), (0.32, 0.826), (0.40, 0.852), (0.48, 0.882), (0.56, 0.915), (0.66, 0.948), (0.75, 0.978), (0.82, 1.0)], 1.0, FG))
    b.append(bumps([(0.02, 0.770, 0.030), (0.07, 0.768, 0.026), (0.12, 0.776, 0.030), (0.18, 0.782, 0.024), (0.23, 0.792, 0.028), (0.29, 0.806, 0.024), (0.34, 0.822, 0.026)], 0.86, FG))
    b.append(ridge([(0.0, 0.875), (0.10, 0.885), (0.20, 0.905), (0.30, 0.935), (0.38, 0.97), (0.43, 1.0)], 1.0, FG2))
    b.append(cypress(0.035, 0.705, 0.785, 0.030, PINE, bumps=4, seed=0.4))
    b.append(cypress(0.110, 0.615, 0.805, 0.048, PINE, bumps=7, seed=0.0))
    b.append(cypress(0.222, 0.620, 0.812, 0.052, PINE, bumps=7, seed=1.1))
    b.append(cypress(0.326, 0.742, 0.838, 0.033, PINE, bumps=4, seed=0.7))
    return b, defs


def summer_forest():
    """여름의 숲: 크림색 하늘, 왼쪽 큰 나무와 위쪽 잎, 덤불, 먼 산과 호수, 굽은 오솔길, 앞 풀(책장 시안 2단 표지 구성)."""
    SKY, SKY2 = "#FBEBD8", "#FCF1E3"
    MTN, MTN2, FAR_TREE, FAR_TREE2 = "#B9C3C5", "#C6CFCF", "#9FB3A7", "#AFC0B2"
    LAKE, LAKE_HI = "#CCDCDF", "#E4EDEC"
    MEADOW, MEADOW2, MEADOW3, PATH = "#DCD9A3", "#CDCF96", "#E6E1AF", "#F5E7CB"
    LEAF, LEAF2, LEAF3 = "#90A688", "#7F9878", "#A3B595"
    TRUNK, TRUNK2, GRASS, GRASS2 = "#9C7D67", "#8A6D59", "#7E9673", "#8FA581"
    defs = f'<radialGradient id="glow" cx="0.55" cy="0.4" r="0.6"><stop offset="0" stop-color="{SKY2}"/><stop offset="1" stop-color="{SKY}"/></radialGradient>'
    b = [f'<rect width="{W}" height="{H}" fill="url(#glow)"/>']
    b.append(ridge([(0.0, 0.50), (0.06, 0.485), (0.13, 0.50), (0.22, 0.55), (0.3, 0.6)], 0.8, MTN2))
    b.append(ridge([(0.5, 0.64), (0.6, 0.585), (0.7, 0.545), (0.8, 0.52), (0.86, 0.515), (0.93, 0.53), (1.0, 0.555)], 0.8, MTN))
    b.append(blob([(0.50, 0.73), (0.52, 0.66), (0.545, 0.615), (0.56, 0.60), (0.575, 0.62), (0.60, 0.67), (0.62, 0.73)], FAR_TREE))
    b.append(blob([(0.585, 0.73), (0.60, 0.68), (0.615, 0.665), (0.63, 0.69), (0.64, 0.73)], FAR_TREE2))
    b.append(ridge([(0.62, 0.73), (0.66, 0.69), (0.72, 0.675), (0.8, 0.665), (0.9, 0.655), (1.0, 0.65)], 0.8, FAR_TREE2))
    for cu, cv, r, s in [(0.72, 0.68, 0.05, 1), (0.8, 0.665, 0.06, 2), (0.9, 0.655, 0.07, 3), (0.99, 0.64, 0.08, 4)]:
        b.append(foliage(cu, cv, r, FAR_TREE, n=7, seed=s))
    b.append(poly([(0.5, 0.73), (0.82, 0.73), (0.82, 0.79), (0.5, 0.79)], LAKE))
    b.append(poly([(0.56, 0.748), (0.74, 0.748), (0.74, 0.752), (0.56, 0.752)], LAKE_HI))
    b.append(poly([(0.6, 0.768), (0.78, 0.768), (0.78, 0.772), (0.6, 0.772)], LAKE_HI))
    b.append(ridge([(0.0, 0.78), (0.2, 0.775), (0.45, 0.78), (0.6, 0.785), (0.8, 0.775), (1.0, 0.77)], 1.0, MEADOW))
    b.append(ridge([(0.0, 0.84), (0.15, 0.83), (0.35, 0.85), (0.55, 0.87), (0.75, 0.85), (1.0, 0.84)], 1.0, MEADOW2))
    b.append(ridge([(0.3, 0.9), (0.45, 0.905), (0.6, 0.92), (0.8, 0.91), (1.0, 0.9)], 1.0, MEADOW3))
    b.append(blob([(0.585, 0.788), (0.64, 0.80), (0.62, 0.815), (0.55, 0.835), (0.48, 0.86), (0.47, 0.885), (0.53, 0.92), (0.6, 0.96), (0.64, 1.0),
                   (0.44, 1.0), (0.42, 0.95), (0.38, 0.91), (0.37, 0.88), (0.41, 0.85), (0.5, 0.82), (0.56, 0.80)], PATH))
    b.append(poly([(0.225, 0.78), (0.235, 0.64), (0.25, 0.64), (0.26, 0.78)], TRUNK))
    for cu, cv, r, col, s in [(0.17, 0.60, 0.11, LEAF3, 5), (0.31, 0.55, 0.12, LEAF, 6), (0.42, 0.63, 0.1, LEAF, 7), (0.24, 0.66, 0.1, LEAF2, 8),
                              (0.10, 0.70, 0.09, LEAF, 9), (0.36, 0.71, 0.09, LEAF2, 10), (0.47, 0.74, 0.06, LEAF2, 11)]:
        b.append(foliage(cu, cv, r, col, n=12, seed=s))
    for cu, cv, r, col, s in [(0.86, 0.72, 0.07, LEAF2, 12), (0.95, 0.68, 0.08, LEAF, 13), (0.78, 0.75, 0.05, LEAF, 14)]:
        b.append(foliage(cu, cv, r, col, n=12, seed=s))
    b.append(poly([(0.02, 0.83), (0.05, 0.6), (0.06, 0.42), (0.07, 0.3), (0.10, 0.22), (0.17, 0.14), (0.19, 0.155), (0.13, 0.23),
                   (0.11, 0.28), (0.15, 0.24), (0.27, 0.16), (0.285, 0.175), (0.17, 0.27), (0.11, 0.36), (0.10, 0.45), (0.10, 0.6), (0.13, 0.83)], TRUNK))
    b.append(poly([(0.08, 0.83), (0.085, 0.6), (0.09, 0.45), (0.10, 0.45), (0.10, 0.6), (0.13, 0.83)], TRUNK2))
    for cu, cv, r, col, s in [(0.05, 0.05, 0.12, LEAF, 20), (0.17, 0.09, 0.11, LEAF3, 21), (0.30, 0.11, 0.1, LEAF, 22), (0.40, 0.14, 0.07, LEAF3, 23),
                              (0.10, 0.17, 0.08, LEAF2, 24), (0.27, 0.0, 0.11, LEAF2, 25), (0.0, 0.25, 0.07, LEAF, 26)]:
        b.append(foliage(cu, cv, r, col, n=13, seed=s, squash=0.9))
    b.append(poly([(1.0, 0.31), (0.93, 0.2), (0.9, 0.17), (0.915, 0.165), (0.95, 0.2), (1.0, 0.26)], TRUNK))
    for cu, cv, r, col, s in [(0.66, 0.03, 0.09, LEAF, 30), (0.78, 0.07, 0.1, LEAF3, 31), (0.9, 0.04, 0.11, LEAF, 32), (0.75, 0.17, 0.07, LEAF2, 33),
                              (0.87, 0.20, 0.08, LEAF, 34), (0.98, 0.15, 0.09, LEAF2, 35), (0.96, 0.30, 0.06, LEAF, 36), (0.6, 0.0, 0.07, LEAF2, 37)]:
        b.append(foliage(cu, cv, r, col, n=13, seed=s, squash=0.9))
    b.append(leaves(-0.02, 0.36, 0.96, 0.11, GRASS2, n=11, seed=40, width=0.05))
    b.append(leaves(-0.02, 0.26, 1.0, 0.1, GRASS, n=8, seed=41, width=0.055))
    b.append(leaves(0.74, 1.02, 0.97, 0.11, GRASS2, n=8, seed=42, width=0.05))
    b.append(leaves(0.8, 1.02, 1.0, 0.09, GRASS, n=6, seed=43, width=0.055))
    return b, defs


def light_speed():
    """우리가 빛의 속도로 갈 수 없다면: 복숭아빛 노을, 구름 띠, 해, 겹친 산, 굽은 강과 윤슬, 왼쪽 아래 숲(책장 시안 3단 표지 구성)."""
    SKY_T, SKY_M, SKY_B = "#FCCEAA", "#F9C09F", "#F5B39A"
    CLOUD, CLOUD2, HAZE, SUN = "#F2A592", "#F6B49C", "#E9A7A6", "#FCE3A3"
    BACK, MID_L, MID_R = "#C59DAE", "#8A8DB4", "#8F92B8"
    NEAR_L, NEAR_L2, NEAR_R, NEAR_R2 = "#606C98", "#515D8A", "#5D6A96", "#4F5B87"
    WATER, WATER2, GLINT, TREES = "#AAB3D0", "#9CA7CA", "#F7D9A2", "#3E4A70"
    defs = (f'<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{SKY_T}"/>'
            f'<stop offset="0.42" stop-color="{SKY_M}"/><stop offset="0.6" stop-color="{SKY_B}"/></linearGradient>'
            f'<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{WATER}"/><stop offset="1" stop-color="{WATER2}"/></linearGradient>')
    b = [f'<rect width="{W}" height="{H}" fill="url(#sky)"/>']
    b.append(blob([(0.0, 0.355), (0.14, 0.36), (0.3, 0.372), (0.42, 0.39), (0.34, 0.405), (0.16, 0.41), (0.0, 0.415)], HAZE))
    b.append(blob([(0.5, 0.43), (0.64, 0.412), (0.8, 0.40), (1.0, 0.392), (1.0, 0.44), (0.82, 0.447), (0.64, 0.448)], CLOUD))
    b.append(blob([(0.04, 0.455), (0.2, 0.448), (0.38, 0.452), (0.52, 0.462), (0.4, 0.474), (0.2, 0.478), (0.04, 0.475)], CLOUD2))
    b.append(circle(0.59, 0.505, 0.066, SUN))
    b.append(ridge([(0.0, 0.50), (0.12, 0.505), (0.25, 0.52), (0.4, 0.55), (0.5, 0.57), (0.62, 0.565), (0.75, 0.545), (0.88, 0.525), (1.0, 0.515)], 0.7, BACK))
    b.append(ridge([(0.0, 0.52), (0.1, 0.515), (0.22, 0.535), (0.35, 0.57), (0.47, 0.61), (0.56, 0.635), (0.62, 0.65)], 0.7, MID_L))
    b.append(ridge([(0.42, 0.648), (0.55, 0.618), (0.65, 0.585), (0.75, 0.55), (0.87, 0.52), (1.0, 0.5)], 0.7, MID_R))
    b.append(f'<rect x="0" y="{Y(0.635):.1f}" width="{W}" height="{Y(0.365):.1f}" fill="url(#water)"/>')
    b.append(land([(0.46, 0.712), (0.58, 0.688), (0.7, 0.658), (0.82, 0.624), (0.92, 0.6), (1.0, 0.59)], [(1.0, 0.728), (0.8, 0.724), (0.6, 0.718), (0.46, 0.714)], NEAR_R))
    b.append(land([(0.68, 0.724), (0.8, 0.692), (0.9, 0.662), (1.0, 0.645)], [(1.0, 0.73), (0.68, 0.726)], NEAR_R2))
    b.append(land([(0.0, 0.575), (0.1, 0.593), (0.2, 0.62), (0.3, 0.655), (0.4, 0.695), (0.5, 0.735), (0.58, 0.762), (0.63, 0.776)],
                  [(0.5, 0.788), (0.34, 0.797), (0.18, 0.806), (0.0, 0.812)], NEAR_L))
    b.append(land([(0.0, 0.676), (0.1, 0.697), (0.2, 0.732), (0.3, 0.772), (0.37, 0.798)], [(0.24, 0.812), (0.0, 0.826)], NEAR_L2))
    b.append(column(0.645, 0.76, GLINT, cu=0.585, top_half=0.0, bottom_half=0.05, seed=5, n=12, power=1.0))
    b.append(column(0.76, 0.99, GLINT, cu=0.57, top_half=0.13, bottom_half=0.03, seed=6, n=20, power=0.8, wobble=0.02))
    b.append(glints([(0.66, 0.8, 0.79, 0.008), (0.34, 0.46, 0.835, 0.009), (0.7, 0.84, 0.86, 0.009), (0.36, 0.44, 0.9, 0.008), (0.68, 0.78, 0.93, 0.008), (0.62, 0.7, 0.72, 0.007)], GLINT))
    for cu, cv, r, s in [(0.02, 0.89, 0.05, 1), (0.08, 0.915, 0.055, 2), (0.15, 0.94, 0.055, 3), (0.22, 0.97, 0.05, 4), (0.05, 0.97, 0.06, 5), (0.29, 1.0, 0.05, 6)]:
        b.append(foliage(cu, cv, r, TREES, n=8, seed=s))
    return b, defs


COVERS = {"slow-season": slow_season, "summer-forest": summer_forest, "light-speed": light_speed}


def browser():
    for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              shutil.which("chromium") or "", shutil.which("google-chrome") or ""):
        if p and os.path.exists(p):
            return p
    raise SystemExit("헤드리스로 SVG를 그릴 Chrome/Edge가 없습니다")


def render(svg_path, png_path):
    url = "file:///" + os.path.abspath(svg_path).replace("\\", "/")
    subprocess.run([browser(), "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    f"--window-size={PX[0]},{PX[1]}", f"--screenshot={os.path.abspath(png_path)}", url],
                   check=True, capture_output=True, timeout=120)


def main():
    os.makedirs(SRC, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    for name, fn in COVERS.items():
        body, defs = fn()
        sp = os.path.join(SRC, f"{name}.svg")
        with open(sp, "w", encoding="utf-8") as f:
            f.write(svg(body, PX[0], PX[1], defs))
        pp = os.path.join(OUT, f"{name}.png")
        render(sp, pp)
        print(pp, os.path.getsize(pp))


if __name__ == "__main__":
    main()
