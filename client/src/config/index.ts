interface Config {
  baseUrl: string;
}

// Use hostname to detect environment — avoids build-time NODE_ENV which is
// always "development" when using `expo export --dev`.
const getConfig = (): Config => {
  // EXPO_PUBLIC_API_URL is baked in at build time by `expo export`. Metro's
  // env-var inliner only recognizes plain `process.env.EXPO_PUBLIC_*` member
  // access — optional chaining (`process.env?.X`) is a different AST shape
  // that it won't statically replace, so the reference survives into the
  // browser bundle and always reads undefined from the empty runtime shim.
  // Guard against browser environments where `process` is not defined (e.g.
  // Storybook) with a `typeof` check instead, which doesn't break inlining.
  if (typeof process !== "undefined" && process.env.EXPO_PUBLIC_API_URL) {
    return { baseUrl: process.env.EXPO_PUBLIC_API_URL };
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
