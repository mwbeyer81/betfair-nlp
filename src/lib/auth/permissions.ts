// The permission model.
//
// A user carries a list of permission keys (UserDocument.permissions). A
// route asks for one key; `admin` implies every other key, so an admin never
// needs to be granted each one individually — that implication is the only
// special case in here, and it is applied in one place (grantsFor) rather
// than checked ad hoc at each call site.
//
// Permissions are granted ONLY by `yarn grant:permission <email> <key>`,
// which needs database access. Nothing in signup, Google/phone sign-in, or
// any HTTP route can add one, so there is no self-service path to a
// permission and no route that can escalate the caller's own access.

export const PERMISSION_KEYS = ["admin", "data-sources:read"] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export interface PermissionDefinition {
  key: PermissionKey;
  label: string;
  description: string;
  /** Keys this permission grants on top of itself. */
  implies: PermissionKey[];
}

export const PERMISSIONS: PermissionDefinition[] = [
  {
    key: "admin",
    label: "Admin",
    description:
      "Full access to every admin-only screen and endpoint, including the permissions matrix itself. Implies every other permission.",
    implies: ["data-sources:read"],
  },
  {
    key: "data-sources:read",
    label: "Data sources",
    description:
      "Read the Kaggle CSV vs The Racing API field comparison at /admin/data-sources.",
    implies: [],
  },
];

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/**
 * Everything a stored permission list actually grants, with implications
 * expanded — e.g. ["admin"] grants ["admin", "data-sources:read"].
 *
 * Unknown keys are dropped rather than passed through: a permission removed
 * from PERMISSION_KEYS must stop granting access on the next request, not
 * linger on whichever accounts happen to still have it stored.
 */
export function grantsFor(stored: string[] | undefined): PermissionKey[] {
  const granted = new Set<PermissionKey>();
  (stored ?? []).forEach(key => {
    if (!isPermissionKey(key)) return;
    granted.add(key);
    PERMISSIONS.find(p => p.key === key)?.implies.forEach(implied => granted.add(implied));
  });
  // Stable order — PERMISSIONS order, not insertion order, so the same set
  // always serialises identically (the matrix screen and its tests compare
  // these lists directly).
  return PERMISSIONS.map(p => p.key).filter(key => granted.has(key));
}

export function hasPermission(stored: string[] | undefined, required: PermissionKey): boolean {
  return grantsFor(stored).includes(required);
}
