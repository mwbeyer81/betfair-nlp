// The unlisted key for /why-its-hard.
//
// THIS IS OBSCURITY, NOT SECURITY. The app is a static bundle served from a
// CDN, so this string ships to every browser and anyone who opens the JS can
// read it. It keeps the page out of the burger menu for signed-out visitors
// and off the path of anyone guessing URLs — it does NOT make the page
// private, and nothing behind it may ever be treated as confidential.
//
// What it is actually for: the page can be handed out as a link without being
// discoverable by someone poking at the site.
export const WHY_ITS_HARD_KEY = "a18e5351-b4bb-4a9f-a014-715f72b1f0ee";

export const WHY_ITS_HARD_QUERY = `k=${WHY_ITS_HARD_KEY}`;

/** The full shareable path, e.g. for a "copy link" affordance. */
export function whyItsHardUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/why-its-hard?${WHY_ITS_HARD_QUERY}`;
}
