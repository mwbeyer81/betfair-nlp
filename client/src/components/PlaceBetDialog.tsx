import React, { useEffect, useState } from "react";
import { TextInput as RNTextInput, StyleSheet, View } from "react-native";
import { Text, Button, Portal, Dialog, SegmentedButtons, Switch } from "react-native-paper";
import { colors, radii, spacing } from "../theme";
import { minQualifyingPrice } from "../utils/betOrderFormat";
import { toFractionalOdds } from "../utils/oddsFormat";
import { BetOrderType } from "../services/chatApi";

interface PlaceBetDialogProps {
  visible: boolean;
  horseName: string;
  raceSummary: string;
  saving: boolean;
  error: string | null;
  onSave: (values: { orderType: BetOrderType; targetProfit: number; maxStake: number; sandbox: boolean }) => void;
  onCancel: () => void;
}

export const PlaceBetDialog: React.FC<PlaceBetDialogProps> = ({
  visible,
  horseName,
  raceSummary,
  saving,
  error,
  onSave,
  onCancel,
}) => {
  const [orderType, setOrderType] = useState<BetOrderType>("scheduled");
  const [sandbox, setSandbox] = useState(false);
  const [targetProfit, setTargetProfit] = useState("");
  const [maxStake, setMaxStake] = useState("");

  // Reset the typed values each time the dialog reopens, same pattern as
  // SaveResultDialog — a previous bet's leftover figures shouldn't bleed
  // into the next one. Defaulting orderType back to "scheduled" and
  // sandbox back to off preserves today's behavior for anyone who never
  // touches either toggle.
  useEffect(() => {
    if (visible) {
      setOrderType("scheduled");
      setSandbox(false);
      setTargetProfit("");
      setMaxStake("");
    }
  }, [visible]);

  const targetProfitNum = parseFloat(targetProfit);
  const maxStakeNum = parseFloat(maxStake);
  const minPrice = minQualifyingPrice(targetProfitNum, maxStakeNum);
  const touched = targetProfit !== "" || maxStake !== "";
  const validationError = touched && minPrice == null
    ? "Enter a target profit and max stake greater than zero."
    : null;
  const displayError = validationError ?? error;

  function handleSave() {
    if (minPrice == null) return;
    onSave({ orderType, targetProfit: targetProfitNum, maxStake: maxStakeNum, sandbox: orderType === "instant" && sandbox });
  }

  return (
    <Portal>
      <Dialog testID="place-bet-dialog" visible={visible} onDismiss={onCancel} style={styles.dialog}>
        <Dialog.Title>Bet on {horseName}</Dialog.Title>
        <Dialog.Content>
          <View testID="place-bet-dialog-order-type-toggle">
            <SegmentedButtons
              value={orderType}
              onValueChange={value => setOrderType(value as BetOrderType)}
              style={styles.orderTypeToggle}
              buttons={[
                { value: "scheduled", label: "Schedule", testID: "place-bet-dialog-order-type-scheduled" },
                { value: "instant", label: "Bet now", testID: "place-bet-dialog-order-type-instant" },
              ]}
            />
          </View>
          {orderType === "instant" && (
            <View testID="place-bet-dialog-sandbox-row" style={styles.sandboxRow}>
              <View style={styles.sandboxLabelGroup}>
                <Text style={styles.sandboxLabel}>Sandbox (fake) bet</Text>
                <Text style={styles.sandboxHint}>
                  Never places real money, even if real betting is enabled for your account. Result and P&amp;L are
                  tracked from the real race outcome once it's run.
                </Text>
              </View>
              <Switch testID="place-bet-dialog-sandbox-switch" value={sandbox} onValueChange={setSandbox} />
            </View>
          )}
          <Text variant="bodyMedium" style={styles.helperText}>
            {orderType === "instant"
              ? `${raceSummary} — this places the bet immediately at whatever price Betfair currently offers. It will fail with an error if the current price doesn't already meet your target — there's no waiting for an instant bet.`
              : `${raceSummary} — set how much you want to win and the most you're willing to stake. This only backs the runner if Betfair offers a price high enough to hit your target within that stake.`}
          </Text>
          <Text style={styles.label}>Target profit (£)</Text>
          <RNTextInput
            testID="place-bet-dialog-target-profit-input"
            style={styles.input}
            value={targetProfit}
            onChangeText={setTargetProfit}
            keyboardType="numeric"
            placeholder="e.g. 20"
            placeholderTextColor={colors.textSecondary}
          />
          <Text style={styles.label}>Max stake (£)</Text>
          <RNTextInput
            testID="place-bet-dialog-max-stake-input"
            style={styles.input}
            value={maxStake}
            onChangeText={setMaxStake}
            keyboardType="numeric"
            placeholder="e.g. 10"
            placeholderTextColor={colors.textSecondary}
          />
          {minPrice != null && (
            <Text testID="place-bet-dialog-min-price-preview" style={styles.previewText}>
              Will back at {toFractionalOdds(minPrice)} ({minPrice.toFixed(2)}) or better.
            </Text>
          )}
          {displayError && (
            <Text testID="place-bet-dialog-error" style={styles.errorText}>
              {displayError}
            </Text>
          )}
        </Dialog.Content>
        <Dialog.Actions>
          <Button
            testID="place-bet-dialog-cancel"
            mode="text"
            onPress={onCancel}
            disabled={saving}
            style={styles.dialogButton}
          >
            Cancel
          </Button>
          <Button
            testID="place-bet-dialog-confirm"
            mode="contained"
            loading={saving}
            disabled={saving || minPrice == null}
            onPress={handleSave}
            style={styles.dialogButton}
          >
            {orderType === "instant" ? (sandbox ? "Place Sandbox Bet" : "Place Bet Now") : "Schedule Bet"}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
};

const styles = StyleSheet.create({
  // Paper's Dialog only insets itself by a fixed margin, so on a desktop
  // viewport it grows to nearly the full window width — a two-field form
  // stretched across 1900px, with the Schedule/Bet now toggle and the
  // Cancel/Confirm buttons flung to opposite ends of the screen. Capping
  // it keeps the dialog a dialog at any width; the cap is deliberately
  // narrower than PageContainer's 900 (a short form needs far less room
  // than a page of content), and is a no-op at phone widths, where
  // width:100% minus Paper's own margin already wins.
  dialog: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  orderTypeToggle: {
    marginBottom: spacing.sm,
  },
  sandboxRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sandboxLabelGroup: {
    flex: 1,
  },
  sandboxLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.text,
  },
  sandboxHint: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  helperText: {
    marginBottom: spacing.sm,
    color: colors.textSecondary,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 15,
    color: colors.text,
  },
  previewText: {
    marginTop: spacing.sm,
    fontSize: 13,
    fontWeight: "600",
    color: colors.info,
  },
  errorText: {
    marginTop: spacing.xs,
    color: colors.danger,
  },
  dialogButton: {
    borderRadius: radii.button,
  },
});
