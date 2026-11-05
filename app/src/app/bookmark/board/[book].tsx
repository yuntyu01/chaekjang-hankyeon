// 갈피 보드(2026-11-02 사용자 시안): 책 한 권의 갈피를 화면보다 넓은 보드에 흩어 붙인다. 확대는 읽기, 축소는 배치 확인.
// 빈 곳을 끌면 보드 이동, 두 손가락으로 확대·축소, 갈피를 꾹 눌러 끌면 옮겨 붙이기(다른 갈피 위에도, 화면 끝에 닿으면 보드가 넓어진다), 떼면 손잡이로 폭 바꾸기, 한 번 누르면 크게 읽기. '전체 보기'는 모든 갈피가 보이게, '+ 갈피'는 보던 곳의 빈 자리에.
// 새 갈피는 자동으로 놓이고(domain/bookmark-board) 옮긴 자리는 갈피 기록에 저장돼 다른 기기로 간다. 마지막 위치·배율은 기기마다 기억한다.
// 가로로 끌면 옆 책의 보드로 넘어간다(2026-11-05 사용자 '점 추가해서 옆으로 넘기면 옆에 책'). 보드가 화면보다 넓으면 보드 끝까지 움직인 뒤 넘어간다. 두 손가락은 언제나 보드만 움직인다.
import { router, useLocalSearchParams } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useFrameCallback, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { boardBookIds, boardBounds, boardCardSize, boardClamp, boardFit, boardFreeSpot, boardHeightAt, boardPageSlide, boardPhotoRatio, boardResized, boardSpots, boardTextChars, boardViewKey, boardZoomAt, BOARD_MAX_SCALE, BOARD_MAX_W, BOARD_MIN_SCALE, BOARD_MIN_W, type BoardSpot, type BoardView } from '@/domain/bookmark-board';
import { tabColors } from '@/domain/color';
import { bookmarksOf, memoShelfBook, type Bookmark, type Library } from '@/domain/library';
import { realBoardSeed } from '@/domain/real-sample';
import { BoardCard } from '@/features/bookmark/BoardCard';
import { PageDots } from '@/features/bookmark/PageDots';
import { libraryStore, useLibrary } from '@/store/library-store';
import { LinkedCover } from '@/ui/BookVisual';
import { ChevronLeft, MoveDiagonal2, Plus } from '@/ui/icons';
import { Btn, Empty, IconButton } from '@/ui/kit';
import { PERF_ENABLED } from '@/ui/perf';
import { colors, fonts, icon, buttonHeight, space, type } from '@/ui/theme';

// 카드를 얹는 층의 크기와 원점: 음수 자리까지 터치가 닿도록 넓은 층의 가운데를 보드 원점으로 쓴다
const ORIGIN = 3000;
const LAYER = ORIGIN * 2;
const REACH = ORIGIN - 400; // 옮겨 붙일 수 있는 범위
const LIFT = 1.04;
const HANDLE = 44;
// 카드를 끌다 화면 끝에 닿으면 보드가 넓어진다: 끝에서 이만큼 안쪽(dp), 1초에 이 배율로
const EDGE = 44;
const EDGE_ZOOM = 0.72;

// 책 넘기기: 이만큼 끌거나 이 속도로 튕기면 다음 책으로
const TURN_AT = 0.22;
const FLING = 700;
const TURN_MS = 240;

type Turner = {
  drag: SharedValue<number>; // 넘기느라 끈 거리(왼쪽으로 끌면 음수 = 다음 책)
  settling: SharedValue<boolean>;
  edges: SharedValue<{ prev: boolean; next: boolean }>;
  settle: (vx: number, ok: boolean) => void;
};

