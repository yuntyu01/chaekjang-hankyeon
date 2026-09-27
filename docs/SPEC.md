# 책장 한켠 - 홈 외 기능 구현 지시서 (HOME_BRIEF.md와 함께 사용)

홈 책장 화면은 HOME_BRIEF.md가 기준이고, 이 문서는 그 외 전부를 다룬다. 먼저 기존 코드와 Book/BookPlacement 타입을 확인하고, 폴더 구조·API 설계 제안과 질문 5개 이내를 보여준 뒤 승인 후 Phase 순서대로 진행한다. 각 Phase 끝에서 멈춰 보고한다.

## 1. 앱 개요
- 이름(가칭): 책장 한켠. 화면에는 "나의 책장" 유지.
- 한 줄: 읽은 책을 검색하거나 찍으면, 앱이 새로 장정해서 내 책장에 꽂아준다.
- 원칙: 커뮤니티·팔로우·추천 없음. AI는 표지 그림을 새로 그리지 않는다(저작권). 앱은 색·조판·모티프 배치만.
- 실제 표지(API 이미지)는 상세보기와 "정면 전시"로 고른 책에서만. 선반 책등은 전부 앱 재장정.

## 2. 기술 스택
- 앱: React Native(Expo), 네이티브 모듈 없음, 카메라·바코드는 expo-camera.
- 서버: Go + PostgreSQL, 파일 Cloudflare R2(완독 카드 이미지만).
- AI: Gemini 멀티모달, 키는 서버에만(앱 → Go → Gemini). 사진은 긴 변 1024px.
- 도서 데이터: 검색 카카오 책 API, 고해상도 표지·쪽수·제휴링크 알라딘 Open API. 저장·재배포 약관 확인 후 저장 가능한 필드만 캐시, 불가 필드는 URL 참조.
- i18n(ko 우선, en 자리).

## 3. 핵심 데이터
서버 공유(ISBN 기준) books: isbn13(PK), title, authors[], publisher, published_at, page_count, format, cover_url, cover_thumb_url, description, theme_color(1회 추출), height_class, thickness_class(page_count 규칙), default_motif_id, created_at. 같은 ISBN은 외부 API·색 추출 1회.

서버 개인:
- user_books: user_id, isbn13, status(reading|read|want), finished_at, note, song_title, song_url, custom_theme_color?, custom_motif_id?, cover_display(bool), created_at
- shelf_layouts: user_id, ShelfLayout JSON, version
- finish_cards: user_id, isbn13, image_url(R2), created_at

앱 로컬: 로컬 캐시(SQLite 등), 오프라인 열람, 동기화는 "마지막 수정 시각 우선".

Book 매핑: themeColor ← custom_theme_color ?? books.theme_color / height·thickness ← books / spineArtUri·coverArtUri ← 모티프 자산 슬롯(30개 내외 세트) / originalCoverUri ← books.cover_url.

## 4. 책 추가 흐름 (입력 3종 → 확인 1종)
[+] → 바텀시트: 검색(기본) / 사진 / 바코드
1. 검색: 제목·저자 → 결과(썸네일 필수, 판 구분) → 다중 체크 → "N권 담기"
2. 사진: 단권(표지/책등) 또는 책장 한 칸. 서버 인식 → 후보 ISBN. 확신도 낮으면 후보 3개 + 검색 폴백. 원본 사진 서버 미저장(명시).
3. 바코드: ISBN 스캔 → 즉시 조회.
공통 확인: 책마다 상태(읽음/읽는 중/읽고 싶음), 읽음이면 완독일(기본 오늘) → 재장정 미리보기(색·모티프 변경) → [책장에 꽂기] → LayoutEngine으로 빈 자리 배치(완독일 순), 꽂히는 애니메이션은 홈 컴포넌트 재사용. 읽는 중/읽고 싶음은 "읽는 중" 칸.

AI 인식 스키마: `{ "books": [ { "title": "", "author": "", "publisher": "", "isbn_guess": "", "confidence": 0.0 } ] }` → 서버가 카카오 검색으로 대조해 ISBN 확정 후 캐시·반환.

