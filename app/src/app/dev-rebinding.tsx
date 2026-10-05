// 개발용: 재장정 30권(썸네일 색이 형광·흰색·검정·회색이어도 선반 톤이 유지되는지)을 책등·정면으로 확인한다. 배포 번들에서는 비어 있다.
import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { bindingFields } from '@/domain/library';
import { buildBookArt, extractPalette, type RebindInput } from '@/domain/rebinding';
import type { Book } from '@/domain/types';
import { previewBook } from '@/features/book/BindingEditor';
import { StandaloneBook } from '@/ui/book3d/StandaloneBook';

const px = (hex: string) => { const v = parseInt(hex.slice(1), 16); return Array.from({ length: 64 }, () => [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255]).flat(); };
const T = (title: string, authors: string, category: string, pages: number, h: number, thumb: string, extra: Partial<RebindInput> = {}): RebindInput => ({ title, authors: [authors], category, pageCount: pages, heightMm: h, widthMm: Math.round(h * 0.68), isbn: `97889${title.length}${pages}`, palette: extractPalette(px(thumb)), ...extra });

export const SAMPLE_30: RebindInput[] = [
  T('데미안', '헤르만 헤세', '813.6', 232, 188, '#2E4F8A'), T('채식주의자', '한강', '813.7', 188, 205, '#E8E4D8'), T('아무튼, 독서', '김초엽', '814.7', 140, 170, '#FFFF00'),
  T('소년이 온다', '한강', '813.7', 216, 205, '#111111'), T('코스모스', '칼 세이건', '440', 640, 235, '#2A2F55'), T('사피엔스', '유발 하라리', '909', 636, 235, '#C4511D'),
  T('월든', '헨리 데이비드 소로', '844', 420, 188, '#6B8F5A'), T('어린 왕자', '생텍쥐페리', '863', 120, 170, '#80B8E0'), T('나의 문화유산답사기', '유홍준', '981', 360, 225, '#808080'),
  T('시선', '이병률', '811.7', 96, 190, '#FF1493'), T('총, 균, 쇠', '재레드 다이아몬드', '909', 688, 235, '#B08A55'), T('정의란 무엇인가', '마이클 샌델', '340', 420, 223, '#FFFFFF'),
  T('클린 코드', '로버트 마틴', '005', 584, 235, '#0033CC'), T('미움받을 용기', '기시미 이치로', '181', 332, 188, '#F4C430'), T('불편한 편의점', '김호연', '813.7', 268, 188, '#9BC53D'),
  T('작별하지 않는다', '한강', '813.7', 332, 205, '#CFCFCF'), T('여행의 이유', '김영하', '814.7', 188, 188, '#66CCCC'), T('이기적 유전자', '리처드 도킨스', '472', 584, 223, '#8B3A3A'),
  T('해리 포터 1', 'J.K. 롤링', '843', 424, 205, '#AA2200', { seriesTitle: '해리 포터' }), T('해리 포터 2', 'J.K. 롤링', '843', 480, 205, '#22AA55', { seriesTitle: '해리 포터' }),
  T('해리 포터 3', 'J.K. 롤링', '843', 560, 205, '#FFEE00', { seriesTitle: '해리 포터' }), T('죽은 시인의 사회', 'N.H. 클라인바움', '843', 244, 188, '#000000'),
  T('The Great Gatsby', 'F. Scott Fitzgerald', '843', 180, 188, '#2B6F77'), T('논어', '공자', '151', 380, 210, '#5B4636'), T('서양미술사', '곰브리치', '609', 688, 250, '#C9A24B'),
  T('우리가 빛의 속도로 갈 수 없다면', '김초엽', '813.7', 340, 205, '#4B6EAF'), T('나무', '베르나르 베르베르', '863', 88, 150, '#7FB069'), T('인간 실격', '다자이 오사무', '833', 168, 170, '#F5F5F0'),
  T('토지 1', '박경리', '813.6', 428, 225, '#6E4B3A'), T('멋진 신세계', '올더스 헉슬리', '843', 312, 188, '#D4A5A5'),
];

export default function DevRebinding() {
  if (!__DEV__) return null;
  const books = useMemo(() => SAMPLE_30.map((i): { book: Book; v: string } => {
    const art = buildBookArt(i, '');
    const f = bindingFields(art);
    return { book: previewBook({ title: i.title, author: i.authors?.[0], size: { widthMm: i.widthMm!, heightMm: i.heightMm! }, pages: i.pageCount, binding: { ...f, seed: 0, source: 'default' } }), v: `${art.layoutVariant} ${art.motifId}` };
  }), []);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#F4EDE2' }} contentContainerStyle={{ paddingTop: 50, paddingBottom: 80 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'center', gap: 2 }}>
        {books.map(({ book }) => <StandaloneBook key={book.id + book.title} book={book} pose="spine" scale={0.62} />)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'center', gap: 6, marginTop: 24 }}>
        {books.slice(0, 12).map(({ book, v }) => <View key={book.title} style={{ alignItems: 'center' }}><StandaloneBook book={book} pose="front" scale={0.5} /><Text style={{ fontSize: 9 }}>{v}</Text></View>)}
      </View>
    </ScrollView>
  );
}
