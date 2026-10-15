# 종이 모드 (Android 전용)

다른 전자책 앱이나 PDF 뷰어로 읽는 동안, 화면 맨 위에 터치를 받지 않는 옅은 종이 색과 미세한 결을 한 겹 얹는 기능이다.
읽기 화면의 ‘종이 모드’에서 켜고 끈다. 독서 타이머와는 따로 움직인다.

- 코드: `app/modules/paper-mode/`(Expo 로컬 모듈, Kotlin), 설정 시트 `app/src/features/reading/PaperModeSheet.tsx`
- `app/android/`는 CI의 `expo prebuild`가 만든다. 로컬 모듈은 prebuild 없이 Gradle 자동 연결(`expo-modules-autolinking`, 기본 `./modules`)로 잡히고,
  권한·서비스 선언은 모듈의 `AndroidManifest.xml`이 앱 매니페스트에 합쳐진다(`app.json`은 바꾸지 않았다).

## 하는 일과 하지 않는 일

- 다른 앱 화면을 읽거나 캡처·분석하지 않는다. 접근성 서비스, 화면 녹화(MediaProjection) 권한을 쓰지 않는다.
- 다른 앱의 배경만 바꾸거나 전자잉크처럼 바꾸는 기능이 아니다. 오버레이 창 하나가 **화면 전체**(글자·사진 포함)에 같은 효과를 얹는다.
- 실행 중인 앱을 감지하지 않는다. 자체 뷰어·파일 가져오기도 없다.
- 시스템 밝기 설정을 바꾸지 않는다.

## 매니페스트에 더해지는 것 (`app/modules/paper-mode/android/src/main/AndroidManifest.xml`)

| 선언 | 이유 |
| --- | --- |
| `android.permission.SYSTEM_ALERT_WINDOW` | 다른 앱 위 표시. 특별 권한이라 사용자가 시스템 설정에서 직접 허용한다(처음 ‘켜기’를 누를 때 앱이 설명하고 설정을 연다). Expo prebuild 템플릿이 앱 매니페스트에 이미 넣지만, 이제 실제로 쓰므로 모듈 매니페스트에도 적었다. |
| `android.permission.FOREGROUND_SERVICE` | 켜져 있는 동안 프로세스를 유지하는 포그라운드 서비스. |
| `android.permission.FOREGROUND_SERVICE_SPECIAL_USE` | Android 14+에서 `specialUse` 유형 서비스에 필요. |
| `android.permission.POST_NOTIFICATIONS` | Android 13+ 실행 중 알림(‘끄기’ 버튼). 처음 켤 때 한 번 묻는다. 거부해도 기능과 앱 안 끄기는 동작한다. |
| `<service .PaperOverlayService android:foregroundServiceType="specialUse" android:exported="false" android:process=":paper">` + `<property android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE>` | 오버레이 창의 주인. 용도 설명 문자열은 Play 심사에서 읽힌다. 별도 프로세스인 이유는 아래 ‘프로세스’. |
| `<receiver .PaperStopReceiver android:exported="false" android:process=":paper">` | 알림의 ‘끄기’(우리 알림의 PendingIntent만 보낸다). |

### 포그라운드 서비스 유형을 `specialUse`로 정한 이유

공식 유형(camera, connectedDevice, dataSync, health, location, mediaPlayback, mediaProcessing, mediaProjection, microphone,
phoneCall, remoteMessaging, shortService, systemExempted) 가운데 "사용자가 켠 화면 색조 오버레이를 끌 때까지 유지"에 맞는 것이 없다.
다른 유형(예: dataSync, mediaPlayback)으로 우회하지 않는다.

## Play Console에서 할 일 (배포 전)

1. **정책 > 앱 콘텐츠 > 포그라운드 서비스 권한**: `specialUse`를 신고한다. 설명 예:
   "사용자가 앱에서 직접 켠 '종이 모드' 동안, 다른 앱 위에 터치를 받지 않는 옅은 종이 색 오버레이를 유지합니다. 실행 중 알림의 '끄기' 또는 앱 안에서 즉시 끌 수 있고,
   재부팅 후 자동으로 켜지지 않습니다. 화면 내용을 읽거나 캡처하지 않습니다." 켜기 → 다른 앱에서 효과 → 알림에서 끄기를 보여 주는 짧은 영상을 함께 낸다.
2. `SYSTEM_ALERT_WINDOW`는 Play의 제한 권한 신고 대상은 아니지만, 스토어 설명과 개인정보 처리방침에 "다른 앱 위 표시 권한을 화면 색조 효과에만 쓰고 화면 내용을 수집하지 않는다"를 적는다.
3. 데이터 보안 양식: 종이 모드는 기기 밖으로 보내는 데이터가 없다(설정값 3개만 기기에 저장).

## 시험

- 합성 수식·결 잡음(기기 없이): `cd app/android && ./gradlew :paper-mode:testReleaseUnitTest`

## 동작 규칙 (구현 기준)

