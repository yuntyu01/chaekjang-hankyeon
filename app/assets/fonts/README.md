# 앱에 넣은 글꼴

- `NanumSquareRoundR.ttf`, `NanumSquareRoundB.ttf`, `NanumSquareRoundEB.ttf` — 나눔스퀘어라운드 Regular·Bold·ExtraBold (Copyright © 2017 NAVER Corporation, 디자인 산돌커뮤니케이션).
  나눔 글꼴은 SIL Open Font License 1.1로 배포된다(https://hangeul.naver.com/fonts).
  파일은 웹폰트 배포본(https://github.com/innks/NanumSquareRound)의 TTF 그대로다(한글 11,172자·영문·숫자·KS 약물, 숫자 폭은 모두 같다).
  화면 UI 글꼴: R은 본문·목록·입력창, B는 제목·버튼(토큰은 `src/ui/screenTheme.ts`의 `fonts.ui`·`fonts.uiBold`·`type`). EB는 `theme.ts`의 `roundTitle`로 등록돼 있다(홈 머리글 ‘나의 책장’은 시안 글자 그림 `ReferenceUI`로 그린다).
  R은 2026-10-26 디자인 통일 때 같은 배포본에서 더했다.

- `NotoSerifKR-{Regular,Medium,SemiBold}.otf` — Noto Serif CJK KR 400·500·600. 갈피 문장(갈피 카드·갈피 작성 입력창) 같은 내용 글꼴(명조)로 쓴다. 화면 UI에는 쓰지 않는다.
  출처: https://github.com/notofonts/noto-cjk/tree/main/Serif/SubsetOTF/KR (2026-10-03 내려받음).
  SIL OFL 1.1: `NotoSerifKR-OFL.txt`.
