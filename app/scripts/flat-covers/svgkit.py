"""평면 표지 그림용 작은 SVG 도구. 좌표는 정규 좌표(u: 가로 0..1, v: 세로 0..1)이고 675x1000 viewBox(앱 표지 면 비율 0.675)에 그린다.
그림은 색 면(평평한 도형)만 쓴다: 원근·책 테두리·제본 홈·그림자·제목 글자는 넣지 않는다(앱이 몸체와 제목을 그린다)."""
import math
import random

W, H = 675, 1000


def X(u):
    return u * W


def Y(v):
    return v * H


def curve(pts):
    """정규 좌표 점들을 지나는 매끈한 곡선(Catmull-Rom → 3차 베지어). 열린 경로."""
    P = [(X(u), Y(v)) for u, v in pts]
    d = f"M{P[0][0]:.1f} {P[0][1]:.1f}"
    n = len(P)
    for i in range(n - 1):
        p0 = P[i - 1] if i > 0 else P[i]
        p1, p2 = P[i], P[i + 1]
        p3 = P[i + 2] if i + 2 < n else P[i + 1]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}"
    return d


def ridge(top, bottom_v, fill):
    """능선(왼쪽 → 오른쪽 곡선) 아래를 bottom_v까지 채운 면."""
    d = curve(top) + f" L{X(top[-1][0]):.1f} {Y(bottom_v):.1f} L{X(top[0][0]):.1f} {Y(bottom_v):.1f} Z"
    return f'<path d="{d}" fill="{fill}"/>'


def land(top, shore, fill):
    """능선(왼쪽 → 오른쪽 곡선) 다음 물가(오른쪽 → 왼쪽 직선)로 닫은 땅."""
    d = curve(top) + " " + " ".join(f"L{X(u):.1f} {Y(v):.1f}" for u, v in shore) + " Z"
    return f'<path d="{d}" fill="{fill}"/>'


def blob(pts, fill):
    """점들을 지나는 매끈한 닫힌 도형."""
    pts = list(pts)
    ext = [pts[-1]] + pts + [pts[0], pts[1]]
    P = [(X(u), Y(v)) for u, v in ext]
    d = f"M{P[1][0]:.1f} {P[1][1]:.1f}"
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}"
    return f'<path d="{d} Z" fill="{fill}"/>'


def poly(pts, fill):
    return '<path d="M' + " L".join(f"{X(u):.1f} {Y(v):.1f}" for u, v in pts) + f' Z" fill="{fill}"/>'


def circle(u, v, r, fill):
    """r은 표지 폭 비율(둥글게 보이도록 가로 기준)."""
    return f'<circle cx="{X(u):.1f}" cy="{Y(v):.1f}" r="{X(r):.1f}" fill="{fill}"/>'


def foliage(cu, cv, r, fill, n=9, seed=0, squash=1.0):
    """잎 덩이: 가운데 타원 + 둘레 작은 원들(평면 그림체)."""
    rnd = random.Random(seed)
    out = [f'<ellipse cx="{X(cu):.1f}" cy="{Y(cv):.1f}" rx="{X(r * 0.82):.1f}" ry="{X(r * 0.82) * squash:.1f}" fill="{fill}"/>']
    for i in range(n):
        a = 2 * math.pi * i / n + rnd.random() * 0.4
        rr = r * (0.34 + 0.12 * rnd.random())
        out.append(f'<circle cx="{X(cu) + X(r * 0.72) * math.cos(a):.1f}" cy="{Y(cv) + X(r * 0.72) * squash * math.sin(a):.1f}" r="{X(rr):.1f}" fill="{fill}"/>')
    return "".join(out)


def bumps(items, base_v, fill):
    """둥근 나무 머리 띠: (가운데 u, 꼭대기 v, 반지름) 마다 타원 + 아래로 base_v까지 기둥."""
    out = []
    for cu, tv, r in items:
        ry = r * W / H * 1.1
        out.append(f'<ellipse cx="{X(cu):.1f}" cy="{Y(tv + ry):.1f}" rx="{X(r):.1f}" ry="{Y(ry):.1f}" fill="{fill}"/>')
        out.append(f'<rect x="{X(cu - r):.1f}" y="{Y(tv + ry):.1f}" width="{X(2 * r):.1f}" height="{Y(base_v - tv - ry):.1f}" fill="{fill}"/>')
    return "".join(out)


def cypress(cu, top_v, base_v, half_w, fill, bumps=6, seed=0.0):
    """길쭉한 침엽수: 뾰족한 꼭대기, 울퉁불퉁한 옆, 아래쪽이 가장 넓다."""
    n = 40
    left, right = [], []
    for i in range(n + 1):
        t = i / n
        w = half_w * (t ** 0.62) * (1 - 0.5 * t ** 9)
        b = 0.22 * half_w * abs(math.sin(t * math.pi * bumps + seed)) * (t ** 0.5)
        v = top_v + (base_v - top_v) * t
        left.append((cu - w - b, v))
        right.append((cu + w + b * 0.85, v))
    return poly(left + right[::-1], fill)


def glints(items, fill):
    """윤슬 한 줄씩: (u0, u1, v, 두께) 끝이 뾰족한 렌즈."""
    out = []
    for u0, u1, v, h in items:
        m = (u0 + u1) / 2
        pts = [(u0, v), (u0 + 0.015, v - h / 2), (m, v - h * 0.6), (u1 - 0.015, v - h / 2), (u1, v),
               (u1 - 0.02, v + h / 2), (m + 0.01, v + h * 0.55), (u0 + 0.025, v + h / 2)]
        out.append(poly(pts, fill))
    return "".join(out)


def column(v0, v1, fill, cu=0.512, top_half=0.13, bottom_half=0.012, seed=3, n=22, wobble=0.01, power=0.9):
    """윤슬 기둥: 좌우가 들쭉날쭉하고 수평선에서 넓다가 아래로 좁아진다."""
    rnd = random.Random(seed)
    L, R = [], []
    for i in range(n + 1):
        t = i / n
        v = v0 + (v1 - v0) * t
        half = top_half * (1 - t) ** power + bottom_half
        c = cu + wobble * math.sin(t * 7)
        j = 1 if i % 2 == 0 else 0.45
        L.append((c - half * j * (0.8 + 0.4 * rnd.random()), v))
        R.append((c + half * j * (0.8 + 0.4 * rnd.random()), v))
    return poly(L + R[::-1], fill)


def leaves(u0, u1, base_v, height, fill, n=10, seed=0, width=0.035):
    """앞쪽 풀잎: 아래 선에서 부채꼴로 올라오는 넓은 잎."""
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        cu = u0 + (u1 - u0) * (i + 0.5) / n + (rnd.random() - 0.5) * 0.02
        h = height * (0.6 + 0.4 * rnd.random())
        lean = (rnd.random() - 0.5) * 0.06
        w = width * (0.7 + 0.5 * rnd.random())
        tip = (cu + lean, base_v - h)
        out.append(blob([(cu - w / 2, base_v + 0.02), (cu - w * 0.55, base_v - h * 0.45), tip, (cu + w * 0.55, base_v - h * 0.45), (cu + w / 2, base_v + 0.02)], fill))
    return "".join(out)


def svg(body, w, h, defs=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {W} {H}" preserveAspectRatio="none">'
            f'<defs>{defs}</defs>' + "".join(body) + "</svg>\n")
