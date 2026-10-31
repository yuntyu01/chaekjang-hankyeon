// 커뮤니티 쓰기(게시·좋아요·댓글·팔로우·평가)가 막혔을 때 다음 행동으로 안내한다.
// 공개 활동은 소셜 계정 연결 + 공개 닉네임이 있어야 한다(서버가 판단, 앱은 안내만).
import { router } from 'expo-router';
import { Alert } from 'react-native';

import { errorMessage, needsProfile, needsSocial } from '@/services/community';

export function explainWriteError(e: unknown, fallbackTitle = '처리하지 못했어요') {
  if (needsSocial(e))
    Alert.alert('계정을 먼저 연결해 주세요', '공개 활동은 Google이나 카카오 계정을 연결한 뒤 할 수 있어요. 이 기기의 개인 기록은 공개되지 않아요.', [
      { text: '나중에', style: 'cancel' },
      { text: '계정 연결', onPress: () => router.push('/backup') },
    ]);
  else if (needsProfile(e))
    Alert.alert('공개 닉네임을 정해 주세요', '게시물·후기·댓글에는 계정 이름 대신 공개 닉네임이 보여요.', [
      { text: '나중에', style: 'cancel' },
      { text: '닉네임 정하기', onPress: () => router.push('/community/profile') },
    ]);
  else Alert.alert(fallbackTitle, errorMessage(e));
}

// 신고 사유(짧게 고르기). 운영자가 /admin/reports에서 확인한다
export const REPORT_REASONS = ['스팸·광고', '욕설·혐오', '개인정보 노출', '저작권 침해', '기타'] as const;
