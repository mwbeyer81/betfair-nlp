// Parsing and serialisation for the registry-driven filters in
// ./field-registry.ts, shared between src/server/router.ts (raw Express query
// strings) and saved-filter-set-service.ts (a saved filter set's persisted
// `filters` map) — the same "one parser, never two silently-drifting ones"
// rule src/lib/service/filter-params-util.ts already states for the
// hand-written filters.
//
// PARAM SPELLING
// --------------
// Numeric fields take `min<Name>` / `max<Name>` with the field name's first
// letter capitalised: `minOfficialRating`, `maxDaysSinceLastRun`. Enum fields
// take a single comma-joined param named by `enumParam` (`sexes`, `headgear`),
// matching the convention `countries`/`courses`/`goings` already use.
//
// UNKNOWN NAMES ARE AN ERROR, NOT A NO-OP
// ---------------------------------------
// `?minOffcialRating=80` (note the typo) must not quietly return every race as
// though no filter were set — that is the failure mode where someone trusts a
// number that answered a different question. parseDynamicFilters collects such
// names into `errors` and the route 400s on them.

import { FILTER_FIELDS, FilterField, getFilterField } from "./field-registry";
import { parseCsvListParam, parseFloatParam } from "../service/filter-params-util";

export interface DynamicFilterValue {
  min?: number;
  max?: number;
  values?: string[];
}

export type DynamicFilters = Record<string, DynamicFilterValue>;

export interface ParsedDynamicFilters {
  filters: DynamicFilters;
  errors: string[];
}

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function minParamName(field: FilterField | string): string {
  return `min${capitalize(typeof field === "string" ? field : field.name)}`;
}

export function maxParamName(field: FilterField | string): string {
  return `max${capitalize(typeof field === "string" ? field : field.name)}`;
}

export function enumParamName(field: FilterField): string {
  return field.enumParam ?? `${field.name}s`;
}

/** Every param name the registry owns — used to spot typos and to decide whether a URL carries any of these filters. */
export const DYNAMIC_FILTER_PARAM_NAMES: string[] = FILTER_FIELDS.flatMap(f =>
  f.type === "enum" ? [enumParamName(f)] : [minParamName(f), maxParamName(f)]
);

const KNOWN = new Set(DYNAMIC_FILTER_PARAM_NAMES);

// Anything shaped like one of ours but not actually one of ours. Deliberately
// narrow: it must look like `min<Capital>`/`max<Capital>` so it cannot fire on
// the hand-written `minIsp`/`maxRunners`/`minDate` params, which are parsed
// elsewhere and are not registry fields.
const LOOKS_DYNAMIC = /^(?:min|max)[A-Z]/;

const HAND_WRITTEN_MIN_MAX = new Set([
  "minRunners", "maxRunners", "minIsp", "maxIsp", "minInIspRange", "maxInIspRange",
  "minDate", "maxDate", "minModelWinProbability", "minModelSpEdgePts",
  "minTrainerFormRunners", "maxTrainerFormRunners", "minModelProb", "maxModelProb",
  "minImpliedProb", "maxImpliedProb", "minEdge", "maxEdge",
]);

/**
 * Read every registry filter present in `query`.
 *
 * A field appears in the result only if at least one of its bounds (or a
 * non-empty value list) was supplied, so `hasActiveDynamicFilters` is just an
 * emptiness check and the DAO can skip all of this when nothing is set.
 */
export function parseDynamicFilters(query: Record<string, unknown>): ParsedDynamicFilters {
  const filters: DynamicFilters = {};
  const errors: string[] = [];

  for (const field of FILTER_FIELDS) {
    if (field.type === "enum") {
      const values = parseCsvListParam(query[enumParamName(field)]);
      if (values.length === 0) continue;
      const allowed = new Set((field.enumValues ?? []).map(v => v.value));
      const bad = values.filter(v => !allowed.has(v));
      if (bad.length > 0) {
        errors.push(
          `${enumParamName(field)}: unknown value(s) ${bad.join(", ")}. ` +
          `Allowed: ${[...allowed].join(", ")}`
        );
        continue;
      }
      // A disabled field is listed for explanation only — honouring a filter on
      // one would apply a condition no runner can satisfy, which reads as
      // "your filter found nothing" rather than "this field is empty".
      if (!field.enabled) {
        errors.push(`${enumParamName(field)}: ${field.label} is not filterable (${field.note ?? "no data"})`);
        continue;
      }
      filters[field.name] = { values };
      continue;
    }

    const minRaw = query[minParamName(field)];
    const maxRaw = query[maxParamName(field)];
    if (minRaw == null && maxRaw == null) continue;
    if (!field.enabled) {
      errors.push(`${minParamName(field)}/${maxParamName(field)}: ${field.label} is not filterable (${field.note ?? "no data"})`);
      continue;
    }

    const value: DynamicFilterValue = {};
    // NaN is the sentinel for "supplied but unparseable" — a supplied bound that
    // cannot be read is a caller error, not an unset bound, so it is reported
    // rather than defaulted away. This is why parseFloatParam's fallback is NaN
    // here and not 0: `minAge=0` is a legitimate bound and must survive, which
    // the `parseFloat(x) || fallback` idiom elsewhere in router.ts would eat.
    if (minRaw != null) {
      const n = parseFloatParam(minRaw, NaN);
      if (Number.isNaN(n)) errors.push(`${minParamName(field)}: not a number`);
      else value.min = n;
    }
    if (maxRaw != null) {
      const n = parseFloatParam(maxRaw, NaN);
      if (Number.isNaN(n)) errors.push(`${maxParamName(field)}: not a number`);
      else value.max = n;
    }

    // An inverted range is a stale or hand-edited URL, not a request for
    // nothing — swap, matching clampModelVsSpDateWindow's handling of a
    // backwards date range rather than silently returning an empty result.
    if (value.min != null && value.max != null && value.min > value.max) {
      const swap = value.min;
      value.min = value.max;
      value.max = swap;
    }

    if (value.min != null || value.max != null) filters[field.name] = value;
  }

  for (const key of Object.keys(query)) {
    if (!LOOKS_DYNAMIC.test(key)) continue;
    if (KNOWN.has(key) || HAND_WRITTEN_MIN_MAX.has(key)) continue;
    errors.push(`${key}: unknown filter field`);
  }

  return { filters, errors };
}

export function hasActiveDynamicFilters(filters: DynamicFilters): boolean {
  return Object.keys(filters).length > 0;
}

/** Inverse of parseDynamicFilters — used to write a saved filter set's `filters` map and the URL. */
export function serializeDynamicFilters(filters: DynamicFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(filters)) {
    const field = getFilterField(name);
    if (!field) continue;
    if (field.type === "enum") {
      if (value.values?.length) out[enumParamName(field)] = value.values.join(",");
      continue;
    }
    if (value.min != null) out[minParamName(field)] = String(value.min);
    if (value.max != null) out[maxParamName(field)] = String(value.max);
  }
  return out;
}
