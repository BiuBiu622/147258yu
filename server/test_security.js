import http from 'http';

const testUrl = 'http://localhost:8080/account-status.html';
console.log(`正在测试受限 URL: ${testUrl}`);

http.get(testUrl, (res) => {
    console.log(`状态码: ${res.statusCode}`);
    console.log('响应头:', res.headers);

    if (res.statusCode === 302 && res.headers.location === '/license.html') {
        console.log('✅ 测试成功: 非法访问被正确重定向到授权页');
    } else {
        console.log('❌ 测试失败: 未达到预期重定向目标');
    }
    process.exit(0);
}).on('error', (e) => {
    console.error(`测试出错: ${e.message}`);
    process.exit(1);
});
