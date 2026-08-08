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
// PUBLIC route (see App.tsx's isPublicRoute): it is the honest counterweight to
// the model screens, and putting it behind the login wall would be perverse.
// It is also meant to be linkable, so someone can be sent straight to it.
//
// EVERY NUMBER HERE IS MEASURED, not illustrative, and they are quoted at LEVEL
// STAKES throughout (£1 flat per bet) — the convention a reader intuitively
// assumes. Mixing in the repo's other convention (to-win-£1, which stakes
// 1/(price-1)) would put -11.69% next to -22.94% for the same bets and read as
// a contradiction. Sources, so these can be re-checked rather than trusted:
//
//   top-1 rate 26.79% vs market favourite 35.03%,
//   back-everything -22.94%, random-runner -21.18%, top pick -10.32%,
//   favourite -7.51%      -> 43,880 races, 2022-01-01..2026-08-06, prod
//   +11.4% over 78 races -> -24.7% over 272   -> live capture, Jul 28-Aug 6
//   ~14,500 bets to resolve a 3% edge         -> per-bet SD 1.84, 95% CI
//   840 cells, one at +6.31% on 919 bets      -> ml/experiment.py segments
//   disagreements lose monotonically          -> AGENTS.md 2026-08-01
//
// If the model is retrained or the window moves, these go stale. That is the
// cost of quoting real numbers, and it is the right trade: a page arguing for
// honesty cannot use made-up figures.
const SECTIONS: { id: string; heading: string; body: string[] }[] = [
  {
    id: "not-picking-winners",
    heading: "The job isn't picking winners",
    body: [
      "That's the bit that surprises everyone. Our model picks the winner in about 27 out of every 100 races. That sounds decent — until you learn that just backing the favourite every time picks 35 out of 100. Anyone can do that, for free, without a model.",
      "So the real job isn't “find the winner”. It's “find a horse the bookmakers have got wrong”. Those are completely different problems, and only the second one pays.",
    ],
  },
  {
    id: "behind-before-you-start",
    heading: "You're behind before you place a bet",
    body: [
      "Add up the bookmakers' prices in any race and they come to about 115–120%, not 100%. That extra is their cut.",
      "Back every horse in every race at £1 a time and you lose about 23p in every pound — not through bad luck, just through the margin. A model doesn't need to be good. It needs to be good enough to overcome a permanent headwind.",
    ],
  },
  {
    id: "strong-opponent",
    heading: "The market is a very strong opponent",
    body: [
      "It's tempting to think of the starting price as a number to beat. It isn't — it's the combined opinion of thousands of people, including trainers, stable staff and professional gamblers, all putting their own money behind it.",
      "Our model, using every bit of public form we have, captures a bit over half of the market's skill at separating winners from losers. The market knows things that simply aren't written down anywhere: how a horse worked at home, whether the yard fancies it, where the serious money is going.",
      "You can read all the public form perfectly and still be behind, because you're missing what the market can see.",
    ],
  },
  {
    id: "quite-good-is-worthless",
    heading: "“Quite good” is worth nothing",
    body: [
      "Our model is genuinely far better than guessing. Picking a horse at random loses about 21p in the pound. Our model's top pick loses about 10p. That's a big improvement.",
      "It's also useless, because backing the favourite loses about 7.5p. There's no prize for second.",
    ],
  },
  {
    id: "luck-vs-skill",
    heading: "You can't tell skill from luck for a very long time",
    body: [
      "This is the one that catches people out worst.",
      "Over one week — 78 bets — our model's top picks showed an 11% profit. Genuinely exciting. Over the following three weeks, 272 bets, the same method showed a 25% loss. Nothing changed. The first number was just noise.",
      "To be reasonably confident that a 3% edge is real rather than luck, you'd need around 14,500 bets — roughly eighteen months of backing one horse a race, every race, every day. Anything concluded from a few weeks is a coin-flip dressed up as a finding.",
    ],
  },
  {
    id: "mirages",
    heading: "Anything that looks like a winner is probably a mirage",
    body: [
      "We tested 840 different combinations — this course, that price range, this type of race. Exactly one looked properly profitable: +6.3%.",
      "Then we looked closer. It came from our worst model. It was based on 919 bets. And it lost money in every single individual year — the profit came from a handful of lucky big-priced winners.",
      "Test enough combinations and some will look brilliant by pure chance. Spotting which ones are real is harder than finding them.",
    ],
  },
  {
    id: "bold-opinions",
    heading: "The model's boldest opinions are its worst bets",
    body: [
      "The most uncomfortable finding: when our model strongly disagreed with the market — “this horse is a much better chance than the price suggests” — those were its worst-performing bets of all. The bigger the disagreement, the bigger the loss.",
      "Where the model and the market argue, the market usually wins.",
    ],
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
            <Text style={styles.title}>Why building a model that actually makes money is so hard</Text>
            <Text style={styles.standfirst}>
              Every figure below is measured against real results from our own model, not an
              illustration. Most of them are unflattering to us, which is rather the point.
            </Text>
          </Surface>

          {SECTIONS.map(section => (
            <Surface key={section.id} style={styles.card} testID={`why-its-hard-section-${section.id}`}>
              <Text style={styles.heading}>{section.heading}</Text>
              {section.body.map((paragraph, i) => (
                <Text key={i} style={styles.paragraph}>
                  {paragraph}
                </Text>
              ))}
            </Surface>
          ))}

          {/* The comparison the whole page turns on, as a table rather than
              buried in prose — it is the fastest way to see that "better than
              random" and "worth betting" are different things. */}
          <Surface style={styles.card} testID="why-its-hard-comparison">
            <Text style={styles.heading}>The numbers side by side</Text>
            <Text style={styles.paragraph}>
              Backing one horse per race, £1 a time, across 43,880 races.
            </Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, styles.colLabel]}>Who you back</Text>
              <Text style={[styles.th, styles.colNum]}>Wins</Text>
              <Text style={[styles.th, styles.colNum]}>Lost per £1</Text>
            </View>
            {[
              { who: "The favourite", wins: "35%", lost: "7.5p", best: true },
              { who: "Our model's top pick", wins: "27%", lost: "10p", best: false },
              { who: "A horse at random", wins: "13%", lost: "21p", best: false },
              { who: "Every horse in the race", wins: "12%", lost: "23p", best: false },
            ].map(row => (
              <View key={row.who} style={styles.tableRow} testID={`why-its-hard-row-${row.who.replace(/\s+/g, "-").toLowerCase()}`}>
                <Text style={[styles.td, styles.colLabel, row.best && styles.tdStrong]}>{row.who}</Text>
                <Text style={[styles.td, styles.colNum]}>{row.wins}</Text>
                <Text style={[styles.td, styles.colNum, row.best && styles.tdStrong]}>{row.lost}</Text>
              </View>
            ))}
            <Text style={styles.footnote}>
              Nothing on this list makes money. The favourite simply loses least — and it needs no
              model at all.
            </Text>
          </Surface>

          <Surface style={[styles.card, styles.summaryCard]} testID="why-its-hard-summary">
            <Text style={styles.heading}>The honest summary</Text>
            <Text style={styles.paragraph}>
              A model can be well built, genuinely skilful, and comfortably better than guessing — and
              still lose money, because it's competing against a well-informed crowd while carrying
              the bookmaker's margin.
            </Text>
            <Text style={styles.paragraph}>
              Beating the market isn't a matter of trying harder or adding more cleverness. It needs
              information the market doesn't already have — and by definition, that's the hardest kind
              to get.
            </Text>
          </Surface>

          <Text style={styles.disclaimer} testID="why-its-hard-disclaimer">
            Nothing here is betting advice, and none of the approaches described has been profitable
            in testing. Please gamble responsibly.
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
  paragraph: { fontSize: 15, color: colors.text, lineHeight: 24, marginBottom: spacing.sm },
  footnote: { fontSize: 13, color: colors.textSecondary, lineHeight: 20, marginTop: spacing.md, fontStyle: "italic" },
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
  td: { fontSize: 15, color: colors.text },
  tdStrong: { fontWeight: "700" },
  colLabel: { flex: 2 },
  colNum: { flex: 1, textAlign: "right" },
  disclaimer: {
    fontSize: 12,
    color: colors.textTertiary,
    lineHeight: 18,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
