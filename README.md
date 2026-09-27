# 책장 한켠

읽은 책을 모아 직접 배치해 꾸미는 책장 앱(가칭). 화면명은 "나의 책장".

- 지시서: `docs/HOME_BRIEF.md`(홈), `docs/BOOKSHELF_ASSET_BRIEF.md`(선반·배경 자산 적용), `docs/SPEC.md`(홈 외, Phase 0~6)
- 시안: `docs/design/home-reference.png` · 캡처: `docs/screenshots/` (00은 시안과 나란히 비교)
- 자산 규격·임시/최종 구분: `docs/assets.md`

## 실행

```bash
cd app && npm install
npx expo start --port 8095     # Expo Go(SDK 57)
npm test && npm run typecheck

cd server && go test ./...
PORT=8080 go run ./cmd/api     # 키·DB 없으면 메모리 저장소 + 가짜 도서로 뜬다(.env.example 참고)
```

자산 스크립트: `python3 app/scripts/measure-shelf.py`(선반 측정·배경 이음새 검사), `python3 app/scripts/extract-reference-assets.py`(시안에서 임시 예시 자산 추출).

## 구조

| 경로 | 역할 |
|---|---|
| `app/src/domain/` | 타입, 배치 엔진(이동·쌓기·형태·서랍·검증), 회전 형상, 제목 조판, 카탈로그 매핑·등급 규칙, 모티프 슬롯 30개, 선반 측정값 |
| `app/src/store/placement-store.ts` | 확정 배치, 로컬 저장(v2: 선반+서랍, 정규화 x 기록), 되돌리기, 저장 실패 표시 |
| `app/src/db/local-db.ts` | 기기 SQLite 캐시(catalog_books, user_books) |
| `app/src/ui/` | 종이 배경, 책 렌더러, 선반 줄(선반 PNG)·그림자·드래그 오버레이 |
| `app/src/features/home/` | 홈, 상세·배치 메뉴, 책 서랍 |
| `server/internal/books` | ISBN 공유 캐시(TTL 갱신, ISBN당 외부 조회·색 추출 1회), 카카오 검색 프록시 |
| `server/internal/llm` | Gemini·GPT 키 여러 개 순서대로, 한도·토큰·서버 오류 시 다음 키 |

## 상태 (2026-09-27)

**동작 구현(Android 에뮬레이터 Expo Go에서 확인):** 선반 PNG v3·종이 배경 적용, 세운·기울인·누운(쌓기)·표지 책, 갈피(문장 있는 책), 길게 눌러 같은 칸 자리 바꾸기·다른 선반 끼우기·자동 스크롤·새 선반 놓기, 정보 상자(자세·기울기·자리·서랍), 책 서랍, 되돌리기, 헤더 독서 연도, 앱 재시작 후 복원.

**시각 품질:** 시안과 나란히 비교(`docs/screenshots/00-compare-reference.png`). 예시 책 그림은 시안에서 잘라낸 **임시 자산**이라 거의 같지만, 최종 재장정 아트는 아직 없다. 차이: 줄 간격이 모든 줄 공통(지시)이라 3번째 줄 위가 시안보다 넓다. 책 키는 폰 화면을 채우도록 시안보다 약 15% 크다(그림 없는 띠만 늘림).

**서버·외부 연동:** 카카오·Gemini·GPT는 코드와 가짜 서버 테스트만 있고 **실제 키로 호출하지 않았다**(키 없음). 알라딘 Open API는 2026-10-30 종료 공지(신규 키 발급 9/4 종료)라 쓰지 않는다 → 고해상도 표지·쪽수 대체 출처 결정 필요. Postgres 저장소는 로컬 DB가 없어 실행하지 못했다(`TEST_DATABASE_URL`로 도는 테스트만 있음). KoDeploy 배포 전(Dockerfile만).

**미구현:** 등록·재장정 흐름(사진 → 식별 확인 → 재장정 → 배치, SPEC Phase 1·3), 로그인·동기화.

**확인하지 않은 것:** iOS, 실제 기기, TalkBack/VoiceOver, 동작 줄이기 설정, 200권 성능(가상화 없음), 저장 실패 경로.
