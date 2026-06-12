const net = require('net');
[27017, 27019].forEach(port => {
  const s = net.connect({ host: '127.0.0.1', port }, () => {
    console.log(`127.0.0.1:${port} CONNECTED`);
    s.destroy();
  });
  s.on('error', e => console.log(`127.0.0.1:${port} ERROR: ${e.message}`));
  s.setTimeout(5000, () => { console.log(`127.0.0.1:${port} TIMEOUT`); s.destroy(); });
});