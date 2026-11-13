// 지금 앱 서재 DB를 옮기기(MIGRATIONS) 끝까지 돌린 뒤의 표·열·user_version을 뽑는다(gen_shaders.sh가 jest로 돌린다).
// Flutter 쪽 lib/db/local_db.dart 표 구조가 같은지 test/schema_matches_app_test.dart가 견준다
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { createSQLiteTestDatabase } from '@/test-utils/sqlite';

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
