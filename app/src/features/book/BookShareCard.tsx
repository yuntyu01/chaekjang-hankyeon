// 책 공유 카드(2026-11-09 사용자 시안): 벽에 움푹 파인 칸 안 선반에 책 한 권 + 아래 읽기 상태·제목·저자·한 줄 감상·별점·독서 시간·읽은 기간 + '책장 한켠'.
// 2026-11-09 '공유 디자인이 좀 별론데' → 시안에서 다시 잰 값으로 장면을 고쳤다:
// - 칸 안 면은 모서리 꺾인 선 없이 부드러운 그늘(천장 아래·왼쪽 안 모서리), 오른쪽 안 면은 창빛에 밝게, 판 가까이는 나무 반사로 따뜻하게
// - 선반은 결이 있는 밝은 나무(윗면 얇게 밝고 앞 끝 빛줄, 앞면 결, 아래 벽 그늘)
// - 갈피는 시안처럼 책배 쪽 머리 위로 나온 납작한 종이 탭(옅은 갈피 색). 3D 갈피(한지 결·빛)는 이 크기에서 얼룩져 보여 빼고 그린다
// - 책은 오른쪽 책배 속지가 보이게 16° 돌린다(판 끝 여유 2.5mm 때문에 9°에서는 속지가 거의 안 보였다)
// - 글자는 시안의 무채 회색(앱 본문 남색 회색 말고)
// 크기는 폭 360 기준 값(시안 941px에서 잰 자리)에 k = width/360을 곱한다(미리보기·내보내기 같은 모양). 높이는 최소 9:16이고 감상이 길면 늘어난다.
// 공유 이미지는 화면을 그대로 뜨므로(makeImageFromView) 장면 캔버스는 책 그림이 준비되면 그림으로 굳혀 둔다. onReady = 장면 그림까지 준비됨
import { BlurMask, Canvas, Group, LinearGradient, Path, Rect, RoundedRect, Skia, useCanvasRef, vec, type SkPath } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { corners, faceCorners, fromPlaced, rot, toWorld, type Book3 } from '@/domain/book3';
import { project } from '@/domain/camera';
import { shade } from '@/domain/color';
import { coverAtSize } from '@/domain/cover-url';
import { outlineOf, standaloneFrame } from '@/domain/shelf-scene';
import type { Book } from '@/domain/types';
import { SKIN } from '@/scene-config/skin';
import { tabsOf, useBookArt, useBookShared } from '@/ui/book3d/art';
import { BookNode } from '@/ui/book3d/BookNode';
import { frameCam, noRibbon } from '@/ui/book3d/StandaloneBook';
import { Star } from '@/ui/icons';
import { keepAll } from '@/ui/keep-all';
import { colors, fonts } from '@/ui/theme';
import { ALL_PARTS, type BookShareData, type ShareParts } from './book-share';

// 한 줄 감상 글자 크기: 짧으면 시안 크기, 길면 줄인다
function noteSize(text: string) {
  const n = text.replace(/\s+/g, '').length;
  if (n <= 24) return { size: 19, lh: 29 };
  if (n <= 60) return { size: 17.5, lh: 27 };
  return { size: 16, lh: 25 };
}

// 시안 글자색(무채 회색)
const INK = { title: '#313233', author: '#5F6167', note: '#272629', meta: '#75767B', rule: '#DCDCDE', foot: '#86868A' };

// 장면 자리(폭 360 기준 dp, 시안 941px에서 잼): 칸 안쪽 왼쪽·오른쪽·위, 판 윗면 시작·앞면 시작·아래 끝, 판 아래 그늘 길이, 장면 높이
const SC = { l: 19.5, r: 340.5, top: 50, ledge: 322, face: 326.5, bottom: 345, under: 22, h: 372 };
// 칸 안쪽 면이 보이는 폭(dp, 시안): 천장 11, 왼쪽 10, 오른쪽 11.5
const NF = { ceil: 11, left: 10, right: 11.5 };

