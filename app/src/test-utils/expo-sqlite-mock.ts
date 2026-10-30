// 시험용 expo-sqlite: local-db가 쓰는 비동기 API만 better-sqlite3(메모리 DB)로 흉내 낸다.
// 쓰는 법: jest.mock('expo-sqlite', () => require('@/test-utils/expo-sqlite-mock').expoSqlite());
// DB는 globalThis에 하나(모듈 레지스트리가 나뉘어도 같은 DB). resetSqlite()로 새로 만든다.
import Database from 'better-sqlite3';

type G = { __sqliteMock?: Database.Database };
const g = globalThis as G;

export function sqliteDb() {
  g.__sqliteMock ??= new Database(':memory:');
  return g.__sqliteMock;
}
export function resetSqlite() {
  g.__sqliteMock?.close();
  g.__sqliteMock = new Database(':memory:');
  return g.__sqliteMock;
}

const norm = (args: unknown[]) => (args.length === 1 && Array.isArray(args[0]) ? args[0] : args);

export function expoSqlite() {
  return {
    openDatabaseAsync: async () => ({
      execAsync: async (sql: string) => void sqliteDb().exec(sql),
      getFirstAsync: async (sql: string, ...args: unknown[]) => sqliteDb().prepare(sql).get(...norm(args)) ?? null,
      getAllAsync: async (sql: string, ...args: unknown[]) => sqliteDb().prepare(sql).all(...norm(args)),
      runAsync: async (sql: string, ...args: unknown[]) => sqliteDb().prepare(sql).run(...norm(args)),
      prepareAsync: async (sql: string) => {
        const st = sqliteDb().prepare(sql);
        return { executeAsync: async (args: unknown[]) => void st.run(...args), finalizeAsync: async () => {} };
      },
      withTransactionAsync: async (fn: () => Promise<void>) => {
        const d = sqliteDb();
        d.exec('BEGIN');
        try {
          await fn();
          d.exec('COMMIT');
        } catch (e) {
          d.exec('ROLLBACK');
          throw e;
        }
      },
    }),
  };
}
