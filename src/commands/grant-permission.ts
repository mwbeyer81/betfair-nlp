#!/usr/bin/env ts-node

// Grants (or revokes) one permission on one existing account, by email.
//
// This is the ONLY way an account gains a permission: nothing in the signup,
// Google, phone or HTTP surface can write `permissions`, so access cannot be
// self-granted or escalated to through the API — it takes database access and
// this command. See src/lib/auth/permissions.ts for the model.
//
// Usage:
//   MONGODB_URI=... MONGODB_DB_NAME=... yarn grant:permission <email> <key>
//   MONGODB_URI=... MONGODB_DB_NAME=... yarn grant:permission <email> <key> --revoke
//   MONGODB_URI=... MONGODB_DB_NAME=... yarn grant:permission --list
//
// Against production, MONGODB_URI is the Atlas connection string and
// MONGODB_DB_NAME is betfair_nlp.

import { DatabaseConnection } from "../config/database";
import { UserDAO, UserDocument } from "../lib/dao/user-dao";
import { PERMISSIONS, grantsFor, isPermissionKey } from "../lib/auth/permissions";

function describe(user: UserDocument): string {
  const effective = grantsFor(user.permissions);
  return (
    `${user.email ?? user.phone ?? "(no email)"} — _id ${String(user._id)}, ` +
    `stored [${(user.permissions ?? []).join(", ")}], effective [${effective.join(", ")}]`
  );
}

function usage(): void {
  console.error("Usage: yarn grant:permission <email> <key> [--revoke]   |   yarn grant:permission --list");
  console.error(`Keys: ${PERMISSIONS.map(p => p.key).join(", ")}`);
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const list = args.includes("--list");
  const positional = args.filter(a => !a.startsWith("--"));
  const [email, permission] = positional;

  if (!list && (!email || !permission)) {
    usage();
    process.exit(1);
  }

  // Validated before touching the database: a typo'd key would otherwise be
  // stored happily, grant nothing (grantsFor drops unknown keys) and look
  // like a successful grant.
  if (!list && !isPermissionKey(permission)) {
    console.error(`Unknown permission "${permission}".`);
    usage();
    process.exit(1);
  }

  const dbConnection = DatabaseConnection.getInstance();
  await dbConnection.connect();
  const userDao = new UserDAO(dbConnection.getDb());

  try {
    if (list) {
      const holders = await userDao.listWithPermissions();
      if (holders.length === 0) {
        console.log("No account holds any permission.");
      } else {
        console.log(`${holders.length} account(s) with permissions:`);
        holders.forEach(a => console.log(`  ${describe(a)}`));
      }
      return;
    }

    // Look the account up first so a typo'd email reports "no such account"
    // rather than the silent no-op an unmatched updateOne would otherwise be.
    const existing = await userDao.findByEmail(email);
    if (!existing) {
      console.error(`No account found for ${email}. Nothing changed.`);
      process.exitCode = 1;
      return;
    }

    const held = (existing.permissions ?? []).includes(permission);
    if (held === !revoke) {
      console.log(
        `${email} already ${revoke ? "does not have" : "has"} "${permission}" stored. Nothing changed.`
      );
      return;
    }

    const matched = await userDao.setPermissionByEmail(email, permission, !revoke);
    if (!matched) {
      console.error(`Update matched no account for ${email}. Nothing changed.`);
      process.exitCode = 1;
      return;
    }

    // Read back rather than trusting the write — this command is normally
    // pointed at production, where "it printed OK" is not the same as
    // "the document actually says so now".
    const after = await userDao.findByEmail(email);
    console.log(`${revoke ? "Revoked" : "Granted"} "${permission}" for ${email}.`);
    console.log(`  ${describe(after!)}`);
  } finally {
    await dbConnection.disconnect();
  }
}

run().catch(error => {
  console.error("grant-permission failed:", error);
  process.exit(1);
});
