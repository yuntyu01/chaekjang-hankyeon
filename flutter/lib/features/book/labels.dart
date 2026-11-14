// 책·기록 글자(지금 앱 features/book/labels.ts)
library;

/// '2026-11-05T…' → '2026.11.05'. 시각이 든 값(UTC ISO)은 기기 현지 날짜로: 앞 10자만 자르면 한국 0~9시에 남긴 갈피가 전날로 보였다
/// (지금 앱 labels.ymd도 같은 버그 — Flutter에서만 고친다). 날짜만 있는 값('2026-11-05')은 그대로
String ymd(String? d) {
  if (d == null || d.isEmpty) return '';
  final t = d.length > 10 ? DateTime.tryParse(d) : null;
  if (t == null) return (d.length > 10 ? d.substring(0, 10) : d).replaceAll('-', '.');
  final l = t.toLocal();
  String two(int v) => v.toString().padLeft(2, '0');
  return '${l.year}.${two(l.month)}.${two(l.day)}';
}
