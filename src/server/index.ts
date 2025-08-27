import app from './app';
import config from 'config';

const PORT = config.get('server.port') || 3000;
const HOST = config.get('server.host') || 'localhost';

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
  console.log(`📊 Health check: http://${HOST}:${PORT}/health`);
  console.log(`🔍 API endpoint: http://${HOST}:${PORT}/api/query`);
  console.log(`🐎 Horses endpoint: http://${HOST}:${PORT}/api/horses/top`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

export default server;
