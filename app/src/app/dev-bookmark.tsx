// 개발용: 사진 갈피 카드(상세·목록)를 시안과 나란히 확인하는 화면. 배포 번들에서는 비어 있다.
import { ScrollView, View } from 'react-native';

import { BookmarkCard, PAGE_BG } from '@/features/bookmark/BookmarkCard';
import { LANDSCAPES } from '@/domain/book-design';
import { SAMPLE_BOOKS } from '@/domain/onboarding-sample';
import { Image } from 'react-native';

const PHOTO = Image.resolveAssetSource(require('../../assets/dev/sample-page.jpg')).uri;

export default function DevBookmark() {
  if (!__DEV__) return null;
  const book = { ...SAMPLE_BOOKS[0], title: '느린 계절', themeColor: '#4B6080', cover: LANDSCAPES.night };
  const base = { title: '느린 계절', author: '한서윤', page: 128, date: '2026.10.05', color: '#6896B5', book };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: PAGE_BG }} contentContainerStyle={{ alignItems: 'center', paddingTop: 60, paddingBottom: 80 }}>
      <BookmarkCard showMemo width={390} seed="p1" data={{ ...base, text: '', memo: '서두르던 마음이 조금 느려졌다.', photoUri: PHOTO, photoRatio: 668 / 506 }} />
      <View style={{ height: 24 }} />
      <BookmarkCard showMemo={false} compact width={390} seed="p2" data={{ ...base, text: '', photoUri: PHOTO, photoRatio: 668 / 506 }} />
      <BookmarkCard showMemo={false} compact width={390} seed="p3" data={{ ...base, text: '천천히 읽은 문장은 오래 내 곁에 남았다.' }} />
    </ScrollView>
  );
}
