// Client-side half of the raw-model-field filter registry.
//
// The catalogue itself is NOT duplicated here — it is fetched from
// GET /api/industry-sp/filter-fields, whose single definition lives in
// src/lib/filters/field-registry.ts. Only the shape and the param-name rules
// are mirrored, and the param-name rules are three one-line functions that the
// server's dynamic-filter-params.ts states identically. Anything more than that
// (which fields exist, their coverage, their notes, the enum values) travels
// over the wire, so adding a field never means editing this file.
//
// URL round-trip: only fields the user actually chose appear as query params, so
// a bookmark stays short and a saved filter set from before this feature has no
// registry keys in its map at all — it replays exactly as it always did.

export type FilterFieldType = "number" | "enum";
export type FilterFieldFamily = "race" | "runner" | "horse" | "trainer" | "jockey";
export type FilterFieldMatchMode = "equals" | "contains";

export interface FilterEnumValue {
  value: string;
  label: string;
  count: number;
}

export interface FilterFieldDef {
  name: string;
  label: string;
  family: FilterFieldFamily;
  type: FilterFieldType;
  scope: "race" | "runner";
  enabled: boolean;
  coverage: number;
  note?: string;
  overlaps?: string;
  enumValues?: FilterEnumValue[];
  matchMode?: FilterFieldMatchMode;
  enumParam?: string;
}

export interface DynamicFilterValue {
  min?: string;
  max?: string;
  values?: string[];
}

/** Keyed by field name. Only chosen fields appear. */
export type DynamicFilters = Record<string, DynamicFilterValue>;

function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function minParamName(name: string): string {
  return `min${capitalize(name)}`;
}

export function maxParamName(name: string): string {
  return `max${capitalize(name)}`;
}

export function enumParamName(field: FilterFieldDef): string {
  return field.enumParam ?? `${field.name}s`;
}

/** The display order of the two sections and the groups inside them. */
export const FAMILY_LABELS: Record<FilterFieldFamily, string> = {
  race: "Race",
  runner: "Runner",
  horse: "Horse form",
  trainer: "Trainer form",
  jockey: "Jockey form",
};

/**
 * A field matches the picker's search box if the query appears in its name,
 * label or family label. Matching on `name` as well as `label` is deliberate:
 * these are the model's own column names, and someone who has read
 * ml/train_and_predict.py will type `horseAvgRPR`, not "Avg RPR (last 3)".
 */
export function fieldMatchesQuery(field: FilterFieldDef, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    field.name.toLowerCase().includes(q) ||
    field.label.toLowerCase().includes(q) ||
    FAMILY_LABELS[field.family].toLowerCase().includes(q)
  );
}

/** Query params for the chosen filters — the exact spelling the API parses. */
export function dynamicFiltersToParams(
  filters: DynamicFilters,
  fields: FilterFieldDef[]
): Record<string, string> {
  const byName = new Map(fields.map(f => [f.name, f]));
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(filters)) {
    const field = byName.get(name);
    if (!field) continue;
    if (field.type === "enum") {
      if (value.values?.length) out[enumParamName(field)] = value.values.join(",");
      continue;
    }
    // Trimmed-empty is "the user cleared this box", not "zero" — sending it as
    // 0 would apply a bound they just removed.
    if (value.min?.trim()) out[minParamName(name)] = value.min.trim();
    if (value.max?.trim()) out[maxParamName(name)] = value.max.trim();
  }
  return out;
}

/** Read chosen filters back out of a URLSearchParams — the inverse of the above. */
export function dynamicFiltersFromParams(
  params: URLSearchParams,
  fields: FilterFieldDef[]
): DynamicFilters {
  const out: DynamicFilters = {};
  for (const field of fields) {
    if (field.type === "enum") {
      const raw = params.get(enumParamName(field));
      const values = raw ? raw.split(",").filter(Boolean) : [];
      if (values.length) out[field.name] = { values };
      continue;
    }
    const min = params.get(minParamName(field.name));
    const max = params.get(maxParamName(field.name));
    if (min == null && max == null) continue;
    const value: DynamicFilterValue = {};
    if (min != null) value.min = min;
    if (max != null) value.max = max;
    out[field.name] = value;
  }
  return out;
}

/**
 * Every param name the registry could put in a URL.
 *
 * urlHasAnyParams() in ispUrlParams.ts needs this: it decides whether a fresh
 * mount is a bare /isp (show nothing until Apply) or a link arriving with
 * filters already set. A shared link carrying ONLY registry params — perfectly
 * possible, since these are just as bookmarkable as the rest — would otherwise
 * be treated as a bare load and silently ignore them.
 */
export function dynamicFilterParamNames(fields: FilterFieldDef[]): string[] {
  return fields.flatMap(f =>
    f.type === "enum" ? [enumParamName(f)] : [minParamName(f.name), maxParamName(f.name)]
  );
}

export function hasActiveDynamicFilters(filters: DynamicFilters): boolean {
  return Object.values(filters).some(
    v => v.values?.length || v.min?.trim() || v.max?.trim()
  );
}

/** A short "min–max" / "≥ min" / "≤ max" summary for the applied-filters line. */
export function describeDynamicFilter(field: FilterFieldDef, value: DynamicFilterValue): string | null {
  if (field.type === "enum") {
    if (!value.values?.length) return null;
    const byValue = new Map((field.enumValues ?? []).map(v => [v.value, v.label]));
    return `${field.label}: ${value.values.map(v => byValue.get(v) ?? v).join(", ")}`;
  }
  const min = value.min?.trim();
  const max = value.max?.trim();
  if (min && max) return `${field.label} ${min}–${max}`;
  if (min) return `${field.label} ≥ ${min}`;
  if (max) return `${field.label} ≤ ${max}`;
  return null;
}
