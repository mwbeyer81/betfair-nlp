import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, ScrollView, StyleSheet, SafeAreaView, TouchableOpacity } from "react-native";
import { Text, ActivityIndicator, Surface, Button } from "react-native-paper";
import {
  chatApi,
  PERMISSION_DENIED_ERROR,
  DataSourceComparison,
  ComparisonVerdict,
  FieldComparisonRow,
  LabelledStat,
} from "../services/chatApi";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { colors, radii, spacing } from "../theme";
import { useResponsive } from "../utils/responsive";
import type { Route } from "../hooks/useRouter";

interface DataSourceComparisonScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout: () => void;
  onBack: () => void;
}

// Permissioned screen: the Kaggle CSV vs RacingAPI field comparison. The
// data comes from GET /api/admin/data-sources, which needs
// `data-sources:read` (implied by `admin`) and 403s otherwise — that
// server-side gate is the real permission, and this screen simply renders
// whichever of the two answers it gets. Nothing here decides who may see it.
//
// Full prose version, with the reproduction commands and the caveats behind
// every number: README-kaggle-vs-racingapi-fields.md.

const VERDICT_STYLE: Record<ComparisonVerdict, { bg: string; fg: string; label: string; mark: string }> = {
  same: { bg: colors.successLight, fg: colors.success, label: "values agree", mark: "✓" },
  caution: { bg: "#FEF3C7", fg: colors.warning, label: "same concept, different encoding", mark: "!" },
  different: { bg: "#FEE2E2", fg: colors.danger, label: "genuinely different", mark: "✕" },
};

const VERDICT_ORDER: ComparisonVerdict[] = ["different", "caution", "same"];