- **창 하나**: `TYPE_APPLICATION_OVERLAY`, `FLAG_NOT_TOUCHABLE | FLAG_NOT_FOCUSABLE | FLAG_LAYOUT_IN_SCREEN | FLAG_LAYOUT_NO_LIMITS`. 터치와 입력 포커스를 가져가지 않는다.
- **터치 통과(Android 12+)**: 시스템은 다른 앱 오버레이가 가리는 정도를 창의 `WindowManager.LayoutParams.alpha`로 판정한다(같은 앱 창들은 합산).
  그래서 색감과 결을 창 안 그림 한 장으로 합성하고, 창 `alpha`를 그 효과의 가장 큰 불투명도(최대 약 0.12)로 둔다. 그림 알파는 그 값에 대한 비율이다.
  창 `alpha`는 `InputManager.getMaximumObscuringOpacityForTouch()`(기본 0.8)의 98% 이하로 제한하고, 제한되면 앱이 "약하게 적용 중"이라고 알린다.
- **합성**: 오버레이는 아래 화면과 보통 알파 합성만 할 수 있다. 흰 종이 목표색을 내는 색 중 검정이 가장 적게 들뜨는 색(가장 많이 바뀌는 채널 = 0)을 쓰고,
  종이 결은 검정을 아주 조금 얹어(곱하기와 같은 효과) 밝은 바탕에만 보이게 한다. 색감 최대에서도 회색 보조 글자(#757575) 대비가 원래의 88% 이상(가장 진한 결 화소를 더해도 86% 이상) 남게 상한을 정했고, 기본값(밝은 종이 60%, 결 35%)은 95% 남는다. 검은 글자는 최대에서도 (19, 13, 0) 안팎의 아주 짙은 갈색까지만 뜬다(`PaperLookTest`).
- **결**: 화면 크기 그대로의 정적 잡음 한 장(타일 반복 없음, 고정 시드, dp 단위 크기, 비스듬한 격자로 줄무늬 방지). 값·크기가 바뀔 때만 다시 만든다(백그라운드 스레드).
  매 프레임 다시 그리거나 JS 타이머를 돌리지 않는다.
- **생명주기**: 화면이 꺼지면 창을 떼고, 잠금이 풀리면 다시 붙인다(잠금 화면 위에 그리지 않는다). 잠금 해제 방송(USER_PRESENT)은 SystemUI가 보내므로
  화면 수신기는 `RECEIVER_EXPORTED`로 등록한다(세 방송 모두 보호된 방송이라 다른 앱이 보낼 수 없다). 회전하면 새 크기로 그림만 다시 만든다.
  다른 앱 위 표시 권한이 회수되면(AppOps 감시) 서비스가 스스로 끝난다. `START_NOT_STICKY`이고 부팅 수신기가 없어,
  재부팅·강제 종료 뒤에는 꺼져 있다. 켜짐 여부는 저장하지 않고, 팔레트·색감·결 값만 `SharedPreferences(paper_mode)`에 저장한다.
- **프로세스**: 서비스는 앱(React Native)과 다른 프로세스 `:paper`에서 돈다. 포그라운드 서비스가 붙은 프로세스는 백그라운드에서도
  캐시·동결되지 않아서, 같은 프로세스면 종이 모드를 켜 둔 동안 다른 앱을 쓰는 내내 앱 전체(JS·애니메이션)가 깨어 있었다
  (에뮬레이터에서 앱 프로세스가 백그라운드 CPU 약 25~40%, 꺼 두면 몇십 초 뒤 동결되어 0). 지금은 앱 프로세스는 평소처럼 동결되고 `:paper`만 남는다.
  두 프로세스 사이(`PaperBus.kt`): 켜기·값 바꾸기는 값을 실은 인텐트, 끄기는 `stopService`, 상태는 서비스가 쓰는 작은 파일 + 같은 앱 안 방송,
  켜져 있는지는 `getRunningServices`(자기 앱 서비스만 보인다)로 확인한다.
- **시작 조건**: 포그라운드 서비스는 사용자가 앱 화면에서 켤 때만 시작한다(Android 12+ 백그라운드 시작 제한). 알림의 ‘끄기’는 서비스를 멈추기만 한다.
- **알림 권한이 없을 때**: 서비스 알림은 알림창에 보이지 않는다. 앱의 종이 모드 시트가 "켜짐"과 함께 그 사실과 끄는 방법(앱 안 끄기, Android 13+ 알림창의 실행 중인 앱 목록)을 보여 준다.
- 지원: Android 8.0(API 26) 이상. 그 아래에서는 진입점을 숨긴다. iOS·Expo Go에는 네이티브 모듈이 없어 진입점이 보이지 않는다.

## 호환성 제한 (사용자에게 "모든 앱에서 된다"고 말하지 않는다)

- 상태 표시줄·알림창·내비게이션 막대 같은 시스템 창은 오버레이보다 위에 있어 효과가 덮지 않는다(Android 16 에뮬레이터에서 창 순서로 확인). 키보드(입력기) 창은 오버레이 아래라 함께 덮인다.
- 앱이 `setHideOverlayWindows(true)`(Android 12+)를 쓰는 화면(은행·결제·일부 시스템 설정 등)에서는 시스템이 효과를 숨긴다. 우회하지 않는다.
- 다른 앱 위 표시 권한 화면 같은 일부 시스템 화면도 오버레이를 숨긴다.
- 제조사 기기는 최대 가림 불투명도나 오버레이 정책을 바꿀 수 있다.
