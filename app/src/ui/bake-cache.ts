// 구운 하늘 가림 그림(줄 아틀라스, SceneLight bakeAtlas)을 휴대폰 캐시 폴더에 담아 두고 다음 실행에 다시 쓴다(2026-11-13).
// 굽기는 줄마다 GPU를 몇 초씩 쓴다(S23: 켤 때마다 1분 가까이, 발열·배터리). 책장이 그대로면 같은 그림이 나오므로, 굽는 데 들어가는 값 전부
// (구울 면 자리·칸 수·법선·둘레·상자 목록·맞추기 값·셰이더 소스)로 열쇠를 만들어 같은 열쇠의 그림이 있으면 굽지 않는다.
// 그림은 구운 표면 그대로의 8비트 화소를 손실 없는 PNG로(다시 읽어도 화소가 같다). 시작할 때 최근 것만 읽어 UI 런타임에 올린다
import { ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import * as FS from 'expo-file-system/legacy';
import { scheduleOnUI } from 'react-native-worklets';

const DIR = FS.cacheDirectory ? `${FS.cacheDirectory}bake-v1/` : null;
// 남겨 두는 그림 수(줄 수보다 넉넉히: 책을 옮기면 그 줄은 새 열쇠가 된다). 오래된 것부터 지운다
const KEEP = 40;

// UI 런타임에 든 구운 그림(이름 → 그림, 넣은 차례 = 덜 쓴 것부터)과 줄마다 지금 쓰는 그림(pins: 줄 열쇠 → 최근 석 장).
// 그림의 주인은 이 모음 하나다: 줄은 빌려 쓰고, MEM_KEEP장이 넘으면 어느 줄도 쓰지 않는 것부터 놓아준다
type Store = { __bakes?: Record<string, SkImage>; __bakePins?: Record<string, SkImage[]> };
const MEM_KEEP = 64;

// 문자열 열쇠 → 짧은 이름(FNV-1a 두 갈래, 16진 16자)
export function bakeHash(s: string): string {
  'worklet';
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 15);
  }
  const hex = (x: number) => (x >>> 0).toString(16).padStart(8, '0');
  return hex(a) + hex(b);
}

// UI 스레드: 열쇠의 구운 그림(없으면 null). 읽으면 가장 최근 것이 된다
export function cachedBake(name: string): SkImage | null {
  'worklet';
  const m = (globalThis as Store).__bakes;
  const image = m?.[name];
  if (!m || !image) return null;
  delete m[name];
  m[name] = image;
  return image;
}

// UI 스레드: 그림을 모음에 넣는다(이번 실행에 구운 것도: 책을 제자리로 돌리면 다시 굽지 않는다)
export function putBake(name: string, image: SkImage) {
  'worklet';
  const g = globalThis as Store;
  const m = g.__bakes ?? (g.__bakes = {});
  const old = m[name];
  delete m[name];
  m[name] = image;
  const pins = g.__bakePins ?? {};
  const pinned = (img: SkImage) => {
    for (const k in pins) if (pins[k].indexOf(img) >= 0) return true;
    return false;
  };
  if (old && old !== image && !pinned(old)) old.dispose();
  const names = Object.keys(m);
  let over = names.length - MEM_KEEP;
  for (const n of names) {
    if (over <= 0) break;
    const img = m[n];
    if (img === image || pinned(img)) continue;
    delete m[n];
    img.dispose();
    over--;
  }
}

// UI 스레드: 줄(key)이 이 그림을 쓴다. 최근 석 장(지금 것·바꾸는 동안의 앞 것·그리는 중일 수 있는 것)은 놓아주지 않는다
export function pinBake(key: string, image: SkImage) {
  'worklet';
  const g = globalThis as Store;
  const pins = g.__bakePins ?? (g.__bakePins = {});
  const list = pins[key] ?? (pins[key] = []);
  const i = list.indexOf(image);
  if (i >= 0) list.splice(i, 1);
  list.push(image);
  while (list.length > 3) list.shift();
}

// UI 스레드: 줄이 사라졌다(그림은 모음에 남아 다시 쓰이거나 밀려난다)
export function unpinBakes(key: string) {
  'worklet';
  const pins = (globalThis as Store).__bakePins;
  if (pins) delete pins[key];
}

// UI 스레드: 이 이름의 그림이 아직 이 그림이고 어느 줄이 지금 쓰는 그림인지(담기 전에 확인: 밀려나 놓아준 그림이나 지나간 배치는 담지 않는다)
export function isCurrentBake(name: string, image: SkImage): boolean {
  'worklet';
  const g = globalThis as Store;
  if (g.__bakes?.[name] !== image) return false;
  const pins = g.__bakePins ?? {};
  for (const k in pins) {
    const list = pins[k];
    if (list[list.length - 1] === image) return true;
  }
  return false;
}

// 시작: 담아 둔 그림을 읽어 UI 런타임에 올린다(첫 굽기보다 먼저 끝나게 시작 화면이 기다린다). 실패하면 그냥 굽는다
export async function loadBakeCache(): Promise<void> {
  if (!DIR) return;
  try {
    await FS.makeDirectoryAsync(DIR, { intermediates: true });
    const names = (await FS.readDirectoryAsync(DIR)).filter((n) => n.endsWith('.png'));
    const infos = await Promise.all(names.map(async (n) => {
      const info = await FS.getInfoAsync(DIR + n);
      return { n, t: info.exists ? info.modificationTime ?? 0 : 0 };
    }));
    infos.sort((x, y) => y.t - x.t);
    for (const x of infos.slice(KEEP)) void FS.deleteAsync(DIR + x.n, { idempotent: true });
    await Promise.all(infos.slice(0, KEEP).map(async (x) => {
      const b64 = await FS.readAsStringAsync(DIR + x.n, { encoding: FS.EncodingType.Base64 });
      const image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(b64));
      if (image) scheduleOnUI(putBake, x.n.slice(0, -4), image);
    }));
  } catch (e) {
    console.warn('bake cache load', String((e as Error)?.message ?? e));
  }
}

// JS: 새로 구운 그림(화면 밖 표면에서 읽어 낸 CPU 그림)을 PNG로 담는다. 같은 이름이면 덮어쓴다
let disk: Promise<unknown> = Promise.resolve();
export function saveBake(name: string, image: SkImage) {
  if (!DIR) return;
  disk = disk.then(async () => {
    const b64 = image.encodeToBase64(ImageFormat.PNG, 100);
    image.dispose();
    if (b64) await FS.writeAsStringAsync(`${DIR}${name}.png`, b64, { encoding: FS.EncodingType.Base64 });
  }).catch((e) => console.warn('bake cache save', String((e as Error)?.message ?? e)));
}