export default function BookmarkBoard() {
  const { book: first, demo } = useLocalSearchParams<{ book: string; demo?: string }>();
  const { lib } = useLibrary();
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  // 측정 번들: ?demo=1 은 시험 서재에 실제 책 갈피를 넣는다(보드 사진·옮기기 저장 확인용)
  const seeded = useRef(false);
  useEffect(() => {
    if (!PERF_ENABLED || demo !== '1' || seeded.current) return;
    seeded.current = true;
    const target = realBoardSeed(libraryStore, first);
    if (target !== first) router.replace(`/bookmark/board/${target}?demo=1`);
  }, [demo, first]);

  // 넘길 책: 연 순간의 순서로 고정한다(새 갈피를 남겼다고 책 순서가 바뀌어 화면이 튀지 않게)
  const order = useMemo(() => boardBookIds(lib, first), [first]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = useMemo(() => order.filter((x) => lib.books[x]), [order, lib.books]);
  const pagesRef = useRef(pages);
  const [id, setId] = useState(first);
  useEffect(() => setId(first), [first]);
  const index = pages.indexOf(id);
  useLayoutEffect(() => { pagesRef.current = pages; }, [pages]);

  const reduce = useReducedMotion();
  const base = useSharedValue(Math.max(0, index));
  const drag = useSharedValue(0);
  const settling = useSharedValue(false);
  const edges = useSharedValue({ prev: index > 0, next: index >= 0 && index < pages.length - 1 });
  useLayoutEffect(() => {
    base.value = Math.max(0, index);
    edges.value = { prev: index > 0, next: index >= 0 && index < pages.length - 1 };
  }, [base, edges, index, pages.length]);

  const commit = useCallback((i: number) => {
    const next = pagesRef.current[i];
    if (next) setId(next);
  }, []);
  // 넘어간 순간 UI 스레드에서 기준 칸과 끈 거리를 함께 바꾼다(그리는 자리는 그대로라 깜빡이지 않는다)
  const go = useCallback((dir: 1 | -1) => {
    'worklet';
    settling.value = true;
    drag.value = withTiming(-dir * W, { duration: reduce ? 0 : TURN_MS, easing: Easing.out(Easing.cubic) }, () => {
      const next = base.value + dir;
      base.value = next;
      drag.value = 0;
      settling.value = false;
      scheduleOnRN(commit, next);
    });
  }, [W, base, commit, drag, reduce, settling]);
  const settle = useCallback((vx: number, ok: boolean) => {
    'worklet';
    const d = drag.value;
    if (d === 0) return;
    const dir = d < 0 ? 1 : -1;
    const can = dir > 0 ? edges.value.next : edges.value.prev;
    const fling = Math.abs(vx) > FLING && vx < 0 === d < 0;
    if (ok && can && (Math.abs(d) > W * TURN_AT || fling)) go(dir);
    else drag.value = withTiming(0, { duration: reduce ? 0 : 200, easing: Easing.out(Easing.cubic) });
  }, [W, drag, edges, go, reduce]);
  // 화면 낭독: 끌지 않고 위아래 조절 동작으로 넘긴다
  const turn = (dir: 1 | -1) => {
    if (dir > 0 ? index < pages.length - 1 : index > 0) scheduleOnUI(go, dir);
  };
  const track = useAnimatedStyle(() => ({ transform: [{ translateX: -base.value * W + drag.value }] }));

  // 옆 책은 처음 화면을 그린 뒤에 붙인다(여는 순간을 늦추지 않게)
  const [near, setNear] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setNear(true), 300);
    return () => clearTimeout(t);
  }, []);

  if (index < 0) {
    return (
      <View style={[st.root, { paddingTop: insets.top }]}>
        <IconButton label="뒤로" onPress={() => router.back()}><ChevronLeft size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></IconButton>
        <Empty title="책을 찾지 못했어요" />
      </View>
    );
  }
  const title = (x: string) => lib.editions[lib.books[x]?.editionId]?.title ?? '';
  const turner: Turner = { drag, settling, edges, settle };
  return (
    <View style={st.root}>
      <View style={[st.head, { paddingTop: insets.top + 4 }]}>
        <View style={st.titleRow}>
          <IconButton label="뒤로" onPress={() => router.back()}><ChevronLeft size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></IconButton>
          <Text style={st.title} accessibilityRole="header">갈피 보드</Text>
        </View>
      </View>
      <View style={st.pager}>
        <Animated.View style={[st.track, { width: pages.length * W }, track]}>
          {pages.map((pid, i) => (Math.abs(i - index) <= (near ? 1 : 0) ? (
            <View key={pid} style={[st.page, { left: i * W, width: W }]}>
              <BoardPage id={pid} lib={lib} turner={turner} />
            </View>
          ) : null))}
        </Animated.View>
      </View>
      {pages.length > 1 ? (
        <View style={[st.dots, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`${pages.length}권 중 ${index + 1}번째 책, ${title(id)}`}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(ev) => turn(ev.nativeEvent.actionName === 'increment' ? 1 : -1)}>
            <PageDots count={pages.length} index={index} color={tabColors(memoShelfBook(lib, id)?.art.ribbon, id)[0]} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function BoardPage({ id, lib, turner }: { id: string; lib: Library; turner: Turner }) {
  const { drag, settling, edges, settle } = turner;
  const insets = useSafeAreaInsets();
  const bottomBar = insets.bottom + 16 + buttonHeight.s; // 아래 '전체 보기·+ 갈피' 줄이 덮는 높이
  const b = lib.books[id];
  const e = b && lib.editions[b.editionId];
  const marks = useMemo(() => (b ? bookmarksOf(lib, id) : []), [lib, id, b]);
  const spots = useMemo(() => boardSpots(marks), [marks]);
  const bounds = useMemo(() => boardBounds(spots), [spots]);
  const color = b ? memoShelfBook(lib, b.id)?.art.ribbon : undefined;

  const [vp, setVp] = useState({ w: 0, h: 0 });
  const viewRef = useRef<View>(null);
  const originY = useSharedValue(0); // 보드 칸 위쪽의 화면 좌표(손가락 위치 환산)
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const s = useSharedValue(1);
  const reduce = useReducedMotion();
  const ready = useRef(false);
  const [shown, setShown] = useState(false);
  const boundsSV = useSharedValue(bounds);
  const vpSV = useSharedValue(vp);
  useEffect(() => {
    boundsSV.value = bounds;
    vpSV.value = vp;
  }, [bounds, vp, boundsSV, vpSV]);

  const place = useCallback((v: BoardView, animate: boolean) => {
    const t = { duration: animate && !reduce ? 260 : 0, easing: Easing.out(Easing.cubic) };
    x.value = withTiming(v.x, t);
    y.value = withTiming(v.y, t);
    s.value = withTiming(v.s, t);
  }, [reduce, s, x, y]);
  // 처음 열 때: 마지막에 보던 곳, 없으면 전체 보기
  useEffect(() => {
    if (!vp.w || !spots.length || ready.current) return;
    ready.current = true;
    void Storage.getItem(boardViewKey(id)).then((raw) => {
      let v: BoardView | null = null;
      try {
        const o = raw ? JSON.parse(raw) : null;
        if (o && [o.x, o.y, o.s].every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) v = boardClamp(o, bounds, vp.w, vp.h);
      } catch {
        v = null;
      }
      place(v ?? boardFit(spots, vp.w, vp.h, bottomBar), false);
      setShown(true);
    });
  }, [vp, spots, id, bounds, place]);
  const saveView = useCallback((vx: number, vy: number, vs: number) => {
    void Storage.setItem(boardViewKey(id), JSON.stringify({ x: vx, y: vy, s: vs }));
  }, [id]);

  const pinchStart = useSharedValue(1);
  // 가로로 시작한 한 손가락 끌기만 책을 넘긴다. 세로 끌기와 두 손가락은 보드만 움직인다
  // 안드로이드는 활성화 순간 이동 거리(translation)를 0으로 되돌리므로, 방향은 누른 자리와 활성화 자리의 차이로 잰다
  const paging = useSharedValue(false);
  const beginX = useSharedValue(0);
  const beginY = useSharedValue(0);
  const pan = useMemo(() => Gesture.Pan().minDistance(6).maxPointers(2)
    .onBegin((ev) => {
      beginX.value = ev.x;
      beginY.value = ev.y;
    })
    .onStart((ev) => {
      paging.value = !settling.value && (edges.value.prev || edges.value.next) && ev.numberOfPointers <= 1 && Math.abs(ev.x - beginX.value) > Math.abs(ev.y - beginY.value);
    })
    .onChange((ev) => {
      if (ev.numberOfPointers > 1) paging.value = false;
      let dx = ev.changeX;
      if (paging.value) {
        // 넘기다 되돌아오면 책이 제자리에 온 뒤에야 보드가 움직인다
        const d = drag.value;
        if (d !== 0) {
          const nd = d + dx;
          if (nd * d > 0) {
            drag.value = Math.max(-vpSV.value.w, Math.min(vpSV.value.w, nd));
            return;
          }
          drag.value = 0;
          dx = nd;
        }
        const slide = boardPageSlide(x.value, dx, s.value, boundsSV.value, vpSV.value.w);
        if (slide.left !== 0 && (slide.left < 0 ? edges.value.next : edges.value.prev)) drag.value = slide.left;
        dx = slide.x - x.value;
      }
      const v = boardClamp({ x: x.value + dx, y: y.value + (drag.value !== 0 ? 0 : ev.changeY), s: s.value }, boundsSV.value, vpSV.value.w, vpSV.value.h);
      x.value = v.x;
      y.value = v.y;
    })
    .onEnd((ev, ok) => {
      scheduleOnRN(saveView, x.value, y.value, s.value);
      settle(ev.velocityX, ok);
    }), [beginX, beginY, boundsSV, drag, edges, paging, s, saveView, settle, settling, vpSV, x, y]);
  const pinch = useMemo(() => Gesture.Pinch()
    .onStart(() => {
      pinchStart.value = s.value;
    })
    .onUpdate((ev) => {
      const next = Math.max(BOARD_MIN_SCALE, Math.min(BOARD_MAX_SCALE, pinchStart.value * ev.scale));
      const k = next / s.value;
      const v = boardClamp({ x: ev.focalX - (ev.focalX - x.value) * k, y: ev.focalY - (ev.focalY - y.value) * k, s: next }, boundsSV.value, vpSV.value.w, vpSV.value.h);
      x.value = v.x;
      y.value = v.y;
      s.value = v.s;
    })
    .onEnd(() => {
      scheduleOnRN(saveView, x.value, y.value, s.value);
    }), [boundsSV, pinchStart, s, saveView, vpSV, x, y]);
  // 고른 갈피: 꾹 눌렀다 떼면 고르고, 빈 곳이나 카드를 한 번 누르면 풀린다
  const [picked, setPicked] = useState<string | null>(null);
  const pickedRef = useRef<string | null>(null);
  useLayoutEffect(() => { pickedRef.current = picked; }, [picked]);
  const clearPick = useCallback(() => setPicked(null), []);
  const tapCard = useCallback((markId: string) => {
    if (pickedRef.current) setPicked(null);
    else router.push(`/bookmark/${markId}`);
  }, []);
  const viewChanged = useCallback(() => saveView(x.value, y.value, s.value), [s, saveView, x, y]);
  const board = useMemo(() => {
    const tapEmpty = Gesture.Tap().maxDistance(8).onEnd((_, ok) => {
      if (ok) scheduleOnRN(clearPick);
    });
    return Gesture.Simultaneous(pan, pinch, tapEmpty);
  }, [clearPick, pan, pinch]);
  const layer = useAnimatedStyle(() => ({ transform: [{ translateX: x.value - ORIGIN * s.value }, { translateY: y.value - ORIGIN * s.value }, { scale: s.value }] }));

  const fit = () => {
    const v = boardFit(spots, vp.w, vp.h, bottomBar);
    place(v, true);
    saveView(v.x, v.y, v.s);
  };
  const addHere = () => {
    const spot = boardFreeSpot(spots, { x: x.value, y: y.value, s: s.value }, vp.w, vp.h, boardCardSize({ text: '갈피에 남길 문장 두 줄 정도' }));
    router.push({ pathname: '/bookmark/new', params: { book: id, boardX: String(spot.x), boardY: String(spot.y) } });
  };
  // 나중에 만지거나 고친 갈피가 위에(기기가 달라도 같은 순서)
  const order = useMemo(() => [...marks].sort((p, q) => p.updatedAt.localeCompare(q.updatedAt)), [marks]);
  const spotOf = useMemo(() => new Map(spots.map((o) => [o.id, o])), [spots]);

  if (!b || !e) return null;
  return (
    <>
      <View style={st.bookRow}>
        <View style={st.cover} pointerEvents="none"><LinkedCover lib={lib} id={id} width={34} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={type.rowStrong} numberOfLines={1}>{e.title}</Text>
          <Text style={type.sub} numberOfLines={1}>{[e.authors[0], `갈피 ${marks.length}개`].filter(Boolean).join(' · ')}</Text>
        </View>
        <Btn label="목록 보기" kind="secondary" size="s" onPress={() => router.push({ pathname: '/bookmarks', params: { book: id } })} />
      </View>
      <GestureDetector gesture={board}>
        <View ref={viewRef} style={st.view} collapsable={false} onLayout={(ev) => { setVp({ w: ev.nativeEvent.layout.width, h: ev.nativeEvent.layout.height }); viewRef.current?.measureInWindow((_mx, my) => { originY.value = my; }); }}>
          {marks.length ? (
            <Animated.View style={[st.layer, layer, { opacity: shown ? 1 : 0 }]}>
              {order.map((m) => {
                const o = spotOf.get(m.id);
                return o ? <BoardItem key={m.id} mark={m} spot={o} color={color} x={x} y={y} scale={s} vp={vpSV} originY={originY} selected={picked === m.id} onSelect={setPicked} onTap={tapCard} onViewChanged={viewChanged} /> : null;
              })}
            </Animated.View>
          ) : (
            <Empty title="아직 남긴 갈피가 없어요" body="이 책에 남긴 문장과 사진을 여기에 붙여 둘 수 있어요." />
          )}
        </View>
      </GestureDetector>
      <View style={[st.bottom, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
        <Btn label="전체 보기" kind="secondary" size="s" disabled={!marks.length} onPress={fit} />
        <Btn label="갈피" kind="secondary" size="s" icon={<Plus size={icon.small} color={colors.ink} strokeWidth={icon.stroke} />} onPress={addHere} />
      </View>
    </>
  );
}

type BoardItemProps = {
  mark: Bookmark;
  spot: BoardSpot;
  color?: string;
  x: SharedValue<number>;
  y: SharedValue<number>;
  scale: SharedValue<number>;
  vp: SharedValue<{ w: number; h: number }>;
  originY: SharedValue<number>;
  selected: boolean;
  onSelect: (id: string) => void;
  onTap: (id: string) => void;
  onViewChanged: () => void;
};

// 갈피 한 장: 누르면 크게 읽기. 꾹 누르면 들리고, 끌면 옮겨지며(다른 갈피 위에도 놓을 수 있다), 떼면 고른 상태가 되어 손잡이로 폭을 바꾼다.
// 끄는 자리는 손가락 위치로 바로 계산한다(끌다가 화면 끝에 닿아 보드가 넓어져도 카드가 손가락 아래에 남는다)
function BoardItem({ mark, spot, color, x, y, scale, vp, originY, selected, onSelect, onTap, onViewChanged }: BoardItemProps) {
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const lift = useSharedValue(0);
  const w = useSharedValue(spot.w);
  const cardH = useSharedValue(spot.h);
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);
  const chars = useMemo(() => boardTextChars(mark.text), [mark.text]);
  const ratio = mark.photoUri ? boardPhotoRatio(mark.photoRatio) : 0;
  // 저장된 자리로 그려진 뒤에 끈 만큼을 지운다(놓는 순간 튀지 않게)
  useLayoutEffect(() => {
    dx.value = 0;
    dy.value = 0;
    w.value = spot.w;
  }, [spot.x, spot.y, spot.w, dx, dy, w]);

  const frame = useFrameCallback((info) => {
    const near = fingerX.value < EDGE || fingerX.value > vp.value.w - EDGE || fingerY.value < EDGE || fingerY.value > vp.value.h - EDGE;
    if (!near || scale.value <= BOARD_MIN_SCALE) return;
    const k = Math.max(BOARD_MIN_SCALE / scale.value, Math.pow(EDGE_ZOOM, (info.timeSincePreviousFrame ?? 16) / 1000));
    const v = boardZoomAt({ x: x.value, y: y.value, s: scale.value }, k, vp.value.w / 2, vp.value.h / 2);
    x.value = v.x;
    y.value = v.y;
    scale.value = v.s;
    dx.value = (fingerX.value - x.value) / scale.value - grabX.value;
    dy.value = (fingerY.value - y.value) / scale.value - grabY.value;
  }, false);
  const setEdgeWatch = useCallback((on: boolean) => frame.setActive(on), [frame]);

  const tapped = useCallback(() => onTap(mark.id), [mark.id, onTap]);
  const drop = useCallback((mx: number, my: number, ok: boolean) => {
    onViewChanged();
    if (!ok || Math.abs(mx) + Math.abs(my) < 2) {
      dx.value = 0;
      dy.value = 0;
    } else {
      const nx = Math.round(Math.max(-REACH, Math.min(REACH, spot.x + mx)));
      const ny = Math.round(Math.max(-REACH, Math.min(REACH, spot.y + my)));
      libraryStore.updateBookmark(mark.id, { boardX: nx, boardY: ny, boardRot: spot.rot });
    }
    if (ok) onSelect(mark.id);
  }, [dx, dy, mark.id, onSelect, onViewChanged, spot.rot, spot.x, spot.y]);
  const gesture = useMemo(() => {
    const tap = Gesture.Tap().maxDistance(8).onEnd((_, ok) => {
      if (ok) scheduleOnRN(tapped);
    });
    const move = Gesture.Pan().activateAfterLongPress(280)
      .onStart((ev) => {
        lift.value = withTiming(1, { duration: 120 });
        fingerX.value = ev.absoluteX;
        fingerY.value = ev.absoluteY - originY.value;
        grabX.value = (fingerX.value - x.value) / scale.value;
        grabY.value = (fingerY.value - y.value) / scale.value;
        scheduleOnRN(setEdgeWatch, true);
      })
      .onChange((ev) => {
        fingerX.value = ev.absoluteX;
        fingerY.value = ev.absoluteY - originY.value;
        dx.value = (fingerX.value - x.value) / scale.value - grabX.value;
        dy.value = (fingerY.value - y.value) / scale.value - grabY.value;
      })
      .onEnd((_, ok) => {
        scheduleOnRN(drop, dx.value, dy.value, ok);
      })
      .onFinalize(() => {
        lift.value = withTiming(0, { duration: 180 });
        scheduleOnRN(setEdgeWatch, false);
      });
    return Gesture.Exclusive(move, tap);
  }, [drop, dx, dy, fingerX, fingerY, grabX, grabY, lift, originY, scale, setEdgeWatch, tapped, x, y]);

  // 손잡이: 폭이 바뀌면 글은 그 폭에 맞춰 다시 줄 바꿈된다. 왼쪽 위 모서리는 그대로
  const commitWidth = useCallback((nw: number) => {
    if (Math.round(nw) === spot.w) return;
    libraryStore.updateBookmark(mark.id, boardResized(mark, spot, Math.round(nw)));
  }, [mark, spot]);
  const resizeBy = (d: number) => commitWidth(Math.max(BOARD_MIN_W, Math.min(BOARD_MAX_W, spot.w + d)));
  const resize = useMemo(() => Gesture.Pan().minDistance(1)
    .onChange((ev) => {
      const d = Math.abs(ev.changeX) >= Math.abs(ev.changeY) ? ev.changeX : ev.changeY;
      w.value = Math.max(BOARD_MIN_W, Math.min(BOARD_MAX_W, w.value + d / scale.value));
    })
    .onEnd(() => {
      scheduleOnRN(commitWidth, w.value);
    }), [commitWidth, scale, w]);

  const left = ORIGIN + spot.x - spot.w / 2;
  const top = ORIGIN + spot.y - spot.h / 2;
  const rad = (spot.rot * Math.PI) / 180;
  const style = useAnimatedStyle(() => ({
    width: w.value,
    minHeight: boardHeightAt(w.value, chars, ratio),
    zIndex: lift.value > 0.01 ? 3 : selected ? 2 : 0,
    transform: [{ translateX: dx.value }, { translateY: dy.value }, { rotate: `${spot.rot}deg` }, { scale: 1 + (LIFT - 1) * lift.value }],
  }));
  const shadow = useAnimatedStyle(() => ({ opacity: lift.value }));
  // 손잡이는 돌아간 카드의 오른쪽 아래 모서리에, 확대·축소와 상관없이 같은 크기로
  const handle = useAnimatedStyle(() => {
    const hw = w.value / 2;
    const hh = cardH.value / 2;
    const cx = left + hw + dx.value + hw * Math.cos(rad) - hh * Math.sin(rad);
    const cy = top + hh + dy.value + hw * Math.sin(rad) + hh * Math.cos(rad);
    return { left: cx - HANDLE / 2, top: cy - HANDLE / 2, opacity: 1 - lift.value, transform: [{ scale: 1 / scale.value }] };
  });
  const label = `${mark.text.trim() || '사진 갈피'}${mark.page ? `, ${mark.page}쪽` : ''}`;
  const ring = tabColors(color, mark.myBookId)[0];
  return (
    <>
      <GestureDetector gesture={gesture}>
        <Animated.View accessible accessibilityRole="button" accessibilityLabel={label} accessibilityHint="눌러서 크게 읽기, 꾹 눌러 옮기기" onLayout={(ev) => { cardH.value = ev.nativeEvent.layout.height; }} style={[{ position: 'absolute', left, top }, style]}>
          {/* 들어 올린 동안만 깊은 그림자 */}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st.liftShadow, shadow]} />
          <BoardCard mark={mark} color={color} />
          {selected ? <View pointerEvents="none" style={[st.picked, { borderColor: ring }]} /> : null}
        </Animated.View>
      </GestureDetector>
      {selected ? (
        <GestureDetector gesture={resize}>
          <Animated.View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="갈피 크기"
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(ev) => resizeBy(ev.nativeEvent.actionName === 'increment' ? 24 : -24)}
            style={[st.handle, handle]}>
            <View style={[st.handleDot, { borderColor: ring }]}>
              <MoveDiagonal2 size={14} color={colors.ink} strokeWidth={icon.stroke} />
            </View>
          </Animated.View>
        </GestureDetector>
      ) : null}
    </>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: { paddingHorizontal: space.page, zIndex: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -10 },
  title: { fontFamily: fonts.uiBold, fontSize: 19, lineHeight: 26, color: colors.ink, includeFontPadding: false },
  pager: { flex: 1, overflow: 'hidden' },
  track: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  page: { position: 'absolute', top: 0, bottom: 0 },
  dots: { position: 'absolute', left: 0, right: 0, height: buttonHeight.s, alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  bookRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6, paddingBottom: 10, paddingHorizontal: space.page },
  cover: { width: 34, alignItems: 'center' },
  view: { flex: 1, overflow: 'hidden' },
  layer: { position: 'absolute', left: 0, top: 0, width: LAYER, height: LAYER, transformOrigin: 'left top' },
  picked: { position: 'absolute', left: -3, top: -3, right: -3, bottom: -3, borderWidth: 1.5, borderRadius: 5 },
  handle: { position: 'absolute', width: HANDLE, height: HANDLE, alignItems: 'center', justifyContent: 'center', zIndex: 4 },
  handleDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  liftShadow: { borderRadius: 4, boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 24, color: 'rgba(60,50,45,0.28)' }] },
  bottom: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 2 },
});
