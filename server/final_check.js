import http from 'http';

const options = {
    hostname: 'localhost',
    port: 8080,
    path: '/login.html',
    method: 'GET',
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
};

const req = http.request(options, (res) => {
    console.log(`[测试] 状态码: ${res.statusCode}`);
    console.log(`[测试] 重定向目标: ${res.headers.location || 'NONE'}`);
    process.exit(0);
});

req.on('error', (e) => {
    console.error(`[测试] 错误: ${e.message}`);
    process.exit(1);
});

req.end();
