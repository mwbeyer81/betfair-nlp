interface Config {
  baseUrl: string;
}

// Use hostname to detect environment — avoids build-time NODE_ENV which is
// always "development" when using `expo export --dev`.
const getConfig = (): Config => {
  // EXPO_PUBLIC_API_URL is baked in at build time by `expo export`.
  // Set it when deploying to S3/CloudFront (cross-origin from the Lambda API).
  // Guard against browser environments where `process` is not defined (e.g. Storybook).
  const expoApiUrl =
    typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_API_URL : undefined;
  if (expoApiUrl) {
    return { baseUrl: expoApiUrl };
  }
  // Storybook stories mock API calls against http://localhost:3000 via MSW,
  // regardless of what host Storybook itself is served from (see preview-head.html).
  if (typeof window !== 'undefined' && (window as any).__STORYBOOK__) {
    return { baseUrl: 'http://localhost:3000' };
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
