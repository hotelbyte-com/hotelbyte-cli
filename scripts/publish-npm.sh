#!/bin/sh
# scripts/publish-npm.sh: 发 staicli (hbcli) 到 npmjs —— 与全局 ~/.npmrc 完全隔离
#
# 隔离方式(参考 gotry scripts/publish-npm.sh):
#   NPM_CONFIG_USERCONFIG 指向仓内 .npmrc.publish(gitignored)
#   —— 不读写 ~/.npmrc,不受 bnpm registry/prefix 行影响。
#
# 用法:
#   TAG=latest ./scripts/publish-npm.sh   # dist-tag 必须显式传(无默认值)
#   ./scripts/publish-npm.sh login        # 只建 web 登录会话,浏览器点一次 Approve 即退出
#
# 发布前闸:
#   - git 工作区干净(除本脚本自动改的 dist/)
#   - bun test 全绿
#   - bun run build:js 产出 dist/cli.js
# 发布后:
#   - npm view 回拉验证 registry 上可见
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
NPMRC="$ROOT/.npmrc.publish"

# dist-tag 必须显式传入,未传即拒发。豁免 login:纯认证子命令不发布任何东西
case "${1:-}" in
  login) ;;
  *)
    if [ -z "${TAG:-}" ]; then
      echo "!! TAG 未指定,拒绝发布。用法:TAG=latest ./scripts/publish-npm.sh(dist-tag 是显式意图,无默认值)" >&2
      exit 1
    fi
    ;;
esac
export NPM_CONFIG_USERCONFIG="$NPMRC"

NAME="$(node -e "console.log(require('./package.json').name)")"
VERSION="$(node -e "console.log(require('./package.json').version)")"

# 每次现生成:registry 固定 npmjs;token 来源优先级 = 上次 web 登录会话(仍有效则保留) > ~/.npmrc 的 npmjs token
if grep -q _authToken "$NPMRC" 2>/dev/null && npm whoami --registry=https://registry.npmjs.org/ >/dev/null 2>&1; then
  echo ">> 保留 .npmrc.publish 中仍有效的登录会话 token"
else
  {
    echo 'registry=https://registry.npmjs.org/'
    TOKEN="$(awk '/registry\.npmjs\.org\/:_authToken=/{print $0}' ~/.npmrc 2>/dev/null | sed -E 's/^[^=]*=//' | head -1)"
    [ -n "$TOKEN" ] && echo "//registry.npmjs.org/:_authToken=$TOKEN"
  } > "$NPMRC"
fi

if [ "${1:-}" = "login" ]; then
  echo ">> web 登录:会话 token 只写 $NPMRC(全局 ~/.npmrc 不动)。浏览器点 Approve 后本命令即完成。"
  npm login --auth-type=web --registry=https://registry.npmjs.org/
  exit 0
fi

# ---- 发布前闸 ----
echo ">> 闸:git 工作区干净(除 dist/ 与 .npmrc.publish)"
DIRTY="$(git status --porcelain --untracked-files=no | grep -v '^..dist/' | grep -v '^..npmrc.publish' || true)"
if [ -n "$DIRTY" ]; then
  echo "!! 工作区有未提交改动,请先 git commit/stash 再 publish"
  echo "$DIRTY"
  exit 1
fi

echo ">> 闸:bun test"
bun test >/dev/null 2>&1 || { echo "!! bun test 失败,拒绝发布"; exit 1; }
echo "   ✓ bun test 全绿"

echo ">> 闸:预编译 dist/cli.js(bun build --target=node,纯 JS bundle)"
bun run build:js

echo ">> 隔离配置生效:registry=$(npm config get registry)"
npm whoami --registry=https://registry.npmjs.org/ || echo "  (未登录/无 token 权限,继续尝试 publish)"

echo ">> publish ${NAME} v${VERSION} --tag ${TAG}"
npm publish --access public --tag "$TAG" --registry=https://registry.npmjs.org/

# ---- 发布后回拉验证(参考 gotry:回拉未做不得宣称「已发布」)----
echo ">> 回拉验证:npm view ${NAME}"
npm view "$NAME" --registry=https://registry.npmjs.org/ version dist-tags --json | head -20

echo ">> Done → ${NAME}@${VERSION} (tag=${TAG})"