export function BookShareCard({ data, parts = ALL_PARTS, width, onReady }: { data: BookShareData; parts?: ShareParts; width: number; onReady?: () => void }) {
  const k = width / 360;
  const u = (v: number) => v * k;
  // 갈피 색: 책장 갈피와 같은 규칙(표지에서 뽑은 색). 읽기 상태 글자도 그 색(조금 짙게)
  const tab = useMemo(() => tabsOf({ ...data.book, quotes: Math.max(1, data.book.quotes ?? 0) })[0]?.color ?? colors.star, [data.book]);
  const ink = shade(tab, -0.18);
  const note = parts.note ? data.note : undefined;
  const nt = note ? noteSize(note) : null;
  const meta = [
    parts.rating && data.rating ? { key: 'rating', text: String(data.rating), star: true } : null,
    parts.time && data.readTime ? { key: 'time', text: data.readTime } : null,
    parts.period && data.period ? { key: 'period', text: data.period } : null,
  ].filter((m): m is { key: string; text: string; star?: boolean } => !!m);
  const longTitle = data.title.length > 18;
  return (
    <View style={{ width, minHeight: (width * 16) / 9, backgroundColor: SKIN.wall.color }} accessible accessibilityLabel={`${data.title} 공유 카드`}>
      <ShareScene book={data.book} tab={tab} width={width} onReady={onReady} />
      <View style={{ paddingTop: u(382), paddingHorizontal: u(34), flex: 1 }}>
        <Text allowFontScaling={false} style={{ fontFamily: fonts.uiMedium, fontSize: u(14.5), lineHeight: u(20), color: ink, includeFontPadding: false }}>{data.status}</Text>
        <Text allowFontScaling={false} numberOfLines={2} style={{ fontFamily: fonts.uiTitle, fontSize: u(longTitle ? 21 : 25), lineHeight: u(longTitle ? 29 : 33), color: INK.title, marginTop: u(4), includeFontPadding: false }}>{keepAll(data.title)}</Text>
        {data.author ? <Text allowFontScaling={false} numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: u(15.5), lineHeight: u(21), color: INK.author, marginTop: u(5), includeFontPadding: false }}>{data.author}</Text> : null}
        {note && nt ? <Text allowFontScaling={false} textBreakStrategy="highQuality" style={{ fontFamily: fonts.reading, fontSize: u(nt.size), lineHeight: u(nt.lh), color: INK.note, marginTop: u(26), includeFontPadding: false }}>{keepAll(note)}</Text> : null}
        {meta.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: u(8), marginTop: u(note ? 30 : 24) }}>
            {meta.map((m, i) => (
              <View key={m.key} style={{ flexDirection: 'row', alignItems: 'center' }}>
                {i > 0 ? <View style={{ width: StyleSheet.hairlineWidth * 2, height: u(16), backgroundColor: INK.rule, marginHorizontal: u(20) }} /> : null}
                {m.star ? <Star size={u(14)} color={INK.meta} fill={INK.meta} strokeWidth={1} style={{ marginRight: u(7) }} /> : null}
                <Text allowFontScaling={false} style={{ fontFamily: fonts.ui, fontSize: u(14.5), lineHeight: u(20), color: INK.meta, includeFontPadding: false, fontVariant: ['tabular-nums'] }}>{m.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={{ flex: 1, minHeight: u(36) }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: u(16), paddingBottom: u(30) }}>
          <View style={{ width: u(18), height: StyleSheet.hairlineWidth * 2, backgroundColor: INK.rule }} />
          <Text allowFontScaling={false} style={{ fontFamily: fonts.ui, fontSize: u(13), lineHeight: u(18), color: INK.foot, includeFontPadding: false }}>책장 한켠</Text>
          <View style={{ width: u(18), height: StyleSheet.hairlineWidth * 2, backgroundColor: INK.rule }} />
        </View>
      </View>
    </View>
  );
}

// 채널마다 곱한 색(시안 나무색 ÷ 밝은 나무 스킨 색 비율을 다른 나무 스킨에도 그대로 쓴다)
function mul(hex: string, m: [number, number, number]) {
  const n = parseInt(hex.slice(1, 7), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v, i) => Math.max(0, Math.min(255, Math.round(v * m[i]))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// 고른 스킨(선반·틀·벽지) 색에서 칸·판 색을 만든다. 흰 틀·밝은 나무 판일 때 시안 값과 같다
function sceneColors() {
  // 칸 안은 무채에 가깝다(시안 뒷벽 R≈B): 틀 색을 같은 밝기의 회색 쪽으로 75% 당긴다
  const f = SKIN.frame?.color ?? shade(SKIN.wall.color, -0.07);
  const n = parseInt(f.slice(1, 7), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const avg = (c[0] + c[1] + c[2]) / 3;
  const frame = `#${c.map((v) => Math.round(v * 0.25 + avg * 0.75).toString(16).padStart(2, '0')).join('')}`;
  const p = SKIN.plank.color;
  const wood = SKIN.plank.mat === 'wood';
  return {
    wall: SKIN.wall.color,
    // 뒷벽(왼쪽 → 오른쪽 밝게)
    backL: shade(frame, -0.015),
    backM: shade(frame, 0.02),
    backR: shade(frame, 0.2),
    // 안쪽 면: 천장(앞 → 뒤 짙게), 왼쪽(앞 밝음 → 안 모서리 짙게), 오른쪽(안 모서리 → 앞, 창빛에 밝게)
    ceilFront: shade(frame, -0.065),
    ceilBack: shade(frame, -0.1),
    leftFront: shade(frame, 0.0),
    leftBack: shade(frame, -0.065),
    rightBack: shade(frame, 0.02),
    rightFront: shade(frame, 0.45),
    dark: '#5E4C46',
    warm: mul(p, [0.97, 0.82, 0.7]),
    topBack: mul(p, [0.996, 0.986, 1.005]),
    topFront: mul(p, [1.045, 1.064, 1.098]),
    frontTop: mul(p, [0.967, 0.923, 0.896]),
    frontMid: mul(p, [0.942, 0.891, 0.855]),
    frontLow: mul(p, [0.921, 0.859, 0.808]),
    edge: mul(p, [0.818, 0.741, 0.679]),
    grainDark: wood ? mul(p, [0.78, 0.66, 0.56]) : null,
    grainLight: wood ? mul(p, [1.04, 1.05, 1.07]) : null,
  };
}

// 나무 결: 판 앞면을 가로지르는 가는 물결선(늘 같은 무늬)
function grainPaths(x0: number, x1: number, y0: number, y1: number, k: number) {
  let seed = 20261109;
  const r = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const out: { path: SkPath; w: number; a: number; light: boolean }[] = [];
  for (let i = 0; i < 30; i++) {
    const y = y0 + r() * (y1 - y0);
    const amp = (0.25 + r() * 0.7) * k;
    const period = (70 + r() * 160) * k;
    const phase = r() * Math.PI * 2;
    const drift = (r() - 0.5) * 2.2 * k;
    const b = Skia.PathBuilder.Make();
    for (let x = x0; x <= x1 + 1; x += 4 * k) {
      const t = (x - x0) / (x1 - x0);
      const yy = y + amp * Math.sin((x / period) * Math.PI * 2 + phase) + drift * t;
      if (x === x0) b.moveTo(x, yy);
      else b.lineTo(x, yy);
    }
    const light = r() < 0.25;
    out.push({ path: b.detach(), w: (0.3 + r() * 0.8) * k, a: light ? 0.18 + r() * 0.14 : 0.04 + r() * 0.1, light });
  }
  return out;
}

// 조금 돌려 세운 책 한 권(오른쪽 끝이 앞으로 → 오른쪽 책배 속지가 보인다)
const SPIN = -16;
function spun(rest: Book3, spin: number): Book3 {
  const c = { x: rest.dims.T / 2, y: rest.dims.H / 2, z: rest.dims.W / 2 };
  const center = toWorld(rest, c);
  const r = rot(rest.roll, rest.yaw, c, spin, 0);
  return { ...rest, spin, t: { x: center.x - r.x, y: center.y - r.y, z: center.z - r.z } };
}

// 칸·선반·책·갈피를 한 캔버스에 그리고, 책 그림이 준비되면 캔버스를 그림으로 굳힌다
function ShareScene({ book: raw, tab, width, onReady }: { book: Book; tab: string; width: number; onReady?: () => void }) {
  const k = width / 360;
  const u = (v: number) => v * k;
  const H = u(SC.h);
  const col = useMemo(() => sceneColors(), []);
  const book = useMemo(() => noRibbon(raw.coverArtUri ? { ...raw, coverArtUri: coverAtSize(raw.coverArtUri, 'XL') } : raw), [raw]);
  const frame = useMemo(() => standaloneFrame(book, 'front'), [book]);
  const cam = useMemo(() => frameCam(frame), [frame]);
  const rest = useMemo(() => fromPlaced(frame.box), [frame]);
  const pose = useMemo(() => spun(rest, SPIN), [rest]);
  // 책 크기·자리: 시안 책(폭 155·높이 217dp) 상자 안에 맞추고, 발은 판 윗면 뒤쪽, 가운데 맞춤
  const g = useMemo(() => {
    const poly = outlineOf(cam, pose);
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const bw = Math.max(...xs) - minX;
    const bh = Math.max(...ys) - minY;
    const s = Math.min((210 * k) / bw, (216 * k) / bh);
    const tx = width / 2 - (minX + bw / 2) * s;
    const ty = (SC.ledge + 1) * k - (minY + bh) * s;
    const cs = corners(pose);
    const cover = faceCorners('cover').map((i) => {
      const q = project(cam, cs[i]);
      return { x: q.x * s + tx, y: q.y * s + ty };
    });
    const byX = [...cover].sort((a, b) => b.x - a.x);
    const topRight = byX[0].y < byX[1].y ? byX[0] : byX[1];
    const coverL = Math.min(...cover.map((p) => p.x));
    const coverW = topRight.x - coverL;
    return { s, tx, ty, box: { x: minX * s + tx, y: minY * s + ty, w: bw * s, h: bh * s }, topRight, coverW };
  }, [cam, pose, width, k]);
  const px = useMemo(() => ({ s: g.s, tx: g.tx, ty: g.ty }), [g]);
  const grain = useMemo(() => (col.grainDark ? grainPaths(u(SC.l), u(SC.r), u(SC.face + 1), u(SC.bottom - 1), k) : []), [col, k]);
  const state = useSharedValue(pose);
  const camSV = useSharedValue(cam);
  useEffect(() => {
    state.value = pose;
    camSV.value = cam;
  }, [pose, cam, state, camSV]);
  const shared = useBookShared();
  // BookNode와 같은 값으로 물어 같은 그림(캐시)을 기다린다: 준비되면 몇 프레임 뒤 캔버스를 뜬다
  const art = useBookArt(book, g.s, rest.dims, shared);
  const canvas = useCanvasRef();
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (!art) return;
    let live = true;
    setUri(null);
    const t = setTimeout(() => {
      void canvas.current?.makeImageSnapshotAsync().then((img) => {
        if (live) setUri(`data:image/png;base64,${img.encodeToBase64()}`);
      }).catch(() => {});
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [art, g.s, width, canvas]);

  const L = u(SC.l);
  const R = u(SC.r);
  const T = u(SC.top);
  const W = R - L;
  const back = u(SC.ledge) - T;
  // 갈피 탭: 시안처럼 책배 쪽(표지 오른쪽 끝에서 표지 폭의 4.5% 안쪽), 폭 23·나온 길이 13dp(작은 책은 표지 폭에 맞춰 줄인다)
  const tabW = Math.min(u(23), g.coverW * 0.16);
  const tabOut = Math.min(u(13), g.coverW * 0.09);
  const tabR = g.topRight.x - g.coverW * 0.045;
  const tabTop = g.topRight.y - tabOut;
  const b = g.box;
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width, height: H }} pointerEvents="none" accessible accessibilityLabel={`${raw.title} 표지`}>
      <Canvas ref={canvas} style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={width} height={H} color={col.wall} />
        {/* 칸 안 뒷벽: 왼쪽 앞에서 오는 창빛이라 오른쪽이 밝다 */}
        <Rect x={L} y={T} width={W} height={back}>
          <LinearGradient start={vec(L, 0)} end={vec(R, 0)} colors={[col.backL, col.backM, col.backR]} positions={[0, 0.45, 1]} />
        </Rect>
        {/* 뒷벽 안 모서리 그늘(천장 아래가 가장 짙고, 양옆은 옅게): 면 경계에서 시작해 부드럽게 풀린다 */}
        <Rect x={L} y={T + u(NF.ceil)} width={W} height={u(36)}>
          <LinearGradient start={vec(0, T + u(NF.ceil))} end={vec(0, T + u(NF.ceil + 36))} colors={[0.11, 0.07, 0.035, 0.012, 0].map((a) => shadeA(col.dark, a))} positions={[0, 0.25, 0.55, 0.8, 1]} />
        </Rect>
        <Rect x={L + u(NF.left)} y={T} width={u(18)} height={back}>
          <LinearGradient start={vec(L + u(NF.left), 0)} end={vec(L + u(NF.left + 18), 0)} colors={[0.05, 0.02, 0].map((a) => shadeA(col.dark, a))} positions={[0, 0.45, 1]} />
        </Rect>
        <Rect x={R - u(NF.right + 14)} y={T} width={u(14)} height={back}>
          <LinearGradient start={vec(R - u(NF.right + 14), 0)} end={vec(R - u(NF.right), 0)} colors={[0, 0.02, 0.045].map((a) => shadeA(col.dark, a))} positions={[0, 0.55, 1]} />
        </Rect>
        {/* 판 가까이: 나무에서 튄 따뜻한 빛, 판과 맞닿은 줄은 조금 어둡게 */}
        <Rect x={L} y={u(SC.ledge - 44)} width={W} height={u(44)}>
          <LinearGradient start={vec(0, u(SC.ledge - 44))} end={vec(0, u(SC.ledge))} colors={[shadeA(col.warm, 0), shadeA(col.warm, 0.1), shadeA(col.warm, 0.22)]} positions={[0, 0.7, 1]} />
        </Rect>
        <Rect x={L} y={u(SC.ledge - 7)} width={W} height={u(7)}>
          <LinearGradient start={vec(0, u(SC.ledge - 7))} end={vec(0, u(SC.ledge))} colors={[shadeA(col.dark, 0), shadeA(col.dark, 0.07)]} />
        </Rect>

        {/* 안쪽 면 세 개(경계가 또렷한 띠, 모서리는 비스듬히 만난다): 양옆 → 천장 순서 */}
        <Path path={facePath([[L, T], [L + u(NF.left), T + u(NF.ceil)], [L + u(NF.left), u(SC.ledge)], [L, u(SC.ledge)]])}>
          <LinearGradient start={vec(L, 0)} end={vec(L + u(NF.left), 0)} colors={[col.leftFront, col.leftBack]} />
        </Path>
        <Path path={facePath([[R, T], [R - u(NF.right), T + u(NF.ceil)], [R - u(NF.right), u(SC.ledge)], [R, u(SC.ledge)]])}>
          <LinearGradient start={vec(R - u(NF.right), 0)} end={vec(R, 0)} colors={[col.rightBack, col.rightFront]} />
        </Path>
        <Path path={facePath([[L, T], [R, T], [R - u(NF.right), T + u(NF.ceil)], [L + u(NF.left), T + u(NF.ceil)]])}>
          <LinearGradient start={vec(0, T)} end={vec(0, T + u(NF.ceil))} colors={[col.ceilFront, col.ceilBack]} />
        </Path>
        {/* 양옆 면 아래쪽도 판에서 튄 따뜻한 빛 */}
        {[[L, u(NF.left)], [R - u(NF.right), u(NF.right)]].map(([x, w]) => (
          <Rect key={x} x={x} y={u(SC.ledge - 44)} width={w} height={u(44)}>
            <LinearGradient start={vec(0, u(SC.ledge - 44))} end={vec(0, u(SC.ledge))} colors={[shadeA(col.warm, 0), shadeA(col.warm, 0.1)]} />
          </Rect>
        ))}

        {/* 책이 뒷벽에 드리운 그늘(오른쪽으로 길게, 머리 위로는 거의 없다) */}
        <RoundedRect x={b.x + u(13)} y={b.y + u(12)} width={b.w} height={b.h - u(12)} r={u(4)} color={shadeA(col.dark, 0.5)}>
          <BlurMask blur={u(10)} style="normal" />
        </RoundedRect>

        {/* 선반 판: 윗면(뒤 → 앞 끝 밝게) + 앞면(결) + 아래 모서리 + 아래 벽 그늘 */}
        <Rect x={L} y={u(SC.ledge)} width={W} height={u(SC.face - SC.ledge)}>
          <LinearGradient start={vec(0, u(SC.ledge))} end={vec(0, u(SC.face))} colors={[col.topBack, col.topBack, col.topFront]} positions={[0, 0.45, 1]} />
        </Rect>
        <Rect x={L} y={u(SC.face)} width={W} height={u(SC.bottom - SC.face)}>
          <LinearGradient start={vec(0, u(SC.face))} end={vec(0, u(SC.bottom))} colors={[col.frontTop, col.frontMid, col.frontLow]} />
        </Rect>
        <Group clip={Skia.XYWHRect(L, u(SC.face), W, u(SC.bottom - SC.face))}>
          {grain.map((gr, i) => (
            <Path key={i} path={gr.path} style="stroke" strokeWidth={gr.w} color={gr.light ? col.grainLight! : col.grainDark!} opacity={gr.a} />
          ))}
        </Group>
        <Rect x={L} y={u(SC.face) - u(0.4)} width={W} height={u(0.8)} color={col.topFront} />
        <Rect x={L} y={u(SC.bottom) - u(0.9)} width={W} height={u(0.9)} color={col.edge} opacity={0.8} />
        <Rect x={L} y={u(SC.bottom)} width={W} height={u(SC.under)}>
          <LinearGradient start={vec(0, u(SC.bottom))} end={vec(0, u(SC.bottom + SC.under))} colors={[0.34, 0.24, 0.15, 0.08, 0.03, 0].map((a) => shadeA(col.dark, a))} positions={[0, 0.16, 0.33, 0.56, 0.8, 1]} />
        </Rect>

        {/* 책 발밑 닿는 그늘 */}
        <RoundedRect x={b.x + u(2)} y={u(SC.ledge) - u(0.5)} width={b.w} height={u(3)} r={u(1.5)} color={shadeA(col.dark, 0.45)}>
          <BlurMask blur={u(1.6)} style="normal" />
        </RoundedRect>

        {/* 갈피 탭(책 뒤에서 머리 위로 나온 종이: 아래쪽은 책이 가린다) */}
        <RoundedRect x={tabR - tabW} y={tabTop} width={tabW} height={tabOut + u(8)} r={u(1.6)}>
          <LinearGradient start={vec(0, tabTop)} end={vec(0, tabTop + tabOut)} colors={[shade(tab, 0.5), shade(tab, 0.4)]} />
        </RoundedRect>

        <BookNode book={book} dims={rest.dims} state={state} cam={camSV} px={px} shared={shared} />
      </Canvas>
      {uri ? <Image source={{ uri }} resizeMode="stretch" style={StyleSheet.absoluteFill} onLoad={onReady} /> : null}
    </View>
  );
}

// 꼭짓점 목록 → 닫힌 경로
function facePath(pts: [number, number][]) {
  const b = Skia.PathBuilder.Make();
  pts.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y)));
  b.close();
  return b.detach();
}

// 색에 진하기를 준 rgba
function shadeA(hex: string, a: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
