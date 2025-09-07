import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import * as Linking from "expo-linking";

interface AuthScreenProps {
  onAuthenticated: () => void;
  // For testing in Storybook - simulates credentials loaded from URL
  testCredentialsFromUrl?: boolean;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onAuthenticated,
  testCredentialsFromUrl = false,
}) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);
  const [credentialsFromUrl, setCredentialsFromUrl] = useState(
    testCredentialsFromUrl
  );

  // Parse URL parameters for authentication
  useEffect(() => {
    const parseUrlParams = async () => {
      try {
        const url = await Linking.getInitialURL();
        if (url) {
          const parsed = Linking.parse(url);
          const authParam = parsed.queryParams?.auth;

          if (authParam) {
            console.log("🔐 Found auth parameter:", authParam);

            // Try to decode as base64 first
            let credentials: string;
            try {
              credentials = atob(authParam);
              console.log("✅ Decoded base64 credentials");
            } catch {
              // If not base64, use as plain text
              credentials = authParam;
              console.log("📝 Using plain text credentials");
            }

            // Parse username:password format
            const [urlUsername, urlPassword] = credentials.split(":");

            if (urlUsername && urlPassword) {
              console.log("👤 Setting credentials from URL");
              setUsername(urlUsername);
              setPassword(urlPassword);
              setCredentialsFromUrl(true);

              // Auto-login after a brief delay to ensure state is set
              setTimeout(() => {
                if (!autoLoginAttempted) {
                  console.log("🚀 Attempting auto-login");
                  setAutoLoginAttempted(true);
                  handleLogin();
                }
              }, 100);
            } else {
              console.log("❌ Invalid credentials format in URL");
            }
          }
        }
      } catch (error) {
        console.log("❌ Error parsing URL:", error);
      }
    };

    parseUrlParams();
  }, [autoLoginAttempted]);

  const handleLogin = () => {
    setIsLoading(true);

    // Simulate a brief loading state
    setTimeout(() => {
      if (username === "matthew" && password === "beyer") {
        onAuthenticated();
      } else {
        Alert.alert(
          "Authentication Failed",
          "Invalid username or password. Please try again.",
          [{ text: "OK" }]
        );
      }
      setIsLoading(false);
    }, 500);
  };

  const isFormValid = username.trim() !== "" && password.trim() !== "";

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Betfair NLP</Text>
            <Text style={styles.subtitle}>Authentication Required</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Username</Text>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="Enter username"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
              />
            </View>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isLoading}
                onSubmitEditing={handleLogin}
                returnKeyType="done"
              />
            </View>

            <TouchableOpacity
              style={[
                styles.loginButton,
                (!isFormValid || isLoading) && styles.loginButtonDisabled,
              ]}
              onPress={handleLogin}
              disabled={!isFormValid || isLoading}
            >
              <Text style={styles.loginButtonText}>
                {isLoading ? "Authenticating..." : "Login"}
              </Text>
            </TouchableOpacity>
          </View>

          {credentialsFromUrl && (
            <View style={styles.urlCredentialsInfo}>
              <Text style={styles.urlCredentialsText}>
                💡 Credentials loaded from URL parameters
              </Text>
              <Text style={styles.urlCredentialsSubtext}>
                Press Enter or tap Login to continue
              </Text>
            </View>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Please enter your credentials to access the chat assistant.
            </Text>
            <Text style={styles.urlInfoText}>
              💡 Tip: You can also use URL parameters like{" "}
              <Text style={styles.urlExample}>?auth=username:password</Text> or{" "}
              <Text style={styles.urlExample}>?auth=base64encoded</Text>
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
    backgroundColor: "#f5f5f5",
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  header: {
    alignItems: "center",
    marginBottom: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#007AFF",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: "#666",
    textAlign: "center",
  },
  form: {
    marginBottom: 32,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  loginButton: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  loginButtonDisabled: {
    backgroundColor: "#ccc",
  },
  loginButtonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "600",
  },
  footer: {
    alignItems: "center",
  },
  footerText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
  urlCredentialsInfo: {
    backgroundColor: "#e8f5e8",
    borderWidth: 1,
    borderColor: "#4caf50",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  urlCredentialsText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2e7d32",
    marginBottom: 4,
  },
  urlCredentialsSubtext: {
    fontSize: 14,
    color: "#4caf50",
    textAlign: "center",
  },
  urlInfoText: {
    fontSize: 12,
    color: "#888",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 16,
  },
  urlExample: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
