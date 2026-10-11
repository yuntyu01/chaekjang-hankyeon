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
3. Google Cloud 서비스 계정을 만들고 JSON 키를 받아 Play Console 사용자 및 권한에서 "출시 관리자"로 초대한다.

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

비밀값이 빠지면 첫 단계에서 바로 실패하고 빠진 이름을 알려 준다.

## 2. 배포하는 법

- **드라이런(기본값)**: Actions > "CD: Android AAB" > Run workflow. `dry_run`이 켜져 있으면 AAB만 만들어 아티팩트로 남긴다. 첫 업로드용 AAB를 이렇게 받는다.
- **손으로 올리기**: `dry_run`을 끄고 트랙(`internal`, `alpha`, `beta`, `production`)을 고른다.
- **main 푸시**: `app/` 이 바뀐 커밋이 main 에 푸시되면 비공개 테스트(`alpha`) 트랙에 자동으로 올라간다(버전 이름은 app.json 값). 연달아 푸시하면 마지막 것만 올린다. `PLAY_SERVICE_ACCOUNT_JSON` 이 없으면 첫 단계에서 실패한다.
- **태그 푸시**: `git tag v1.0.0 && git push origin v1.0.0` → 버전 이름 `1.0.0`으로 `alpha` 트랙에 올라간다.

versionCode는 2025-01-01부터의 분 단위 시각이라 어느 경로로 돌아도 겹치지 않는다.

## 3. 빌드가 하는 일

타입 검사 → app.json에 버전 찍기 → `expo prebuild` → 스플래시 로고 파일 보충 → 서명 설정 덧붙이기 → 키스토어 복원 → `bundleRelease` → AAB 업로드.

- 스플래시 이미지를 따로 두지 않아 prebuild가 `splashscreen_logo.xml`을 만들지 않는다. 없으면 리소스 연결에서 실패해서 워크플로가 빈 도형 파일을 만든다.
- `android/gradle.properties`에 메모리 설정을 덧붙인다(러너 메모리 부족으로 Kotlin 컴파일이 죽는 것을 막는다).

## 4. 아직 안 해 본 것

- GitHub Actions에서 실제로 돌려 보지 않았다. 같은 절차를 로컬 복사본에서 돌려 AAB가 나오는지만 확인했다(x86_64 한 개 ABI만, 시험용 키스토어).
- Play 업로드 단계(`r0adkll/upload-google-play`)는 시험하지 못했다.
