import { MongoClient, Db } from "mongodb";
import { UserDAO } from "../user-dao";

const MONGO_URI = "mongodb://localhost:27019";
// Uniquely-named throwaway database, dropped in afterAll — same pattern as
// saved-filter-set-dao.integration.test.ts.
const DB_NAME = `betfair_nlp_test_user_perms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Covers permission writes against a real MongoDB rather than a mocked
// collection, because the things most likely to break here are exactly the
// things a mock would paper over: the email match being case-folded,
// $addToSet's idempotence, $pull on an account with no array at all, and
// updateOne's matchedCount being the difference between "granted" and
// "silently did nothing".
describe("UserDAO permissions (integration)", () => {
  let client: MongoClient;
  let db: Db;
  let dao: UserDAO;

  beforeAll(async () => {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    dao = new UserDAO(db);
  }, 15000);

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  afterEach(async () => {
    await db.collection("users").deleteMany({});
  });

  async function seed(email: string): Promise<void> {
    await dao.createUser(email, "hash", "token", new Date(Date.now() + 60_000));
  }

  it("a newly created account has no permissions field at all", async () => {
    await seed("plain@backbet.co.uk");

    const user = await dao.findByEmail("plain@backbet.co.uk");
    expect(user).not.toBeNull();
    expect(user?.permissions).toBeUndefined();
  });

  it("setPermissionByEmail grants a permission and reports the match", async () => {
    await seed("grant.me@backbet.co.uk");

    const matched = await dao.setPermissionByEmail("grant.me@backbet.co.uk", "admin", true);

    expect(matched).toBe(true);
    expect((await dao.findByEmail("grant.me@backbet.co.uk"))?.permissions).toEqual(["admin"]);
  });

  it("granting twice does not duplicate the key", async () => {
    await seed("twice@backbet.co.uk");

    await dao.setPermissionByEmail("twice@backbet.co.uk", "admin", true);
    await dao.setPermissionByEmail("twice@backbet.co.uk", "admin", true);

    expect((await dao.findByEmail("twice@backbet.co.uk"))?.permissions).toEqual(["admin"]);
  });

  it("keeps other permissions when one is granted", async () => {
    await seed("multi@backbet.co.uk");

    await dao.setPermissionByEmail("multi@backbet.co.uk", "data-sources:read", true);
    await dao.setPermissionByEmail("multi@backbet.co.uk", "admin", true);

    expect((await dao.findByEmail("multi@backbet.co.uk"))?.permissions?.sort()).toEqual([
      "admin",
      "data-sources:read",
    ]);
  });

  it("revoking removes only the named permission", async () => {
    await seed("revoke@backbet.co.uk");
    await dao.setPermissionByEmail("revoke@backbet.co.uk", "admin", true);
    await dao.setPermissionByEmail("revoke@backbet.co.uk", "data-sources:read", true);

    await dao.setPermissionByEmail("revoke@backbet.co.uk", "admin", false);

    expect((await dao.findByEmail("revoke@backbet.co.uk"))?.permissions).toEqual(["data-sources:read"]);
  });

  it("revoking from an account that never had the field is a harmless no-op", async () => {
    await seed("never@backbet.co.uk");

    const matched = await dao.setPermissionByEmail("never@backbet.co.uk", "admin", false);

    expect(matched).toBe(true);
    expect((await dao.findByEmail("never@backbet.co.uk"))?.permissions ?? []).toEqual([]);
  });

  // createUser lowercases on write and findByEmail lowercases on read, so the
  // update filter has to as well or granting from a capitalised address typed
  // at the command line would match nothing and report success.
  it("matches the account case-insensitively", async () => {
    await seed("mixed.case@backbet.co.uk");

    const matched = await dao.setPermissionByEmail("Mixed.Case@Backbet.co.uk", "admin", true);

    expect(matched).toBe(true);
    expect((await dao.findByEmail("mixed.case@backbet.co.uk"))?.permissions).toEqual(["admin"]);
  });

  it("returns false for an email with no account, and creates nothing", async () => {
    const matched = await dao.setPermissionByEmail("nobody@backbet.co.uk", "admin", true);

    expect(matched).toBe(false);
    expect(await db.collection("users").countDocuments()).toBe(0);
  });

  describe("listing", () => {
    beforeEach(async () => {
      await seed("holder.one@backbet.co.uk");
      await seed("holder.two@backbet.co.uk");
      await seed("ordinary@backbet.co.uk");
      await dao.setPermissionByEmail("holder.one@backbet.co.uk", "admin", true);
      await dao.setPermissionByEmail("holder.two@backbet.co.uk", "data-sources:read", true);
    });

    it("listWithPermissions returns only accounts holding something", async () => {
      const holders = await dao.listWithPermissions();

      expect(holders.map(h => h.email).sort()).toEqual([
        "holder.one@backbet.co.uk",
        "holder.two@backbet.co.uk",
      ]);
    });

    // An account whose only permission was revoked stores an empty array,
    // which must not come back as a holder.
    it("listWithPermissions excludes an account revoked back to empty", async () => {
      await dao.setPermissionByEmail("holder.one@backbet.co.uk", "admin", false);

      const holders = await dao.listWithPermissions();

      expect(holders.map(h => h.email)).toEqual(["holder.two@backbet.co.uk"]);
    });

    // The matrix shows who does NOT have access as clearly as who does, so
    // this one has to include the ordinary account.
    it("listAll returns every account", async () => {
      expect((await dao.listAll()).map(u => u.email).sort()).toEqual([
        "holder.one@backbet.co.uk",
        "holder.two@backbet.co.uk",
        "ordinary@backbet.co.uk",
      ]);
    });
  });
});