## 5. 화면 목록 (홈 제외)
1. 추가 시트(검색/사진/바코드) 2. 검색 결과(썸네일, 다중 선택, 판 선택) 3. 촬영(단권/책장 모드, 가이드, 셔터, 바코드 전환) 4. 인식 확인(후보, 탭해서 검색 교체, 일괄 상태) 5. 재장정 미리보기 & 꽂기 6. 책 상세(실제 표지 크게 → API 정보 → 내 기록 편집 → 재장정 변경 → 정면 전시 토글 → 완독 카드 → 알라딘 링크, 읽고 싶음일 때만 "구매") 7. 완독 카드(주조색 배경 + 세리프 제목 + 저자 + 완독일 + 노래 + 앱 마크, 정사각·세로, PNG → R2 → 공유 시트, 실제 표지 미포함) 8. 읽는 중 칸(완독 처리 → 선반 이동 + 카드 제안) 9. 기록 탭(연도 → 월별 막대 → 달력 점 → 날짜별 책) 10. 내 공간(닉네임, 통계 3개, 설정: 모티프 세트·다크 모드 "밤의 서재"·CSV 내보내기·로그아웃, 로그인 Apple/Google/카카오) 11. 온보딩(로그인 → "첫 책을 넣어볼까요?" → 추가 시트)

## 6. 디자인 규칙
배경 아이보리, 글자 먹색, 강조색 없음. 다크 모드 진한 남색 "밤의 서재". 제목 명조, 메뉴·숫자 고딕. 카드·시트 납작하게, 그림자는 책에만. 통계 카드·명언·달성률 금지. 숫자는 "16권"처럼 작게.

## 7. 서버 API (Go, 제안)
- POST /auth/{apple|google|kakao}
- GET /books/search?q= (카카오 프록시 + 캐시)
- GET /books/{isbn13} (캐시, 없으면 카카오+알라딘 후 저장)
- POST /books/recognize (multipart, Gemini, 원본 미저장)
- GET/PUT /me/books, /me/books/{isbn13}
- GET/PUT /me/layout
- POST /me/cards (R2 업로드)
- GET /me/export.csv
- JSON, 오류 형식 통일, Gemini 사용자당 일 한도(예: 30장).

## 8. 진행 순서
- Phase 0: 홈 결과 확인, Book 확장, 로컬 DB, 토큰·서체, 모티프 슬롯 30개(파일명·규격), Go 서버 뼈대 + books 캐시 + 검색 프록시
- Phase 1: 검색 추가 흐름 전체(검색 → 확인 → 미리보기 → 꽂기 → 홈 반영), 이 시점에 "쓸 수 있는" 상태
- Phase 2: 책 상세
- Phase 3: 바코드 + 사진 인식 + 인식 확인 + 일괄 추가
- Phase 4: 완독 카드 + 읽는 중 칸 + 완독 처리
- Phase 5: 기록 탭, 내 공간, 로그인, 동기화, 내보내기
- Phase 6: 다크 모드, 접근성, 성능(200권 이상 스크롤)

## 9. 원칙
Phase 시작 전 할 일 승인, 새 라이브러리는 이유 한 줄. 약관에 어긋나는 저장 금지(불확실하면 URL 참조 + 보고). 사진은 인식 후 폐기, 개인정보 문구에 카메라·사진·위치 사용 이유. 순수 로직(색 추출, 두께 등급, 카드 레이아웃, 동기화 병합) 단위 테스트. 검증한 범위만 "확인했다"고 보고.

## 10. 완료 기준
검색만으로 추가 → 재장정되어 꽂힘 → 재시작 후 유지 / 사진 한 장으로 여러 권 후보 → 수정·일괄 추가 / 상세에서 고해상도 실제 표지 + 기록 편집 / 완독 카드 PNG 공유 / 같은 ISBN 두 계정이어도 외부 API·색 추출 1회 / 커뮤니티·추천·통계 카드 없음.
