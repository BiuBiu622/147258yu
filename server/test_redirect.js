import http from 'http';

const testUrl = 'http://localhost:8080/license.html?t=' + Date.now();
console.log(`正在测试 URL: ${testUrl}`);

http.get(testUrl, (res) => {
    console.log(`状态码: ${res.statusCode}`);
    console.log('响应头:', res.headers);

    if (res.statusCode === 200) {
        console.log('✅ 测试成功: 页面返回 200');
    } else if (res.statusCode === 302) {
        console.log(`❌ 测试失败: 页面重定向到 ${res.headers.location}`);
    } else {
        console.log(`⚠️ 测试异常: 返回码 ${res.statusCode}`);
    }
    process.exit(0);
}).on('error', (e) => {
    console.error(`测试出错: ${e.message}`);
    process.exit(1);
});
