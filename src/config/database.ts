import { MongoClient, Db } from "mongodb";
import { getMongoUri, getMongoDbName } from "./index";

export class MongoDB {
  private client: MongoClient;
  private db?: Db;
  private connected = false;
  private dbName: string;

  constructor(uri: string, dbName?: string) {
    this.client = new MongoClient(uri);
    this.dbName = dbName || "betfair_nlp";
  }

  async connect(): Promise<Db> {
    if (!this.connected) {
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      this.connected = true;
    }
    return this.db!;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    await this.client.close();
    this.connected = false;
  }
}

export class DatabaseConnection {
  private static instance: DatabaseConnection;
  private mongoDB: MongoDB;
  private db: Db | null = null;

  private constructor() {
    const mongoUri = getMongoUri();
    const dbName = getMongoDbName();
    this.mongoDB = new MongoDB(mongoUri, dbName);
  }

  public static getInstance(): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection();
    }
    return DatabaseConnection.instance;
  }

  public async connect(): Promise<void> {
    try {
      this.db = await this.mongoDB.connect();
      console.log("Connected to MongoDB");
    } catch (error) {
      console.error("Failed to connect to MongoDB:", error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.mongoDB.isConnected()) {
        await this.mongoDB.disconnect();
        this.db = null;
        console.log("Disconnected from MongoDB");
      }
    } catch (error) {
      console.error("Failed to disconnect from MongoDB:", error);
      throw error;
    }
  }

  public getDb(): Db {
    if (!this.db) {
      throw new Error("Database not connected. Call connect() first.");
    }
    return this.db;
  }

  public isConnected(): boolean {
    return this.mongoDB.isConnected();
  }
}
