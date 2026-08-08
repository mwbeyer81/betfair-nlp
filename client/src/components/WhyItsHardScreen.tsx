import React from "react";
import { View, ScrollView, StyleSheet, SafeAreaView } from "react-native";
import { Text, Surface } from "react-native-paper";
import { PageContainer } from "./PageContainer";
import { AppHeader } from "./AppHeader";
import { colors, radii, spacing } from "../theme";
import type { Route } from "../hooks/useRouter";

interface WhyItsHardScreenProps {
  navigate: (to: Route, query?: string) => void;
  isAuthenticated: boolean;
  onLogout: () => void;
  onRequestAuth?: () => void;
  onBack: () => void;
}

// Static content — no API calls, so no loading or error state. Deliberately a
// PUBLIC route behind an unlisted key (see App.tsx / whyItsHardLink.ts).
//
// AUDIENCE: someone who has bet successfully for years and is evaluating
// whether this system is worth their time. They know overrounds, SP, drift,
// RPR and level stakes cold, and none of that needs explaining. They do NOT
// know machine-learning vocabulary, so "XGBoost" is named but described,
// and Brier score / calibration / out-of-sample testing are explained in
// words rather than named and left to be looked up.
//
// EVERY NUMBER IS MEASURED, not illustrative, and quoted at LEVEL STAKES
// throughout — the repo's other convention (to-win-£1) reports -11.69% where
// level reports -22.94% for the SAME bets, and showing both would read as a
// contradiction rather than as the bet-sizing artefact it is. Sources:
//
//   top-1 26.79% vs favourite 35.03%; back-everything -22.94%, random -21.18%,
//   top pick -10.32%, favourite -7.51%   -> 43,880 races, 2022-01..2026-08, prod
//   Brier 0.0946 vs 0.0888, AUC 0.722 vs 0.785 -> ml/experiment.py, rel-binary
//   +11.4% over 78 bets -> -24.7% over 272     -> live capture, Jul 28-Aug 6
//   ~14,500 bets for a 3% edge                 -> per-bet level SD 1.84
//   840 combinations, one at +6.3% on 919 bets -> experiment segments
//   disagreements lose monotonically           -> AGENTS.md 2026-08-01
//   +4.48% contaminated vs -18.75% honest      -> AGENTS.md 2026-08-04
//
// These go stale if the model is retrained. That is the cost of quoting real
// figures, and it is the right trade: a page arguing for honesty cannot use
// invented ones.

const LIVE_INPUTS: { group: string; items: string }[] = [
  { group: "About the race", items: "course · going · code · class · distance · field size" },
  { group: "About the runner", items: "trainer · jockey · sex · headgear · saddlecloth · draw · official rating · weight · age" },
  { group: "Recent activity", items: "days since last run · career runs · career strike rate" },
  { group: "Trainer and jockey form (last 14 days)", items: "runs, strike rate, and profit on backing every one of their runners" },
  { group: "Recent form (last 3 runs only)", items: "average RPR · average Topspeed · average beaten distance" },
];

const MEASURES: { name: string; body: string }[] = [
  {
    name: "Accuracy score",
    body: "A report card for percentages rather than for tips. Saying 20% about a horse that wins is a bigger miss than saying 20% about one that loses; average those misses across every runner. Lower is better. Crucially it is scored against the SP with the bookmaker's margin taken out, so it is a fair-price comparison, not a margin one.",
  },
  { name: "Ranking ability", body: "How reliably it puts winners above losers when it sorts a field." },
  { name: "Top-pick strike rate", body: "How often the horse it rates highest actually wins." },
  { name: "P&L", body: "At both £1 level stakes and staking-to-win-£1." },
];

