interface Config {
  baseUrl: string;
}

// Use hostname to detect environment — avoids build-time NODE_ENV which is
// always "development" when using `expo export --dev`.
const getConfig = (): Config => {
  // EXPO_PUBLIC_API_URL is baked in at build time by `expo export`.
  // Set it when deploying to S3/CloudFront (cross-origin from the Lambda API).
  if (process.env.EXPO_PUBLIC_API_URL) {
    return { baseUrl: process.env.EXPO_PUBLIC_API_URL };
  }
  if (
    typeof window !== 'undefined' &&
    !['localhost', '127.0.0.1'].includes(window.location.hostname)
  ) {
    // Served from the production domain — use same-origin relative URLs so
    // API calls go to the same Express server that served the page.
    return { baseUrl: '' };
  }
  return { baseUrl: 'http://localhost:3000' };
};

export const config = getConfig();
