// The "Raw model fields" section of the Filters screen.
//
// WHY A PICKER RATHER THAN A ROW PER FIELD
// ----------------------------------------
// Every other filter on this screen is a permanent row, which works because
// there are about fifteen of them. This section covers the 21 columns
// ml/train_and_predict.py actually trains on, and rendering all of them up
// front would roughly triple the height of an already-tall panel to expose
// controls almost all of which are unused in any given session.
//
// So: choose a field, get a row. Only chosen fields reach the URL and the saved
// filter set, which keeps a shared link short and means a saved result created
// before this feature has no registry params in it at all.
//
// COVERAGE IS SHOWN, NOT HIDDEN
// -----------------------------
// Several of these fields are sparse for structural reasons — `draw` only
// exists on the Flat, `officialRating` mostly on handicaps, `hg` is null for
// the 62.8% of runners wearing no headgear. Filtering on one silently drops a
// whole category of race, and a user who sets `maxDraw=4` and watches every
// Chase disappear is being failed by the UI rather than by the data. Every
// entry therefore carries its measured coverage, and the ones with a caveat
// carry the caveat.

import React, { useMemo, useState } from "react";
import { View, ScrollView, TextInput as RNTextInput, StyleSheet } from "react-native";
import { Text, Button, Chip, TouchableRipple } from "react-native-paper";
import { colors, radii, spacing } from "../theme";
import {
  FilterFieldDef,
  DynamicFilters,
  DynamicFilterValue,
  FAMILY_LABELS,
  fieldMatchesQuery,
} from "../utils/filterFields";

export interface FilterFieldPickerProps {
  fields: FilterFieldDef[];
  /** Draft state — edits here do nothing until the panel's Apply is pressed, like every other filter. */
  value: DynamicFilters;
  onChange: (next: DynamicFilters) => void;
  loading?: boolean;
  error?: string | null;
}

function coverageLabel(field: FilterFieldDef): string {
  return `${field.coverage.toFixed(1)}% populated`;
}

