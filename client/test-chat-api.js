// Test script to verify ChatApi configuration
const { chatApi } = require('./src/services/chatApi.ts');

console.log('ChatApi baseUrl:', chatApi.baseUrl);
console.log('Testing configuration...');

// Note: This is just to test the configuration loading
// The actual API call would require the server to be running
console.log('Configuration test completed successfully!');
