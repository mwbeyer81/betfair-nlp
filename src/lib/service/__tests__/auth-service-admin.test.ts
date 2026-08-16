import { Db, ObjectId } from "mongodb";
import { AuthService } from "../auth-service";

// Narrow fake Db: AuthService only reaches the users collection through
// UserDAO, and these cases only exercise findById.
function fakeDb(users: { _id: ObjectId; isAdmin?: boolean }[]): Db {
  return {
    collection: () => ({
      findOne: async (query: { _id?: ObjectId }) =>
        users.find(u => String(u._id) === String(query?._id)) ?? null,
    }),
  } as unknown as Db;
}

describe("AuthService.isAdmin", () => {
  const adminId = new ObjectId();
  const plainId = new ObjectId();
  const missingId = new ObjectId();

  const service = () =>
    new AuthService(
      fakeDb([
        { _id: adminId, isAdmin: true },
        { _id: plainId },
      ])
    );

  it("is true for an account with isAdmin set", async () => {
    expect(await service().isAdmin(adminId.toString())).toBe(true);
  });

  it("is false for an account without the flag", async () => {
    expect(await service().isAdmin(plainId.toString())).toBe(false);
  });

  it("is false when no such account exists", async () => {
    expect(await service().isAdmin(missingId.toString())).toBe(false);
  });

  // A `sub` claim that isn't a valid ObjectId would make `new ObjectId(...)`
  // throw — which would surface as a 500 rather than the 403 it should be.
  it("is false — not a throw — for a malformed user id", async () => {
    expect(await service().isAdmin("not-an-object-id")).toBe(false);
  });

  it("is false for an empty user id", async () => {
    expect(await service().isAdmin("")).toBe(false);
  });
});
