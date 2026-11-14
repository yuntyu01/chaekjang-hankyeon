# 기기 안 문장 인식(ML Kit): 구성 요소를 이름으로 찾아 만든다(리플렉션). 줄이기(R8)가 지우거나 이름을 바꾸면 InputImage·인식기가 null로 깨진다
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_** { *; }
-keep class com.google.android.odml.** { *; }
-dontwarn com.google.mlkit.**
