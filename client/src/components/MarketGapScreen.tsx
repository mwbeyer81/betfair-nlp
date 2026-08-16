import React from "react";
import { View, ScrollView, StyleSheet, SafeAreaView } from "react-native";
import { Text, Surface } from "react-native-paper";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { colors, radii, spacing } from "../theme";
import type { Route } from "../hooks/useRouter";

interface MarketGapScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout: () => void;
  onRequestAuth?: () => void;
  onBack: () => void;
}

// Static content — no API calls, so no loading or error state. A PUBLIC route
// behind an unlisted key (see App.tsx / marketGapLink.ts).
//
// AUDIENCE: us, plus anyone we hand the link to deliberately — a co-founder,
// an advisor, someone weighing whether to put time or money in. NOT customers.
// The intro card says so on its face, because the key is obscurity and not
// security: it ships in the JS bundle, so this page must read as defensible to
// anyone who finds it, including a competitor.
//
// That constraint shapes two things. (1) Every competitor line is a plain
// statement of what that product does, never a claim about their motives — the
// commercially useful observation ("nobody reports a baseline or a holdout") is
// stated as an absence we have observed, which is both truer and safer than
// speculating about why. (2) The uncomfortable parts about OUR position stay
// in, because a strategy page that only lists strengths is worthless to the
// people it is written for.
//
// EVERY NUMBER about our own model is measured, same rule as
// WhyItsHardScreen.tsx. Sources:
//
//   Brier 0.0932 OOS vs market 0.0871, BSS -0.0696   -> walk-forward, prod
//   control 0.095289 / rel-binary 0.094554 /
//     market 0.088829, top-1 26.08 / 27.36 / 34.85%  -> ml/experiment.py,
//                                                       5 arms, 189,640 rows
//   zero segments passed the acceptance rule          -> same run, all arms
//   971k runners, 116 engineered features             -> ml/features.py
//
// The competitor list is a snapshot of a market that moves. It is NOT measured
// the way our own figures are, and the page says so rather than implying a
// rigour it doesn't have.

const INCUMBENTS: { name: string; body: string }[] = [
  {
    name: "Horse Race Base",
    body: "Web query builder over a large field set, long-established, with an active community of systems builders. Cheap.",
  },
  {
    name: "Proform Racing",
    body: "The long-standing desktop incumbent. A full system builder with backtesting, sold on subscription tiers.",
  },
  {
    name: "Geegeez Gold",
    body: "Mid-market, strongly marketed, with a Query Tool aimed at making form data approachable rather than at power users.",
  },
  {
    name: "Betwise / Smartform",
    body: "Sells the database itself rather than a UI — you bring SQL, R or Python. The most technical segment of the market.",
  },
  {
    name: "Racing Post / Raceform",
    body: "Form data and analysis tooling at the mainstream end.",
  },
];

const GAPS: { n: string; heading: string; body: string[] }[] = [
  {
    n: "1",
    heading: "Statistical honesty — the real one",
    body: [
      "Every tool above hands you a filter builder, a P&L, and complete freedom to try five hundred combinations until one looks good. None of them, as far as we have been able to establish, reports what not choosing at all would have returned over the same races, or offers a way to score a filter on data it was never tuned against.",
      "Our baseline on every figure, the race-by-race convergence graph, and a lock-and-score-once holdout would be genuinely novel in retail racing software. That is not a feature gap. It is a category gap.",
    ],
  },
  {
    n: "2",
    heading: "Relative features",
    body: [
      "The incumbents expose raw fields — official rating, weight, days since last run, trainer strike rate, course-and-distance flags. What isn't there is within-race normalisation and field-strength context: how far clear a horse is on ratings in units of this field's own spread, whether it is well in at the weights, whether the top-rated horse is a standout or one of two, how strong the race is that the edge is measured against.",
      "That is quant-desk thinking which hasn't reached retail tools. It is a real differentiator — and the harder sell, because a punter does not know they want a z-score.",
    ],
  },
];

const NUMBERS: { label: string; ours: string; market: string }[] = [
  { label: "Accuracy (Brier, out-of-sample)", ours: "0.0932", market: "0.0871" },
  { label: "Top pick strike rate", ours: "27.36%", market: "34.85%" },
  { label: "Profitable segments found", ours: "0", market: "—" },
];

