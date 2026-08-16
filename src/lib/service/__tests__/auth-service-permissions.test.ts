import { Db, ObjectId } from "mongodb";
import { AuthService } from "../auth-service";

interface FakeUser {
  _id: ObjectId;
  email?: string;
  phone?: string;
  emailVerified?: boolean;
  permissions?: string[];
}

// Narrow fake Db: AuthService reaches the users collection only through
// UserDAO, and these cases exercise findById and find({}).
function fakeDb(users: FakeUser[]): Db {
  return {
    collection: () => ({
      findOne: async (query: { _id?: ObjectId }) =>
        users.find(u => String(u._id) === String(query?._id)) ?? null,
      find: () => ({ toArray: async () => users }),
    }),
  } as unknown as Db;
}

describe("AuthService permissions", () => {
  const adminId = new ObjectId();
  const readerId = new ObjectId();
  const plainId = new ObjectId();
  const missingId = new ObjectId();

  const users: FakeUser[] = [
    { _id: adminId, email: "admin@backbet.co.uk", emailVerified: true, permissions: ["admin"] },
    { _id: readerId, email: "reader@backbet.co.uk", emailVerified: true, permissions: ["data-sources:read"] },
    { _id: plainId, email: "plain@backbet.co.uk", emailVerified: true },
  ];
  const service = () => new AuthService(fakeDb(users));

  describe("getPermissions", () => {
    it("expands admin's implications", async () => {
      expect(await service().getPermissions(adminId.toString())).toEqual(["admin", "data-sources:read"]);
    });

    it("returns just the granted key for a specific permission", async () => {
      expect(await service().getPermissions(readerId.toString())).toEqual(["data-sources:read"]);
    });

    it("returns nothing for an account with none", async () => {
      expect(await service().getPermissions(plainId.toString())).toEqual([]);
    });

    it("returns nothing when no such account exists", async () => {
      expect(await service().getPermissions(missingId.toString())).toEqual([]);
    });

    // A `sub` claim that isn't a valid ObjectId would make `new ObjectId(...)`
    // throw — which would surface as a 500 rather than the 403 it should be.
    it("returns nothing — not a throw — for a malformed user id", async () => {
      expect(await service().getPermissions("not-an-object-id")).toEqual([]);
      expect(await service().getPermissions("")).toEqual([]);
    });
  });

  describe("hasPermission", () => {
    it("lets an admin through a specific permission's gate", async () => {
      expect(await service().hasPermission(adminId.toString(), "data-sources:read")).toBe(true);
    });

    it("does not let a specific permission through the admin gate", async () => {
      expect(await service().hasPermission(readerId.toString(), "admin")).toBe(false);
    });

    it("refuses an account with no permissions", async () => {
      expect(await service().hasPermission(plainId.toString(), "data-sources:read")).toBe(false);
    });
  });

  describe("getMe", () => {
    it("reports effective permissions and isAdmin together", async () => {
      const me = await service().getMe(adminId.toString());
      expect(me).toMatchObject({
        email: "admin@backbet.co.uk",
        permissions: ["admin", "data-sources:read"],
        isAdmin: true,
      });
    });

    it("reports isAdmin false for a holder of a specific permission", async () => {
      const me = await service().getMe(readerId.toString());
      expect(me).toMatchObject({ permissions: ["data-sources:read"], isAdmin: false });
    });

    it("reports an empty list, not undefined, for an account with none", async () => {
      const me = await service().getMe(plainId.toString());
      expect(me).toMatchObject({ permissions: [], isAdmin: false });
    });
  });

  describe("listAccountPermissions", () => {
    it("returns every account, including those with no permissions", async () => {
      const rows = await service().listAccountPermissions();
      expect(rows).toHaveLength(3);
      expect(rows.map(r => r.email)).toContain("plain@backbet.co.uk");
    });

    it("separates what is stored from what is effective", async () => {
      const rows = await service().listAccountPermissions();
      const admin = rows.find(r => r.email === "admin@backbet.co.uk")!;
      // The distinction the matrix screen renders: admin stores one key but
      // effectively holds both.
      expect(admin.stored).toEqual(["admin"]);
      expect(admin.effective).toEqual(["admin", "data-sources:read"]);
    });

    it("puts the accounts with the most permissions first", async () => {
      const rows = await service().listAccountPermissions();
      expect(rows.map(r => r.email)).toEqual([
        "admin@backbet.co.uk",
        "reader@backbet.co.uk",
        "plain@backbet.co.uk",
      ]);
    });
  });
});
