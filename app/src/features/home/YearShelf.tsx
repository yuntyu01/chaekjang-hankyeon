// 지난 연도 책장 한 쪽(보기 전용): 그해 남긴 책장을 지금 책장과 같은 그림·카메라로 그린다.
// 책을 짧게 누르면 그해 기록(상태·한 줄 감상·그해까지의 최근 메모)으로 책 정보 시트를 연다. 끌기·꾸미기는 없다.
// 숨긴 책(지금 서재에서 뺀 책)은 '책 정보 보기'가 없다(지금 서재에 없는 책이라 열 화면이 없다).
import { router } from 'expo-router';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedScrollHandler, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import type { Bookcase } from '@/domain/bookcase';
import { withSharpCover } from '@/domain/cover-url';
import { sortedShelves } from '@/domain/layout-engine';
import { memosByBook } from '@/features/book/all-books';
import { STATUS_LABEL } from '@/features/book/labels';
import { shareErrorTitle, shareWindowArea, windowShareAvailable } from '@/services/share-image';
import { libraryStore, useLibrary } from '@/store/library-store';
import { appAlert } from '@/ui/alert';
import type { Shared } from '@/ui/book3d/art';
import { TAB_FADE, tabBarBlock } from '@/ui/tabBar';
import { CONTENT_TOP, computeRows, type ShelfMetrics } from '@/ui/shelf/metrics';
import { flushApply } from '@/ui/shelf/planner';
import type { CamSV } from '@/ui/shelf/ShelfMotion';
import { pickAt, type Pick, type SceneGeo } from '@/ui/shelf/scene';
import { HeaderWall, SHELF_CAST_EXTENT, ShelfScene, type SceneRowProps } from '@/ui/shelf/ShelfScene';
import { Share } from '@/ui/icons';
import { colors, navigation, press } from '@/ui/theme';

import { BookSheet } from './BookSheet';
import { HeaderVeil } from './HeaderVeil';
import { HEADER_ICON, HEADER_ICON_SLOP, headerIconStyle, YearHeader } from './YearHeader';
import { HeaderFade } from './YearPager';
import { useSceneMotions, useShelfScenes } from './useShelfSceneState';
import { realId, yearScene } from './year-shelf';

const NONE: string[] = [];
const NO_ROWS: never[] = [];
const NO_LEAVING: { id: string; from: string }[] = [];
const SLOP_DU = 3;

type Props = {
  bookcase: Bookcase;
  zoom: SharedValue<number>; // 줄이면 머리글이 사라진다(YearPager)
  m: ShelfMetrics;
  width: number;
  viewportH: number; // 쪽 높이(머리글 포함)
  cam: CamSV;
  viewPitch: number;
  shared: Shared;
  active: boolean; // 지금 보이는 쪽(시트는 이때만)
};

