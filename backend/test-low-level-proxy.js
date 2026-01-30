const http = require('http');
const https = require('https');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

console.log('=== 底层代理测试 ===\n');

const proxyUrl = 'http://127.0.0.1:10809';

// 测试1: 使用http模块直接测试
function testHttpModule() {
  return new Promise((resolve) => {
    console.log('1. 使用http模块测试 (http://httpbin.org/ip):');

    const agent = new HttpProxyAgent(proxyUrl);

    const options = {
      hostname: 'httpbin.org',
      port: 80,
      path: '/ip',
      method: 'GET',
      agent: agent,
      timeout: 10000
    };

    const req = http.request(options, (res) => {
      console.log('   ✓ 连接成功! 状态码:', res.statusCode);

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log('   IP:', json.origin);
        } catch (e) {
          console.log('   响应:', data.substring(0, 100));
        }
        resolve(true);
      });
    });

    req.on('error', (error) => {
      console.log('   ✗ 失败:', error.code || error.message);
      resolve(false);
    });

    req.on('timeout', () => {
      console.log('   ✗ 超时');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// 测试2: 使用https模块测试
function testHttpsModule() {
  return new Promise((resolve) => {
    console.log('\n2. 使用https模块测试 (https://api.ipify.org):');

    const agent = new HttpsProxyAgent(proxyUrl, {
      rejectUnauthorized: false
    });

    const options = {
      hostname: 'api.ipify.org',
      port: 443,
      path: '/?format=json',
      method: 'GET',
      agent: agent,
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      console.log('   ✓ 连接成功! 状态码:', res.statusCode);

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log('   IP:', json.ip);
        } catch (e) {
          console.log('   响应:', data.substring(0, 100));
        }
        resolve(true);
      });
    });

    req.on('error', (error) => {
      console.log('   ✗ 失败:', error.code || error.message);
      resolve(false);
    });

    req.on('timeout', () => {
      console.log('   ✗ 超时');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// 测试3: 不使用代理直连
function testDirect() {
  return new Promise((resolve) => {
    console.log('\n3. 直连测试 (https://www.baidu.com):');

    const options = {
      hostname: 'www.baidu.com',
      port: 443,
      path: '/',
      method: 'GET',
      timeout: 5000
    };

    const req = https.request(options, (res) => {
      console.log('   ✓ 连接成功! 状态码:', res.statusCode);
      res.resume(); // 消费数据
      resolve(true);
    });

    req.on('error', (error) => {
      console.log('   ✗ 失败:', error.code || error.message);
      resolve(false);
    });

    req.on('timeout', () => {
      console.log('   ✗ 超时');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function main() {
  await testHttpModule();
  await testHttpsModule();
  await testDirect();
  console.log('\n=== 测试完成 ===');
}

main().catch(console.error);
