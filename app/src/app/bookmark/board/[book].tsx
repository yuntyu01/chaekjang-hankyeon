// 갈피 보드(2026-11-02 사용자 시안): 책 한 권의 갈피를 화면보다 넓은 보드에 흩어 붙인다. 확대는 읽기, 축소는 배치 확인.
// 빈 곳을 끌면 보드 이동, 두 손가락으로 확대·축소, 갈피를 길게 누른 뒤 끌면 옮겨 붙이기, 한 번 누르면 크게 읽기. '전체 보기'는 모든 갈피가 보이게, '+ 갈피'는 보던 곳의 빈 자리에.
// 새 갈피는 자동으로 놓이고(domain/bookmark-board) 옮긴 자리는 갈피 기록에 저장돼 다른 기기로 간다. 마지막 위치·배율은 기기마다 기억한다.
// 가로로 끌면 옆 책의 보드로 넘어간다(2026-11-05 사용자 '점 추가해서 옆으로 넘기면 옆에 책'). 보드가 화면보다 넓으면 보드 끝까지 움직인 뒤 넘어간다. 두 손가락은 언제나 보드만 움직인다.
import { router, useLocalSearchParams } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { boardBookIds, boardBounds, boardCardSize, boardClamp, boardFit, boardFreeSpot, boardPageSlide, boardSpots, boardViewKey, BOARD_MAX_SCALE, BOARD_MIN_SCALE, type BoardSpot, type BoardView } from '@/domain/bookmark-board';
import { tabColors } from '@/domain/color';
import { bookmarksOf, memoShelfBook, type Bookmark, type Library } from '@/domain/library';
import { realBoardSeed } from '@/domain/real-sample';
import { BoardCard } from '@/features/bookmark/BoardCard';
import { PageDots } from '@/features/bookmark/PageDots';
import { libraryStore, useLibrary } from '@/store/library-store';
import { LinkedCover } from '@/ui/BookVisual';
import { ChevronLeft, Plus } from '@/ui/icons';
import { Btn, Empty, IconButton } from '@/ui/kit';
import { PERF_ENABLED } from '@/ui/perf';
import { colors, fonts, icon, buttonHeight, space, type } from '@/ui/theme';

// 카드를 얹는 층의 크기와 원점: 음수 자리까지 터치가 닿도록 넓은 층의 가운데를 보드 원점으로 쓴다
const ORIGIN = 3000;
const LAYER = ORIGIN * 2;
const REACH = ORIGIN - 400; // 옮겨 붙일 수 있는 범위
const LIFT = 1.04;

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
  const paging = useSharedValue(false);
  const pan = useMemo(() => Gesture.Pan().minDistance(6).maxPointers(2)
    .onStart((ev) => {
      paging.value = !settling.value && (edges.value.prev || edges.value.next) && ev.numberOfPointers === 1 && Math.abs(ev.translationX) > Math.abs(ev.translationY);
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
    }), [boundsSV, drag, edges, paging, s, saveView, settle, settling, vpSV, x, y]);
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
  const board = useMemo(() => Gesture.Simultaneous(pan, pinch), [pan, pinch]);
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
        <View style={st.view} collapsable={false} onLayout={(ev) => setVp({ w: ev.nativeEvent.layout.width, h: ev.nativeEvent.layout.height })}>
          {marks.length ? (
            <Animated.View style={[st.layer, layer, { opacity: shown ? 1 : 0 }]}>
              {order.map((m) => {
                const o = spotOf.get(m.id);
                return o ? <BoardItem key={m.id} mark={m} spot={o} color={color} scale={s} /> : null;
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

function BoardItem({ mark, spot, color, scale }: { mark: Bookmark; spot: BoardSpot; color?: string; scale: SharedValue<number> }) {
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const lift = useSharedValue(0);
  // 저장된 자리로 그려진 뒤에 끈 만큼을 지운다(놓는 순간 튀지 않게)
  useLayoutEffect(() => {
    dx.value = 0;
    dy.value = 0;
  }, [spot.x, spot.y, dx, dy]);
  const open = useCallback(() => router.push(`/bookmark/${mark.id}`), [mark.id]);
  const drop = useCallback((mx: number, my: number) => {
    const nx = Math.round(Math.max(-REACH, Math.min(REACH, spot.x + mx)));
    const ny = Math.round(Math.max(-REACH, Math.min(REACH, spot.y + my)));
    libraryStore.updateBookmark(mark.id, { boardX: nx, boardY: ny, boardRot: spot.rot });
  }, [mark.id, spot.rot, spot.x, spot.y]);
  const gesture = useMemo(() => {
    const tap = Gesture.Tap().maxDistance(8).onEnd((_, ok) => {
      if (ok) scheduleOnRN(open);
    });
    const move = Gesture.Pan().activateAfterLongPress(280)
      .onStart(() => {
        lift.value = withTiming(1, { duration: 120 });
      })
      .onChange((ev) => {
        dx.value += ev.changeX / scale.value;
        dy.value += ev.changeY / scale.value;
      })
      .onEnd(() => {
        scheduleOnRN(drop, dx.value, dy.value);
      })
      .onFinalize(() => {
        lift.value = withTiming(0, { duration: 180 });
      });
    return Gesture.Exclusive(move, tap);
  }, [drop, dx, dy, lift, open, scale]);
  const style = useAnimatedStyle(() => ({
    zIndex: lift.value > 0.01 ? 1 : 0,
    transform: [{ translateX: dx.value }, { translateY: dy.value }, { rotate: `${spot.rot}deg` }, { scale: 1 + (LIFT - 1) * lift.value }],
  }));
  const shadow = useAnimatedStyle(() => ({ opacity: lift.value }));
  const label = `${mark.text.trim() || '사진 갈피'}${mark.page ? `, ${mark.page}쪽` : ''}`;
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View accessible accessibilityRole="button" accessibilityLabel={label} accessibilityHint="눌러서 크게 읽기, 길게 눌러 옮기기" style={[{ position: 'absolute', left: ORIGIN + spot.x - spot.w / 2, top: ORIGIN + spot.y - spot.h / 2 }, style]}>
        {/* 들어 올린 동안만 깊은 그림자 */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st.liftShadow, shadow]} />
        <BoardCard mark={mark} color={color} minHeight={spot.h} />
      </Animated.View>
    </GestureDetector>
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
  liftShadow: { borderRadius: 4, boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 24, color: 'rgba(60,50,45,0.28)' }] },
  bottom: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 2 },
});
