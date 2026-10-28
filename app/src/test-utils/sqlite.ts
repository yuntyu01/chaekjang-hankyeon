// Jest에서만 사용하는 실제 SQLite 어댑터. 앱의 expo-sqlite 비동기 인터페이스를 제공한다.
export function createSQLiteTestDatabase() {
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const native = new DatabaseSync(':memory:');
  const adapter: {
    execAsync(sql: string): Promise<void>;
    runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
    getFirstAsync(sql: string, ...params: unknown[]): Promise<unknown>;
    getAllAsync(sql: string, ...params: unknown[]): Promise<unknown>;
    withTransactionAsync(fn: () => Promise<void>): Promise<void>;
    withExclusiveTransactionAsync(fn: (tx: typeof adapter) => Promise<void>): Promise<void>;
    close(): void;
  } = {
    async execAsync(sql: string) { native.exec(sql); },
    async runAsync(sql: string, ...params: unknown[]) { return native.prepare(sql).run(...params); },
    async getFirstAsync(sql: string, ...params: unknown[]) { return native.prepare(sql).get(...params) ?? null; },
    async getAllAsync(sql: string, ...params: unknown[]) { return native.prepare(sql).all(...params); },
    async withTransactionAsync(fn: () => Promise<void>) {
      native.exec('BEGIN');
      try { await fn(); native.exec('COMMIT'); } catch (error) { native.exec('ROLLBACK'); throw error; }
    },
    async withExclusiveTransactionAsync(fn: (tx: typeof adapter) => Promise<void>) {
      native.exec('BEGIN');
      try { await fn(adapter); native.exec('COMMIT'); } catch (error) { native.exec('ROLLBACK'); throw error; }
    },
    close() { native.close(); },
  };
  return adapter;
}