export const MarketGapScreen: React.FC<MarketGapScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onRequestAuth,
  onBack,
}) => {
  return (
    <SafeAreaView style={styles.screen} testID="market-gap-screen">
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onRequestAuth={onRequestAuth}
        onBack={onBack}
        subtitle="Market Gap"
        testIdPrefix="market-gap"
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <PageContainer maxWidth={760}>
          <Surface style={[styles.card, styles.noteCard]} testID="market-gap-internal-note">
            <Text style={styles.noteLabel}>Internal strategy note</Text>
            <Text style={styles.noteBody}>
              This is a working assessment for us and for people we hand the link to — not marketing,
              not a customer-facing claim. It reaches an unflattering conclusion about our own
              addressable market on purpose. The unlisted link keeps it off the menu; it does not make
              it private.
            </Text>
          </Surface>

          <Surface style={styles.card} testID="market-gap-intro">
            <Text style={styles.title}>
              Is there a gap in the market for a backtester built on engineered filters?
            </Text>
            <Text style={styles.standfirst}>
              Short answer: the market is not empty, and the gap is narrower and stranger than “a
              filter backtester”. It is worth building. It is a smaller business than it looks.
            </Text>
          </Surface>

          <Surface style={styles.card} testID="market-gap-section-incumbents">
            <Text style={styles.heading}>What already exists</Text>
            <Text style={styles.paragraph}>
              UK and Irish systems backtesting is a real, occupied category:
            </Text>
            {INCUMBENTS.map(c => (
              <View key={c.name} style={styles.measure}>
                <Text style={styles.measureName}>{c.name}</Text>
                <Text style={styles.measureBody}>{c.body}</Text>
              </View>
            ))}
            <Text style={[styles.paragraph, styles.spacedTop]}>
              “Build a filter, see what it returned at SP” is table stakes here. So is
              course-and-distance form, trainer strike rates and days since last run.{" "}
              <Text style={styles.bold}>Do not position on that</Text> — it means competing with
              fifteen-year head starts and established communities on their own ground.
            </Text>
            <Text style={styles.footnote}>
              This list is a snapshot of a market that moves, and unlike every figure about our own
              model it is not measured. Verify current feature sets and pricing before committing a
              roadmap to it.
            </Text>
          </Surface>

          <Surface style={styles.card} testID="market-gap-section-gaps">
            <Text style={styles.heading}>Where the gap actually is</Text>
            {GAPS.map(g => (
              <View key={g.n} style={styles.subsection}>
                <Text style={styles.subheading}>
                  {g.n}. {g.heading}
                </Text>
                {g.body.map((p, i) => (
                  <Text key={i} style={styles.paragraph}>
                    {p}
                  </Text>
                ))}
              </View>
            ))}
          </Surface>

          <Surface style={styles.card} testID="market-gap-section-retention">
            <Text style={styles.heading}>The problem to think hardest about</Text>
            <Text style={styles.paragraph}>
              <Text style={styles.bold}>
                The honest product has a retention problem built into it.
              </Text>{" "}
              The rest of the category sells hope. We would be selling a rigorous instrument whose
              most likely output is “this doesn't work either” — and the endgame of a perfectly
              honest backtester is a user who correctly concludes they cannot beat the price, and
              then cancels.
            </Text>
            <Text style={styles.paragraph}>
              That is not a reason not to build it. It is a reason to be clear-eyed that rigour
              shrinks the addressable market to the minority who find it intrinsically satisfying —
              the Smartform end rather than the systems-seller end. Smaller, more technical, pays
              more, churns less. A business, but a different and narrower one than “racing punters”.
            </Text>
            <Text style={styles.paragraph}>
              The tell is in what our own instrumentation already found:
            </Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, styles.colLabel]}>Measure</Text>
              <Text style={[styles.th, styles.colNum]}>Our model</Text>
              <Text style={[styles.th, styles.colNum]}>The market</Text>
            </View>
            {NUMBERS.map(r => (
              <View key={r.label} style={styles.tableRow}>
                <Text style={[styles.td, styles.colLabel]}>{r.label}</Text>
                <Text style={[styles.td, styles.colNum, styles.tdStrong]}>{r.ours}</Text>
                <Text style={[styles.td, styles.colNum]}>{r.market}</Text>
              </View>
            ))}
            <Text style={[styles.paragraph, styles.spacedTop]}>
              If that is the truth of the domain — and our own measurement says it is — then any tool
              honest enough to reveal it is selling the discovery, not the edge. Price and pitch it as
              such.
            </Text>
          </Surface>

          <Surface style={[styles.card, styles.summaryCard]} testID="market-gap-summary">
            <Text style={styles.heading}>Where to aim</Text>
            <Text style={styles.paragraph}>
              Not at punters hunting a winning system. At people who want to check whether something
              works — which includes validating the systems and tipsters they already pay for. “Give
              us the rules, we'll score them on years nobody could have tuned against” is a sharper
              wedge than “build your own”, it has an obvious moment of need, and no incumbent can copy
              it without undermining their own pitch.
            </Text>
            <Text style={styles.paragraph}>
              Worth holding separately: the <Text style={styles.bold}>dataset</Text> may be the better
              asset. 971,000 runners, settled at industry SP, with 116 engineered features
              materialised and clean point-in-time discipline. That is Betwise's business model, and
              it sells to the segment least likely to churn.
            </Text>
          </Surface>

          <Text style={styles.disclaimer} testID="market-gap-disclaimer">
            Internal assessment, not betting advice and not a customer-facing claim. None of the
            approaches described has been profitable in testing.
          </Text>
        </PageContainer>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryCard: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  noteCard: { borderColor: colors.accent },
  noteLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.accent,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  noteBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 21 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text, marginBottom: spacing.sm, lineHeight: 30 },
  standfirst: { fontSize: 15, color: colors.textSecondary, lineHeight: 23, fontStyle: "italic" },
  heading: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.sm, lineHeight: 25 },
  subsection: { marginTop: spacing.md },
  subheading: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: spacing.xs, lineHeight: 22 },
  paragraph: { fontSize: 15, color: colors.text, lineHeight: 24, marginBottom: spacing.sm },
  bold: { fontWeight: "700" },
  spacedTop: { marginTop: spacing.lg },
  footnote: { fontSize: 13, color: colors.textSecondary, lineHeight: 20, marginTop: spacing.md, fontStyle: "italic" },
  measure: { marginTop: spacing.md },
  measureName: { fontSize: 14, fontWeight: "700", color: colors.text, marginBottom: 2 },
  measureBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 21 },
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
  tdStrong: { fontWeight: "700" },
  colLabel: { flex: 2.2 },
  colNum: { flex: 1, textAlign: "right" },
  disclaimer: {
    fontSize: 12,
    color: colors.textTertiary,
    lineHeight: 18,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
