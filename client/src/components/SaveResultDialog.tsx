import React, { useEffect, useState } from "react";
import { View, TextInput as RNTextInput, StyleSheet } from "react-native";
import { Text, Button, Portal, Dialog } from "react-native-paper";
import { colors, radii, spacing } from "../theme";

interface SaveResultDialogProps {
  visible: boolean;
  autoNamePreview: string;
  saving: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export const SaveResultDialog: React.FC<SaveResultDialogProps> = ({
  visible,
  autoNamePreview,
  saving,
  error,
  onSave,
  onCancel,
}) => {
  const [name, setName] = useState("");

  // Reset the typed name each time the dialog reopens, so a previous
  // save's leftover text never bleeds into the next one.
  useEffect(() => {
    if (visible) setName("");
  }, [visible]);

  return (
    <Portal>
      <Dialog testID="save-result-dialog" visible={visible} onDismiss={onCancel}>
        <Dialog.Title>Save Result</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium" style={styles.helperText}>
            Give this filter set a name, or leave it blank to use an auto-generated one.
          </Text>
          <RNTextInput
            testID="save-result-dialog-name-input"
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={autoNamePreview}
            placeholderTextColor={colors.textSecondary}
          />
          {error && (
            <Text testID="save-result-dialog-error" style={styles.errorText}>
              {error}
            </Text>
          )}
        </Dialog.Content>
        <Dialog.Actions>
          <Button
            testID="save-result-dialog-cancel"
            mode="text"
            onPress={onCancel}
            disabled={saving}
            style={styles.dialogButton}
          >
            Cancel
          </Button>
          <Button
            testID="save-result-dialog-confirm"
            mode="contained"
            loading={saving}
            disabled={saving}
            onPress={() => onSave(name.trim())}
            style={styles.dialogButton}
          >
            Save
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
};

const styles = StyleSheet.create({
  helperText: {
    marginBottom: spacing.sm,
    color: colors.textSecondary,
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
  errorText: {
    marginTop: spacing.xs,
    color: colors.danger,
  },
  dialogButton: {
    borderRadius: radii.button,
  },
});
