import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import config from "config";
import { Db } from "mongodb";
import { UserDAO, UserDocument } from "../dao/user-dao";

const SALT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Kept low (rather than a stronger 8+) so the seeded legacy test account
// (email matthew@backbet.co.uk, password "beyer" — the same 5-char password
// that was hardcoded pre-signup) can be created through this same validated
// signup path instead of a separate unvalidated seeding backdoor.
const MIN_PASSWORD_LENGTH = 5;

export class AuthError extends Error {
  public status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class AuthService {
  private userDao: UserDAO;

  constructor(db: Db) {
    this.userDao = new UserDAO(db);
  }

  public async createIndexes(): Promise<void> {
    await this.userDao.createIndexes();
  }

  public async signup(email: string, password: string): Promise<string> {
    this.validateSignup(email, password);
    const existing = await this.userDao.findByEmail(email);
    if (existing) {
      throw new AuthError("An account with that email already exists", 409);
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await this.userDao.createUser(email, passwordHash);
    return this.issueToken(user);
  }

  public async login(email: string, password: string): Promise<string> {
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
    return this.issueToken(user);
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
