// Client-side configuration for React Native/Expo
// This replaces the Node.js 'config' package which doesn't work in React Native

interface Config {
  baseUrl: string;
}

// Environment detection
const getEnvironment = (): string => {
  // Check for environment variable (for build-time configuration)
  if (typeof process !== 'undefined' && process.env.NODE_ENV) {
    return process.env.NODE_ENV;
  }
  
  // Default to development
  return 'development';
};

// Configuration based on environment
const getConfig = (): Config => {
  const env = getEnvironment();
  
  switch (env) {
    case 'production':
      return {
        baseUrl: 'http://51.20.109.194/'
      };
    case 'development':
    default:
      return {
        baseUrl: 'http://localhost:3000'
      };
  }
};

export const config = getConfig();
