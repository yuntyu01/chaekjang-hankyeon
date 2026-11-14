#!/bin/bash
# 빛 셰이더를 만든다: 지금 앱(../app)의 생성기에서 SkSL을 뽑아 → GLSL로 바꿔 shaders/*.frag 에 쓴다.
# flutter build가 그 파일을 impellerc로 미리 컴파일한다(기기에서 처음 그릴 때 컴파일하지 않는다).
# 셰이더 식을 바꿀 일이 있으면 ../app/src/ui/scene-light-sksl.ts 를 고치고 이것을 다시 돌린다.
# 관문(S23 측정)을 지나면 생성기를 Dart로 옮기고 node 의존을 없앤다.
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
NODE_BIN=${NODE_BIN:-$HOME/.nvm/versions/node/v22.21.0/bin}
FLUTTER_BIN=${FLUTTER_BIN:-$HOME/flutter/bin}

# 지금 앱은 커밋된 것을 쓴다(다른 작업의 미커밋 빛 조정이 섞이지 않게): HEAD의 app/을 임시 폴더에 풀고 node_modules만 빌린다.
# 작업 폴더 그대로 쓰려면 APP_SRC=../app 으로 돌린다
if [ -z "$APP_SRC" ]; then
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT
  git -C "$ROOT/.." archive HEAD app | tar -x -C "$TMP"
  ln -s "$ROOT/../app/node_modules" "$TMP/app/node_modules"
  APP_SRC="$TMP/app"
  echo "== 지금 앱: 커밋 $(git -C "$ROOT/.." rev-parse --short HEAD)"
fi

echo "== SkSL·줄 구성 뽑기 (jest)"
cd "$APP_SRC"
PATH=$NODE_BIN:$PATH npx jest --silent=false \
  --config "{\"preset\":\"jest-expo\",\"rootDir\":\".\",\"testEnvironment\":\"node\",\"modulePaths\":[\"<rootDir>/node_modules\"],\"roots\":[\"$ROOT/tool\"],\"testMatch\":[\"**/dump_sksl.test.ts\",\"**/dump_schema.test.ts\",\"**/dump_bookmark.test.ts\",\"**/dump_reading.test.ts\",\"**/dump_rebinding.test.ts\",\"**/dump_physics.test.ts\",\"**/dump_locked.test.ts\",\"**/dump_qa_seed.test.ts\",\"**/dump_edit.test.ts\"],\"moduleNameMapper\":{\"^@/(.*)$\":\"<rootDir>/src/\$1\"}}" \
  2>&1 | grep -E "^\s+(console.log|\[dump\])|✓|✕|Tests:|Error|Cannot" | sed 's/^ *//'

echo "== GLSL 로 바꾸기"
cd "$ROOT"
PATH=$FLUTTER_BIN:$PATH dart run tool/sksl_to_glsl.dart build/sksl shaders
