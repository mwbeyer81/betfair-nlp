import { OAuth2Client } from "google-auth-library";
import config from "config";
import { AuthError } from "./auth-service";

function readConfigString(key: string): string {
  try {
    const value = config.get<string>(key);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
}

// Verifies a Google Identity Services ID token entirely client-side of
// Google's OAuth flow — the frontend gets a signed JWT directly from
// Google's own JS (no authorization-code exchange, no client secret
// anywhere), and this just checks that signature against Google's public
// keys plus confirms the token was actually issued for *our* client ID
// (google-auth-library handles both, including key rotation).
export class GoogleAuthService {
  private client: OAuth2Client | null;
  private clientId: string;

  constructor() {
    this.clientId = readConfigString("google.clientId");
    this.client = this.clientId ? new OAuth2Client(this.clientId) : null;
  }

  public async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    if (!this.client) {
      throw new AuthError("Google sign-in is not configured", 503);
    }
    if (!idToken) {
      throw new AuthError("Google ID token is required", 400);
    }
    let ticket;
    try {
      ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
    } catch (error) {
      throw new AuthError("Invalid Google ID token", 401);
    }
    const payload = ticket.getPayload();
    if (!payload || !payload.sub) {
      throw new AuthError("Invalid Google ID token", 401);
    }
    return {
      sub: payload.sub,
      email: payload.email ?? null,
      emailVerified: payload.email_verified === true,
    };
  }
}
