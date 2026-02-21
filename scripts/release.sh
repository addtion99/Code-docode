#!/usr/bin/env bash
# 本地打包并发布到 GitHub Release
# 用法: ./scripts/release.sh [版本标签]
# 示例: ./scripts/release.sh v0.0.1
# 若不传标签则使用 package.json 中的 version（前加 v）

set -e
cd "$(dirname "$0")/.."

TAG="${1:-}"
if [ -z "$TAG" ]; then
  TAG="v$(node -p "require('./package.json').version")"
fi

echo "使用 Node: $(node -v)"
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "错误: 需要 Node.js >= 20，当前为 $(node -v)。请使用 nvm use 20 或安装 Node 20。"
  exit 1
fi

echo "安装依赖..."
npm ci

echo "编译并打包插件..."
npm run package

VSIX=$(ls -t *.vsix 2>/dev/null | head -1)
if [ -z "$VSIX" ]; then
  echo "错误: 未找到 .vsix 文件"
  exit 1
fi

echo "创建 Release: $TAG，上传 $VSIX"
if command -v gh &>/dev/null; then
  gh release create "$TAG" "$VSIX" --title "Release $TAG" --generate-notes
  echo "已发布: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/releases/tag/$TAG"
else
  echo "未安装 GitHub CLI (gh)。请手动到 GitHub 仓库的 Releases 页面创建 $TAG 并上传 $VSIX"
  echo "或安装 gh: https://cli.github.com/"
fi
