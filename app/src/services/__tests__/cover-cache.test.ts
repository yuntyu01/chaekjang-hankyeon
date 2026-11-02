// 책장 표지 받아 두기: 책은 네트워크를 기다리지 않고, 못 받아도 멈추지 않으며, 받은 그림은 인터넷 없이도 다시 쓴다
const mockFiles = new Map<string, number>();
const mockDownload = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async (p: string) => (mockFiles.has(p) ? { exists: true, size: mockFiles.get(p) } : { exists: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  downloadAsync: (uri: string, to: string) => mockDownload(uri, to),
  moveAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
    mockFiles.set(to, mockFiles.get(from) ?? 1);
    mockFiles.delete(from);
  }),
  deleteAsync: jest.fn(async (p: string) => void mockFiles.delete(p)),
}));
import { AppState } from 'react-native';

import { COVER_DIR, COVER_RETRY_MS, coverFileName, isRemoteImage, watchCover, withTimeout, type CoverState } from '../cover-cache';

const URL = 'https://image.yes24.com/goods/1/L';
const FILE = `${COVER_DIR}${coverFileName(URL)}`;
const decode = async (file: string) => (mockFiles.get(file) === 0 ? null : `image:${file}`);
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const start = (uri: string | null, dec: (f: string) => Promise<string | null> = decode) => {
  const seen: CoverState<string>[] = [];
  const stop = watchCover<string>(uri, dec, (s) => seen.push(s));
  return { seen, stop, last: () => seen[seen.length - 1] };
};
const ok = (uri: string, to: string) => {
  mockFiles.set(to, 100);
  return Promise.resolve({ status: 200, uri: to });
};

const appListeners: ((s: string) => void)[] = [];
beforeEach(() => {
  mockFiles.clear();
  mockDownload.mockReset();
  jest.useFakeTimers();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (s: string) => void) => {
    appListeners.push(fn);
    return { remove: () => appListeners.splice(appListeners.indexOf(fn), 1) };
  }) as never);
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('받아 둔 그림은 인터넷 없이 바로 쓴다', async () => {
  mockFiles.set(FILE, 100);
  const { last, stop } = start(URL);
  await flush();
  expect(last()).toEqual({ image: `image:${FILE}`, pending: false });
  expect(mockDownload).not.toHaveBeenCalled();
  stop();
});

it('없는 그림은 받기 전에 책부터 그리게 하고, 받으면 바꾼다', async () => {
  let finish!: (v: unknown) => void;
  mockDownload.mockImplementation((_: string, to: string) => new Promise((r) => (finish = () => { mockFiles.set(to, 100); r({ status: 200 }); })));
  const { seen, last, stop } = start(URL);
  await flush();
  expect(last()).toEqual({ image: null, pending: false }); // 네트워크가 끝나기 전
  finish(undefined);
  await flush();
  expect(last()).toEqual({ image: `image:${FILE}`, pending: false });
  expect(seen).toHaveLength(2);
  expect(mockFiles.has(FILE)).toBe(true);
  stop();
});

it('연결이 안 되면 멈추지 않고, 조금 뒤 다시 받아 복구한다', async () => {
  mockDownload.mockRejectedValueOnce(new Error('Unable to resolve host'));
  const { last, stop } = start(URL);
  await flush();
  expect(last()).toEqual({ image: null, pending: false });
  mockDownload.mockImplementation(ok);
  jest.advanceTimersByTime(COVER_RETRY_MS);
  await flush();
  expect(last().image).toBe(`image:${FILE}`);
  stop();
});

it('앱으로 돌아오면 바로 다시 받는다', async () => {
  mockDownload.mockRejectedValueOnce(new Error('offline'));
  const { last, stop } = start(URL);
  await flush();
  mockDownload.mockImplementation(ok);
  appListeners[appListeners.length - 1]('active');
  await flush();
  expect(last().image).toBe(`image:${FILE}`);
  stop();
});

it('응답이 없으면 시간 제한으로 끝내고 다시 받는다', async () => {
  mockDownload.mockImplementationOnce(() => new Promise(() => undefined));
  const { last, stop } = start(URL);
  await flush();
  expect(last()).toEqual({ image: null, pending: false });
  mockDownload.mockImplementation(ok);
  await jest.advanceTimersByTimeAsync(20000 + COVER_RETRY_MS + 10);
  expect(last().image).toBe(`image:${FILE}`);
  stop();
});

it('없는 그림(404)은 이번 실행에서 다시 받지 않고, 조각 파일을 남기지 않는다', async () => {
  mockDownload.mockImplementation((_: string, to: string) => {
    mockFiles.set(to, 10);
    return Promise.resolve({ status: 404 });
  });
  const { last, stop } = start(URL);
  await flush();
  jest.advanceTimersByTime(COVER_RETRY_MS * 3);
  await flush();
  expect(mockDownload).toHaveBeenCalledTimes(1);
  expect(last()).toEqual({ image: null, pending: false });
  expect([...mockFiles.keys()]).toEqual([]);
  stop();
});

it('망가진 파일은 지우고 다시 받는다', async () => {
  mockFiles.set(FILE, 100);
  let reads = 0;
  const dec = async (f: string): Promise<string | null> => (++reads === 1 ? null : `image:${f}`);
  mockDownload.mockImplementation(ok);
  const { last, stop } = start(URL, dec);
  await flush();
  expect(mockDownload).toHaveBeenCalledTimes(1);
  expect(last().image).toBe(`image:${FILE}`);
  stop();
});

it('그만 보면 다시 받지 않는다', async () => {
  mockDownload.mockRejectedValue(new Error('offline'));
  const { stop } = start(URL);
  await flush();
  stop();
  jest.advanceTimersByTime(COVER_RETRY_MS * 2);
  await flush();
  expect(mockDownload).toHaveBeenCalledTimes(1);
});

it('여러 책이 같은 그림을 원해도 한 번만 받는다', async () => {
  mockDownload.mockImplementation(ok);
  const a = start(URL);
  const b = start(URL);
  await flush();
  expect(mockDownload).toHaveBeenCalledTimes(1);
  expect(a.last().image).toBe(b.last().image);
  a.stop();
  b.stop();
});

it('기기 안 사진: 파일이 없으면 기다리지 않고 장정으로', async () => {
  const gone = start('file:///photos/none.jpg');
  await flush();
  expect(gone.last()).toEqual({ image: null, pending: false });
  mockFiles.set('file:///photos/a.jpg', 100);
  const here = start('file:///photos/a.jpg');
  await flush();
  expect(here.last().image).toBe('image:file:///photos/a.jpg');
  expect(mockDownload).not.toHaveBeenCalled();
});

it('주소가 없으면 바로 끝난다', () => {
  const { seen } = start(null);
  expect(seen).toEqual([{ image: null, pending: false }]);
});

it('끝나지 않는 일도 시간 제한으로 null', async () => {
  const p = withTimeout(new Promise<string>(() => undefined), 100);
  jest.advanceTimersByTime(100);
  await expect(p).resolves.toBeNull();
  await expect(withTimeout(Promise.reject(new Error('x')), 100)).resolves.toBeNull();
});

it('주소 구분과 파일 이름', () => {
  expect(isRemoteImage(URL)).toBe(true);
  expect(isRemoteImage('file:///a.jpg')).toBe(false);
  expect(coverFileName(URL)).toBe(coverFileName(URL));
  expect(coverFileName(URL)).not.toBe(coverFileName(`${URL}x`));
});
