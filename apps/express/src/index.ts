import express from 'express';
import { connectDb, getSummaryStats } from '@backbet/shared';
import { jwtAuth, corsMiddleware, helmetMiddleware } from '../../src/server/middleware';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(corsMiddleware);
app.use(helmetMiddleware);

app.get('/api/stats', jwtAuth, async (_req: Request, res: Response) => {
  const data = await getSummaryStats();
  res.json({ success: true, data });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

async function main() {
  await connectDb();
  app.listen(PORT, () => console.log(`Express app listening on :${PORT}`));
}

main().catch(console.error);
