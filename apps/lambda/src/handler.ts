import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { connectDb, getSummaryStats } from '@backbet/shared';

let connected = false;

const json = (statusCode: number, body: object): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!connected) {
      await connectDb();
      connected = true;
    }
    const data = await getSummaryStats();
    return json(200, { success: true, data, source: 'lambda' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Handler error:', message);
    return json(503, { success: false, error: message });
  }
};
