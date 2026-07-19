import { Collection, Db, ObjectId } from "mongodb";

export interface UserDocument {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  createdAt: Date;
  emailVerified: boolean;
  verificationToken: string | null;
  verificationTokenExpiresAt: Date | null;
}

export class UserDAO {
  private collection: Collection<UserDocument>;

  constructor(db: Db, collectionName = "users") {
    this.collection = db.collection<UserDocument>(collectionName);
  }

  public async createIndexes(): Promise<void> {
    await this.collection.createIndex({ email: 1 }, { unique: true });
    // Sparse: most documents end up with verificationToken: null once
    // verified, and there's no uniqueness requirement here (a stale/expired
    // token being looked up and found is handled by the expiry check in
    // AuthService, not by the index) — sparse just keeps the index small.
    await this.collection.createIndex({ verificationToken: 1 }, { sparse: true });
  }

  public async findByEmail(email: string): Promise<UserDocument | null> {
    return this.collection.findOne({ email: email.toLowerCase() });
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
    };
    const result = await this.collection.insertOne(doc as UserDocument);
    return { ...doc, _id: result.insertedId };
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
