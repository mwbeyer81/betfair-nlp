// Turns parsed DynamicFilters into aggregation conditions for
// industry-sp-dao.ts.
//
// Two outputs, because the two scopes land in different places in the pipeline:
// race-scoped conditions go in the `$match { $expr }` over the race document,
// runner-scoped ones go inside the `$filter` over `runners` that defines the
// qualifying set. Mixing them up would silently change the meaning — a
// race-level condition evaluated per runner is merely wasteful, but a
// runner-level one evaluated on the race document reads `$$r` outside its
// binding and throws.

import { DynamicFilters } from "./dynamic-filter-params";
import { fieldValueExpr, getFilterField, FilterField } from "./field-registry";

/**
 * A numeric bound pair as an aggregation condition.
 *
 * The `$isNumber` guard is doing real work and is not defensive noise. Most of
 * these fields are legitimately null for structural reasons — a debutant has no
 * `horseAvgRPR`, a jumps runner has no `draw` — and BSON's cross-type ordering
 * sorts null BELOW every number. Without the guard, `{$lte: [null, 40]}` is
 * true, so `maxDraw=40` would quietly match every jumps runner in the database:
 * the exact opposite of what the filter says. With it, a null value fails every
 * bound, which is what "this runner has no draw" should mean.
 */
function numericCond(value: unknown, min?: number, max?: number): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [{ $isNumber: value }];
  if (min != null) parts.push({ $gte: [value, min] });
  if (max != null) parts.push({ $lte: [value, max] });
  return { $and: parts };
}

/**
 * An enum selection as an aggregation condition.
 *
 * "contains" uses $indexOfCP rather than $regexMatch deliberately: the values
 * are single characters that would each be a valid regex, so a regex would work
 * today, but a substring test says what is meant and cannot acquire a
 * metacharacter problem if a multi-character code is ever added to the registry.
 */
function enumCond(field: FilterField, value: unknown, values: string[]): Record<string, unknown> {
  if (field.matchMode === "contains") {
    return {
      $or: values.map(v => ({ $gte: [{ $indexOfCP: [{ $ifNull: [value, ""] }, v] }, 0] })),
    };
  }
  return { $in: [value, values] };
}

function condsForScope(filters: DynamicFilters, scope: "race" | "runner"): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const [name, bounds] of Object.entries(filters)) {
    const field = getFilterField(name);
    if (!field || field.scope !== scope || !field.enabled) continue;
    const value = fieldValueExpr(field);
    if (field.type === "enum") {
      if (bounds.values?.length) out.push(enumCond(field, value, bounds.values));
      continue;
    }
    if (bounds.min != null || bounds.max != null) {
      out.push(numericCond(value, bounds.min, bounds.max));
    }
  }
  return out;
}

/** `$$r`-bound conditions, for use inside a `$filter`/`$map` over `runners`. */
export function buildDynamicRunnerConds(filters: DynamicFilters): Record<string, unknown>[] {
  return condsForScope(filters, "runner");
}

/** `$`-bound conditions, for use in a `$match { $expr }` on the race document. */
export function buildDynamicRaceConds(filters: DynamicFilters): Record<string, unknown>[] {
  return condsForScope(filters, "race");
}
