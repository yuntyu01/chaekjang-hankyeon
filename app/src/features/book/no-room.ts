// 책장에 자리가 없을 때 묻기: place-books가 부르고 화면은 앱에 하나 있는 NoRoomSheet가 그린다(place-books는 화면 밖 코드라 여기를 거친다).
export type NoRoomRequest = { ids: readonly string[]; onKeep: () => void; onOpen: () => void };
type Host = (req: NoRoomRequest) => void;

let host: Host | null = null;
export function setNoRoomHost(next: Host | null) {
  host = next;
}
// 그릴 곳이 없으면(앱이 뜨기 전 등) 묻지 않고 보관한다: 책을 잃지 않는 쪽
export function askNoRoom(req: NoRoomRequest) {
  if (host) host(req);
  else req.onKeep();
}
// 시트가 붙어 있는 동안만 받는다
export function askNoRoomHostReady(next: Host) {
  setNoRoomHost(next);
  return () => setNoRoomHost(null);
}
