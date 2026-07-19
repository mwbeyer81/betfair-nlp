import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from "react-native";
import {
  Text,
  TextInput,
  Button,
  Surface,
  ActivityIndicator,
} from "react-native-paper";
import * as Linking from "expo-linking";
import { chatApi } from "../services/chatApi";
import { colors, radii, spacing } from "../theme";

interface AuthScreenProps {
  onAuthenticated: () => void;
  testCredentialsFromUrl?: boolean;
  // When set, this screen is a dismissible overlay (e.g. an anonymous user
  // on the public /isp page opted into signing up) rather than the
  // unconditional first screen — render a way to back out without
  // authenticating. Omitted entirely on the routes that still require
  // login (/events, /chat, /runners), where dismissing isn't meaningful.
  onCancel?: () => void;
}

type AuthMode = "login" | "signup";

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onAuthenticated,
  testCredentialsFromUrl = false,
  onCancel,
}) => {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Only used in signup mode — a typo-catcher, not sent to the backend.
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);
  const [credentialsFromUrl, setCredentialsFromUrl] = useState(
    testCredentialsFromUrl
  );

  useEffect(() => {
    const parseUrlParams = async () => {
      try {
        const url = await Linking.getInitialURL();
        if (url) {
          const parsed = Linking.parse(url);
          const authParam = parsed.queryParams?.auth;

          if (authParam) {
            const authString = Array.isArray(authParam)
              ? authParam[0]
              : authParam;

            let credentials: string;
            try {
              credentials = atob(authString);
            } catch {
              credentials = authString;
            }

            const [urlEmail, urlPassword] = credentials.split(":");

            if (urlEmail && urlPassword) {
              setEmail(urlEmail);
              setPassword(urlPassword);
              setCredentialsFromUrl(true);

              if (!autoLoginAttempted) {
                setAutoLoginAttempted(true);
                setIsLoading(true);
                chatApi.login(urlEmail, urlPassword).then((result) => {
                  if (typeof window !== "undefined") {
                    localStorage.setItem("auth_token", result.token);
                  }
                  chatApi.setToken(result.token);
                  onAuthenticated();
                }).catch(() => {
                  setIsLoading(false);
                });
              }
            }
          }
        }
      } catch {
        // ignore
      }
    };

    parseUrlParams();
  }, [autoLoginAttempted]);

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result =
        mode === "login"
          ? await chatApi.login(email, password)
          : await chatApi.signup(email, password);
      if (typeof window !== "undefined") {
        localStorage.setItem("auth_token", result.token);
      }
      chatApi.setToken(result.token);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(m => (m === "login" ? "signup" : "login"));
    setError(null);
    // Confirm-password only applies to signup — clear it so a stale value
    // from a previous signup attempt can't linger into the next one.
    setConfirmPassword("");
  };

  const passwordsMismatch =
    mode === "signup" && confirmPassword.length > 0 && password !== confirmPassword;

  const isFormValid =
    email.trim() !== "" &&
    password.trim() !== "" &&
    (mode === "login" || (confirmPassword.length > 0 && password === confirmPassword));

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.content}>
          {onCancel && (
            <Button
              testID="auth-cancel-button"
              mode="text"
              onPress={onCancel}
              compact
              style={styles.cancelButton}
            >
              ← Continue browsing without signing up
            </Button>
          )}
          <View style={styles.header}>
            <Text variant="displaySmall" style={styles.title}>
              BackBet
            </Text>
            <Text variant="bodyLarge" style={styles.subtitle}>
              {mode === "login" ? "Log in to continue" : "Create your account"}
            </Text>
          </View>

          <Surface style={styles.form} elevation={1}>
            <TextInput
              testID="auth-email-input"
              mode="outlined"
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!isLoading}
              style={styles.input}
            />

            <TextInput
              testID="auth-password-input"
              mode="outlined"
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder={
                mode === "signup" ? "At least 5 characters" : "Enter password"
              }
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
              onSubmitEditing={mode === "login" ? handleSubmit : undefined}
              returnKeyType={mode === "login" ? "done" : "next"}
              style={styles.input}
            />

            {mode === "signup" && (
              <>
                <TextInput
                  testID="auth-confirm-password-input"
                  mode="outlined"
                  label="Confirm password"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Re-enter your password"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  onSubmitEditing={handleSubmit}
                  returnKeyType="done"
                  style={styles.input}
                />
                {passwordsMismatch && (
                  <Text testID="auth-confirm-password-error" style={styles.errorText}>
                    Passwords don't match
                  </Text>
                )}
              </>
            )}

            {error && (
              <Text testID="auth-error" style={styles.errorText}>
                {error}
              </Text>
            )}

            <Button
              testID={mode === "login" ? "auth-login-button" : "auth-signup-button"}
              mode="contained"
              onPress={handleSubmit}
              disabled={!isFormValid || isLoading}
              style={styles.loginButton}
              contentStyle={styles.loginButtonContent}
              labelStyle={styles.loginButtonLabel}
            >
              {isLoading
                ? mode === "login"
                  ? "Logging in…"
                  : "Creating account…"
                : mode === "login"
                  ? "Log In"
                  : "Sign Up"}
            </Button>

            {isLoading && (
              <ActivityIndicator animating style={styles.spinner} />
            )}

            <Button
              testID="auth-mode-toggle"
              mode="text"
              onPress={toggleMode}
              disabled={isLoading}
              compact
            >
              {mode === "login"
                ? "Need an account? Sign up"
                : "Already have an account? Log in"}
            </Button>
          </Surface>

          {credentialsFromUrl && (
            <Surface style={styles.urlCredentialsInfo} elevation={0}>
              <Text variant="bodyMedium" style={styles.urlCredentialsText}>
                Credentials loaded from URL parameters
              </Text>
              <Text variant="bodySmall" style={styles.urlCredentialsSubtext}>
                Press Enter or tap Log In to continue
              </Text>
            </Surface>
          )}

          <View style={styles.footer}>
            <Text variant="bodySmall" style={styles.footerText}>
              {mode === "login"
                ? "Please enter your email and password to access BackBet."
                : "Sign up with your email — you'll be logged in immediately and we'll send a verification link to confirm your address."}
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  content: {
    flex: 1,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  cancelButton: {
    alignSelf: "flex-start",
    marginBottom: spacing.md,
  },
  header: {
    alignItems: "center",
    marginBottom: spacing.xxl,
  },
  title: {
    color: colors.primary,
    fontWeight: "bold",
    marginBottom: 4,
  },
  subtitle: {
    color: colors.textSecondary,
    textAlign: "center",
  },
  form: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    marginBottom: spacing.xl,
    gap: spacing.lg,
  },
  input: {
    backgroundColor: colors.surface,
  },
  errorText: {
    color: colors.pnlNegative,
  },
  loginButton: {
    marginTop: 4,
    borderRadius: radii.md,
  },
  loginButtonContent: {
    paddingVertical: 6,
  },
  loginButtonLabel: {
    fontSize: 17,
    fontWeight: "600",
  },
  spinner: {
    marginTop: 4,
  },
  urlCredentialsInfo: {
    backgroundColor: colors.successLight,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: "center",
  },
  urlCredentialsText: {
    color: colors.success,
    fontWeight: "600",
    marginBottom: 2,
  },
  urlCredentialsSubtext: {
    color: colors.success,
    textAlign: "center",
  },
  footer: {
    alignItems: "center",
    gap: 6,
  },
  footerText: {
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
});
