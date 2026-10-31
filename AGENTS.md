# 작업 규칙 (사람·AI 에이전트 공통)

## Git: 무조건 main
- 브랜치를 따로 만들지 않는다. 실험·점검도 main에서 한다(`git checkout -b`, `git worktree add`로 다른 브랜치 만들기 금지).
- 단계가 끝날 때마다(코드나 문서가 바뀐 단계) 그 단계에서 바꾼 파일만 골라 main에 커밋하고 바로 push한다.
- 다른 사람이 먼저 push했으면 `git pull --rebase origin main`으로 받아 합친 뒤 push한다. 강제 push 금지.
- 같은 작업 폴더를 여러 세션이 함께 쓸 수 있다. `git add -A`·`git add .` 대신 내가 바꾼 파일만 add한다. 남의 미커밋 변경은 건드리지 않는다.
- 커밋 메시지는 짧은 한국어로 쓴다. `Co-Authored-By` 같은 AI 흔적은 넣지 않는다.
- 커밋하지 않는 것: `server/.env`, `server/.gradle`·`server/bin`·`server/build`·`server/data`.
- main push에 `app/**` 변경이 있으면 Play 배포 CI(`.github/workflows/android-playstore-deploy.yml`)가 돈다. 결과를 확인한다.
- 서버(`server/**`) 변경은 push만으로 운영에 반영되지 않는다. KoDeploy에서 재배포해야 한다.
