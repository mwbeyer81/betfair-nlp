import React, { useCallback, useEffect, useState } from "react";
import { View, ScrollView, StyleSheet, SafeAreaView } from "react-native";
import { Text, ActivityIndicator, Surface, Button } from "react-native-paper";
import {
  chatApi,
  PERMISSION_DENIED_ERROR,
  PermissionsMatrix,
  AccountPermissions,
  PermissionDefinition,
} from "../services/chatApi";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { colors, radii, spacing } from "../theme";
import type { Route } from "../hooks/useRouter";

interface PermissionsScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout: () => void;
  onBack: () => void;
}

// The permissions matrix — every account down the side, every permission
// across the top. Needs `admin` itself, since who else has access is exactly
// what only an administrator should see.
//
// Read-only on purpose. Permissions are granted by `yarn grant:permission`,
// which needs database access; no HTTP route can widen anybody's access,
// including the caller's own. A "grant" button here would be the single most
// valuable thing on the site to an attacker who got hold of a session.
//
// A cell distinguishes two ways of holding a permission:
//   ●  granted — the key is stored on the account
//   ○  inherited — `admin` implies it (see src/lib/auth/permissions.ts)
// which matters when reading the matrix: revoking `data-sources:read` from an
// admin changes nothing, because admin keeps implying it.

const GRANTED = "●";
const INHERITED = "○";
const NONE = "·";

function cellFor(account: AccountPermissions, permission: PermissionDefinition): {
  mark: string;
  kind: "granted" | "inherited" | "none";
} {
  if (account.stored.includes(permission.key)) return { mark: GRANTED, kind: "granted" };
  if (account.effective.includes(permission.key)) return { mark: INHERITED, kind: "inherited" };
  return { mark: NONE, kind: "none" };
}

function accountLabel(account: AccountPermissions): string {
  return account.email ?? account.phone ?? "(no email or phone)";
}