export function FilterFieldPicker({ fields, value, onChange, loading, error }: FilterFieldPickerProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");

  const chosen = useMemo(
    () => fields.filter(f => value[f.name] != null),
    [fields, value]
  );

  // Already-chosen fields drop out of the picker rather than being shown
  // disabled: picking one twice has no meaning, and the list is long enough
  // that every row removed is worth removing.
  const available = useMemo(
    () => fields.filter(f => value[f.name] == null && fieldMatchesQuery(f, query)),
    [fields, value, query]
  );

  function setField(name: string, next: DynamicFilterValue) {
    onChange({ ...value, [name]: next });
  }

  function addField(field: FilterFieldDef) {
    setField(field.name, field.type === "enum" ? { values: [] } : {});
    setQuery("");
    setPickerOpen(false);
  }

  function removeField(name: string) {
    const next = { ...value };
    delete next[name];
    onChange(next);
  }

  function toggleEnumValue(field: FilterFieldDef, enumValue: string) {
    const current = value[field.name]?.values ?? [];
    const next = current.includes(enumValue)
      ? current.filter(v => v !== enumValue)
      : [...current, enumValue];
    setField(field.name, { values: next });
  }

  if (loading) {
    return (
      <View testID="filter-field-picker" style={styles.section}>
        <Text testID="filter-field-picker-loading" style={styles.stateText}>
          Loading model fields…
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View testID="filter-field-picker" style={styles.section}>
        <Text testID="filter-field-picker-error" style={styles.errorText}>
          {error}
        </Text>
      </View>
    );
  }

  return (
    <View testID="filter-field-picker" style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Raw model fields</Text>
        <Button
          testID="filter-field-picker-add"
          mode="outlined"
          compact
          onPress={() => setPickerOpen(open => !open)}
          style={styles.addBtn}
          labelStyle={styles.addBtnLabel}
        >
          {pickerOpen ? "Close" : "+ Add filter"}
        </Button>
      </View>

      {pickerOpen && (
        <View testID="filter-field-picker-list" style={styles.pickerPanel}>
          <RNTextInput
            testID="filter-field-picker-search"
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search fields…"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <ScrollView style={styles.pickerScroll} keyboardShouldPersistTaps="handled">
            {available.length === 0 ? (
              <Text testID="filter-field-picker-empty" style={styles.stateText}>
                {query.trim() ? `No fields match "${query.trim()}"` : "Every field is already added"}
              </Text>
            ) : (
              available.map(field => (
                <TouchableRipple
                  key={field.name}
                  testID={`filter-field-option-${field.name}`}
                  // A disabled field stays visible and explains itself. Hiding
                  // it would leave someone who knows the model's column list
                  // hunting for a field that looks simply absent.
                  disabled={!field.enabled}
                  onPress={() => addField(field)}
                  style={[styles.option, !field.enabled && styles.optionDisabled]}
                >
                  <View>
                    <View style={styles.optionTop}>
                      <Text style={styles.optionLabel}>{field.label}</Text>
                      <Text style={styles.optionFamily}>{FAMILY_LABELS[field.family]}</Text>
                    </View>
                    <Text style={styles.optionName}>{field.name}</Text>
                    <Text
                      testID={`filter-field-option-${field.name}-coverage`}
                      style={[styles.optionCoverage, !field.enabled && styles.optionCoverageDead]}
                    >
                      {field.enabled ? coverageLabel(field) : "Not filterable — no data"}
                    </Text>
                    {field.note && (
                      <Text testID={`filter-field-option-${field.name}-note`} style={styles.optionNote}>
                        {field.note}
                      </Text>
                    )}
                  </View>
                </TouchableRipple>
              ))
            )}
          </ScrollView>
        </View>
      )}

      {chosen.length === 0 ? (
        <Text testID="filter-field-picker-none" style={styles.stateText}>
          No model-field filters. Add one to narrow by any column the model trains on.
        </Text>
      ) : (
        chosen.map(field => (
          <View
            key={field.name}
            testID={`filter-field-row-${field.name}`}
            style={styles.chosenRow}
          >
            <View style={styles.chosenHeader}>
              <Text style={styles.chosenLabel}>{field.label}</Text>
              <Button
                testID={`filter-field-remove-${field.name}`}
                mode="text"
                compact
                onPress={() => removeField(field.name)}
                labelStyle={styles.removeLabel}
              >
                Remove
              </Button>
            </View>

            {field.type === "enum" ? (
              <ScrollView
                horizontal
                testID={`filter-field-chips-${field.name}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {(field.enumValues ?? []).map(ev => {
                  const selected = (value[field.name]?.values ?? []).includes(ev.value);
                  return (
                    <Chip
                      key={ev.value}
                      testID={`filter-field-chip-${field.name}-${ev.value}`}
                      accessibilityState={{ selected }}
                      compact
                      mode={selected ? "flat" : "outlined"}
                      selected={selected}
                      onPress={() => toggleEnumValue(field, ev.value)}
                      style={selected ? styles.chipActive : styles.chip}
                    >
                      {ev.label}
                    </Chip>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={styles.boundsRow}>
                <RNTextInput
                  testID={`filter-field-min-${field.name}`}
                  style={styles.boundInput}
                  value={value[field.name]?.min ?? ""}
                  onChangeText={v => setField(field.name, { ...value[field.name], min: v })}
                  placeholder="min"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  autoCorrect={false}
                />
                <Text style={styles.boundDash}>–</Text>
                <RNTextInput
                  testID={`filter-field-max-${field.name}`}
                  style={styles.boundInput}
                  value={value[field.name]?.max ?? ""}
                  onChangeText={v => setField(field.name, { ...value[field.name], max: v })}
                  placeholder="max"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  autoCorrect={false}
                />
              </View>
            )}

            <Text testID={`filter-field-coverage-${field.name}`} style={styles.chosenCoverage}>
              {coverageLabel(field)}
              {field.overlaps ? ` · also covered by the ${field.overlaps} filter` : ""}
            </Text>
            {field.note && (
              <Text testID={`filter-field-note-${field.name}`} style={styles.chosenNote}>
                {field.note}
              </Text>
            )}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  addBtn: { borderRadius: radii.sm },
  addBtnLabel: { fontSize: 12, marginVertical: 2 },
  pickerPanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  search: {
    height: 38,
    fontSize: 14,
    color: colors.text,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerScroll: { maxHeight: 260 },
  option: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionDisabled: { opacity: 0.5 },
  optionTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  optionLabel: { fontSize: 14, fontWeight: "600", color: colors.text },
  optionFamily: { fontSize: 11, color: colors.textSecondary },
  optionName: { fontSize: 11, fontFamily: "monospace", color: colors.textSecondary },
  optionCoverage: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  optionCoverageDead: { fontStyle: "italic" },
  optionNote: { fontSize: 11, color: colors.textSecondary, marginTop: 2, lineHeight: 15 },
  chosenRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 6,
  },
  chosenHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chosenLabel: { fontSize: 13, fontWeight: "600", color: colors.text },
  removeLabel: { fontSize: 12 },
  boundsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  boundInput: {
    flex: 1,
    height: 36,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
  },
  boundDash: { fontSize: 14, color: colors.textSecondary },
  chipRow: { gap: 6, paddingVertical: 2 },
  chip: { backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary },
  chosenCoverage: { fontSize: 11, color: colors.textSecondary },
  chosenNote: { fontSize: 11, color: colors.textSecondary, lineHeight: 15 },
  stateText: { fontSize: 12, color: colors.textSecondary },
  errorText: { fontSize: 12, color: colors.danger },
});