export function YearShelf({ bookcase, zoom, m, width, viewportH, cam, viewPitch, shared, active }: Props) {
  const insets = useSafeAreaInsets();
  const { lib } = useLibrary(); // 판본·장정·기록이 바뀌면 다시 만든다
  const scene = useMemo(() => yearScene(libraryStore.full(), bookcase), [lib, bookcase]); // eslint-disable-line react-hooks/exhaustive-deps
  const { prefix, layout } = scene;
  // 표지로 세운 책은 실제 표지를 큰 그림으로(지금 책장과 같다)
  const books = useMemo(() => {
    const out = { ...scene.books };
    for (const p of layout.placements) if (p.pose === 'front' && out[p.bookId]) out[p.bookId] = withSharpCover(out[p.bookId]);
    return out;
  }, [scene, layout]);
  const [headerH, setHeaderH] = useState(0);
  const vpH = Math.max(0, viewportH - headerH);
  const shelves = useMemo(() => sortedShelves(layout), [layout]);
  const frames = useShelfScenes(layout, books, true); // 저장된 모습 그대로(물리 다시 풀지 않음)
  const rows = useMemo(() => computeRows(layout, m.scale, vpH, navigation.shelfReserve + insets.bottom), [layout, m.scale, vpH, insets.bottom]);
  const motions = useSceneMotions(useMemo(() => shelves.map((s) => s.id), [shelves]), frames);
  const geoOf = (): SceneGeo => ({ rows: rows.map((r) => ({ shelfId: r.shelfId, baseline: r.baseline, dy: rows.length ? (r.baseline - rows[0].baseline) / m.scale : 0, space: r.space })), s: m.scale, originX: m.originX });
  const geo = useSharedValue<SceneGeo>(geoOf());
  useLayoutEffect(() => {
    geo.value = geoOf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, m]);
  // 줄이 짠 경로를 UI로(지금 책장과 같은 묶음 적용)
  useLayoutEffect(() => {
    flushApply();
  });

  const [sel, setSel] = useState<string | null>(null);
  const shownSel = active ? sel : null;
  const glowShelf = shownSel ? layout.placements.find((p) => p.bookId === shownSel)?.shelfId : undefined;
  const sceneRows: SceneRowProps[] = useMemo(
    () =>
      shelves.flatMap((sh) => {
        const row = rows.find((r) => r.shelfId === sh.id);
        if (!row) return [];
        return [{ shelfId: sh.id, row, frames: frames.get(sh.id) ?? [], dragId: null, glowId: glowShelf === sh.id ? shownSel : null, hint: null }];
      }),
    [shelves, rows, frames, glowShelf, shownSel],
  );
  const last = rows.at(-1);
  const contentH = Math.max(vpH, (last ? last.top + last.height : CONTENT_TOP) + Math.max((SHELF_CAST_EXTENT + 8) * m.scale, tabBarBlock(insets.bottom) + TAB_FADE * 0.6));

  const pickRef = useRef((p: Pick) => setSel(p ? p.bookId : null));
  const onPick = useCallback((p: Pick) => pickRef.current(p), []);
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(300)
        .maxDistance(10)
        .onEnd((e, ok) => {
          if (!ok) return;
          const g = geo.value;
          scheduleOnRN(onPick, pickAt(motions, g, cam.value, e.x, e.y, SLOP_DU * g.s));
        }),
    [motions, geo, cam, onPick],
  );
  const scroll = useMemo(() => Gesture.Native(), []);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  const a11yLabelOf = useCallback((id: string) => books[id]?.title ?? '', [books]);
  const onA11y = useCallback((id: string, action: string) => {
    if (action === 'activate') setSel(id);
  }, []);

  const id = shownSel ? realId(prefix, shownSel) : null;
  const mine = id ? scene.lib.books[id] : undefined;
  const memo = useMemo(() => (id ? memosByBook(scene.lib).get(id)?.[0]?.text : undefined), [scene, id]);
  // 지금 서재에 보이는 책이면 책 정보로 갈 수 있다(숨긴 책은 화면용 서재 lib에 없다)
  const open = id && lib.books[id] ? id : null;

  // 공유: 상태 표시줄 아래부터 탭 바 위까지 보이는 책장을 찍어 보낸다
  const { height: winH } = useWindowDimensions();
  const [shooting, setShooting] = useState(false);
  const share = async () => {
    setSel(null);
    setShooting(true);
    try {
      // 아이콘·시트가 화면에서 걷힌 뒤에 찍는다
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50))));
      const top = insets.top;
      await shareWindowArea({ x: 0, y: top, w: width, h: winH - top - tabBarBlock(insets.bottom) }, { name: `bookcase_${scene.year}`, dialogTitle: `${scene.year}년 책장`, onShot: () => setShooting(false) });
    } catch (e) {
      appAlert(shareErrorTitle(e), (e as Error).message);
    } finally {
      setShooting(false);
    }
  };

  return (
    <>
      <GestureDetector gesture={scroll}>
        <Animated.ScrollView showsVerticalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={16} onScrollBeginDrag={() => setSel(null)}>
          <View onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
            <HeaderWall rows={sceneRows} motions={motions} books={books} m={m} width={width} height={headerH} cam={cam} />
            <HeaderFade zoom={zoom}>
            {/* 머리줄: 벽에 새긴 그해 숫자 가운데(2026-11-10 사용자 '2026 같은 건 작년 책장에 파서'), 오른쪽 위는 공유 아이콘 하나(사용자 '2025는 우측 상단에 공유 아이콘만').
                지금 책장으로는 오른쪽으로 밀어 돌아간다. 공유는 보이는 책장을 그대로 찍는다(찍는 동안 아이콘은 숨긴다) */}
            <YearHeader year={scene.year} a11yLabel={`${scene.year}년 책장, ${scene.count}권, 그해 완독 ${scene.finished}권`} width={width} actionsW={windowShareAvailable ? HEADER_ICON : 0}>
              {windowShareAvailable ? (
                <Pressable onPress={share} disabled={shooting} hitSlop={HEADER_ICON_SLOP} accessibilityRole="button" accessibilityLabel={`${scene.year}년 책장 공유`} style={({ pressed }) => [headerIconStyle, pressed && press, shooting && HIDDEN]}>
                  <Share size={24} color={colors.iconSoft} />
                </Pressable>
              ) : null}
            </YearHeader>
            </HeaderFade>
          </View>
          <GestureDetector gesture={tap}>
            <View style={{ height: contentH }} collapsable={false}>
              <ShelfScene
                rows={sceneRows}
                lockedRows={NO_ROWS}
                lockedReady
                motions={motions}
                geo={geo}
                books={books}
                m={m}
                width={width}
                height={contentH}
                cam={cam}
                shared={shared}
                reduceMotion
                planBudgetMs={60}
                debug={false}
                handle={null}
                a11yLabelOf={a11yLabelOf}
                onA11y={onA11y}
                viewPitch={viewPitch}
                transitIds={NONE}
                glowId={shownSel}
                leaving={NO_LEAVING}
              />
            </View>
          </GestureDetector>
        </Animated.ScrollView>
      </GestureDetector>
      <HeaderVeil scrollY={scrollY} hidden={false} />
      {shownSel && books[shownSel] && mine ? (
        <BookSheet
          book={books[shownSel]}
          status={`${scene.year}년 · ${STATUS_LABEL[mine.status]}`}
          note={mine.note}
          memo={memo}
          readOnly
          bottomInset={insets.bottom}
          reduceMotion={false}
          onClose={() => setSel(null)}
          onDetail={open ? () => {
            setSel(null);
            router.push(`/book/${open}`);
          } : undefined}
        />
      ) : null}
    </>
  );
}

const HIDDEN = { opacity: 0 };
