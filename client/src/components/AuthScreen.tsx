import React, { useState, useEffect, useRef } from "react";
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
import { config } from "../config";
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

// "phone-entry" / "phone-code" are their own two-step flow (enter number ->
// send code -> enter code -> verify), not a variant of login/signup — a
// phone sign-in creates or logs into an account with no password at all.
type AuthMode = "login" | "signup" | "phone-entry" | "phone-code";

const PHONE_RE = /^\+[1-9]\d{6,14}$/;

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
  const [phone, setPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);
  const [credentialsFromUrl, setCredentialsFromUrl] = useState(
    testCredentialsFromUrl
  );
  const googleButtonContainerRef = useRef<View>(null);

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

  // Sign In With Google is web-only (Google Identity Services is a
  // browser JS library — there's no equivalent for a native RN build,
  // which this app doesn't currently have anyway). Loads the script once,
  // renders Google's own button into googleButtonContainerRef, and never
  // touches anything if config.googleClientId is blank (no Google Cloud
  // project created yet) — same "just don't render" pattern as the rest
  // of this app's optional integrations.
  useEffect(() => {
    if (!config.googleClientId) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    function renderButton() {
      const google = (window as any).google;
      const container = googleButtonContainerRef.current as unknown as HTMLElement | null;
      if (!google?.accounts?.id || !container) return;
      google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: handleGoogleCredential,
      });
      google.accounts.id.renderButton(container, {
        theme: "outline",
        size: "large",
        width: 300,
      });
    }

    const scriptId = "google-identity-services";
    if (document.getElementById(scriptId)) {
      renderButton();
      return;
    }
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = renderButton;
    document.body.appendChild(script);
    // Deliberately not cleaning up the script tag on unmount — Google's
    // own script is safe to leave loaded/re-initialize if this screen
    // mounts again (e.g. re-opening the sign-up overlay).
  }, [mode]);

  async function handleGoogleCredential(response: { credential?: string }) {
    if (!response.credential) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await chatApi.signInWithGoogle(response.credential);
      if (typeof window !== "undefined") {
        localStorage.setItem("auth_token", result.token);
      }
      chatApi.setToken(result.token);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setIsLoading(false);
    }
  }

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

  const handleSendCode = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await chatApi.sendSmsCode(phone);
      setMode("phone-code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send verification code");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await chatApi.verifySmsCode(phone, smsCode);
      if (typeof window !== "undefined") {
        localStorage.setItem("auth_token", result.token);
      }
      chatApi.setToken(result.token);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid or expired verification code");
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

  const startPhoneSignIn = () => {
    setMode("phone-entry");
    setError(null);
  };

  const backToEmailLogin = () => {
    setMode("login");
    setError(null);
    setPhone("");
    setSmsCode("");
  };

  const passwordsMismatch =
    mode === "signup" && confirmPassword.length > 0 && password !== confirmPassword;

  const isFormValid =
    email.trim() !== "" &&
    password.trim() !== "" &&
    (mode === "login" || (confirmPassword.length > 0 && password === confirmPassword));

  const isPhoneValid = PHONE_RE.test(phone.trim());

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
              {mode === "login"
                ? "Log in to continue"
                : mode === "signup"
                  ? "Create your account"
                  : mode === "phone-entry"
                    ? "Sign in with phone"
                    : "Enter your code"}
            </Text>
          </View>

          {(mode === "login" || mode === "signup") && (
            <>
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
                  style={{ borderRadius: radii.button }}
                >
                  {mode === "login"
                    ? "Need an account? Sign up"
                    : "Already have an account? Log in"}
                </Button>
              </Surface>

              <View style={styles.altSignInSection}>
                <Text style={styles.altSignInDivider}>or</Text>
                {!!config.googleClientId && (
                  <View testID="auth-google-button-container" ref={googleButtonContainerRef} style={styles.googleButtonContainer} />
                )}
                <Button
                  testID="auth-use-phone"
                  mode="outlined"
                  onPress={startPhoneSignIn}
                  disabled={isLoading}
                  style={styles.altSignInButton}
                >
                  Sign in with phone
                </Button>
              </View>
            </>
          )}

          {(mode === "phone-entry" || mode === "phone-code") && (
            <Surface style={styles.form} elevation={1}>
              {mode === "phone-entry" ? (
                <>
                  <TextInput
                    testID="auth-phone-input"
                    mode="outlined"
                    label="Phone number"
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="+14155551234"
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                    style={styles.input}
                  />
                  <Text style={styles.helperText}>
                    Include your country code, e.g. +44 for the UK.
                  </Text>

                  {error && (
                    <Text testID="auth-error" style={styles.errorText}>
                      {error}
                    </Text>
                  )}

                  <Button
                    testID="auth-phone-send-code"
                    mode="contained"
                    onPress={handleSendCode}
                    disabled={!isPhoneValid || isLoading}
                    style={styles.loginButton}
                    contentStyle={styles.loginButtonContent}
                    labelStyle={styles.loginButtonLabel}
                  >
                    {isLoading ? "Sending…" : "Send code"}
                  </Button>
                </>
              ) : (
                <>
                  <Text style={styles.helperText}>Code sent to {phone}</Text>
                  <TextInput
                    testID="auth-sms-code-input"
                    mode="outlined"
                    label="Verification code"
                    value={smsCode}
                    onChangeText={setSmsCode}
                    placeholder="123456"
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                    onSubmitEditing={handleVerifyCode}
                    returnKeyType="done"
                    style={styles.input}
                  />

                  {error && (
                    <Text testID="auth-error" style={styles.errorText}>
                      {error}
                    </Text>
                  )}

                  <Button
                    testID="auth-phone-verify-code"
                    mode="contained"
                    onPress={handleVerifyCode}
                    disabled={smsCode.trim() === "" || isLoading}
                    style={styles.loginButton}
                    contentStyle={styles.loginButtonContent}
                    labelStyle={styles.loginButtonLabel}
                  >
                    {isLoading ? "Verifying…" : "Verify"}
                  </Button>

                  <Button
                    testID="auth-phone-resend"
                    mode="text"
                    onPress={handleSendCode}
                    disabled={isLoading}
                    compact
                    style={{ borderRadius: radii.button }}
                  >
                    Resend code
                  </Button>
                </>
              )}

              {isLoading && (
                <ActivityIndicator animating style={styles.spinner} />
              )}

              <Button
                testID="auth-back-to-login"
                mode="text"
                onPress={backToEmailLogin}
                disabled={isLoading}
                compact
                style={{ borderRadius: radii.button }}
              >
                ← Back to email login
              </Button>
            </Surface>
          )}

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
                : mode === "signup"
                  ? "Sign up with your email — you'll be logged in immediately and we'll send a verification link to confirm your address."
                  : "No password needed — we'll text you a one-time code."}
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
    borderRadius: radii.button,
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
  helperText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  errorText: {
    color: colors.pnlNegative,
  },
  loginButton: {
    marginTop: 4,
    borderRadius: radii.button,
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
  altSignInSection: {
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  altSignInDivider: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  altSignInButton: {
    width: "100%",
    borderRadius: radii.button,
  },
  googleButtonContainer: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
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
