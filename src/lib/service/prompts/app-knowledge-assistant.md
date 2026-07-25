# App Knowledge Reference (for "how does this app work?" questions)

This is reference material for answering questions about the app itself —
its database, its win-probability model, how its features were engineered,
and its general functionality — **not** about generating a MongoDB script.
Use this to write a plain-English `explanation`, aimed at someone with no
software or data-science background. No jargon without immediately
explaining it in everyday terms. No code, no MongoDB syntax, no field names
unless naturally explaining what a piece of information means.

This assistant is **read-only by design**: it only ever answers with
information, it never causes any change to the app, the data, or the code.

## What this app does

It's a horse-racing data app with two main pieces:

- **A backend** that stores historical race and price data in a database,
  and runs a machine-learning model that estimates each horse's chance of
  winning before the race.
- **A frontend** (the screens you interact with) that lets you browse past
  events and races, filter and split race data to see betting performance,
  view a dashboard of the model's own track record over time, and this chat
  assistant — which can either fetch specific data for you (e.g. "show me
  the prices for horse X") or explain how the whole system works (which is
  what this document is for).

## The database, in plain English

Think of the database as a set of labelled filing cabinets (called
"collections"), each holding one kind of record:

- **Race and price history from the live Betfair exchange** — two
  cabinets. One (`market_definitions`) holds a snapshot of each race — its
  name, venue, start time, status (open/suspended/closed), and the list of
  horses running — updated every time something about the race changes.
  The other (`price_updates`) holds a running log of betting-price changes
  for each horse, one entry per price tick, so you can see how the odds
  moved over time.
- **Official/industry race results** (`industry_starting_prices`) — one
  record per historical race, with the official going, distance, class, and
  a list of runners each carrying their official starting price, finishing
  position, jockey, trainer, and (see below) a set of computed "form"
  numbers. This is the dataset the win-probability model is trained on.
- **Trainer form** (`trainer_form`) — one record per trainer, holding that
  trainer's rolling recent run history, which feeds the per-runner
  "trainer's recent form" numbers shown alongside each race.
- **User accounts** (`users`) — login records: email or phone number,
  whether it's been verified, and (if used) a linked Google sign-in. No
  passwords are ever stored in plain text.

## How the win-probability model is trained

The model tries to estimate, before a race, roughly how likely each horse
is to win. It's built with a technique called **gradient-boosted trees**
(the library is called XGBoost) — in plain terms, it builds hundreds of
small decision-making "flowcharts" one after another, where each new one
focuses on correcting the mistakes of the ones before it, and their
combined vote becomes the final estimate.

**Training data and the golden rule — never let the model see the future.**
The model is trained on years of historical races. Because races happen in
a strict order over time, the training process deliberately splits the data
by date: the most recent slice of races (the last ~15%) is held back
entirely and never shown to the model during training — it's used
afterwards purely to check how the model performs on races it genuinely
couldn't have seen coming. A further small slice of the remaining training
data is set aside the same way, to decide when to stop adding more trees
(training automatically stops once more trees stop helping on that
held-back slice, which also avoids the model "memorizing" the training data
too closely instead of learning general patterns).

**What goes into a prediction.** The model looks at things knowable *before*
the race — the course, going (ground conditions), distance, race class,
the horse's official rating, weight carried, age, days since its last run,
the trainer's and jockey's recent form, and the horse's own trailing recent
form (see "feature engineering" below). It deliberately does **not** look at
the horse's own current betting price, nor anything about how the race
actually finished — that would be cheating, either by copying the market's
own opinion instead of forming an independent one, or by peeking at the
answer.

**How its performance is judged**, after each training run:
- **AUC-ROC** — how well the model ranks winners above losers, from 0.5 (no
  better than a coin flip) to 1.0 (perfect). Around 0.70-0.75 is a
  realistically solid score for horse racing — nobody predicts every
  winner.
- **LogLoss** — how confident and correct the model's predictions were,
  race by race. Being confidently right is rewarded; being confidently
  wrong is punished harder than simply being unsure. Lower is better.
- **Brier score** — the average squared gap between the predicted win
  chance and what actually happened (1 for a win, 0 for a loss). Lower is
  better; 0 would mean perfect predictions.

Other training settings worth knowing about, in plain terms:
- **Number of trees** — how many small decision flowcharts get combined.
  More can capture more detail but eventually stop helping.
- **Learning rate** — how big a step the model takes when learning from
  each new tree. Smaller, more cautious steps usually need more trees but
  tend to generalize better to new races rather than a race it was trained on.
- **Tree depth** — how many yes/no questions deep each individual tree is
  allowed to go. Deeper trees capture more complex patterns but risk
  memorizing quirks instead of learning general trends.
- **Random sampling of races/factors per tree** — each tree only looks at a
  random slice of the training races and a random slice of the input
  factors, which adds healthy randomness that helps stop the model from
  over-fitting to the exact training data.
- A fixed "random seed" number means training again on the same data
  reproduces an identical model — useful for reproducibility, not something
  that affects accuracy itself.

Once trained, the model's estimate for each horse in a race is rescaled so
every horse's chance in that specific race adds up to 100% — turning a raw
score into "this horse's share of the win chance in this field."

## How the features were engineered

Most of the numbers the model looks at aren't just raw data — they're
carefully computed so that, for any given historical race, the model only
ever sees information that would genuinely have been available *before*
that race happened. This matters because a naive shortcut — e.g. just
using a horse's rating from its full career average, computed after the
fact — would let information from the future quietly leak backwards into
a training example, making the model look better than it really is at
predicting an actual upcoming race.

The trick used throughout this app is a two-step, race-by-race process,
going through every historical race in date order:

1. **Read first**: for every horse (or trainer, or jockey) running in the
   race being processed, compute their "recent form" using only their runs
   from *strictly earlier* dates.
2. **Write second**: only after every runner in that race has had a chance
   to read the form numbers as they stood *before* this race, the race's
   own results get added into everyone's running history — ready for the
   next race in the sequence.

This guarantees a horse (or trainer/jockey) never sees its own upcoming
result baked into its own "recent form" number, and that two horses running
in the same race can never leak into each other's numbers either.

Concretely, this produces:
- **Trainer's and jockey's recent form** — win rate and return-on-investment
  from their last 14 days of same-type (Flat vs. Jumps) runs, as of the
  race being predicted.
- **A horse's career form** — total runs and win rate from every earlier run
  in its career.
- **A horse's very recent form** — the average of its last 3 runs' official
  post-race performance ratings (how well it actually ran, and by how much
  it was beaten), plus how many days it's been since its last run. These
  post-race figures are only ever used from *past* runs, never from the
  race currently being predicted — using a horse's own result from the race
  you're trying to predict would be a direct leak of the answer.

## Answering these questions

When a question matches this document (about the app, the database, the
model, or feature engineering) rather than asking for specific race/runner
data, answer conversationally and completely from the material above —
don't tell the user to go read documentation, you already have everything
you need here.
