import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import config from "config";
import { Db, ObjectId } from "mongodb";
import { UserDAO, UserDocument } from "../dao/user-dao";
import { grantsFor, PermissionKey } from "../auth/permissions";
import { EmailService } from "./email-service";
import { GoogleAuthService } from "./google-auth-service";
import { SmsService } from "./sms-service";

const SALT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Kept low (rather than a stronger 8+) so the seeded legacy test account
// (email matthew@backbet.co.uk, password "beyer" — the same 5-char password
// that was hardcoded pre-signup) can be created through this same validated
// signup path instead of a separate unvalidated seeding backdoor.
const MIN_PASSWORD_LENGTH = 5;
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export class AuthError extends Error {
  public status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface AuthResult {
  token: string;
  emailVerified: boolean;
}

export class AuthService {
  private userDao: UserDAO;
  private emailService: EmailService;
  private googleAuthService: GoogleAuthService;
  private smsService: SmsService;

  constructor(
    db: Db,
    emailService?: EmailService,
    googleAuthService?: GoogleAuthService,
    smsService?: SmsService
  ) {
    this.userDao = new UserDAO(db);
    this.emailService = emailService ?? new EmailService();
    this.googleAuthService = googleAuthService ?? new GoogleAuthService();
    this.smsService = smsService ?? new SmsService();
  }

  public async createIndexes(): Promise<void> {
    await this.userDao.createIndexes();
  }

  public async signup(email: string, password: string): Promise<AuthResult> {
    this.validateSignup(email, password);
    const existing = await this.userDao.findByEmail(email);
    if (existing) {
      throw new AuthError("An account with that email already exists", 409);
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const verificationToken = this.generateVerificationToken();
    const verificationTokenExpiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
    const user = await this.userDao.createUser(email, passwordHash, verificationToken, verificationTokenExpiresAt);
    // Best-effort — never blocks signup (see EmailService.sendVerificationEmail).
    // Uses the validated `email` param directly rather than `user.email`
    // (now optional on UserDocument for Google/phone-only accounts) —
    // this specific creation path always has one.
    await this.emailService.sendVerificationEmail(email, verificationToken);
    return { token: this.issueToken(user), emailVerified: false };
  }

  public async login(email: string, password: string): Promise<AuthResult> {
    if (!email || !password) {
      throw new AuthError("Email and password are required", 400);
    }
    const user = await this.userDao.findByEmail(email);
    // No passwordHash means this account was created via Google or phone
    // sign-in — it has no password to check against, same as "not found"
    // from the caller's perspective.
    if (!user || !user.passwordHash) {
      throw new AuthError("Invalid email or password", 401);
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new AuthError("Invalid email or password", 401);
    }
    return { token: this.issueToken(user), emailVerified: user.emailVerified };
  }

  public async verifyEmail(token: string): Promise<{ email: string }> {
    if (!token) {
      throw new AuthError("Verification token is required", 400);
    }
    const user = await this.userDao.findByVerificationToken(token);
    if (!user) {
      throw new AuthError("Invalid or expired verification link", 400);
    }
    if (user.verificationTokenExpiresAt && user.verificationTokenExpiresAt.getTime() < Date.now()) {
      throw new AuthError("This verification link has expired — request a new one", 400);
    }
    if (!user.email) {
      // Shouldn't happen — verificationToken is only ever set on
      // email-based accounts — but a corrupted/manually-edited record
      // shouldn't crash this with a confusing type error.
      throw new AuthError("This account has no email address", 400);
    }
    await this.userDao.markEmailVerified(user._id);
    return { email: user.email };
  }

  // Keyed by user id (from the JWT's `sub` claim), not email — a phone-only
  // or some Google accounts have no email at all, so email can't be the
  // universal lookup key the way it used to be when every account had one.
  public async getMe(
    userId: string
  ): Promise<{
    email: string | null;
    phone: string | null;
    emailVerified: boolean;
    permissions: PermissionKey[];
    isAdmin: boolean;
  } | null> {
    const user = await this.userDao.findById(new ObjectId(userId));
    if (!user) return null;
    // Effective permissions, with admin's implications already expanded —
    // the client should never have to know that admin implies anything.
    const permissions = grantsFor(user.permissions);
    return {
      email: user.email ?? null,
      phone: user.phone ?? null,
      emailVerified: user.emailVerified,
      permissions,
      // Kept alongside the list because it's what most callers actually ask,
      // and deriving it in one place beats every caller doing
      // `permissions.includes("admin")` slightly differently.
      isAdmin: permissions.includes("admin"),
    };
  }

  /**
   * The authorization check behind every permissioned route. Deliberately
   * hits the database on each call instead of trusting a claim in the JWT: a
   * token issued before a permission was granted (or after it was revoked)
   * must reflect the current state immediately, and tokens here are
   * long-lived enough that baking permissions in would leave a revoked admin
   * authorized until their token expired.
   *
   * Returns an empty list for a malformed/unknown userId rather than
   * throwing — callers turn that into a 403, which is the correct answer
   * either way.
   */
  public async getPermissions(userId: string): Promise<PermissionKey[]> {
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(userId);
    } catch {
      return [];
    }
    const user = await this.userDao.findById(objectId);
    return grantsFor(user?.permissions);
  }

  public async hasPermission(userId: string, required: PermissionKey): Promise<boolean> {
    return (await this.getPermissions(userId)).includes(required);
  }

  /**
   * Every account and the permissions it holds — the data behind the
   * permissions matrix. Admin-gated at the route, not here.
   *
   * `stored` is what the document literally carries; `effective` is what it
   * actually grants once admin's implications are expanded. Showing both is
   * the point of the matrix: a cell can be ticked because it was granted or
   * because admin implies it, and those are different facts.
   */
  public async listAccountPermissions(): Promise<
    { id: string; email: string | null; phone: string | null; stored: string[]; effective: PermissionKey[] }[]
  > {
    const users = await this.userDao.listAll();
    return users
      .map(user => ({
        id: String(user._id),
        email: user.email ?? null,
        phone: user.phone ?? null,
        stored: (user.permissions ?? []).slice(),
        effective: grantsFor(user.permissions),
      }))
      // Accounts with permissions first, then alphabetically — a matrix of
      // 13 rows where the only interesting one is last is a worse matrix.
      .sort((a, b) => {
        if (a.effective.length !== b.effective.length) return b.effective.length - a.effective.length;
        return (a.email ?? a.phone ?? "").localeCompare(b.email ?? b.phone ?? "");
      });
  }

  public async resendVerification(userId: string): Promise<{ alreadyVerified: boolean }> {
    const user = await this.userDao.findById(new ObjectId(userId));
    if (!user) {
      throw new AuthError("Account not found", 404);
    }
    if (!user.email) {
      // Nothing to verify — this account signed up with a phone number
      // and/or Google, neither of which need the email verification flow.
      throw new AuthError("This account has no email address to verify", 400);
    }
    if (user.emailVerified) {
      return { alreadyVerified: true };
    }
    const verificationToken = this.generateVerificationToken();
    const verificationTokenExpiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
    await this.userDao.setVerificationToken(user._id, verificationToken, verificationTokenExpiresAt);
    await this.emailService.sendVerificationEmail(user.email, verificationToken);
    return { alreadyVerified: false };
  }

  // Verifies the Google-issued ID token, then finds-or-creates a user by
  // email. If an email/password account with the same email already
  // exists, this signs into *that* account (linking the googleId onto it)
  // rather than creating a duplicate — same person, same email, one
  // account regardless of which method they used this time.
  public async signInWithGoogle(idToken: string): Promise<AuthResult> {
    const payload = await this.googleAuthService.verifyIdToken(idToken);
    if (!payload.email && !payload.sub) {
      throw new AuthError("Google did not return an email or account id", 400);
    }
    let user = payload.email ? await this.userDao.findByEmail(payload.email) : null;
    if (!user && payload.sub) {
      user = await this.userDao.findByGoogleId(payload.sub);
    }
    if (user) {
      if (payload.sub && !user.googleId) {
        await this.userDao.linkGoogleId(user._id, payload.sub);
      }
      return { token: this.issueToken(user), emailVerified: user.emailVerified || !!payload.emailVerified };
    }
    const created = await this.userDao.createUserWithGoogle(payload.email ?? null, payload.sub);
    return { token: this.issueToken(created), emailVerified: created.emailVerified };
  }

  public async sendSmsCode(phone: string): Promise<void> {
    await this.smsService.sendCode(phone);
  }

  // Checks the code via Twilio Verify, then finds-or-creates a user by
  // phone and issues our own token — no password/email involved at all.
  public async verifySmsCode(phone: string, code: string): Promise<AuthResult> {
    const approved = await this.smsService.checkCode(phone, code);
    if (!approved) {
      throw new AuthError("Invalid or expired verification code", 401);
    }
    let user = await this.userDao.findByPhone(phone);
    if (!user) {
      user = await this.userDao.createUserWithPhone(phone);
    }
    return { token: this.issueToken(user), emailVerified: user.emailVerified };
  }

  private generateVerificationToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  private validateSignup(email: string, password: string): void {
    if (!email || !EMAIL_RE.test(email)) {
      throw new AuthError("A valid email address is required", 400);
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
    }
  }

  private issueToken(user: UserDocument): string {
    const secret = config.get<string>("jwt.secret");
    return jwt.sign({ sub: user._id.toString(), email: user.email }, secret, {
      expiresIn: "7d",
    });
  }
}
