// 책·기록 글자(지금 앱 features/book/labels.ts)
library;

/// '2026-11-05T…' → '2026.11.05'
String ymd(String? d) => d == null || d.isEmpty ? '' : (d.length > 10 ? d.substring(0, 10) : d).replaceAll('-', '.');