const WHY_HARD: { heading: string; body: string[] }[] = [
  {
    heading: "There are two ways to be right, and we're only good at one",
    body: [
      "When the model says 20%, almost exactly 20% win — its percentages are honest on average. What it can't do as well is say which horse it will be. Nearly all the gap to the market is that second thing, and no amount of adjusting the numbers afterwards fixes it. We tried; it moved the score by 0.0001. Only new information helps.",
    ],
  },
  {
    heading: "It's already losing to the fair price",
    body: [
      "Every figure above has the bookmaker's margin stripped out. So this isn't only a cheap-prices problem — a better price reduces the bleed without creating an edge.",
    ],
  },
  {
    heading: "Its strongest opinions are its worst bets",
    body: [
      "Sorted by how far it disagrees with the market, losses get steadily worse the bigger the disagreement. Where it most strongly disagreed — rating horses about 2.7 times the market's chance — the market said 3.4% and 2.9% won.",
    ],
  },
  {
    heading: "You need far more bets than feels reasonable",
    body: [
      "To be confident a 3% edge is real rather than luck takes around 14,500 bets — roughly eighteen months of one bet a race, every race, every day.",
      "Over one recent week the top picks showed +11.4%. Extending to 272 races: −24.7%. Nothing changed but the sample.",
    ],
  },
  {
    heading: "Something will always look profitable",
    body: [
      "Across 840 combinations of course, price band and race type, exactly one looked good — +6.3%. It came from the worst of five models, ran to 919 bets, and lost money in every individual year.",
    ],
  },
];

const IMPROVEMENTS: { n: string; heading: string; body: string }[] = [
  {
    n: "1",
    heading: "Exchange price moves — as an input, not a target",
    body: "How a price drifts or shortens between morning and off is the strongest signal in racing that's there for anyone to see, and the model has none of it. The trap is training it to predict the price: do that and it converges on the market's own opinion, looks superb on every measure, and is worth nothing. Feed drift in as evidence, don't aim at it.",
  },
  {
    n: "2",
    heading: "Betfair SP as the benchmark and the settlement price",
    body: "There's currently no exchange data at all. Every number here is measured against a price nobody can actually bet into, and against a 15–20% book rather than an exchange's few points.",
  },
  {
    n: "3",
    heading: "Pre-race analyst comment — the thing we assumed we had",
    body: "The only written commentary in the database describes what happened during the race (“set the pace throughout, driven approaching the final furlong”). Useful as history, but it's a replay in words. The valuable text is the pre-race verdict — someone who has watched the horse and formed a view before the off. That sits on a paid racecard tier; the free feed leaves it out.",
  },
  {
    n: "4",
    heading: "Sectional times",
    body: "Absent entirely. The clearest way to separate a horse that won easily from one that got an easy lead.",
  },
  {
    n: "5",
    heading: "Timeform-grade ratings and pedigree data",
    body: "Licensed, and priced accordingly.",
  },
];

