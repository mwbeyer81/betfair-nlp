// The unlisted key for /market-gap.
//
// THIS IS OBSCURITY, NOT SECURITY — the same caveat as whyItsHardLink.ts, and
// it matters MORE here. The app is a static bundle served from a CDN, so this
// string ships to every browser and anyone who opens the JS can read it.
//
// The page behind it is internal strategy: where this product sits against the
// tools already in the market, and what is commercially hard about the
// position. It is written to be defensible if read by anyone — no claim about
// a named competitor that isn't a plain statement of what their product does —
// precisely BECAUSE the key cannot keep it private. Do not add anything to
// that page that would harm us if a competitor read it, because one can.
//
// What the key is actually for: keeping the page out of the burger menu for
// signed-out visitors and off the path of someone guessing URLs, so it can be
// handed to a co-founder, advisor or investor as a link.
export const MARKET_GAP_KEY = "43643d43-bdaa-40a3-ad4c-8deaf4735d2c";

export const MARKET_GAP_QUERY = `k=${MARKET_GAP_KEY}`;

/** The full shareable path, e.g. for a "copy link" affordance. */
export function marketGapUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/market-gap?${MARKET_GAP_QUERY}`;
}
