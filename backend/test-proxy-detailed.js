const axios = require('axios');
const { ProxyAgent } = require('proxy-agent');

console.log('=== 详细代理诊断 ===\n');

// 检查环境变量
console.log('1. 环境变量:');
console.log('   HTTP_PROXY:', process.env.HTTP_PROXY || '未设置');
console.log('   HTTPS_PROXY:', process.env.HTTPS_PROXY || '未设置');
console.log('   NO_PROXY:', process.env.NO_PROXY || '未设置');
console.log();

// 测试不同的代理配置
async function testWithProxy() {
  console.log('2. 使用ProxyAgent测试:');

  const proxyAgent = new ProxyAgent({
    keepAlive: true,
    timeout: 15000
  });

  const axiosInstance = axios.create({
    httpAgent: proxyAgent,
    httpsAgent: proxyAgent,
    timeout: 15000
  });

  try {
    console.log('   测试 httpbin.org (简单HTTP测试)...');
    const response = await axiosInstance.get('http://httpbin.org/ip', { timeout: 10000 });
    console.log('   ✓ 成功! IP:', response.data.origin);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }

  try {
    console.log('   测试 api.ipify.org (获取公网IP)...');
    const response = await axiosInstance.get('https://api.ipify.org?format=json', { timeout: 10000 });
    console.log('   ✓ 成功! IP:', response.data.ip);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }
}

async function testWithoutProxy() {
  console.log('\n3. 不使用代理测试 (直连):');

  const axiosInstance = axios.create({
    proxy: false,
    timeout: 10000
  });

  try {
    console.log('   测试 baidu.com...');
    const response = await axiosInstance.get('https://www.baidu.com', { timeout: 5000 });
    console.log('   ✓ 成功! 状态码:', response.status);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }
}

async function testProxyConnection() {
  console.log('\n4. 测试代理端口连接:');

  const net = require('net');
  const proxyHost = '127.0.0.1';
  const proxyPort = 10809;

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: proxyHost, port: proxyPort }, () => {
      console.log(`   ✓ 代理端口 ${proxyHost}:${proxyPort} 可以连接`);
      socket.end();
      resolve(true);
    });

    socket.on('error', (err) => {
      console.log(`   ✗ 代理端口 ${proxyHost}:${proxyPort} 连接失败:`, err.message);
      resolve(false);
    });

    socket.setTimeout(3000, () => {
      console.log(`   ✗ 代理端口 ${proxyHost}:${proxyPort} 连接超时`);
      socket.destroy();
      resolve(false);
    });
  });
}

async function main() {
  await testProxyConnection();
  await testWithProxy();
  await testWithoutProxy();
  console.log('\n=== 诊断完成 ===');
}

main().catch(console.error);
