import { MongoClient, Db } from "mongodb";
import { UserDAO } from "../user-dao";

const MONGO_URI = "mongodb://localhost:27019";
// Uniquely-named throwaway database, dropped in afterAll — same pattern as
// saved-filter-set-dao.integration.test.ts.
const DB_NAME = `betfair_nlp_test_user_admin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Covers the admin flag against a real MongoDB rather than a mocked
// collection, because the two things most likely to break here are exactly
// the things a mock would paper over: the email match being case-folded, and
// updateOne's matchedCount being the difference between "granted" and
// "silently did nothing".
describe("UserDAO admin flag (integration)", () => {
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

  it("a newly created account has no isAdmin field at all", async () => {
    await seed("plain@backbet.co.uk");

    const user = await dao.findByEmail("plain@backbet.co.uk");
    expect(user).not.toBeNull();
    expect(user?.isAdmin).toBeUndefined();
  });

  it("setAdminByEmail grants admin and reports the match", async () => {
    await seed("grant.me@backbet.co.uk");

    const matched = await dao.setAdminByEmail("grant.me@backbet.co.uk", true);
    expect(matched).toBe(true);

    const user = await dao.findByEmail("grant.me@backbet.co.uk");
    expect(user?.isAdmin).toBe(true);
  });

  it("setAdminByEmail revokes admin", async () => {
    await seed("revoke.me@backbet.co.uk");
    await dao.setAdminByEmail("revoke.me@backbet.co.uk", true);

    await dao.setAdminByEmail("revoke.me@backbet.co.uk", false);

    const user = await dao.findByEmail("revoke.me@backbet.co.uk");
    expect(user?.isAdmin).toBe(false);
  });

  // createUser lowercases on write and findByEmail lowercases on read, so the
  // update filter has to as well or granting admin from a capitalised address
  // typed at the command line would match nothing and report success.
  it("matches the account case-insensitively", async () => {
    await seed("mixed.case@backbet.co.uk");

    const matched = await dao.setAdminByEmail("Mixed.Case@Backbet.co.uk", true);
    expect(matched).toBe(true);
    expect((await dao.findByEmail("mixed.case@backbet.co.uk"))?.isAdmin).toBe(true);
  });

  it("returns false for an email with no account, and creates nothing", async () => {
    const matched = await dao.setAdminByEmail("nobody@backbet.co.uk", true);

    expect(matched).toBe(false);
    expect(await db.collection("users").countDocuments()).toBe(0);
  });

  it("listAdmins returns only the admin accounts", async () => {
    await seed("admin.one@backbet.co.uk");
    await seed("admin.two@backbet.co.uk");
    await seed("ordinary@backbet.co.uk");
    await dao.setAdminByEmail("admin.one@backbet.co.uk", true);
    await dao.setAdminByEmail("admin.two@backbet.co.uk", true);

    const admins = await dao.listAdmins();

    expect(admins.map(a => a.email).sort()).toEqual([
      "admin.one@backbet.co.uk",
      "admin.two@backbet.co.uk",
    ]);
  });

  // An account whose admin was revoked stores isAdmin: false, which must not
  // come back from a { isAdmin: true } query.
  it("listAdmins excludes revoked admins", async () => {
    await seed("was.admin@backbet.co.uk");
    await dao.setAdminByEmail("was.admin@backbet.co.uk", true);
    await dao.setAdminByEmail("was.admin@backbet.co.uk", false);

    expect(await dao.listAdmins()).toEqual([]);
  });
});
