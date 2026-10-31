# Go 서버

기존 HTTP API와 PostgreSQL 스키마를 유지하는 Go 서버다. KoDeploy의 기존 빌드 경로 `server/`와 Dockerfile을 사용하며, 기본 포트는 8080이고 `PORT` 환경변수로 변경할 수 있다. KoDeploy는 수동 재배포해야 한다.

## 실행

Go 1.27 이상과 PostgreSQL이 필요하다. `DATABASE_URL`과 기타 환경변수는 `.env.example`을 참고한다.
KoDeploy에서 제공하는 `postgresql+psycopg2://` 접두사는 서버 시작 시 `postgresql://`로 변환한다. 접속 정보와 SSL 설정은 그대로 유지한다.

```sh
cd server
DATABASE_URL='postgres://user:pass@localhost:5432/chaekjang?sslmode=disable' go run ./cmd/server
```

Docker 이미지: `docker build -t chaekjang-go server`. 운영에서는 사진을 영구 보존할 수 있도록 S3 호환 저장소의 `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`를 설정한다. 로컬 파일 저장은 `FILE_DIR`을 사용한다. 헬스 체크는 `GET /healthz`다.

## 데이터베이스

- 기존 Flyway 데이터베이스는 V1~V7의 성공 이력이 있어야 실행되며, Go 서버는 해당 마이그레이션을 다시 실행하지 않는다. V5인 DB는 `internal/server/migrations`의 V6·V7을 Flyway 도구로 먼저 적용해야 한다.
- V8부터는 Go 서버의 마이그레이션이다. Flyway V7 DB와 Go가 만든 DB 모두에 시작할 때 트랜잭션으로 적용하고 `go_schema_history`에 기록한다. 기존 Flyway의 이력 테이블을 위조하지 않는다.
- 새 데이터베이스에는 V1부터 모두 적용한다. 버전은 파일 이름의 `V<번호>__`로 정하며 1부터 빠짐없이 이어져야 한다.
- V8(`normalized_layout`): 책장 배치 JSON(`shelf_layouts.layout`)을 `shelves`·`shelf_placements` 표로 옮기고, `books`의 키·두께 분류와 기본 모티프 열을 지운다(판형·쪽수·ISBN으로 계산). 되돌릴 수 없으니 운영 DB는 백업한 뒤 재배포한다.
- 알 수 없는 이력을 가진 기존 스키마에는 적용하지 않는다. 실제 데이터 전환 전에 백업과 별도 환경에서의 검증이 필요하다.

## 검증과 남은 작업

`go test ./...`로 일반 시험을 실행하고, **전용 테스트 DB**를 준비한 뒤 `TEST_DATABASE_URL=postgres://... go test ./...`로 PostgreSQL 통합 시험을 실행한다. Flyway V7 DB를 V8로 올리는 시험은 빈 DB를 하나 더 만들어 `TEST_EMPTY_DATABASE_URL`로 넘긴다. 이 시험은 계정과 데이터를 생성하므로 실제 데이터베이스를 지정하지 않는다.

기기 계정, Google·카카오 로그인, 계정 삭제, 도서 검색·상세, 파일, 동기화 API를 구현했다. 도서 검색·ISBN 조회는 YES24 기준이다: `YES24_API_KEY`로 YES24를 부르고(쪽수·판형 mm·분류·시리즈·책 소개, 2026-10-31 실제 키로 확인), 키가 없으면 개발용 가짜 목록을 쓴다(`internal/server/yes24.go`). 종이책만 쓰되 외국 도서(외서·직수입양서·직수입일서, 관리 분류 '외국도서')도 넣고, 한글이 없는 검색어는 외국 도서 칸(`category=FOREIGN`) 100건을 함께 받아 전체 검색 앞 3건 뒤를 제목·저자가 맞는 순으로 다시 줄 세운다(한글 검색어는 국내 도서 먼저). `/healthz`의 `books`가 `yes24`인지로 확인한다. `KAKAO_REST_KEY`는 이제 카카오 로그인(`KAKAO_LOGIN_REST_KEY`가 없을 때)에만 쓴다. 계정 삭제 저널은 R2에 남으며 서버 시작 전 재적용한다. Google·카카오와 객체 저장소의 실서비스 자격 증명은 시험하지 않았다. LLM 키 순환 게이트웨이는 이전했지만 기존 서버처럼 외부 API 엔드포인트에는 연결되어 있지 않다. 실제 서비스 교체 전 외부 연동과 양 서버의 응답 및 부하를 추가 검증해야 한다. 로그인 설정과 삭제·복원 주의사항은 `../docs/social-login.md`를 참고한다.
