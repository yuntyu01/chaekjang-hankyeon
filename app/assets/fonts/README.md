# 앱에 넣은 글꼴

- `GmarketSans-{Medium,Bold}.ttf` — G마켓 산스(Copyright © 2019 eBay Korea Co., Ltd., https://corp.gmarket.com/fonts/). SIL OFL 1.1: `GmarketSans-OFL.txt`(글꼴 파일 안 라이선스 그대로).
  2026-11-11부터 화면 UI 글꼴(사용자 시안 CSS `--font-sans: "Gmarket Sans", ...`). 굵기는 Light·Medium·Bold 셋뿐이라 CSS 굵기 맞춤 규칙대로 보통(400)·중간(500)은 Medium, 600·700은 Bold로 쓴다(Light는 넣지 않았다).
  숫자 폭이 서로 다르고 tnum이 없어, 1초마다 바뀌는 시간 숫자는 `ui/FixedDigits`가 글자마다 같은 폭 칸에 둔다.
  파일은 공식 배포본 `GmarketSansTTF.zip`의 `GmarketSansTTF{Medium,Bold}.ttf` 그대로다(이름만 바꿈).

- `Pretendard-{Regular,Medium,SemiBold,Bold}.otf` — Pretendard 1.3.9 (길형진, https://github.com/orioncactus/pretendard). SIL OFL 1.1: `Pretendard-OFL.txt`.
  화면 UI 글꼴(2026-10-26 시안과 같은 글꼴): Regular 본문·목록·입력칸, Medium 예비, SemiBold 제목·버튼·입력칸 이름. 토큰은 `src/ui/screenTheme.ts`의 `fonts.ui`·`fonts.uiMedium`·`fonts.uiBold`·`type`.
  한글 11,172자(본고딕 뼈대)·영문·숫자(Inter 모양). 숫자 폭이 서로 달라 바뀌는 시간 숫자에는 `fontVariant: ['tabular-nums']`(글꼴의 tnum)를 쓴다.
  Bold는 2026-11-01 추가: 일반 화면의 큰 제목(토스식 위계, `fonts.uiTitle`)에만 쓴다.
  파일은 npm `pretendard@1.3.9`의 `dist/public/static` 그대로다(Bold는 jsDelivr 같은 경로에서 받음, 같은 경로의 SemiBold가 저장소 파일과 md5 같음).

- `NanumSquareRoundB.ttf`, `NanumSquareRoundEB.ttf` — 나눔스퀘어라운드 Bold·ExtraBold (Copyright © 2017 NAVER Corporation, 디자인 산돌커뮤니케이션). SIL OFL 1.1(https://hangeul.naver.com/fonts).
  웹폰트 배포본(https://github.com/innks/NanumSquareRound)의 TTF. 2026-10-31부터 앱에서 쓰지 않는다(홈 머리글 '나의 책장'·연도가 Pretendard로 바뀜). 등록도 뺐고 파일만 남겨 둔다.

- `NotoSerifKR-{Regular,Medium,SemiBold}.otf` — Noto Serif CJK KR 400·500·600. 갈피 문장(갈피 카드·갈피 작성 입력창) 같은 내용 글꼴(명조)로 쓴다. 화면 UI에는 쓰지 않는다.
  출처: https://github.com/notofonts/noto-cjk/tree/main/Serif/SubsetOTF/KR (2026-10-03 내려받음).
  SIL OFL 1.1: `NotoSerifKR-OFL.txt`.

- `Hahmlet-SemiBold.ttf` — 함렛 SemiBold(Copyright 2020 The Hahmlet Project Authors, https://github.com/hyper-type/hahmlet). SIL OFL 1.1: `Hahmlet-OFL.txt`. 책 그림(표지·책등) 제목 글꼴(`src/ui/book3d/art.tsx`).
  2026-10-31 사용자가 함렛을 골랐다. 같은 날 책장 시안 지시로 Medium으로 낮췄다가, 사용자가 '제목 글자도'(더 또렷하게) 해서 SemiBold로 되돌렸다(Medium 파일은 지웠다).
  파일은 npm `@expo-google-fonts/hahmlet@0.4.1`의 `600SemiBold/Hahmlet_600SemiBold.ttf` 그대로다(라이선스 전문은 google/fonts ofl/hahmlet/OFL.txt).

- `MaruBuri-{Regular,SemiBold}.ttf` — 마루부리(© NAVER Corp. © NAVER Cultural Foundation Corp., https://hangeul.naver.com/fonts). SIL OFL 1.1: `MaruBuri-OFL.txt`.
  책 공유 카드의 제목(SemiBold)·한 줄 감상(Regular) 글꼴(2026-11-10 사용자 시안에 맞춤: 함렛·고운바탕보다 붓 끝 모양과 잉크 양이 시안과 가장 가깝다). `src/features/book/useShareScene.ts`에서 Skia 글꼴로만 등록한다.
  파일은 네이버 한글 웹폰트 배포 주소(hangeul.pstatic.net/hangeul_static/webfont/MaruBuri/) 그대로다.

