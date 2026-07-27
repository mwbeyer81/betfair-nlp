import config from "config";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

function readConfigString(key: string): string {
  try {
    const value = config.get<string>(key);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export interface PredictionRunnerInput {
  raceId: string;
  runnerId: string;
  course: string | null;
  going: string | null;
  raceType: string | null;
  raceClass: string | null;
  trainer: string | null;
  jockey: string | null;
  sex: string | null;
  hg: string | null;
  distanceFurlongs: number | null;
  ran: number | null;
  num: number | null;
  draw: number | null;
  trainerFormRuns: number | null;
  trainerFormWinRate: number | null;
  trainerFormStaked: number | null;
  trainerFormReturns: number | null;
  jockeyFormRuns: number | null;
  jockeyFormWinRate: number | null;
  jockeyFormStaked: number | null;
  jockeyFormReturns: number | null;
  officialRating: number | null;
  wgt: number | null;
  age: number | null;
  daysSinceLastRun: number | null;
  horseCareerRuns: number | null;
  horseCareerWinRate: number | null;
  horseAvgRPR: number | null;
  horseAvgTS: number | null;
  horseAvgBeatenDistance: number | null;
  horseAvgExcuseScore: number | null;
  horseTroubleInRunningRate: number | null;
  horseTravelledWellRate: number | null;
}

export interface PredictionApiResponse {
  status: number;
  ok: boolean;
  body: { modelVersionId: string; predictions: { runnerId: string; modelWinProbability: number }[] } | { error: string };
}

// Thin wrapper over the internal ml-prediction-api Lambda (apps/ml-api) —
// invoked directly via lambda:InvokeFunction (RequestResponse), never a
// public Function URL or API Gateway route, so this never touches the
// network beyond AWS's own SDK/IAM path. Mirrors racing-api-client.ts's
// shape (config-driven, returns {status, ok, body} instead of throwing on
// a handled error) even though the transport is InvokeCommand, not fetch.
export class PredictionApiClient {
  private functionName: string;
  private apiKey: string;
  private client: LambdaClient;

  constructor() {
    this.functionName = readConfigString("predictionApi.functionName") || "ml-prediction-api";
    this.apiKey = readConfigString("predictionApi.apiKey");
    const region = readConfigString("predictionApi.region") || "eu-north-1";
    this.client = new LambdaClient({ region });
  }

  public async predict(runners: PredictionRunnerInput[]): Promise<PredictionApiResponse> {
    const command = new InvokeCommand({
      FunctionName: this.functionName,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify({ apiKey: this.apiKey, runners })),
    });
    const result = await this.client.send(command);
    const raw = result.Payload ? Buffer.from(result.Payload).toString("utf-8") : "{}";
    const body = JSON.parse(raw) as PredictionApiResponse["body"];
    const ok = !result.FunctionError && !("error" in body);
    return { status: ok ? 200 : 502, ok, body };
  }
}