export const DataSourceComparisonScreen: React.FC<DataSourceComparisonScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onBack,
}) => {
  const { isNarrow } = useResponsive();
  const [data, setData] = useState<DataSourceComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error`: a non-admin gets a plain explanation and no retry
  // button, because retrying will never help. Showing the generic failure
  // state here would read as an outage.
  const [forbidden, setForbidden] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = useState<ComparisonVerdict | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      setData(await chatApi.getDataSourceComparison());
    } catch (e) {
      if (e instanceof Error && e.message === PERMISSION_DENIED_ERROR) setForbidden(true);
      else setError("Could not load the data-source comparison.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const base: Record<ComparisonVerdict, number> = { same: 0, caution: 0, different: 0 };
    (data?.fields ?? []).forEach(f => {
      base[f.verdict] += 1;
    });
    return base;
  }, [data]);

  const visibleFields = useMemo(
    () => (data?.fields ?? []).filter(f => verdictFilter === null || f.verdict === verdictFilter),
    [data, verdictFilter]
  );

  const header = (
    <AppHeader
      navigate={navigate}
      isAuthenticated={isAuthenticated}
      onLogout={onLogout}
      onBack={onBack}
      subtitle="Data Sources"
      testIdPrefix="data-sources"
    />
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} testID="data-sources-screen">
        {header}
        <View testID="data-sources-loading" style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (forbidden) {
    return (
      <SafeAreaView style={styles.screen} testID="data-sources-screen">
        {header}
        <View testID="data-sources-forbidden" style={styles.centered}>
          <Text style={styles.forbiddenTitle}>Admins only</Text>
          <Text style={styles.forbiddenBody}>
            This page needs the data sources permission, which the admin permission also grants. If
            you think you should have access, ask for it to be granted to your account.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={styles.screen} testID="data-sources-screen">
        {header}
        <View testID="data-sources-error" style={styles.centered}>
          <Text style={styles.errorText}>{error ?? "Could not load the data-source comparison."}</Text>
          <Button mode="contained" onPress={() => void load()} style={styles.retry}>
            Retry
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} testID="data-sources-screen">
      {header}
      <ScrollView contentContainerStyle={styles.scroll}>
        <PageContainer maxWidth={1100}>
          <Surface style={styles.card} testID="data-sources-intro">
            <Text style={styles.title}>Kaggle CSV vs The Racing API</Text>
            <Text style={styles.standfirst}>
              Which fields correspond, which look like they correspond but mean different things, and
              how the actual values differ. Measured, not inferred from field names.
            </Text>
            {data.headline.map((p, i) => (
              <Text key={i} style={[styles.paragraph, i === 0 && styles.spacedTop]}>
                {p}
              </Text>
            ))}
            <Text style={styles.footnote} testID="data-sources-generated-at">
              Analysis run {data.generatedAt}. Figures are a snapshot of the data as it was then.
            </Text>
          </Surface>

          <Surface style={styles.card} testID="data-sources-samples">
            <Text style={styles.heading}>What was compared</Text>
            {data.samples.map(s => (
              <View key={s.name} style={styles.sample} testID={`data-sources-sample-${slug(s.name)}`}>
                <Text style={styles.sampleName}>{s.name}</Text>
                <Text style={styles.sampleWhat}>{s.what}</Text>
                <Text style={styles.sampleMeta}>
                  {s.scale} · {s.window}
                </Text>
              </View>
            ))}
            <Text style={styles.subheadingSpaced}>Caveats</Text>
            {data.caveats.map((c, i) => (
              <Text key={i} style={styles.bullet}>
                • {c}
              </Text>
            ))}
          </Surface>

          <Surface style={styles.card} testID="data-sources-fields">
            <Text style={styles.heading}>Every CSV column, mapped</Text>
            <Text style={styles.paragraph}>
              R = /results/today · C = /racecards. Tap a row for the detail.
            </Text>
            <Text style={styles.paragraph} testID="data-sources-verdict-legend">
              {VERDICT_ORDER.map(v => `${VERDICT_STYLE[v].mark} ${VERDICT_STYLE[v].label}`).join(" · ")}
            </Text>
            <View style={styles.filterRow}>
              <FilterChip
                testID="data-sources-filter-all"
                label={`All ${data.fields.length}`}
                active={verdictFilter === null}
                onPress={() => setVerdictFilter(null)}
                bg={colors.primaryLight}
                fg={colors.primary}
              />
              {VERDICT_ORDER.map(v => (
                <FilterChip
                  key={v}
                  testID={`data-sources-filter-${v}`}
                  label={`${VERDICT_STYLE[v].mark} ${counts[v]}`}
                  active={verdictFilter === v}
                  onPress={() => setVerdictFilter(verdictFilter === v ? null : v)}
                  bg={VERDICT_STYLE[v].bg}
                  fg={VERDICT_STYLE[v].fg}
                />
              ))}
            </View>

            {visibleFields.map(f => (
              <FieldRow
                key={f.csv}
                row={f}
                isNarrow={isNarrow}
                open={openRow === f.csv}
                onToggle={() => setOpenRow(openRow === f.csv ? null : f.csv)}
              />
            ))}
          </Surface>

          <Surface style={styles.card} testID="data-sources-comment">
            <Text style={styles.heading}>“comment” means four different things</Text>
            {data.commentMeanings.map(c => (
              <View key={c.where} style={styles.meaning} testID={`data-sources-meaning-${slug(c.where)}`}>
                <Text style={styles.meaningWhere}>{c.where}</Text>
                <Text style={styles.meaningBody}>{c.meaning}</Text>
              </View>
            ))}
            <Text style={styles.subheadingSpaced}>Even the two post-race comments differ</Text>
            <StatTable rows={data.commentStyle} testIdPrefix="data-sources-comment-style" />
            <Text style={styles.subheadingSpaced}>What that does to the comment-derived features</Text>
            <Text style={styles.paragraph}>
              The same comment-lexicon categories, run over both corpora. The phrase lists are Racing
              Post idiom, so they are not equally reachable from the two sources — a horse whose
              history was captured from the API scores a systematically lower excuse score than one
              whose history came from the CSV, purely from where the text came from.
            </Text>
            <StatTable rows={data.lexiconRates} testIdPrefix="data-sources-lexicon" />
          </Surface>

          <Surface style={styles.card} testID="data-sources-population">
            <Text style={styles.heading}>Coverage is complementary, and that is a live problem</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, styles.colLabel]}>Field</Text>
              <Text style={[styles.th, styles.colNum]}>CSV era</Text>
              <Text style={[styles.th, styles.colNum]}>API era</Text>
            </View>
            {data.populationEras.map(p => (
              <View key={p.field} testID={`data-sources-population-${p.field}`}>
                <View style={styles.tableRow}>
                  <Text style={[styles.td, styles.colLabel, styles.mono]}>{p.field}</Text>
                  <Text style={[styles.td, styles.colNum]}>{p.csvEra}</Text>
                  <Text style={[styles.td, styles.colNum]}>{p.apiEra}</Text>
                </View>
                <Text style={styles.rowNote}>{p.why}</Text>
              </View>
            ))}
          </Surface>

          <Surface style={styles.card} testID="data-sources-api-only">
            <Text style={styles.heading}>In the API, absent from the CSV</Text>
            {data.apiOnly.map(g => (
              <View key={g.group} style={styles.inputGroup} testID={`data-sources-api-only-${slug(g.group)}`}>
                <Text style={styles.inputGroupLabel}>{g.group}</Text>
                <Text style={styles.inputGroupItems}>{g.fields}</Text>
              </View>
            ))}
          </Surface>

          <Surface style={[styles.card, styles.summaryCard]} testID="data-sources-normalisation">
            <Text style={styles.heading}>If you ever pool the two</Text>
            {data.normalisation.map((n, i) => (
              <Text key={i} style={styles.bullet}>
                • {n}
              </Text>
            ))}
          </Surface>
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
};

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

const FilterChip: React.FC<{
  testID: string;
  label: string;
  active: boolean;
  onPress: () => void;
  bg: string;
  fg: string;
}> = ({ testID, label, active, onPress, bg, fg }) => (
  <TouchableOpacity
    testID={testID}
    onPress={onPress}
    accessibilityRole="button"
    style={[styles.chip, { backgroundColor: bg }, active && { borderColor: fg, borderWidth: 2 }]}
  >
    <Text style={[styles.chipLabel, { color: fg }]}>{label}</Text>
  </TouchableOpacity>
);

const FieldRow: React.FC<{
  row: FieldComparisonRow;
  isNarrow: boolean;
  open: boolean;
  onToggle: () => void;
}> = ({ row, isNarrow, open, onToggle }) => {
  const verdict = VERDICT_STYLE[row.verdict];
  return (
    <TouchableOpacity
      testID={`data-sources-field-${row.csv}`}
      onPress={onToggle}
      accessibilityRole="button"
      style={styles.fieldRow}
    >
      <View style={styles.fieldTop}>
        <View style={[styles.verdictDot, { backgroundColor: verdict.bg }]}>
          <Text style={[styles.verdictMark, { color: verdict.fg }]}>{verdict.mark}</Text>
        </View>
        <Text style={[styles.fieldName, styles.mono]}>{row.csv}</Text>
        {!isNarrow && (
          <>
            <Text style={[styles.fieldMapped, styles.mono]}>R {row.results ?? "—"}</Text>
            <Text style={[styles.fieldMapped, styles.mono]}>C {row.racecards ?? "—"}</Text>
          </>
        )}
        <Text style={styles.fieldLevel}>{row.level}</Text>
      </View>
      {isNarrow && (
        <Text style={[styles.fieldMappedNarrow, styles.mono]}>
          R {row.results ?? "—"} · C {row.racecards ?? "—"}
        </Text>
      )}
      {open && (
        <Text style={styles.fieldNote} testID={`data-sources-field-note-${row.csv}`}>
          {row.note}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const StatTable: React.FC<{ rows: LabelledStat[]; testIdPrefix: string }> = ({ rows, testIdPrefix }) => (
  <>
    <View style={styles.tableHeader}>
      <View style={styles.colLabel} />
      <Text style={[styles.th, styles.colNum]}>Kaggle CSV</Text>
      <Text style={[styles.th, styles.colNum]}>RacingAPI</Text>
    </View>
    {rows.map(r => (
      <View key={r.label} style={styles.tableRow} testID={`${testIdPrefix}-${slug(r.label)}`}>
        <Text style={[styles.td, styles.colLabel]}>{r.label}</Text>
        <Text style={[styles.td, styles.colNum]}>{r.csv}</Text>
        <Text style={[styles.td, styles.colNum]}>{r.api}</Text>
      </View>
    ))}
  </>
);

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
  summaryCard: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  title: { fontSize: 22, fontWeight: "700", color: colors.text, marginBottom: spacing.sm, lineHeight: 30 },
  standfirst: { fontSize: 15, color: colors.textSecondary, lineHeight: 23, fontStyle: "italic" },
  heading: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.sm, lineHeight: 25 },
  subheadingSpaced: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    lineHeight: 22,
  },
  paragraph: { fontSize: 15, color: colors.text, lineHeight: 24, marginBottom: spacing.sm },
  spacedTop: { marginTop: spacing.md },
  bullet: { fontSize: 14, color: colors.text, lineHeight: 22, marginBottom: spacing.xs },
  footnote: { fontSize: 13, color: colors.textTertiary, lineHeight: 20, marginTop: spacing.md, fontStyle: "italic" },
  mono: { fontFamily: "monospace" },
  sample: { marginBottom: spacing.md },
  sampleName: { fontSize: 13, fontWeight: "700", color: colors.primary },
  sampleWhat: { fontSize: 14, color: colors.text, lineHeight: 21 },
  sampleMeta: { fontSize: 13, color: colors.textSecondary },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: "transparent",
  },
  chipLabel: { fontSize: 13, fontWeight: "700" },
  fieldRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.background },
  fieldTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  verdictDot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  verdictMark: { fontSize: 12, fontWeight: "700" },
  fieldName: { fontSize: 14, fontWeight: "700", color: colors.text, flex: 1 },
  fieldMapped: { fontSize: 12, color: colors.textSecondary, flex: 1.4 },
  fieldMappedNarrow: { fontSize: 12, color: colors.textSecondary, marginTop: 2, marginLeft: 30 },
  fieldLevel: { fontSize: 11, color: colors.textTertiary, textTransform: "uppercase" },
  fieldNote: { fontSize: 14, color: colors.text, lineHeight: 21, marginTop: spacing.xs, marginLeft: 30 },
  meaning: { marginTop: spacing.md },
  meaningWhere: { fontSize: 14, fontWeight: "700", color: colors.text, marginBottom: 2 },
  meaningBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 21 },
  inputGroup: { marginBottom: spacing.md },
  inputGroupLabel: { fontSize: 13, fontWeight: "700", color: colors.primary, marginBottom: 2 },
  inputGroupItems: { fontSize: 14, color: colors.text, lineHeight: 21 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
    marginTop: spacing.md,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  th: { fontSize: 11, color: colors.textTertiary, textTransform: "uppercase", fontWeight: "600" },
  td: { fontSize: 14, color: colors.text },
  colLabel: { flex: 2.2 },
  colNum: { flex: 1, textAlign: "right" },
  rowNote: { fontSize: 13, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.sm },
});
