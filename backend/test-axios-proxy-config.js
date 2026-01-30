const axios = require('axios');

console.log('=== Axios Proxy配置测试 ===\n');

// 方式1: 使用proxy配置对象
async function testProxyConfig() {
  console.log('1. 使用proxy配置对象:');

  const instance = axios.create({
    proxy: {
      protocol: 'http',
      host: '127.0.0.1',
      port: 10809
    },
    timeout: 15000
  });

  try {
    const response = await instance.get('http://httpbin.org/ip');
    console.log('   ✓ 成功! IP:', response.data.origin);
    return true;
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
    return false;
  }
}

// 方式2: 使用环境变量
async function testEnvProxy() {
  console.log('\n2. 使用环境变量 (axios自动检测):');

  // axios会自动读取HTTP_PROXY和HTTPS_PROXY环境变量
  const instance = axios.create({
    timeout: 15000
  });

  try {
    const response = await instance.get('https://api.ipify.org?format=json');
    console.log('   ✓ 成功! IP:', response.data.ip);
    return true;
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
    return false;
  }
}

// 方式3: 测试Google
async function testGoogle() {
  console.log('\n3. 测试Google (需要VPN):');

  const instance = axios.create({
    proxy: {
      protocol: 'http',
      host: '127.0.0.1',
      port: 10809
    },
    timeout: 15000
  });

  try {
    const response = await instance.get('https://www.google.com');
    console.log('   ✓ 成功! 状态码:', response.status);
    return true;
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
    return false;
  }
}

// 方式4: 测试OpenAI
async function testOpenAI() {
  console.log('\n4. 测试OpenAI API:');

  const instance = axios.create({
    proxy: {
      protocol: 'http',
      host: '127.0.0.1',
      port: 10809
    },
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
    return true;
  } catch (error) {
    console.log('   ✗ 失败:', error.code || error.message);
    return false;
  }
}

async function main() {
  console.log('环境变量:');
  console.log('  HTTP_PROXY:', process.env.HTTP_PROXY || '未设置');
  console.log('  HTTPS_PROXY:', process.env.HTTPS_PROXY || '未设置');
  console.log();

  const result1 = await testProxyConfig();
  const result2 = await testEnvProxy();
  const result3 = await testGoogle();
  const result4 = await testOpenAI();

  console.log('\n=== 测试结果 ===');
  console.log('proxy配置对象:', result1 ? '✓' : '✗');
  console.log('环境变量:', result2 ? '✓' : '✗');
  console.log('Google:', result3 ? '✓' : '✗');
  console.log('OpenAI:', result4 ? '✓' : '✗');
}

main().catch(console.error);
