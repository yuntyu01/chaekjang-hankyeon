/**
 * @jest-environment node
 */
// 기기 없이 책 몸체(Skia)만 PNG로 그려 보는 QA 도구. 제목(RN Text)·선반은 그리지 않는다.
// 실행: QA_OUT=/tmp/bodies.png npx jest -c scripts/qa/render-bodies.jest.config.js
import fs from 'fs';
import path from 'path';
import React from 'react';

jest.mock('@shopify/react-native-skia', () => {
  const headless = jest.requireActual('@shopify/react-native-skia/lib/commonjs/headless');
  const R = jest.requireActual('react');
  const mod = {
    ...headless,
    Canvas: ({ children }) => R.createElement(headless.Group, null, children),
    useImage: (src) => globalThis.__img(src),
    vec: (x = 0, y) => headless.getSkiaExports().Skia.Point(x, y ?? x),
  };
  // Skia 객체는 CanvasKit을 불러온 뒤에야 생긴다
  Object.defineProperty(mod, 'Skia', { get: () => headless.getSkiaExports().Skia });
  return mod;
});

import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb';

const ROOT = path.resolve(__dirname, '../..');

test('책 몸체 렌더', async () => {
  // expo의 TextDecoder 대체품은 utf-16을 몰라 CanvasKit 로드가 실패한다 → Node 것으로 되돌린다
  globalThis.TextDecoder = jest.requireActual('util').TextDecoder;
  await LoadSkiaWeb();
  const { makeOffscreenSurface, drawOffscreen, Group, Rect, getSkiaExports } = require('@shopify/react-native-skia/lib/commonjs/headless');
  const { Skia } = getSkiaExports();
  const cache = new Map();
  globalThis.__img = (src) => {
    if (src == null) return null;
    const rel = typeof src === 'object' && src.testUri ? src.testUri : String(src);
    const file = path.isAbsolute(rel) ? rel : path.join(ROOT, rel.replace(/^(\.\.\/)+/, '')); // jest 자산 스텁의 testUri는 앱 루트 기준
    if (!cache.has(file)) cache.set(file, Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(new Uint8Array(fs.readFileSync(file)))));
    return cache.get(file);
  };
  const { SpineBody, LyingBody, CoverBody } = require('@/ui/book/BookBody');
  const { SAMPLE_BOOKS } = require('@/domain/onboarding-sample');
  const { bookHeight, bookThickness, frontWidth, FRONT_SIDE, TOP_FACE, viewOf } = require('@/domain/geometry');
  const { spineTitleLayout } = require('@/domain/title-layout');
  const { faceWidth, spineView } = require('@/ui/book/BookBody');
  const byId = Object.fromEntries(SAMPLE_BOOKS.map((b) => [b.id, b]));
  const s = 1080 / 390;
  const W = 1080;
  const rowH = 250 * s;
  const rows = [-1, 0, 1];
  const H = rows.length * rowH;
  const els = [<Rect key="bg" x={0} y={0} width={W} height={H} color="#FBF7F0" />];
  rows.forEach((vy, r) => {
    const base = (r + 1) * rowH - 20 * s;
    let x = 16;
    const put = (w, h, node, key) => {
      els.push(
        <Group key={key} transform={[{ translateX: x * s }, { translateY: base - h * s }]}>
          {node}
        </Group>,
      );
      x += w + 2;
    };
    for (const id of ['b01', 'b02', 'b03', 'b04', 'b05', 'b17']) {
      const b = byId[id];
      const hDU = bookHeight(b);
      if (id === 'b04') {
        const fw = frontWidth(b);
        const mirror = viewOf(x + fw / 2) > 0.02;
        put(fw + FRONT_SIDE, hDU, <CoverBody id={id} width={fw * s} height={hDU * s} scale={s} face={b.body?.face ?? b.themeColor} side={FRONT_SIDE * s} cover={b.cover?.image} art={b.body} mirror={mirror} edge={b.cover?.edge} />, `${r}${id}`);
        continue;
      }
      const t = bookThickness(b);
      const view = viewOf(x + t / 2);
      const { side } = spineView(view);
      const lay = spineTitleLayout(b.title, hDU, faceWidth(t, side), b.body?.motifTop ?? 0.58);
      const art = b.body ? { ...b.body, motifTop: lay.artTop } : undefined;
      put(t, hDU, <SpineBody id={id} width={t * s} height={hDU * s} scale={s} face={b.body?.face ?? b.themeColor} art={art} view={view} viewY={vy} />, `${r}${id}`);
    }
    // 누운 책 두 권
    const lower = byId.b12;
    const upper = byId.b13;
    const lh = bookThickness(lower) + TOP_FACE;
    const uh = bookThickness(upper) + TOP_FACE;
    const ll = bookHeight(lower);
    const ul = bookHeight(upper);
    const x0 = x;
    els.push(
      <Group key={`${r}l`} transform={[{ translateX: x0 * s }, { translateY: base - lh * s }]}>
        <LyingBody id="b12" width={ll * s} height={lh * s} scale={s} face={lower.body.face} art={lower.body} topFace={TOP_FACE * s} />
      </Group>,
      <Group key={`${r}u`} transform={[{ translateX: (x0 + 3) * s }, { translateY: base - (bookThickness(lower) + uh) * s }]}>
        <LyingBody id="b13" width={ul * s} height={uh * s} scale={s} face={upper.body.face} art={upper.body} topFace={TOP_FACE * s} />
      </Group>,
    );
  });
  const surface = makeOffscreenSurface(W, H);
  const img = await drawOffscreen(surface, <Group>{els}</Group>);
  const out = process.env.QA_OUT ?? '/tmp/bodies.png';
  fs.writeFileSync(out, Buffer.from(img.encodeToBytes()));
});