export const PermissionsScreen: React.FC<PermissionsScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onBack,
}) => {
  const [data, setData] = useState<PermissionsMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      setData(await chatApi.getPermissionsMatrix());
    } catch (e) {
      if (e instanceof Error && e.message === PERMISSION_DENIED_ERROR) setForbidden(true);
      else setError("Could not load permissions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <AppHeader
      navigate={navigate}
      isAuthenticated={isAuthenticated}
      onLogout={onLogout}
      onBack={onBack}
      subtitle="Permissions"
      testIdPrefix="permissions"
    />
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} testID="permissions-screen">
        {header}
        <View testID="permissions-loading" style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (forbidden) {
    return (
      <SafeAreaView style={styles.screen} testID="permissions-screen">
        {header}
        <View testID="permissions-forbidden" style={styles.centered}>
          <Text style={styles.forbiddenTitle}>Admins only</Text>
          <Text style={styles.forbiddenBody}>
            The permissions matrix needs the admin permission. If you think you should have it, ask
            for it to be granted to your account.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={styles.screen} testID="permissions-screen">
        {header}
        <View testID="permissions-error" style={styles.centered}>
          <Text style={styles.errorText}>{error ?? "Could not load permissions."}</Text>
          <Button mode="contained" onPress={() => void load()} style={styles.retry}>
            Retry
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  const you = data.accounts.find(a => a.isYou) ?? null;

  return (
    <SafeAreaView style={styles.screen} testID="permissions-screen">
      {header}
      <ScrollView contentContainerStyle={styles.scroll}>
        <PageContainer maxWidth={1100}>
          {you && (
            <Surface style={[styles.card, styles.youCard]} testID="permissions-you">
              <Text style={styles.heading}>Your permissions</Text>
              <Text style={styles.youEmail}>{accountLabel(you)}</Text>
              <View style={styles.chipRow}>
                {data.permissions.map(p => {
                  const cell = cellFor(you, p);
                  return (
                    <View
                      key={p.key}
                      testID={`permissions-you-${p.key}`}
                      style={[
                        styles.chip,
                        cell.kind === "granted" && styles.chipGranted,
                        cell.kind === "inherited" && styles.chipInherited,
                        cell.kind === "none" && styles.chipNone,
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipLabel,
                          cell.kind === "none" && styles.chipLabelNone,
                        ]}
                      >
                        {cell.mark} {p.label}
                        {cell.kind === "inherited" ? " (via admin)" : ""}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </Surface>
          )}

          <Surface style={styles.card} testID="permissions-matrix">
            <Text style={styles.heading}>Permissions matrix</Text>
            <Text style={styles.paragraph}>
              {GRANTED} granted directly · {INHERITED} inherited from admin · {NONE} not held.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator style={styles.matrixScroll}>
              <View>
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, styles.colAccount]}>Account</Text>
                  {data.permissions.map(p => (
                    <Text key={p.key} style={[styles.th, styles.colPermission]} testID={`permissions-column-${p.key}`}>
                      {p.label}
                    </Text>
                  ))}
                </View>
                {data.accounts.map(account => (
                  <View
                    key={account.id}
                    style={[styles.tableRow, account.isYou && styles.youRow]}
                    testID={`permissions-row-${account.id}`}
                  >
                    <Text style={[styles.td, styles.colAccount]} numberOfLines={1}>
                      {accountLabel(account)}
                      {account.isYou ? "  (you)" : ""}
                    </Text>
                    {data.permissions.map(p => {
                      const cell = cellFor(account, p);
                      return (
                        <Text
                          key={p.key}
                          testID={`permissions-cell-${account.id}-${p.key}`}
                          style={[
                            styles.td,
                            styles.colPermission,
                            styles.cell,
                            cell.kind === "granted" && styles.cellGranted,
                            cell.kind === "inherited" && styles.cellInherited,
                            cell.kind === "none" && styles.cellNone,
                          ]}
                        >
                          {cell.mark}
                        </Text>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
            <Text style={styles.footnote} testID="permissions-account-count">
              {data.accounts.length} account{data.accounts.length === 1 ? "" : "s"} ·{" "}
              {data.accounts.filter(a => a.effective.length > 0).length} with at least one permission.
            </Text>
          </Surface>

          <Surface style={styles.card} testID="permissions-legend">
            <Text style={styles.heading}>What each permission grants</Text>
            {data.permissions.map(p => (
              <View key={p.key} style={styles.definition} testID={`permissions-definition-${p.key}`}>
                <Text style={styles.definitionLabel}>
                  {p.label} <Text style={styles.definitionKey}>{p.key}</Text>
                </Text>
                <Text style={styles.definitionBody}>{p.description}</Text>
              </View>
            ))}
          </Surface>

          <Surface style={[styles.card, styles.noteCard]} testID="permissions-grant-note">
            <Text style={styles.heading}>Granting is deliberately not possible here</Text>
            <Text style={styles.paragraph}>
              This screen is read-only. Permissions are granted from a machine with database access:
            </Text>
            <Text style={styles.code}>yarn grant:permission &lt;email&gt; &lt;key&gt;</Text>
            <Text style={styles.paragraph}>
              No HTTP route can write a permission — not signup, not Google or phone sign-in, and not
              this screen — so there is no path by which an account can widen its own access.
            </Text>
          </Surface>
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  errorText: { fontSize: 15, color: colors.danger, marginBottom: spacing.md, textAlign: "center" },
  retry: { marginTop: spacing.sm },
  forbiddenTitle: { fontSize: 20, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  forbiddenBody: { fontSize: 15, color: colors.textSecondary, lineHeight: 23, textAlign: "center", maxWidth: 460 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  youCard: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  noteCard: { borderColor: colors.warning },
  heading: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.sm, lineHeight: 25 },
  paragraph: { fontSize: 15, color: colors.text, lineHeight: 24, marginBottom: spacing.sm },
  youEmail: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.sm, borderWidth: 1 },
  chipGranted: { backgroundColor: colors.successLight, borderColor: colors.success },
  chipInherited: { backgroundColor: "#FEF3C7", borderColor: colors.warning },
  chipNone: { backgroundColor: colors.background, borderColor: colors.border },
  chipLabel: { fontSize: 13, fontWeight: "700", color: colors.text },
  chipLabelNone: { color: colors.textTertiary },
  matrixScroll: { marginTop: spacing.sm },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
    alignItems: "center",
  },
  youRow: { backgroundColor: colors.primaryLight },
  th: { fontSize: 11, color: colors.textTertiary, textTransform: "uppercase", fontWeight: "600" },
  td: { fontSize: 14, color: colors.text },
  colAccount: { width: 320, paddingRight: spacing.md },
  colPermission: { width: 140, textAlign: "center" },
  cell: { fontSize: 16, fontWeight: "700" },
  cellGranted: { color: colors.success },
  cellInherited: { color: colors.warning },
  cellNone: { color: colors.textTertiary },
  footnote: { fontSize: 13, color: colors.textTertiary, lineHeight: 20, marginTop: spacing.md, fontStyle: "italic" },
  definition: { marginTop: spacing.md },
  definitionLabel: { fontSize: 14, fontWeight: "700", color: colors.text, marginBottom: 2 },
  definitionKey: { fontSize: 12, fontWeight: "400", color: colors.textTertiary, fontFamily: "monospace" },
  definitionBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 21 },
  code: {
    fontFamily: "monospace",
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.background,
    padding: spacing.sm,
    borderRadius: radii.sm,
    marginBottom: spacing.sm,
  },
});
