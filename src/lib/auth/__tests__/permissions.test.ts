import { PERMISSIONS, grantsFor, hasPermission, isPermissionKey } from "../permissions";

describe("permission model", () => {
  describe("grantsFor", () => {
    it("returns nothing for an account with no permissions", () => {
      expect(grantsFor(undefined)).toEqual([]);
      expect(grantsFor([])).toEqual([]);
    });

    it("returns the key itself for a non-implying permission", () => {
      expect(grantsFor(["data-sources:read"])).toEqual(["data-sources:read"]);
    });

    // The whole point of the implication: an admin never has to be granted
    // each permission individually, so a new permission added to the model
    // is immediately held by every admin.
    it("expands admin into every other permission", () => {
      expect(grantsFor(["admin"])).toEqual(["admin", "data-sources:read"]);
    });

    it("does not duplicate a key that is both granted and implied", () => {
      expect(grantsFor(["admin", "data-sources:read"])).toEqual(["admin", "data-sources:read"]);
    });

    // A key retired from the model must stop granting access on the next
    // request, not linger on whichever accounts still have it stored.
    it("drops unknown keys", () => {
      expect(grantsFor(["not-a-permission", "data-sources:read"])).toEqual(["data-sources:read"]);
      expect(grantsFor(["retired:permission"])).toEqual([]);
    });

    // The matrix screen and its tests compare these lists directly, so the
    // order must come from the model, not from how the account happened to
    // be granted.
    it("orders by the model, not by insertion", () => {
      expect(grantsFor(["data-sources:read", "admin"])).toEqual(["admin", "data-sources:read"]);
    });
  });

  describe("hasPermission", () => {
    it("is true for a directly granted key", () => {
      expect(hasPermission(["data-sources:read"], "data-sources:read")).toBe(true);
    });

    it("is true for a key implied by admin", () => {
      expect(hasPermission(["admin"], "data-sources:read")).toBe(true);
    });

    // Implication is one-way: holding a specific permission must never grant
    // admin, or every permission would be a back door to all of them.
    it("is false for admin when only a specific permission is held", () => {
      expect(hasPermission(["data-sources:read"], "admin")).toBe(false);
    });

    it("is false for an account with nothing", () => {
      expect(hasPermission(undefined, "admin")).toBe(false);
      expect(hasPermission([], "data-sources:read")).toBe(false);
    });
  });

  describe("isPermissionKey", () => {
    it("accepts every key in the model", () => {
      PERMISSIONS.forEach(p => expect(isPermissionKey(p.key)).toBe(true));
    });

    it("rejects anything else", () => {
      expect(isPermissionKey("admin ")).toBe(false);
      expect(isPermissionKey("Admin")).toBe(false);
      expect(isPermissionKey("")).toBe(false);
    });
  });

  describe("the model itself", () => {
    it("has unique keys", () => {
      expect(new Set(PERMISSIONS.map(p => p.key)).size).toBe(PERMISSIONS.length);
    });

    it("only implies keys that exist", () => {
      const keys = new Set(PERMISSIONS.map(p => p.key));
      PERMISSIONS.forEach(p => p.implies.forEach(implied => expect(keys.has(implied)).toBe(true)));
    });

    it("gives every permission a label and a description", () => {
      PERMISSIONS.forEach(p => {
        expect(p.label.length).toBeGreaterThan(0);
        expect(p.description.length).toBeGreaterThan(0);
      });
    });

    // Adding a permission to the model without adding it to admin's implies
    // list would silently create a permission no admin holds.
    it("makes admin imply every other permission", () => {
      const admin = PERMISSIONS.find(p => p.key === "admin")!;
      const others = PERMISSIONS.filter(p => p.key !== "admin").map(p => p.key);
      expect(admin.implies.sort()).toEqual(others.sort());
    });
  });
});
