#!/usr/bin/env ts-node

// Grants (or revokes) admin on one existing account, by email.
//
// This is the ONLY way an account becomes an admin: nothing in the signup,
// Google, phone or HTTP surface can set `isAdmin`, so admin cannot be
// self-granted or escalated to through the API — it takes database access
// and this command. See src/lib/dao/user-dao.ts's UserDocument.isAdmin.
//
// Usage:
//   MONGODB_URI=... MONGODB_DB_NAME=... yarn grant:admin <email>
//   MONGODB_URI=... MONGODB_DB_NAME=... yarn grant:admin <email> --revoke
//   MONGODB_URI=... MONGODB_DB_NAME=... yarn grant:admin --list
//
// Against production, MONGODB_URI is the Atlas connection string and
// MONGODB_DB_NAME is betfair_nlp.

import { DatabaseConnection } from "../config/database";
import { UserDAO } from "../lib/dao/user-dao";

function describe(user: { email?: string; _id: unknown; emailVerified: boolean }): string {
  return `${user.email ?? "(no email)"} — _id ${String(user._id)}, emailVerified=${user.emailVerified}`;
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const list = args.includes("--list");
  const email = args.find(a => !a.startsWith("--"));

  if (!list && !email) {
    console.error("Usage: yarn grant:admin <email> [--revoke]   |   yarn grant:admin --list");
    process.exit(1);
  }

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const userDao = new UserDAO(dbConnection.getDb());

  try {
    if (list) {
      const admins = await userDao.listAdmins();
      if (admins.length === 0) {
        console.log("No admin accounts.");
      } else {
        console.log(`${admins.length} admin account(s):`);
        admins.forEach(a => console.log(`  ${describe(a)}`));
      }
      return;
    }

    // Look the account up first so a typo'd email reports "no such account"
    // rather than the silent no-op an unmatched updateOne would otherwise be.
    const existing = await userDao.findByEmail(email!);
    if (!existing) {
      console.error(`No account found for ${email}. Nothing changed.`);
      process.exitCode = 1;
      return;
    }

    const wasAdmin = existing.isAdmin === true;
    const target = !revoke;
    if (wasAdmin === target) {
      console.log(`${email} is already ${target ? "an admin" : "not an admin"}. Nothing changed.`);
      return;
    }

    const matched = await userDao.setAdminByEmail(email!, target);
    if (!matched) {
      console.error(`Update matched no account for ${email}. Nothing changed.`);
      process.exitCode = 1;
      return;
    }

    // Read back rather than trusting the write — this command is normally
    // pointed at production, where "it printed OK" is not the same as
    // "the document actually says so now".
    const after = await userDao.findByEmail(email!);
    console.log(
      `${target ? "Granted" : "Revoked"} admin for ${email}. ` +
        `Now isAdmin=${after?.isAdmin === true} (${describe(after!)})`
    );
  } finally {
    await dbConnection.disconnect();
  }
}

run().catch(error => {
  console.error("grant-admin failed:", error);
  process.exit(1);
});
