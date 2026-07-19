import twilio from "twilio";
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

const PHONE_RE = /^\+[1-9]\d{6,14}$/; // E.164 — Twilio Verify requires this format

// Wraps Twilio's Verify API (not raw SNS) specifically so Twilio owns code
// generation, expiry, and retry-limiting for us — our side just calls
// "start" and "check" against a Verify Service.
export class SmsService {
  private client: ReturnType<typeof twilio> | null;
  private verifyServiceSid: string;

  constructor() {
    const accountSid = readConfigString("twilio.accountSid");
    const authToken = readConfigString("twilio.authToken");
    this.verifyServiceSid = readConfigString("twilio.verifyServiceSid");
    this.client = accountSid && authToken ? twilio(accountSid, authToken) : null;
  }

  public validatePhone(phone: string): void {
    if (!PHONE_RE.test(phone)) {
      throw new AuthError("Phone number must be in E.164 format, e.g. +14155551234", 400);
    }
  }

  public async sendCode(phone: string): Promise<void> {
    this.validatePhone(phone);
    if (!this.client || !this.verifyServiceSid) {
      throw new AuthError("SMS sign-in is not configured", 503);
    }
    try {
      await this.client.verify.v2.services(this.verifyServiceSid).verifications.create({
        to: phone,
        channel: "sms",
      });
    } catch (error) {
      console.error(`SmsService: failed to send code to ${phone}:`, error);
      throw new AuthError("Failed to send verification code", 502);
    }
  }

  // Returns whether the code was correct — never throws for a wrong code
  // (that's an expected, common case, not a server error).
  public async checkCode(phone: string, code: string): Promise<boolean> {
    this.validatePhone(phone);
    if (!this.client || !this.verifyServiceSid) {
      throw new AuthError("SMS sign-in is not configured", 503);
    }
    if (!code) {
      throw new AuthError("Verification code is required", 400);
    }
    try {
      const check = await this.client.verify.v2
        .services(this.verifyServiceSid)
        .verificationChecks.create({ to: phone, code });
      return check.status === "approved";
    } catch (error) {
      // Twilio returns a 404-shaped error for an unknown/expired
      // verification attempt (e.g. checking a code after it expired with
      // no pending verification) — treat that the same as "wrong code"
      // rather than a server error.
      return false;
    }
  }
}
