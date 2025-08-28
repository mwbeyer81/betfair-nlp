const config = require('config');

console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('baseUrl from config:', config.get('baseUrl'));
console.log('All config:', JSON.stringify(config, null, 2));
