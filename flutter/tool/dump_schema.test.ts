// 지금 앱 서재 DB를 옮기기(MIGRATIONS) 끝까지 돌린 뒤의 표·열·user_version을 뽑는다(gen_shaders.sh가 jest로 돌린다).
// Flutter 쪽 lib/db/local_db.dart 표 구조가 같은지 test/schema_matches_app_test.dart가 견준다
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { createSQLiteTestDatabase } from '@/test-utils/sqlite';
import { realReadingLibrary } from '@/domain/real-sample';
import { monthPeriod, periodStats, yearPeriod, formatDuration, formatDurationPrecise, type Library } from '@/domain/library';
import * as chart from '@/features/stats/chart-data';

let mockDb = createSQLiteTestDatabase();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockDb) }));
jest.mock('expo-sqlite/kv-store', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) } }));

test('dump app db schema', async () => {
  mockDb = createSQLiteTestDatabase();
  const { db } = require('@/db/local-db') as typeof import('@/db/local-db');
  const d = await db();
  const version = ((await d.getFirstAsync('PRAGMA user_version')) as { user_version: number }).user_version;
  const tables = (await d.getAllAsync("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) as { name: string }[];
  const out: Record<string, { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[]> = {};
  for (const t of tables) out[t.name] = (await d.getAllAsync(`PRAGMA table_info(${t.name})`)) as never;
  const indexes = ((await d.getAllAsync("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name")) as { name: string; tbl_name: string }[]);
  const dir = join(__dirname, '..', 'test', 'fixtures');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'app_schema.json'), `${JSON.stringify({ note: '지금 앱 서재 DB 옮기기 끝 모양(tool/dump_schema.test.ts). 손으로 고치지 말 것', version, tables: out, indexes }, null, 1)}\n`);
  console.log(`[dump] schema v${version} tables ${tables.length}`);
});

test('dump app library rows + read', async () => {
  mockDb = createSQLiteTestDatabase();
  const { db, replaceLib, loadLib } = require('@/db/local-db') as typeof import('@/db/local-db');
  await db();
  // 실사 비교 책장의 읽기 기록(회차·세션·갈피) + 여러 선택 값을 채운 항목
  const lib: Library = realReadingLibrary(2026, 11);
  const ids = Object.keys(lib.books);
  const b0 = lib.books[ids[0]];
  lib.books[ids[0]] = { ...b0, rating: 4, note: '좋았다', ribbonColor: '#AA5533', currentPage: 120, hiddenAt: undefined };
  lib.books[ids[1]] = { ...lib.books[ids[1]], hiddenAt: '2026-11-02T03:00:00.000Z' };
  const e0 = lib.editions[b0.editionId];
  lib.editions[b0.editionId] = { ...e0, isbn13: '9788900000001', publisher: '출판사', pageCount: 312, size: { widthMm: 128, heightMm: 188 }, productId: '123', link: 'https://example.com',
    art: { baseColor: '#445566', inkColor: '#FFFFFF', accentColor: '#AA0000', motifId: 'moon', layoutVariant: 'spine_b', heightClass: 'medium', thicknessClass: 'medium', generatedAt: '2026-11-01', version: 2 } };
  const mid = Object.keys(lib.bookmarks)[0];
  if (mid) lib.bookmarks[mid] = { ...lib.bookmarks[mid], page: 33, memo: '메모', boardX: 0.25, boardY: 0.5, boardRot: -3, boardW: 0.8, savedAt: '2026-11-03T00:00:00.000Z' };
  lib.bindings['bd-x'] = { id: 'bd-x', myBookId: ids[0], spineColor: '#123456', motif: 'leaf', source: 'custom', status: 'ready', seed: 7, material: 'linen', inkColor: '#FFFFFF', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };
  await replaceLib(lib);
  const d = await db();
  const tables = ['editions', 'edition_authors', 'my_books', 'rounds', 'sessions', 'bookmarks', 'bindings'];
  const rows: Record<string, unknown[]> = {};
  for (const t of tables) rows[t] = (await d.getAllAsync(`SELECT * FROM ${t}`)) as unknown[];
  const read = await loadLib();
  const st = (p: ReturnType<typeof monthPeriod>, bookId?: string) => {
    const r = periodStats(read, p, bookId);
    return { completedBooks: r.completedBooks, completedRounds: r.completedRounds, rereads: r.rereads, readMs: r.readMs, sessions: r.sessions.map((x) => x.id), bookmarkCount: r.bookmarkCount, booksRead: r.booksRead };
  };
  const stats = [
    { name: 'month-2026-11', ...st(monthPeriod(2026, 11)) },
    { name: 'month-2026-10', ...st(monthPeriod(2026, 10)) },
    { name: 'month-2026-02', ...st(monthPeriod(2026, 2)) },
    { name: 'year-2026', ...st(yearPeriod(2026)) },
    { name: `book-${ids[2]}`, book: ids[2], ...st(yearPeriod(2026), ids[2]) },
  ];
  const durations = [0, 1, 999, 59_999, 60_000, 61_000, 3_599_000, 3_600_000, 3_661_500, 7_384_000].map((ms) => ({ ms, d: formatDuration(ms), p: formatDurationPrecise(ms) }));
  // 기록 화면 자료(features/stats/chart-data)
  const ms = periodStats(read, monthPeriod(2026, 11)).sessions;
  const ys = periodStats(read, yearPeriod(2026)).sessions;
  const charts = {
    monthBars: chart.monthBars(ms, 2026, 11), yearBars: chart.yearBars(ys, 2026), hourBars: chart.hourBars(ys), weekdayBars: chart.weekdayBars(ys),
    lengthBins: chart.lengthBins(ys), summary: chart.sessionSummary(ys), topBooks: chart.topBooks(ys, 5),
    booksByDay: Object.fromEntries([...chart.booksByDay(ms).entries()]), calendar: [chart.calendarWeeks(2026, 11), chart.calendarWeeks(2026, 2), chart.calendarWeeks(2027, 8)],
    yTicks: [0, 59_000, 120_000, 4_200_000, 36_000_000, 400_000_000].map((v) => chart.yTicks(v)), tickLabels: [5, 60, 120, 150, 180].map(chart.tickLabel),
    xLabels: [chart.xLabels(12), chart.xLabels(30), chart.xLabels(31)], dayTitles: ['2026-10-31', '2026-11-13', '2027-01-01'].map(chart.dayTitle),
    timeRanges: ys.slice(0, 8).map((x) => chart.timeRange(x.startedAt, x.endedAt)), hasPause: ys.slice(0, 8).map((x) => chart.hasPause(x)),
    hourLabels: [0, 9, 12, 21].map(chart.hourLabel),
    bookRecords: Object.keys(read.books).map((id) => ({ id, ...chart.bookRecord(read, id) })),
  };
  const dir = join(__dirname, '..', 'test', 'fixtures');
  // 보기 서재의 읽기 기록(지금 앱 real-sample realReadingLibrary): Flutter 보기 서재가 회차·독서 기록도 갖게
  {
    const q = (v: unknown) => (v === null || v === undefined ? 'null' : typeof v === 'string' ? `'${v.replace(/'/g, "\\'")}'` : String(v));
    const line = (r: Record<string, unknown>) => `  {${Object.entries(r).map(([k, v]) => `'${k}': ${q(v)}`).join(', ')}},`;
    writeFileSync(join(__dirname, '..', 'lib', 'gen', 'real_reading.g.dart'), `// 실사 비교 책장의 읽기 기록(지금 앱 domain/real-sample realReadingLibrary(2026, 11)). tool/gen_shaders.sh 가 만든다 — 손으로 고치지 말 것
library;

const realReadingRounds = <Map<String, Object?>>[
${(rows.rounds as Record<string, unknown>[]).map(line).join('\n')}
];

const realReadingSessions = <Map<String, Object?>>[
${(rows.sessions as Record<string, unknown>[]).map(line).join('\n')}
];
`);
  }
  writeFileSync(join(dir, 'chart_cases.json'), `${JSON.stringify({ note: '지금 앱 기록 화면 자료(tool/dump_schema.test.ts). 손으로 고치지 말 것', charts })}\n`);
  writeFileSync(join(dir, 'library_cases.json'), `${JSON.stringify({ note: '지금 앱 서재 저장·읽기·기간 통계(tool/dump_schema.test.ts). 손으로 고치지 말 것', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, rows, library: read, stats, durations })}\n`);
  console.log(`[dump] library ${Object.keys(read.books).length} books ${Object.keys(read.sessions).length} sessions`);
});
