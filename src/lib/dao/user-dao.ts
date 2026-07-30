import { Collection, Db, ObjectId } from "mongodb";

export interface UserDocument {
  _id: ObjectId;
  // Optional — a phone-only or some Google accounts may have no email at
  // all. At least one of email/phone/googleId is always present; enforced
  // in AuthService, not at the schema level.
  email?: string;
  passwordHash?: string;
  createdAt: Date;
  emailVerified: boolean;
  verificationToken: string | null;
  verificationTokenExpiresAt: Date | null;
  googleId?: string;
  phone?: string;
  phoneVerified: boolean;
}

export class UserDAO {
  private collection: Collection<UserDocument>;

  constructor(db: Db, collectionName = "users") {
    this.collection = db.collection<UserDocument>(collectionName);
  }

  public async createIndexes(): Promise<void> {
    // The original `email` index was unique but not sparse — fine when
    // every account had an email, but Google/phone-only signups may not
    // have one at all, and a non-sparse unique index only tolerates ONE
    // document with the field entirely missing before every subsequent
    // one collides. Drop the old definition if it's still in place before
    // recreating it sparse; a fresh or already-migrated collection just
    // no-ops here (dropIndex throws if the index doesn't exist/already
    // matches, caught and ignored).
    try {
      const indexes = await this.collection.indexes();
      const emailIndex = indexes.find((idx) => idx.name === "email_1");
      if (emailIndex && !emailIndex.sparse) {
        await this.collection.dropIndex("email_1");
      }
    } catch {
      // Collection/index doesn't exist yet, or already migrated — nothing to do.
    }
    await this.collection.createIndex({ email: 1 }, { unique: true, sparse: true });
    await this.collection.createIndex({ phone: 1 }, { unique: true, sparse: true });
    await this.collection.createIndex({ googleId: 1 }, { unique: true, sparse: true });
    // Sparse: most documents end up with verificationToken: null once
    // verified, and there's no uniqueness requirement here (a stale/expired
    // token being looked up and found is handled by the expiry check in
    // AuthService, not by the index) — sparse just keeps the index small.
    await this.collection.createIndex({ verificationToken: 1 }, { sparse: true });
  }

  public async findByEmail(email: string): Promise<UserDocument | null> {
    return this.collection.findOne({ email: email.toLowerCase() });
  }

  public async findById(userId: ObjectId): Promise<UserDocument | null> {
    return this.collection.findOne({ _id: userId });
  }

  public async findByPhone(phone: string): Promise<UserDocument | null> {
    return this.collection.findOne({ phone });
  }

  public async findByGoogleId(googleId: string): Promise<UserDocument | null> {
    return this.collection.findOne({ googleId });
  }

  public async findByVerificationToken(token: string): Promise<UserDocument | null> {
    return this.collection.findOne({ verificationToken: token });
  }

  public async createUser(
    email: string,
    passwordHash: string,
    verificationToken: string,
    verificationTokenExpiresAt: Date
  ): Promise<UserDocument> {
    const doc = {
      email: email.toLowerCase(),
      passwordHash,
      createdAt: new Date(),
      emailVerified: false,
      verificationToken,
      verificationTokenExpiresAt,
      phoneVerified: false,
    };
    const result = await this.collection.insertOne(doc as UserDocument);
    return { ...doc, _id: result.insertedId };
  }

  // Google already proved the user owns this email — created pre-verified,
  // no password (this account can only ever sign in via Google), no
  // verification token/email round trip needed.
  public async createUserWithGoogle(email: string | null, googleId: string): Promise<UserDocument> {
    const doc: Omit<UserDocument, "_id"> = {
      ...(email ? { email: email.toLowerCase() } : {}),
      googleId,
      createdAt: new Date(),
      emailVerified: !!email,
      verificationToken: null,
      verificationTokenExpiresAt: null,
      phoneVerified: false,
    };
    const result = await this.collection.insertOne(doc as UserDocument);
    return { ...doc, _id: result.insertedId };
  }

  // Twilio Verify already proved the user controls this phone number —
  // created pre-verified, no password (phone-only sign-in), no email.
  public async createUserWithPhone(phone: string): Promise<UserDocument> {
    const doc: Omit<UserDocument, "_id"> = {
      phone,
      createdAt: new Date(),
      emailVerified: false,
      verificationToken: null,
      verificationTokenExpiresAt: null,
      phoneVerified: true,
    };
    const result = await this.collection.insertOne(doc as UserDocument);
    return { ...doc, _id: result.insertedId };
  }

  public async linkGoogleId(userId: ObjectId, googleId: string): Promise<void> {
    await this.collection.updateOne({ _id: userId }, { $set: { googleId } });
  }

  public async markEmailVerified(userId: ObjectId): Promise<void> {
    await this.collection.updateOne(
      { _id: userId },
      { $set: { emailVerified: true, verificationToken: null, verificationTokenExpiresAt: null } }
    );
  }

  public async setVerificationToken(
    userId: ObjectId,
    verificationToken: string,
    verificationTokenExpiresAt: Date
  ): Promise<void> {
    await this.collection.updateOne(
      { _id: userId },
      { $set: { verificationToken, verificationTokenExpiresAt } }
    );
  }
}
