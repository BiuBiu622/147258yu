#!/bin/bash

# 授权管理端启动脚本（Linux/Mac）
# 使用方法：chmod +x start-server.sh && ./start-server.sh

echo "========================================"
echo "  授权管理端启动脚本"
echo "========================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "✗ 错误：未找到 Node.js"
    echo "  请先安装 Node.js: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✓ Node.js 版本: $NODE_VERSION"

# 检查必需文件
REQUIRED_FILES=(
    "独立管理端/server.js"
    "核心/授权API.js"
    "核心/授权验证.js"
    "核心/授权加密.js"
    "核心/机器码生成.js"
    "数据/all_licenses.json"
)

MISSING=0
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "✗ 缺失文件: $file"
        MISSING=1
    fi
done

if [ $MISSING -eq 1 ]; then
    echo ""
    echo "✗ 错误：部分必需文件缺失"
    echo "  请确保所有文件已正确上传到服务器"
    exit 1
fi

echo "✓ 所有必需文件完整"
echo ""

# 进入管理端目录
cd 独立管理端 || exit 1

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "正在安装依赖..."
    npm install
    if [ $? -ne 0 ]; then
        echo "✗ 依赖安装失败"
        exit 1
    fi
    echo "✓ 依赖安装完成"
    echo ""
fi

# 询问启动方式
echo "请选择启动方式："
echo "  1) 直接启动 (前台运行，适合测试)"
echo "  2) PM2 启动 (后台运行，推荐生产环境)"
echo "  3) 仅显示 PM2 命令 (手动执行)"
echo ""
read -p "请输入选项 [1-3]: " choice

case $choice in
    1)
        echo ""
        echo "正在启动服务..."
        echo "按 Ctrl+C 停止服务"
        echo ""
        node server.js
        ;;
    2)
        if ! command -v pm2 &> /dev/null; then
            echo ""
            echo "✗ 未找到 PM2"
            echo "  正在安装 PM2..."
            npm install -g pm2
            if [ $? -ne 0 ]; then
                echo "✗ PM2 安装失败"
                exit 1
            fi
        fi
        
        echo ""
        echo "正在使用 PM2 启动服务..."
        pm2 start server.js --name "license-admin"
        
        echo ""
        echo "✓ 服务已启动"
        echo ""
        echo "常用命令："
        echo "  查看状态: pm2 status"
        echo "  查看日志: pm2 logs license-admin"
        echo "  重启服务: pm2 restart license-admin"
        echo "  停止服务: pm2 stop license-admin"
        echo "  删除服务: pm2 delete license-admin"
        echo ""
        echo "设置开机自启："
        echo "  pm2 startup"
        echo "  pm2 save"
        ;;
    3)
        echo ""
        echo "PM2 启动命令："
        echo "  cd 独立管理端"
        echo "  pm2 start server.js --name \"license-admin\""
        echo "  pm2 startup  # 设置开机自启"
        echo "  pm2 save     # 保存配置"
        echo ""
        ;;
    *)
        echo "✗ 无效选项"
        exit 1
        ;;
esac

echo ""
echo "========================================"
echo "  访问地址: http://localhost:3100"
echo "  或: http://$(hostname -I | awk '{print $1}'):3100"
echo "========================================"
