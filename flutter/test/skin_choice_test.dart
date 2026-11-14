// 스킨 고르기: 저장 글자 읽기, 벽 없는 조합은 고를 수 없음, 바꾸면 빛 맞추기 값도 그 스킨 것으로
import 'package:chaekjang/gen/light_uniforms.g.dart' as cal;
import 'package:chaekjang/gen/skin_lights.g.dart';
import 'package:chaekjang/scene_config/skin.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('저장 글자', () {
    expect(SkinChoice.parse('oak,walnut,sage'), const SkinChoice(plank: 'oak', frame: 'walnut', wall: 'sage'));
    expect(SkinChoice.parse('oak,none,sage'), isNull, reason: '벽 없는 책장은 Flutter에서 고르지 않는다');
    expect(SkinChoice.parse('oak,walnut'), isNull);
    expect(SkinChoice.parse(null), isNull);
  });
  test('벽 있는 조합 48가지가 표에 다 있다', () {
    expect(skinLights.length, plankSkins.length * (frameSkins.length - 1) * wallSkins.length);
  });
  test('바꾸면 맞추기 값도 바뀌고, 되돌리면 그대로', () {
    final ecam = cal.ECAM;
    expect(setSkin(const SkinChoice(plank: 'walnut', frame: 'walnut', wall: 'sage')), isTrue);
    expect(cal.ECAM, isNot(ecam));
    expect(setSkin(const SkinChoice(plank: 'pine', frame: 'none', wall: 'white')), isFalse);
    expect(setSkin(defaultSkin), isTrue);
    expect(cal.ECAM.r, ecam.r);
  });
}
