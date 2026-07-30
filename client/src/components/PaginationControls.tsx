import React from "react";
import { View, StyleSheet } from "react-native";
import { Text, Button } from "react-native-paper";
import { colors, radii, spacing } from "../theme";

interface PaginationControlsProps {
  testIdPrefix: string;
  page: number;
  // null while the total is unknown — i.e. the request that produced the current
  // rows opted out of the count query (includeTotal: false). Last-page jumps are
  // impossible in that state, so the Last button hides rather than guessing.
  totalPages: number | null;
  total: number | null;
  limit: number;
  rowsPerPageOptions?: number[];
  disabled?: boolean;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

const DEFAULT_ROWS_PER_PAGE = [25, 50, 100, 200];

// Numbered page navigation. Deliberately NOT the "Load more" pattern every other
// screen in this app uses (IspRacesScreen, AllRunnersScreen, DailyRacesScreen):
// those append to a growing list you scroll through, which suits a hierarchical
// race browser. A flat, sortable runner table with an exact match count is a
// different shape — "show me page 40 of the biggest model-vs-SP gaps" is a real
// request there, and Load-more can't express it.
//
// Its own component (rather than inline in ModelVsSpScreen) so it's reviewable
// and storybook-testable in isolation, and reusable when a second screen wants
// numbered paging.
export const PaginationControls: React.FC<PaginationControlsProps> = ({
  testIdPrefix,
  page,
  totalPages,
  total,
  limit,
  rowsPerPageOptions = DEFAULT_ROWS_PER_PAGE,
  disabled = false,
  onPageChange,
  onLimitChange,
}) => {
  const onFirstPage = page <= 1;
  const onLastPage = totalPages != null && page >= totalPages;
  const singlePage = totalPages != null && totalPages <= 1;

  const status =
    totalPages != null
      ? `Page ${page.toLocaleString()} of ${totalPages.toLocaleString()}`
      : `Page ${page.toLocaleString()}`;

  return (
    <View testID={testIdPrefix} style={styles.container}>
      <View style={styles.pageRow}>
        <Button
          testID={`${testIdPrefix}-first`}
          mode="outlined"
          compact
          disabled={disabled || onFirstPage}
          onPress={() => onPageChange(1)}
          style={styles.pageButton}
          labelStyle={styles.pageButtonLabel}
        >
          ‹‹ First
        </Button>
        <Button
          testID={`${testIdPrefix}-prev`}
          mode="outlined"
          compact
          disabled={disabled || onFirstPage}
          onPress={() => onPageChange(page - 1)}
          style={styles.pageButton}
          labelStyle={styles.pageButtonLabel}
        >
          ‹ Prev
        </Button>

        <Text testID={`${testIdPrefix}-status`} style={styles.status}>
          {status}
        </Text>

        <Button
          testID={`${testIdPrefix}-next`}
          mode="outlined"
          compact
          disabled={disabled || onLastPage || singlePage}
          onPress={() => onPageChange(page + 1)}
          style={styles.pageButton}
          labelStyle={styles.pageButtonLabel}
        >
          Next ›
        </Button>
        {/* Hidden, not merely disabled, when totalPages is unknown — there is no
            last page to jump to, and a permanently-dead button reads as a bug. */}
        {totalPages != null && (
          <Button
            testID={`${testIdPrefix}-last`}
            mode="outlined"
            compact
            disabled={disabled || onLastPage || singlePage}
            onPress={() => onPageChange(totalPages)}
            style={styles.pageButton}
            labelStyle={styles.pageButtonLabel}
          >
            Last ››
          </Button>
        )}
      </View>

      <View testID={`${testIdPrefix}-rows-per-page`} style={styles.rowsRow}>
        <Text style={styles.rowsLabel}>Rows per page</Text>
        {rowsPerPageOptions.map(option => {
          const active = option === limit;
          return (
            <Button
              key={option}
              testID={`${testIdPrefix}-rows-per-page-${option}`}
              mode={active ? "contained" : "outlined"}
              compact
              disabled={disabled}
              accessibilityState={{ selected: active }}
              // Page 1, always: page 7 of a 25-row pagination covers rows
              // 151-175, which is a different (and usually empty) place in a
              // 200-row pagination. Resetting is the only non-surprising choice.
              onPress={() => onLimitChange(option)}
              buttonColor={active ? colors.accent : undefined}
              style={styles.rowsButton}
              labelStyle={styles.rowsButtonLabel}
            >
              {String(option)}
            </Button>
          );
        })}
        {total != null && (
          <Text testID={`${testIdPrefix}-total`} style={styles.rowsLabel}>
            {total.toLocaleString()} total
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  pageRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  pageButton: {
    borderRadius: radii.button,
    borderColor: colors.border,
    minWidth: 0,
  },
  pageButtonLabel: {
    fontSize: 12,
    marginHorizontal: spacing.sm,
  },
  status: {
    fontSize: 13,
    color: colors.text,
    fontFamily: "Inter_500Medium",
    paddingHorizontal: spacing.sm,
  },
  rowsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  rowsLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginRight: spacing.xs,
  },
  rowsButton: {
    borderRadius: radii.button,
    borderColor: colors.border,
    minWidth: 0,
  },
  rowsButtonLabel: {
    fontSize: 11,
    marginHorizontal: spacing.sm,
  },
});
