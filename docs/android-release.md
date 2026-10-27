# 책장 한켠 안드로이드 릴리스 (Play Store)

앱을 AAB로 빌드해 Google Play Console에 올리는 파이프라인.

- 워크플로: `.github/workflows/android-playstore-deploy.yml`
- 패키지명: `app/app.json`의 `expo.android.package` (스토어 등록 후에는 바꿀 수 없다)
- 빌드 대상: `app/` (Expo prebuild로 `android/`를 CI에서 만든다. `android/`는 git에 없다)

## 1. 한 번만 하는 준비

### 1-1. 업로드 키스토어

키스토어를 잃으면 같은 앱의 업데이트를 못 올린다. 파일과 비밀번호는 따로 안전하게 보관한다.

```bash
keytool -genkeypair -v -keystore chaekjang-upload.jks -alias chaekjang-upload \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w 0 chaekjang-upload.jks > chaekjang-upload.jks.base64
```

### 1-2. Play Console

1. 앱을 만들고 패키지명을 `app.json` 값과 같게 한다.
2. **첫 AAB는 콘솔에서 손으로 한 번 올려야 한다.** Play API는 이미 트랙이 있는 앱에만 올릴 수 있다. 아래 "드라이런"으로 받은 AAB를 올린다.
3. GitHub의 `PLAY_SERVICE_ACCOUNT_JSON`에 들어 있는 실제 서비스 계정을 Play Console 사용자 및 권한에 등록한다. 현재 Covebook 전용 계정은 `covebook-play-deploy@gen-lang-client-0332508820.iam.gserviceaccount.com`이다. `app.covebook`에만 앱 정보 보기·앱 품질 정보 보기(자동 포함)·앱을 테스트 트랙으로 출시 권한을 부여한다. 계정 전체·관리자·재무·프로덕션 권한은 자동 Alpha 업로드에 부여하지 않는다.

### 1-3. GitHub Secrets

저장소 Settings > Secrets and variables > Actions.

| 종류 | 이름 | 값 |
| --- | --- | --- |
| Secret | `KEYSTORE_BASE64` | `chaekjang-upload.jks.base64` 내용 |
| Secret | `KEYSTORE_PASSWORD` | 키스토어 비밀번호 |
| Secret | `KEY_ALIAS` | `chaekjang-upload` |
| Secret | `KEY_PASSWORD` | 키 비밀번호 |
| Secret | `PLAY_SERVICE_ACCOUNT_JSON` | 서비스 계정 JSON 전체 (드라이런이면 불필요) |
| Variable | `ANDROID_VERSION_CODE_OFFSET` | 선택. 이미 올린 빌드가 있을 때 versionCode 바닥을 올리는 정수 |

비밀값이 빠지면 첫 단계에서 바로 실패하고 빠진 이름을 알려 준다. 업로드를 요청한 실행은 앱 의존성 설치·AAB 빌드 전에 실제 서비스 계정과 Play 앱 접근 권한도 확인한다. 검사용 임시 edit를 만들고 Alpha 트랙을 조회한 뒤 폐기하며 출시를 업로드하거나 commit하지 않는다. 키 JSON·비밀키·인증 토큰은 출력하지 않는다.

## 2. 배포하는 법

- **드라이런(기본값)**: Actions > "CD: Android AAB" > Run workflow. `dry_run`이 켜져 있으면 AAB만 만들어 아티팩트로 남긴다. 첫 업로드용 AAB를 이렇게 받는다.
- **손으로 올리기**: `dry_run`을 끄고 테스트 트랙(`internal`, `alpha`, `beta`)을 고른다. 이 전용 계정은 프로덕션 출시 권한이 없으며 CI에서도 정식 출시는 제공하지 않는다.
- **main 푸시**: `app/` 이 바뀐 커밋이 main 에 푸시되면 비공개 테스트(`alpha`) 트랙에 자동으로 올라간다(버전 이름은 app.json 값). 연달아 푸시하면 마지막 것만 올린다. `PLAY_SERVICE_ACCOUNT_JSON` 이 없으면 첫 단계에서 실패한다.
- **태그 푸시**: `git tag v1.0.0 && git push origin v1.0.0` → 버전 이름 `1.0.0`으로 `alpha` 트랙에 올라간다.
- **권한만 점검**: Run workflow에서 `verify_play_identity_only`를 켠다. 현재 이름은 기존 입력과의 호환을 위한 것이며 실제로는 계정 식별자와 Play 접근까지 확인한다. 앱 빌드·업로드는 하지 않는다.
- **CI 설정 변경**: workflow·검사 스크립트·이 문서는 PR에서 파이프라인 테스트를 실행한다. `app/` 변경이 없는 설정 전용 main 푸시로 같은 앱을 다시 빌드하지 않는다.

versionCode는 2025-01-01부터의 분 단위 시각이라 어느 경로로 돌아도 겹치지 않는다.

## 3. 빌드가 하는 일

파이프라인 테스트 → 필수 비밀값 확인 → Play 권한 사전 검사(업로드할 때만) → 타입 검사 → app.json에 버전 찍기 → `expo prebuild` → 스플래시 로고 파일 보충 → 서명 설정 덧붙이기 → 키스토어 복원 → `bundleRelease` → AAB 업로드.

- 스플래시 이미지를 따로 두지 않아 prebuild가 `splashscreen_logo.xml`을 만들지 않는다. 없으면 리소스 연결에서 실패해서 워크플로가 빈 도형 파일을 만든다.
- `android/gradle.properties`에 메모리 설정을 덧붙인다(러너 메모리 부족으로 Kotlin 컴파일이 죽는 것을 막는다).

## 4. 2026-10-27 업로드 복구 기록

- main의 `d9aedd5` 실행 `40422698144`는 AAB 빌드·타입 검사를 통과했으나 실제 서비스 계정이 Play Console에 미등록되어 업로드 단계에서 권한 오류가 났다. 키가 GitHub에 존재하는지 확인하는 것만으로는 이 오류를 발견할 수 없었다.
- 계정의 비밀값을 바꾸지 않고 Covebook에만 테스트 출시 권한을 등록한 뒤, 실행 `40439933188`에서 기존 `chaekjang-956153-aab`를 재사용해 Alpha 업로드를 완료했다. 재빌드·버전 변경은 하지 않았다. Play 심사·게시 여부는 Console에서 별도로 확인한다.
- 이 사건의 재전송 입력 `recover_existing_run=40422698144`는 해당 main 커밋·아티팩트·SHA-256만 허용하며 트랙은 Alpha로 고정된다. 실행하려면 `dry_run=false`가 필요하다. 이미 복구한 버전을 다시 올리지 않는다. 다른 실행에 재사용하려면 소스·AAB·버전·서명을 확인하고 제한값을 코드 리뷰로 갱신한다.
- 권한 오류·트랙 조회 오류·임시 edit 정리 실패·다른 서비스 계정·Alpha 트랙 누락을 검사하는 단위 테스트가 있다. 실제 Store 서명본의 기기 설치·전체 기능 사용까지 검증했다는 뜻은 아니다.
