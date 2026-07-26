#!/usr/bin/env ts-node

// Inserts the hardcoded legacy test account directly into whatever Mongo
// MONGODB_URI/MONGODB_DB_NAME point at (see scripts/local-ci-e2e.sh — the
// throwaway CI database only). This bypasses AuthService.signup entirely,
// which is deliberately NOT done against the real dev/prod DB (see the
// comment in auth-service.ts about avoiding an "unvalidated seeding
// backdoor") — but here the target DB is destroyed and rebuilt on every
// run, so there's nothing to protect.

import bcrypt from "bcryptjs";
import { DatabaseConnection } from "../src/config/database";
import { UserDocument } from "../src/lib/dao/user-dao";

const EMAIL = "matthew@backbet.co.uk";
const PASSWORD = "beyer";
const SALT_ROUNDS = 10; // matches auth-service.ts

async function run() {
  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const db = dbConnection.getDb();

  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);
  const doc: Omit<UserDocument, "_id"> = {
    email: EMAIL,
    passwordHash,
    createdAt: new Date(),
    emailVerified: true,
    verificationToken: null,
    verificationTokenExpiresAt: null,
    phoneVerified: false,
  };

  await db.collection<UserDocument>("users").deleteMany({ email: EMAIL });
  await db.collection<UserDocument>("users").insertOne(doc as UserDocument);

  console.log(`Seeded test user ${EMAIL} / ${PASSWORD}`);
  await dbConnection.disconnect();
}

run().catch(error => {
  console.error("Seeding test user failed:", error);
  process.exit(1);
});
