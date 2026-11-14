// 탭 넘나들기(지금 앱 router.dismissTo('/read', {book}) 같은 일): 밀어 넣은 화면에서 하단 탭을 바꾸고, 읽기 탭에 책을 넘겨준다
library;

import 'package:flutter/foundation.dart';

class AppNav extends ChangeNotifier {
  AppNav._();
  static final instance = AppNav._();

  /// 바꿀 탭(앱 틀이 읽고 비운다)
  int? tab;

  /// 읽기 탭에 넘겨준 책(읽기 탭이 읽고 비운다)
  String? readBook;

  /// 갈피 탭에 넘겨준 책 거르기(갈피 탭이 읽고 비운다)
  String? bookmarkBook;

  void goTab(int i) {
    tab = i;
    notifyListeners();
  }

  /// 갈피 탭으로 가서 그 책 갈피만(지금 앱 보드 '목록 보기': dismissTo('/bookmarks', {book}))
  void goBookmarks(String bookId) {
    bookmarkBook = bookId;
    goTab(1);
  }

  /// 읽기 탭으로 가서 그 책을 맨 앞에(시작은 재생을 눌러서)
  void goRead(String bookId) {
    readBook = bookId;
    goTab(2);
  }
}
