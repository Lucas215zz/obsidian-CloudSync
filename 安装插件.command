#!/bin/bash
# ============================================================
#  Tencent COS Sync — Obsidian 插件一键安装脚本（小白版）
#  双击这个文件即可自动安装到你的所有 Obsidian 仓库
# ============================================================

# 让终端输出中文不乱码
export LANG=zh_CN.UTF-8

# 当前脚本所在目录（插件文件都在这）
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=============================================="
echo "  Tencent COS Sync 插件安装器"
echo "=============================================="
echo ""

# 1. 检查三个必要文件是否都在
MISSING=0
for F in main.js manifest.json styles.css; do
  if [ ! -f "$DIR/$F" ]; then
    echo "  ❌ 缺少文件：$F"
    MISSING=1
  fi
done

if [ "$MISSING" = "1" ]; then
  echo ""
  echo "  安装文件不完整。请先运行："
  echo "    cd \"$DIR\" && npm install && npm run build"
  echo ""
  read -r -p "按回车键退出..." _
  exit 1
fi

# 2. 找到 Obsidian 的配置，列出你所有的仓库
CONFIG="$HOME/Library/Application Support/obsidian/obsidian.json"
if [ ! -f "$CONFIG" ]; then
  echo "  ⚠️  没有找到 Obsidian 配置（可能还没装 Obsidian，或没打开过）"
  echo "  请先打开一次 Obsidian，再重新双击本脚本。"
  echo ""
  read -r -p "按回车键退出..." _
  exit 1
fi

echo "  正在读取你的 Obsidian 仓库列表..."
echo ""

# 提取所有仓库路径（用 python3 解析 JSON，macOS 自带）
VAULTS=$(python3 - "$CONFIG" <<'PYEOF'
import json, sys
path = sys.argv[1]
try:
    data = json.load(open(path))
    vaults = data.get("vaults", {})
    for v in vaults.values():
        p = v.get("path", "")
        if p:
            print(p)
except Exception as e:
    print("", file=sys.stderr)
PYEOF
)

if [ -z "$VAULTS" ]; then
  echo "  ⚠️  没有找到任何 Obsidian 仓库。"
  echo "  请先在 Obsidian 里打开/创建一个仓库，再重新双击本脚本。"
  echo ""
  read -r -p "按回车键退出..." _
  exit 1
fi

echo "  找到以下仓库："
echo "$VAULTS" | while read -r V; do echo "    • $V"; done
echo ""

# 3. 逐个仓库安装
OK=0
while IFS= read -r VAULT; do
  [ -z "$VAULT" ] && continue
  TARGET="$VAULT/.obsidian/plugins/obsidian-cos-sync"
  if [ ! -d "$VAULT" ]; then
    echo "  ⚠️  仓库目录不存在，跳过：$VAULT"
    continue
  fi
  mkdir -p "$TARGET"
  cp "$DIR/main.js" "$DIR/manifest.json" "$DIR/styles.css" "$TARGET/"
  # 启用插件：把插件 ID 加进 community-plugins.json
  CPJSON="$VAULT/.obsidian/community-plugins.json"
  python3 - "$CPJSON" <<'PYENABLE'
import json, sys
path = sys.argv[1]
try:
    with open(path, 'r', encoding='utf-8') as f:
        plugins = json.load(f)
    if not isinstance(plugins, list):
        plugins = []
except Exception:
    plugins = []
if 'obsidian-cos-sync' not in plugins:
    plugins.append('obsidian-cos-sync')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(plugins, f, ensure_ascii=False, indent=2)
        f.write('\n')
PYENABLE
  echo "  ✅ 已安装到：$VAULT"
  OK=$((OK+1))
done <<< "$VAULTS"

echo ""
echo "=============================================="
if [ "$OK" -ge 1 ]; then
  echo "  🎉 安装完成！共安装了 $OK 个仓库"
  echo ""
  echo "  接下来这样做："
  echo "  1. 完全退出 Obsidian（菜单栏 Obsidian → 退出）"
  echo "  2. 重新打开 Obsidian"
  echo "  3. 打开 设置 → 第三方插件 → 找到"
  echo "     “Tencent COS Sync” → 打开开关"
  echo "  4. 点插件设置，填入腾讯云 COS 的信息："
  echo "     SecretId / SecretKey / Bucket / Region"
else
  echo "  ❌ 没有成功安装到任何仓库，请检查上面的提示"
fi
echo "=============================================="
echo ""
read -r -p "按回车键关闭窗口..." _
