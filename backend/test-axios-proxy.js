const axios = require('axios');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');

console.log('=== Axios代理测试 ===\n');

const proxyUrl = 'http://127.0.0.1:10809';

// 创建代理agent
const httpAgent = new HttpProxyAgent(proxyUrl);
const httpsAgent = new HttpsProxyAgent(proxyUrl, {
  rejectUnauthorized: false
});

console.log('代理配置:', proxyUrl);
console.log();

// 测试不同的axios配置
async function test1() {
  console.log('1. 测试基本配置:');
  try {
    const response = await axios.get('http://httpbin.org/ip', {
      httpAgent: httpAgent,
      timeout: 15000
    });
    console.log('   ✓ 成功! IP:', response.data.origin);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }
}

async function test2() {
  console.log('\n2. 测试HTTPS:');
  try {
    const response = await axios.get('https://api.ipify.org?format=json', {
      httpsAgent: httpsAgent,
      timeout: 15000
    });
    console.log('   ✓ 成功! IP:', response.data.ip);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }
}

async function test3() {
  console.log('\n3. 测试axios实例:');
  const instance = axios.create({
    httpAgent: httpAgent,
    httpsAgent: httpsAgent,
    timeout: 15000
  });

  try {
    const response = await instance.get('https://www.google.com');
    console.log('   ✓ 成功! 状态码:', response.status);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }
}

async function test4() {
  console.log('\n4. 测试OpenAI API:');
  const instance = axios.create({
    httpAgent: httpAgent,
    httpsAgent: httpsAgent,
    timeout: 15000
  });

  try {
    const response = await instance.get('https://api.openai.com/v1/models', {
      headers: { 'Authorization': 'Bearer test' },
      validateStatus: () => true
    });
    console.log('   ✓ 连接成功! 状态码:', response.status);
    if (response.status === 401) {
      console.log('   ℹ API密钥无效，但连接成功');
    }
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }
}

async function test5() {
  console.log('\n5. 测试默认配置:');

  // 设置axios默认配置
  axios.defaults.httpAgent = httpAgent;
  axios.defaults.httpsAgent = httpsAgent;
  axios.defaults.timeout = 15000;

  try {
    const response = await axios.get('https://api.ipify.org?format=json');
    console.log('   ✓ 成功! IP:', response.data.ip);
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
  }
}

async function main() {
  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  console.log('\n=== 测试完成 ===');
}

main().catch(console.error);
