# 앱에 넣은 글꼴

- `Pretendard-{Regular,Medium,SemiBold}.otf` — Pretendard 1.3.9 (길형진, https://github.com/orioncactus/pretendard). SIL OFL 1.1: `Pretendard-OFL.txt`.
  화면 UI 글꼴(2026-10-26 시안과 같은 글꼴): Regular 본문·목록·입력칸, Medium 예비, SemiBold 제목·버튼·입력칸 이름. 토큰은 `src/ui/screenTheme.ts`의 `fonts.ui`·`fonts.uiMedium`·`fonts.uiBold`·`type`.
  한글 11,172자(본고딕 뼈대)·영문·숫자(Inter 모양). 숫자 폭이 서로 달라 바뀌는 시간 숫자에는 `fontVariant: ['tabular-nums']`(글꼴의 tnum)를 쓴다.
  파일은 npm `pretendard@1.3.9`의 `dist/public/static` 그대로다.

- `NanumSquareRoundB.ttf`, `NanumSquareRoundEB.ttf` — 나눔스퀘어라운드 Bold·ExtraBold (Copyright © 2017 NAVER Corporation, 디자인 산돌커뮤니케이션). SIL OFL 1.1(https://hangeul.naver.com/fonts).
  웹폰트 배포본(https://github.com/innks/NanumSquareRound)의 TTF. 홈 머리글(연도·완료 단추, `theme.ts`의 `round`·`roundTitle`)에만 남아 있다(‘나의 책장’ 글자는 시안 글자 그림 `ReferenceUI`).

- `NotoSerifKR-{Regular,Medium,SemiBold}.otf` — Noto Serif CJK KR 400·500·600. 갈피 문장(갈피 카드·갈피 작성 입력창) 같은 내용 글꼴(명조)로 쓴다. 화면 UI에는 쓰지 않는다.
  출처: https://github.com/notofonts/noto-cjk/tree/main/Serif/SubsetOTF/KR (2026-10-03 내려받음).
  SIL OFL 1.1: `NotoSerifKR-OFL.txt`.

- `Hahmlet-SemiBold.ttf` — 함렛 SemiBold(Copyright 2020 The Hahmlet Project Authors, https://github.com/hyper-type/hahmlet). SIL OFL 1.1: `Hahmlet-OFL.txt`. 책 그림(표지·책등) 제목 글꼴(2026-10-31 사용자 선택, `src/ui/book3d/art.tsx`).
  파일은 npm `@expo-google-fonts/hahmlet@0.4.1`의 `600SemiBold/Hahmlet_600SemiBold.ttf` 그대로다(라이선스 전문은 google/fonts ofl/hahmlet/OFL.txt).
