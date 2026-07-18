import React, { useState } from "react";
import { View, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { Text, Modal, Portal, Button } from "react-native-paper";
import { colors, radii, spacing } from "../theme";

interface DateRangePickerProps {
  testID: string;
  fromDate: string;
  toDate: string;
  minDate: string;
  maxDate: string;
  onChange: (fromDate: string, toDate: string) => void;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function parseYmd(s: string): { year: number; month: number; day: number } {
  const [y, m, d] = s.split("-").map(n => parseInt(n, 10));
  return { year: y, month: (m || 1) - 1, day: d || 1 };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function formatDisplay(s: string): string {
  const { year, month, day } = parseYmd(s);
  return `${MONTH_NAMES[month].slice(0, 3)} ${day}, ${year}`;
}

// A single-month, tap-to-select-range calendar in the spirit of Airbnb's
// date picker (pick a start day, then an end day, with the days between
// shaded) — scoped to one visible month at a time (not side-by-side
// months) to fit this app's narrow mobile-first layout. The month header
// doubles as a year quick-jump (tap it to reveal a year grid) since
// stepping one month at a time across an 11-year dataset would make
// picking an old date painfully slow.
export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  testID,
  fromDate,
  toDate,
  minDate,
  maxDate,
  onChange,
}) => {
  const [visible, setVisible] = useState(false);
  const [showYearGrid, setShowYearGrid] = useState(false);
  const [viewYear, setViewYear] = useState(() => parseYmd(fromDate).year);
  const [viewMonth, setViewMonth] = useState(() => parseYmd(fromDate).month);
  const [pendingFrom, setPendingFrom] = useState(fromDate);
  const [pendingTo, setPendingTo] = useState<string | null>(toDate);

  const minY = parseYmd(minDate);
  const maxY = parseYmd(maxDate);

  function openPicker() {
    setPendingFrom(fromDate);
    setPendingTo(toDate);
    const f = parseYmd(fromDate);
    setViewYear(f.year);
    setViewMonth(f.month);
    setShowYearGrid(false);
    setVisible(true);
  }

  function handleDayPress(dateStr: string) {
    if (pendingTo != null || dateStr < pendingFrom) {
      // Starting a fresh range, either because a full range was already
      // picked (tapping again restarts) or the new tap is before the
      // current start (the range gets redefined from this earlier date).
      setPendingFrom(dateStr);
      setPendingTo(null);
    } else {
      setPendingTo(dateStr);
    }
  }

  function goToMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewYear(y);
    setViewMonth(m);
  }

  function handleApply() {
    const from = pendingFrom;
    const to = pendingTo ?? pendingFrom;
    onChange(from <= to ? from : to, from <= to ? to : from);
    setVisible(false);
  }

  const years: number[] = [];
  for (let y = minY.year; y <= maxY.year; y++) years.push(y);

  const numDays = daysInMonth(viewYear, viewMonth);
  const firstWeekday = firstWeekdayOfMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);

  return (
    <View>
      <TouchableOpacity
        testID={testID}
        onPress={openPicker}
        style={styles.trigger}
      >
        <Text style={styles.triggerText}>{formatDisplay(fromDate)}</Text>
        <Text style={styles.triggerDash}>→</Text>
        <Text style={styles.triggerText}>{formatDisplay(toDate)}</Text>
      </TouchableOpacity>

      <Portal>
        <Modal
          testID={`${testID}-modal`}
          visible={visible}
          onDismiss={() => setVisible(false)}
          contentContainerStyle={styles.modalContent}
        >
          {showYearGrid ? (
            <View testID={`${testID}-year-grid`}>
              <Text style={styles.modalTitle}>Select a year</Text>
              <ScrollView style={styles.yearScroll}>
                <View style={styles.yearGrid}>
                  {years.map(y => (
                    <TouchableOpacity
                      key={y}
                      testID={`${testID}-year-${y}`}
                      onPress={() => {
                        setViewYear(y);
                        setViewMonth(0);
                        setShowYearGrid(false);
                      }}
                      style={[styles.yearCell, y === viewYear && styles.yearCellActive]}
                    >
                      <Text style={[styles.yearCellText, y === viewYear && styles.yearCellTextActive]}>
                        {y}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : (
            <View testID={`${testID}-day-grid`}>
              <View style={styles.calendarHeader}>
                <TouchableOpacity
                  testID={`${testID}-prev-month`}
                  onPress={() => goToMonth(-1)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.navArrow}>‹</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`${testID}-header-title`}
                  onPress={() => setShowYearGrid(true)}
                >
                  <Text style={styles.modalTitle}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID={`${testID}-next-month`}
                  onPress={() => goToMonth(1)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.navArrow}>›</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.weekdayRow}>
                {WEEKDAY_LABELS.map((w, i) => (
                  <Text key={i} style={styles.weekdayLabel}>{w}</Text>
                ))}
              </View>

              <View style={styles.dayGrid}>
                {cells.map((d, idx) => {
                  if (d == null) return <View key={idx} style={styles.dayCell} />;
                  const dateStr = ymd(viewYear, viewMonth, d);
                  const isStart = dateStr === pendingFrom;
                  const isEnd = pendingTo != null && dateStr === pendingTo;
                  const inRange = pendingTo != null && dateStr > pendingFrom && dateStr < pendingTo;
                  const outOfBounds = dateStr < minDate || dateStr > maxDate;
                  return (
                    <TouchableOpacity
                      key={idx}
                      testID={`${testID}-day-${dateStr}`}
                      disabled={outOfBounds}
                      onPress={() => handleDayPress(dateStr)}
                      style={[
                        styles.dayCell,
                        inRange && styles.dayCellInRange,
                        (isStart || isEnd) && styles.dayCellSelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayCellText,
                          outOfBounds && styles.dayCellTextDisabled,
                          (isStart || isEnd) && styles.dayCellTextSelected,
                        ]}
                      >
                        {d}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          <View style={styles.modalActions}>
            <Button
              testID={`${testID}-clear`}
              mode="text"
              onPress={() => { setPendingFrom(minDate); setPendingTo(null); }}
            >
              Clear
            </Button>
            <View style={styles.modalActionsRight}>
              <Button testID={`${testID}-cancel`} mode="text" onPress={() => setVisible(false)}>
                Cancel
              </Button>
              <Button testID={`${testID}-apply`} mode="contained" onPress={handleApply}>
                Apply
              </Button>
            </View>
          </View>
        </Modal>
      </Portal>
    </View>
  );
};

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  triggerText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  triggerDash: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    margin: spacing.lg,
    maxWidth: 360,
    alignSelf: "center",
    width: "90%",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.text,
    textAlign: "center",
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  navArrow: {
    fontSize: 24,
    color: colors.primary,
    paddingHorizontal: spacing.md,
  },
  weekdayRow: {
    flexDirection: "row",
    marginBottom: spacing.xs,
  },
  weekdayLabel: {
    width: `${100 / 7}%`,
    textAlign: "center",
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  dayGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
  },
  dayCellInRange: {
    backgroundColor: colors.primaryLight,
  },
  dayCellSelected: {
    backgroundColor: colors.primary,
  },
  dayCellText: {
    fontSize: 14,
    color: colors.text,
  },
  dayCellTextDisabled: {
    color: colors.textTertiary,
  },
  dayCellTextSelected: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  yearScroll: {
    maxHeight: 280,
  },
  yearGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  yearCell: {
    width: 78,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  yearCellActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  yearCellText: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  yearCellTextActive: {
    color: "#FFFFFF",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
  },
  modalActionsRight: {
    flexDirection: "row",
    gap: spacing.xs,
  },
});
