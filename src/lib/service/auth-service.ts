import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import config from "config";
import { Db } from "mongodb";
import { UserDAO, UserDocument } from "../dao/user-dao";
import { EmailService } from "./email-service";

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

  constructor(db: Db, emailService?: EmailService) {
    this.userDao = new UserDAO(db);
    this.emailService = emailService ?? new EmailService();
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
    await this.emailService.sendVerificationEmail(user.email, verificationToken);
    return { token: this.issueToken(user), emailVerified: false };
  }

  public async login(email: string, password: string): Promise<AuthResult> {
    if (!email || !password) {
      throw new AuthError("Email and password are required", 400);
    }
    const user = await this.userDao.findByEmail(email);
    if (!user) {
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
    await this.userDao.markEmailVerified(user._id);
    return { email: user.email };
  }

  public async getMe(email: string): Promise<{ email: string; emailVerified: boolean } | null> {
    const user = await this.userDao.findByEmail(email);
    if (!user) return null;
    return { email: user.email, emailVerified: user.emailVerified };
  }

  public async resendVerification(email: string): Promise<{ alreadyVerified: boolean }> {
    const user = await this.userDao.findByEmail(email);
    if (!user) {
      throw new AuthError("Account not found", 404);
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
