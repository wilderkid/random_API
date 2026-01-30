// 模拟server.js的代理配置
const axios = require('axios');

console.log('=== 模拟server.js代理配置测试 ===\n');

// 检测代理环境变量
const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || httpProxy;

console.log('环境变量:');
console.log('  HTTP_PROXY:', httpProxy || '未设置');
console.log('  HTTPS_PROXY:', httpsProxy || '未设置');
console.log();

// 配置axios代理（与server.js相同的逻辑）
if (httpProxy || httpsProxy) {
  const proxyUrl = new URL(httpsProxy || httpProxy);

  axios.defaults.proxy = {
    protocol: proxyUrl.protocol.replace(':', ''),
    host: proxyUrl.hostname,
    port: parseInt(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80),
    auth: proxyUrl.username && proxyUrl.password ? {
      username: proxyUrl.username,
      password: proxyUrl.password
    } : undefined
  };

  console.log('[Proxy] Proxy detected and configured:');
  console.log(`[Proxy]   Protocol: ${proxyUrl.protocol.replace(':', '')}`);
  console.log(`[Proxy]   Host: ${proxyUrl.hostname}`);
  console.log(`[Proxy]   Port: ${proxyUrl.port || (proxyUrl.protocol === 'https:' ? 443 : 80)}`);
} else {
  console.log('[Proxy] No proxy configured, using direct connection');
}

axios.defaults.timeout = 30000;

console.log();

// 测试连接
async function runTests() {
  console.log('开始测试...\n');

  // 测试1: 国内网站
  try {
    console.log('1. 测试 baidu.com (国内网站):');
    const response = await axios.get('https://www.baidu.com', { timeout: 5000 });
    console.log('   ✓ 成功! 状态码:', response.status);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }

  // 测试2: 国际网站
  try {
    console.log('\n2. 测试 google.com (国际网站):');
    const response = await axios.get('https://www.google.com', { timeout: 8000 });
    console.log('   ✓ 成功! 状态码:', response.status);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }

  // 测试3: OpenAI API
  try {
    console.log('\n3. 测试 OpenAI API (需要VPN):');
    const response = await axios.get('https://api.openai.com/v1/models', {
      headers: { 'Authorization': 'Bearer test' },
      timeout: 8000,
      validateStatus: () => true
    });
    console.log('   ✓ 连接成功! 状态码:', response.status);
    if (response.status === 401 || response.status === 400) {
      console.log('   ℹ API密钥无效，但连接成功（这是正常的）');
    }
  } catch (error) {
    console.log('   ✗ 连接失败:', error.code || error.message);
  }

  // 测试4: 获取公网IP
  try {
    console.log('\n4. 测试 ipify.org (获取公网IP):');
    const response = await axios.get('https://api.ipify.org?format=json', { timeout: 8000 });
    console.log('   ✓ 成功! 你的公网IP:', response.data.ip);
    console.log('   ℹ 如果显示的是国外IP，说明代理正在工作');
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }

  // 测试5: 模拟刷新模型请求
  try {
    console.log('\n5. 模拟刷新模型请求 (httpbin.org):');
    const response = await axios.get('http://httpbin.org/ip', { timeout: 8000 });
    console.log('   ✓ 成功! IP:', response.data.origin);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }

  console.log('\n=== 测试完成 ===');
  console.log('\n总结:');
  console.log('- 如果所有测试都成功，说明代理配置正确');
  console.log('- 如果只有国内网站成功，说明代理可能有问题');
  console.log('- 如果OpenAI API连接成功，说明可以访问需要VPN的网站');
}

runTests().catch(console.error);
