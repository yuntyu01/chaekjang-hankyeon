# Go 서버

기존 Spring 서버의 HTTP API와 PostgreSQL 스키마를 유지하는 Go 서버다. KoDeploy의 기존 빌드 경로 `server/`와 Dockerfile을 사용하며, 기본 포트는 8080이고 `PORT` 환경변수로 변경할 수 있다. 이전 Spring 서버는 비교와 롤백용으로 `server-java/`에 보관한다. KoDeploy는 수동 재배포해야 한다.

## 실행

Go 1.27 이상과 PostgreSQL이 필요하다. `DATABASE_URL`과 기타 환경변수는 `.env.example`을 참고한다.

```sh
cd server
DATABASE_URL='postgres://user:pass@localhost:5432/chaekjang?sslmode=disable' go run ./cmd/server
```

Docker 이미지: `docker build -t chaekjang-go server`. 운영에서는 사진을 영구 보존할 수 있도록 S3 호환 저장소의 `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`를 설정한다. 로컬 파일 저장은 `FILE_DIR`을 사용한다. 헬스 체크는 `GET /healthz`다.

## 데이터베이스

- 기존 Flyway 데이터베이스는 V1~V7의 성공 이력이 있어야 실행되며, Go 서버는 해당 마이그레이션을 다시 실행하지 않는다. 운영 DB가 V5라면 Java Flyway로 V6·V7을 먼저 적용해야 한다.
- 새 데이터베이스에는 V1~V7 SQL을 트랜잭션으로 적용하고 `go_schema_history`에 기록한다. 기존 Flyway의 이력 테이블을 위조하지 않는다. Go가 처음 만든 데이터베이스는 그대로 Java 서버로 전환할 수 없다. 전환이 필요한 경우 별도 Flyway 이력 이관과 검증이 필요하다.
- 알 수 없는 이력을 가진 기존 스키마에는 적용하지 않는다. 실제 데이터 전환 전에 백업과 별도 환경에서의 검증이 필요하다.

## 검증과 남은 작업

`go test ./...`로 일반 시험을 실행하고, **전용 테스트 DB**를 준비한 뒤 `TEST_DATABASE_URL=postgres://... go test ./...`로 PostgreSQL 통합 시험을 실행한다. 이 시험은 계정과 데이터를 생성하므로 실제 데이터베이스를 지정하지 않는다.

기기 계정, Google·카카오 로그인, 계정 삭제, 도서 검색·상세, 파일, 동기화 API를 구현했다. 계정 삭제 저널은 R2에 남으며 서버 시작 전 재적용한다. Google·카카오와 객체 저장소의 실서비스 자격 증명은 시험하지 않았다. LLM 키 순환 게이트웨이는 이전했지만 기존 서버처럼 외부 API 엔드포인트에는 연결되어 있지 않다. 실제 서비스 교체 전 외부 연동과 양 서버의 응답 및 부하를 추가 검증해야 한다. 로그인 설정과 삭제·복원 주의사항은 `../docs/social-login.md`를 참고한다.
