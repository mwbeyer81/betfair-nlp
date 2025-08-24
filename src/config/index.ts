import config from "config";

// Configuration interface for type safety
export interface AppConfig {
  mongodb: {
    uri: string;
    dbName: string;
  };
  app: {
    name: string;
    version: string;
    environment: string;
  };
  logging: {
    level: string;
    enableConsole: boolean;
  };
}

// Export typed configuration
export const appConfig: AppConfig = {
  mongodb: {
    uri: config.get<string>("mongodb.uri"),
    dbName: config.get<string>("mongodb.dbName"),
  },
  app: {
    name: config.get<string>("app.name"),
    version: config.get<string>("app.version"),
    environment: config.get<string>("app.environment"),
  },
  logging: {
    level: config.get<string>("logging.level"),
    enableConsole: config.get<boolean>("logging.enableConsole"),
  },
};

// Helper functions for configuration access
export const getMongoUri = (): string => config.get<string>("mongodb.uri");
export const getMongoDbName = (): string =>
  config.get<string>("mongodb.dbName");
export const getAppEnvironment = (): string =>
  config.get<string>("app.environment");
export const getLogLevel = (): string => config.get<string>("logging.level");
export const isConsoleLoggingEnabled = (): boolean =>
  config.get<boolean>("logging.enableConsole");

// Check if configuration is valid
export const validateConfig = (): void => {
  const requiredKeys = [
    "mongodb.uri",
    "mongodb.dbName",
    "app.name",
    "app.version",
    "app.environment",
    "logging.level",
    "logging.enableConsole",
  ];

  for (const key of requiredKeys) {
    if (!config.has(key)) {
      throw new Error(`Missing required configuration key: ${key}`);
    }
  }
};
