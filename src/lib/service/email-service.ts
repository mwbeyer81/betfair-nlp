import config from "config";

const RESEND_API_URL = "https://api.resend.com/emails";

function readConfigString(key: string): string {
  try {
    const value = config.get<string>(key);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

// Wraps the Resend API (https://resend.com) for transactional email. No
// email infrastructure existed in this repo before this — chosen over AWS
// SES specifically to avoid SES's sandbox-mode recipient restriction
// (SES can only send to addresses you've manually verified until AWS
// grants production access, which can take a day; Resend has no
// equivalent gate once a sending domain is verified).
export class EmailService {
  private apiKey: string;
  private fromAddress: string;
  private apiBaseUrl: string;

  constructor() {
    this.apiKey = readConfigString("email.apiKey");
    this.fromAddress = readConfigString("email.fromAddress") || "BackBet <onboarding@resend.dev>";
    this.apiBaseUrl = readConfigString("app.apiUrl") || "http://localhost:3000";
  }

  // Never throws — signup must succeed regardless of whether the
  // verification email actually goes out (missing API key, Resend being
  // down, a bad `to` address, etc. are all non-fatal here).
  public async sendVerificationEmail(email: string, token: string): Promise<void> {
    if (!this.apiKey) {
      console.warn(
        `EmailService: email.apiKey not configured — skipping verification email to ${email} (non-fatal, signup still succeeds)`
      );
      return;
    }
    const verifyUrl = `${this.apiBaseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
    try {
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: [email],
          subject: "Verify your BackBet email",
          html: this.renderVerificationEmailHtml(verifyUrl),
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(`EmailService: Resend API returned ${response.status} sending to ${email}: ${body}`);
      } else {
        // Resend returns { id } on success — logged so a specific send's
        // actual delivery status can be checked later via
        // GET https://api.resend.com/emails/{id} (not queryable at all
        // without this, since Resend's API is the only source of truth
        // for what happened after acceptance — bounced, delivered, etc.).
        const body = await response.json().catch(() => null) as { id?: string } | null;
        console.log(`EmailService: Resend accepted send to ${email}, id=${body?.id ?? "unknown"}`);
      }
    } catch (error) {
      console.error(`EmailService: failed to send verification email to ${email}:`, error);
    }
  }

  private renderVerificationEmailHtml(verifyUrl: string): string {
    return `<!DOCTYPE html>
<html>
  <body style="font-family: sans-serif; background:#f0f4f8; padding: 2rem; margin: 0;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;">
      <h1 style="color:#0B3D2E;font-size:1.5rem;margin-top:0;">Verify your email</h1>
      <p style="color:#4a5568;">Thanks for signing up for BackBet — confirm your email address to keep your account secure and make sure you can recover it later.</p>
      <p style="margin: 2rem 0;">
        <a href="${verifyUrl}" style="background:#2F6B4F;color:#fff;padding:0.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Verify Email</a>
      </p>
      <p style="color:#94a3b8;font-size:0.85rem;">This link expires in 24 hours. If you didn't sign up for BackBet, you can safely ignore this email.</p>
    </div>
  </body>
</html>`;
  }
}
