#!/bin/bash
# ========================================
#    宝塔自动更新脚本（小白专用）
#    使用方法：宝塔面板 → 计划任务 → 添加Shell脚本
# ========================================

# ===== 只需修改这一行：改成你的项目目录 =====
PROJECT_DIR="/www/wwwroot/default"

# ===== 可选：GITHUB加速镜像 (建议启用以解决连接中断) =====
GITHUB_REPO="https://mirror.ghproxy.com/https://github.com/BiuBiu622/147258yu.git"
# GITHUB_REPO="https://github.com/BiuBiu622/147258yu.git"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始更新..."

cd "$PROJECT_DIR" || { echo "错误: 目录不存在"; exit 1; }

# Git 全局配置优化 (解决大文件或弱网导致的 TLS 中断)
git config --global http.postBuffer 524288000
git config --global http.lowSpeedLimit 0
git config --global http.lowSpeedTime 999999

# 定义带重试功能的执行函数
run_git_with_retry() {
    local cmd=$1
    local max=5
    local n=0
    while [ $n -lt $max ]; do
        n=$((n + 1))
        if eval "$cmd"; then
            return 0
        fi
        echo "连接失败，正在进行第 $n 次重试..."
        sleep 5
    done
    return 1
}

# 首次部署：自动克隆仓库
if [ ! -d ".git" ]; then
    echo "首次部署，正在初始化下载..."
    rm -rf temp_clone
    if run_git_with_retry "git clone \"$GITHUB_REPO\" temp_clone"; then
        cp -r temp_clone/* . 2>/dev/null
        cp -r temp_clone/.* . 2>/dev/null
        rm -rf temp_clone
        echo "首次部署初始化成功！"
    else
        echo "错误: 首次下载失败，请手动检查网络。"
        exit 1
    fi
else
    # 更新：带有重试机制的拉取
    echo "正在拉取最新代码..."
    if run_git_with_retry "git fetch --all"; then
        git reset --hard origin/main
        echo "更新完成！"
    else
        echo "错误: 更新失败，已达到最大重试次数。"
        exit 1
    fi
fi

# 重启服务（可选，取消下面注释即可启用）
# echo "正在重启服务..."
# pm2 restart all

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 执行完毕"
