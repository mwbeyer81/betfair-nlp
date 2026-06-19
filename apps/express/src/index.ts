import express, { Request, Response, NextFunction } from 'express';
import { connectDb, getSummaryStats } from '@backbet/shared';

const app = express();
const PORT = process.env.PORT ?? 3001;

function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user === 'matthew' && pass === 'beyer') { next(); return; }
  }
  res.set('WWW-Authenticate', 'Basic realm="backbet"').status(401).json({ success: false, error: 'Unauthorized' });
}

app.get('/api/stats', basicAuth, async (_req: Request, res: Response) => {
  const data = await getSummaryStats();
  res.json({ success: true, data });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

async function main() {
  await connectDb();
  app.listen(PORT, () => console.log(`Express app listening on :${PORT}`));
}

main().catch(console.error);
