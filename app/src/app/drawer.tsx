// 예전 '서랍' 주소: 2026-10-31부터 책장에 없는 책은 전체 책의 '책장에 없는 책'에서 본다(딥링크·예전 버튼이 그대로 열리게)
import { Redirect } from 'expo-router';

export default function Drawer() {
  return <Redirect href={{ pathname: '/books', params: { filter: 'off' } }} />;
}
