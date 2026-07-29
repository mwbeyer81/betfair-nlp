import React, { useEffect, useState } from "react";
import { TextInput as RNTextInput, StyleSheet, View } from "react-native";
import { Text, Button, Portal, Dialog, SegmentedButtons } from "react-native-paper";
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
  onSave: (values: { orderType: BetOrderType; targetProfit: number; maxStake: number }) => void;
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
  const [targetProfit, setTargetProfit] = useState("");
  const [maxStake, setMaxStake] = useState("");

  // Reset the typed values each time the dialog reopens, same pattern as
  // SaveResultDialog — a previous bet's leftover figures shouldn't bleed
  // into the next one. Defaulting orderType back to "scheduled" preserves
  // today's behavior for anyone who never touches the new toggle.
  useEffect(() => {
    if (visible) {
      setOrderType("scheduled");
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
    onSave({ orderType, targetProfit: targetProfitNum, maxStake: maxStakeNum });
  }

  return (
    <Portal>
      <Dialog testID="place-bet-dialog" visible={visible} onDismiss={onCancel}>
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
            {orderType === "instant" ? "Place Bet Now" : "Schedule Bet"}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
};

const styles = StyleSheet.create({
  orderTypeToggle: {
    marginBottom: spacing.sm,
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