export const WhyItsHardScreen: React.FC<WhyItsHardScreenProps> = ({
  navigate,
  isAuthenticated,
  onLogout,
  onRequestAuth,
  onBack,
}) => {
  return (
    <SafeAreaView style={styles.screen} testID="why-its-hard-screen">
      <AppHeader
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
        onRequestAuth={onRequestAuth}
        onBack={onBack}
        subtitle="Why It's Hard"
        testIdPrefix="why-its-hard"
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <PageContainer maxWidth={760}>
          <Surface style={styles.card} testID="why-its-hard-intro">
            <Text style={styles.title}>
              What this model is, how it was tested, and why it doesn't beat the book
            </Text>
            <Text style={styles.standfirst}>
              Written for someone who knows racing and prices. Every figure is measured against our
              own model, on races it had never seen. Most are unflattering.
            </Text>
          </Surface>

          <Surface style={styles.card} testID="why-its-hard-section-the-model">
            <Text style={styles.heading}>The model</Text>
            <Text style={styles.paragraph}>
              It's built with <Text style={styles.bold}>XGBoost</Text> — software that creates
              thousands of small yes/no rules (“is the official rating above 85?”, “has it run in the
              last 30 days?”, “is it dropping in class?”), where each new rule is aimed at fixing the
              mistakes the earlier ones made. Stack enough together and you get a win percentage for
              each runner.
            </Text>
            <Text style={styles.paragraph}>
              It handles each horse as its own separate question — did this one win? — and then scales
              every runner in a race so the field adds up to 100%.
            </Text>
            <Text style={styles.paragraph}>
              Trained on 110,030 GB races and 972,486 runners, 2015 to 2026, from industry SP form
              data plus a daily racecard feed.
            </Text>
            <Text style={styles.paragraph}>
              <Text style={styles.bold}>It never sees a price.</Text> SP is deliberately kept out of
              what the model looks at. It's used only as the yardstick to mark the model against —
              because a model trained towards the market just learns to repeat the market.
            </Text>
          </Surface>

          <Surface style={styles.card} testID="why-its-hard-section-inputs">
            <Text style={styles.heading}>What it looks at — the 27 live inputs</Text>
            {LIVE_INPUTS.map(g => (
              <View key={g.group} style={styles.inputGroup}>
                <Text style={styles.inputGroupLabel}>{g.group}</Text>
                <Text style={styles.inputGroupItems}>{g.items}</Text>
              </View>
            ))}
            <Text style={styles.paragraph}>
              Anything that happened in the race being predicted — its RPR, Topspeed, beaten distance,
              finishing position — is kept out. Only the horse's earlier runs count, or the model
              would simply be reading the answer off the page.
            </Text>
            <Text style={styles.paragraph}>
              A further 116 inputs are built and tested but not yet live, mostly things that compare a
              horse to the actual rivals it's facing rather than in isolation: how far clear it is on
              ratings, whether it's well in at the weights, its record at this course, trip and going,
              first-time headgear, dropping or rising in class, stepping up or down in trip,
              trainer-jockey combinations, and longer form windows.
            </Text>
          </Surface>

          <Surface style={styles.card} testID="why-its-hard-section-testing">
            <Text style={styles.heading}>How it was tested</Text>
            <Text style={styles.paragraph}>
              <Text style={styles.bold}>Only ever on races it hadn't seen.</Text> 2023 was marked by a
              model built from 2015–2022 alone; 2024 from 2015–2023; and so on. No season is ever
              judged by a version that already knew how it turned out.
            </Text>
            <Text style={styles.paragraph}>
              That matters because the first version wasn't honest. The published percentage came from
              a model rebuilt over every race including the ones it then marked. A “model beats SP”
              filter read +4.48% that way and −18.75% once tested properly. That was found, fixed, and
              everything below uses the honest figures.
            </Text>
            {MEASURES.map(m => (
              <View key={m.name} style={styles.measure}>
                <Text style={styles.measureName}>{m.name}</Text>
                <Text style={styles.measureBody}>{m.body}</Text>
              </View>
            ))}
          </Surface>

          <Surface style={styles.card} testID="why-its-hard-section-results">
            <Text style={styles.heading}>The results</Text>
            <View style={styles.tableHeader}>
              <View style={styles.colLabel} />
              <Text style={[styles.th, styles.colNum]}>Model</Text>
              <Text style={[styles.th, styles.colNum]}>Industry SP</Text>
            </View>
            {[
              { k: "accuracy score (lower better)", a: "0.0946", b: "0.0888" },
              { k: "ranking ability", a: "0.722", b: "0.785" },
              { k: "top pick wins", a: "26.8%", b: "35.0%" },
            ].map(r => (
              <View key={r.k} style={styles.tableRow}>
                <Text style={[styles.td, styles.colLabel]}>{r.k}</Text>
                <Text style={[styles.td, styles.colNum]}>{r.a}</Text>
                <Text style={[styles.td, styles.colNum, styles.tdStrong]}>{r.b}</Text>
              </View>
            ))}

            <Text style={[styles.paragraph, styles.spacedTop]}>
              Backing one runner per race, £1 level, across 43,880 races:
            </Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, styles.colLabel]}>Backing</Text>
              <Text style={[styles.th, styles.colNum]}>Strike</Text>
              <Text style={[styles.th, styles.colNum]}>ROI</Text>
            </View>
            {[
              { who: "The favourite", wins: "35.0%", roi: "−7.5%", best: true },
              { who: "Model's top pick", wins: "26.8%", roi: "−10.3%", best: false },
              { who: "A runner at random", wins: "13.3%", roi: "−21.2%", best: false },
              { who: "Every runner", wins: "11.6%", roi: "−22.9%", best: false },
            ].map(row => (
              <View
                key={row.who}
                style={styles.tableRow}
                testID={`why-its-hard-row-${row.who.replace(/\s+/g, "-").toLowerCase()}`}
              >
                <Text style={[styles.td, styles.colLabel, row.best && styles.tdStrong]}>{row.who}</Text>
                <Text style={[styles.td, styles.colNum]}>{row.wins}</Text>
                <Text style={[styles.td, styles.colNum, row.best && styles.tdStrong]}>{row.roi}</Text>
              </View>
            ))}
            <Text style={styles.footnote}>
              10.9 points better than random. 2.8 points worse than simply backing the jolly. It has
              roughly 58% of the market's ability to sort winners from losers.
            </Text>
          </Surface>

          <Surface style={styles.card} testID="why-its-hard-section-why-hard">
            <Text style={styles.heading}>Why it's hard</Text>
            {WHY_HARD.map(s => (
              <View key={s.heading} style={styles.subsection}>
                <Text style={styles.subheading}>{s.heading}</Text>
                {s.body.map((p, i) => (
                  <Text key={i} style={styles.paragraph}>
                    {p}
                  </Text>
                ))}
              </View>
            ))}
          </Surface>

          <Surface style={styles.card} testID="why-its-hard-section-improvements">
            <Text style={styles.heading}>What could actually make it profitable</Text>
            {IMPROVEMENTS.map(s => (
              <View key={s.n} style={styles.subsection}>
                <Text style={styles.subheading}>
                  {s.n}. {s.heading}
                </Text>
                <Text style={styles.paragraph}>{s.body}</Text>
              </View>
            ))}
          </Surface>

          <Surface style={[styles.card, styles.summaryCard]} testID="why-its-hard-summary">
            <Text style={styles.heading}>Bottom line</Text>
            <Text style={styles.paragraph}>
              A model can be well built, clearly better than guessing, and still lose — because it's up
              against a well-informed crowd while carrying the book's margin.
            </Text>
            <Text style={styles.paragraph}>
              Closing that gap isn't a matter of more tuning. It needs information the market already
              has and this model doesn't, and that information is either paid for or simply not
              recorded.
            </Text>
          </Surface>

          <Text style={styles.disclaimer} testID="why-its-hard-disclaimer">
            Nothing here is betting advice. None of the approaches described has been profitable in
            testing. Please gamble responsibly.
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
  title: { fontSize: 22, fontWeight: "700", color: colors.text, marginBottom: spacing.sm, lineHeight: 30 },
  standfirst: { fontSize: 15, color: colors.textSecondary, lineHeight: 23, fontStyle: "italic" },
  heading: { fontSize: 18, fontWeight: "600", color: colors.text, marginBottom: spacing.sm, lineHeight: 25 },
  subsection: { marginTop: spacing.md },
  subheading: { fontSize: 15, fontWeight: "700", color: colors.text, marginBottom: spacing.xs, lineHeight: 22 },
  paragraph: { fontSize: 15, color: colors.text, lineHeight: 24, marginBottom: spacing.sm },
  bold: { fontWeight: "700" },
  spacedTop: { marginTop: spacing.lg },
  footnote: { fontSize: 13, color: colors.textSecondary, lineHeight: 20, marginTop: spacing.md, fontStyle: "italic" },
  inputGroup: { marginBottom: spacing.md },
  inputGroupLabel: { fontSize: 13, fontWeight: "700", color: colors.primary, marginBottom: 2 },
  inputGroupItems: { fontSize: 14, color: colors.text, lineHeight: 21 },
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
