// 갈피 보드(2026-11-02 사용자 시안): 책 한 권의 갈피를 화면보다 넓은 보드에 흩어 붙인다. 확대는 읽기, 축소는 배치 확인.
// 빈 곳을 끌면 보드 이동, 두 손가락으로 확대·축소, 갈피를 길게 누른 뒤 끌면 옮겨 붙이기, 한 번 누르면 크게 읽기. '전체 보기'는 모든 갈피가 보이게, '+ 갈피'는 보던 곳의 빈 자리에.
// 새 갈피는 자동으로 놓이고(domain/bookmark-board) 옮긴 자리는 갈피 기록에 저장돼 다른 기기로 간다. 마지막 위치·배율은 기기마다 기억한다.
import { router, useLocalSearchParams } from 'expo-router';
import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { boardBounds, boardCardSize, boardClamp, boardFit, boardFreeSpot, boardSpots, boardViewKey, BOARD_MAX_SCALE, BOARD_MIN_SCALE, type BoardSpot, type BoardView } from '@/domain/bookmark-board';
import { bookmarksOf, type Bookmark } from '@/domain/library';
import { realBoardSeed } from '@/domain/real-sample';
import { BoardCard } from '@/features/bookmark/BoardCard';
import { libraryStore, useLibrary } from '@/store/library-store';
import { LinkedCover } from '@/ui/BookVisual';
import { ChevronLeft, Plus } from '@/ui/icons';
import { Btn, Empty, IconButton } from '@/ui/kit';
import { PaperSurface } from '@/ui/PaperSurface';
import { PERF_ENABLED } from '@/ui/perf';
import { colors, fonts, icon, tidySpace as space, tidyType as type } from '@/ui/screenTheme';

// 카드를 얹는 층의 크기와 원점: 음수 자리까지 터치가 닿도록 넓은 층의 가운데를 보드 원점으로 쓴다
const ORIGIN = 3000;
const LAYER = ORIGIN * 2;
const REACH = ORIGIN - 400; // 옮겨 붙일 수 있는 범위
const LIFT = 1.04;

export default function BookmarkBoard() {
  const { book: id, demo } = useLocalSearchParams<{ book: string; demo?: string }>();
  const { lib } = useLibrary();
  const insets = useSafeAreaInsets();
  // 측정 번들: ?demo=1 은 시험 서재에 실제 책 갈피를 넣는다(보드 사진·옮기기 저장 확인용)
  const seeded = useRef(false);
  useEffect(() => {
    if (!PERF_ENABLED || demo !== '1' || seeded.current) return;
    seeded.current = true;
    const target = realBoardSeed(libraryStore, id);
    if (target !== id) router.replace(`/bookmark/board/${target}?demo=1`);
  }, [demo, id]);
  const b = lib.books[id];
  const e = b && lib.editions[b.editionId];
  const marks = useMemo(() => (b ? bookmarksOf(lib, id) : []), [lib, id, b]);
  const spots = useMemo(() => boardSpots(marks), [marks]);
  const bounds = useMemo(() => boardBounds(spots), [spots]);
  const color = (b?.bindingId && lib.bindings[b.bindingId]?.spineColor) || '#8A8378';

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
      place(v ?? boardFit(spots, vp.w, vp.h), false);
      setShown(true);
    });
  }, [vp, spots, id, bounds, place]);
  const saveView = useCallback((vx: number, vy: number, vs: number) => {
    void Storage.setItem(boardViewKey(id), JSON.stringify({ x: vx, y: vy, s: vs }));
  }, [id]);

  const pinchStart = useSharedValue(1);
  const pan = useMemo(() => Gesture.Pan().minDistance(6).maxPointers(2)
    .onChange((ev) => {
      const v = boardClamp({ x: x.value + ev.changeX, y: y.value + ev.changeY, s: s.value }, boundsSV.value, vpSV.value.w, vpSV.value.h);
      x.value = v.x;
      y.value = v.y;
    })
    .onEnd(() => {
      scheduleOnRN(saveView, x.value, y.value, s.value);
    }), [boundsSV, s, saveView, vpSV, x, y]);
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
    const v = boardFit(spots, vp.w, vp.h);
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

  if (!b || !e) {
    return (
      <View style={[st.root, { paddingTop: insets.top }]}>
        <IconButton label="뒤로" onPress={() => router.back()}><ChevronLeft size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></IconButton>
        <Empty title="책을 찾지 못했어요" />
      </View>
    );
  }
  return (
    <View style={st.root}>
      <PaperSurface color="#F8F6F2" radius={0} shaded={false} />
      <View style={[st.head, { paddingTop: insets.top + 4 }]}>
        <View style={st.titleRow}>
          <IconButton label="뒤로" onPress={() => router.back()}><ChevronLeft size={icon.size} color={colors.ink} strokeWidth={icon.stroke} /></IconButton>
          <Text style={st.title} accessibilityRole="header">갈피 보드</Text>
        </View>
        <View style={st.bookRow}>
          <View style={st.cover} pointerEvents="none"><LinkedCover lib={lib} id={id} width={34} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={type.rowStrong} numberOfLines={1}>{e.title}</Text>
            <Text style={type.sub} numberOfLines={1}>{[e.authors[0], `갈피 ${marks.length}개`].filter(Boolean).join(' · ')}</Text>
          </View>
          <Btn label="목록 보기" kind="secondary" size="s" onPress={() => router.push({ pathname: '/bookmarks', params: { book: id } })} />
        </View>
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
    </View>
  );
}

function BoardItem({ mark, spot, color, scale }: { mark: Bookmark; spot: BoardSpot; color: string; scale: SharedValue<number> }) {
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
  bookRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6, paddingBottom: 10 },
  cover: { width: 34, alignItems: 'center' },
  view: { flex: 1, overflow: 'hidden' },
  layer: { position: 'absolute', left: 0, top: 0, width: LAYER, height: LAYER, transformOrigin: 'left top' },
  liftShadow: { borderRadius: 4, boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 24, color: 'rgba(60,50,45,0.28)' }] },
  bottom: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 2 },
});
