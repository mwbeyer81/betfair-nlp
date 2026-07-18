import { Collection, Db, ObjectId } from "mongodb";

export interface UserDocument {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export class UserDAO {
  private collection: Collection<UserDocument>;

  constructor(db: Db, collectionName = "users") {
    this.collection = db.collection<UserDocument>(collectionName);
  }

  public async createIndexes(): Promise<void> {
    await this.collection.createIndex({ email: 1 }, { unique: true });
  }

  public async findByEmail(email: string): Promise<UserDocument | null> {
    return this.collection.findOne({ email: email.toLowerCase() });
  }

  public async createUser(email: string, passwordHash: string): Promise<UserDocument> {
    const doc = {
      email: email.toLowerCase(),
      passwordHash,
      createdAt: new Date(),
    };
    const result = await this.collection.insertOne(doc as UserDocument);
    return { ...doc, _id: result.insertedId };
  }
}
