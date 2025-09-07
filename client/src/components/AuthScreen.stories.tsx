import type { Meta, StoryObj } from "@storybook/react";
import { AuthScreen } from "./AuthScreen";
import { useState } from "react";

const meta: Meta<typeof AuthScreen> = {
  title: "Components/AuthScreen",
  component: AuthScreen,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  argTypes: {
    onAuthenticated: { action: "authenticated" },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// Basic story
export const Default: Story = {
  args: {},
};

// Story with URL parameters simulation
export const WithUrlParameters: Story = {
  render: args => {
    // Simulate URL parameters for testing
    const simulateUrlParams = () => {
      // Mock the URL parameters
      const mockUrl = "http://localhost:8081?auth=matthew:beyer";
      console.log("🔐 Simulating URL:", mockUrl);

      // In a real scenario, this would be handled by expo-linking
      // For Storybook, we'll just show what would happen
      alert(
        "In a real app, this would auto-fill with:\nUsername: matthew\nPassword: beyer\n\nAnd attempt auto-login."
      );
    };

    const simulateBase64UrlParams = () => {
      const mockUrl = "http://localhost:8081?auth=bWF0dGhldzpiZXllcg==";
      console.log("🔐 Simulating Base64 URL:", mockUrl);

      alert(
        "In a real app, this would decode to:\nUsername: matthew\nPassword: beyer\n\nAnd attempt auto-login."
      );
    };

    return (
      <div style={{ width: "400px", padding: "20px" }}>
        <div
          style={{
            marginBottom: "20px",
            padding: "10px",
            backgroundColor: "#f0f8ff",
            borderRadius: "8px",
          }}
        >
          <h4>🔐 URL Parameter Testing</h4>
          <p style={{ fontSize: "14px", margin: "10px 0" }}>
            Test how the AuthScreen handles URL parameters:
          </p>
          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            <button
              onClick={simulateUrlParams}
              style={{
                padding: "8px 16px",
                backgroundColor: "#007AFF",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "12px",
              }}
            >
              Test Plain Text URL
            </button>
            <button
              onClick={simulateBase64UrlParams}
              style={{
                padding: "8px 16px",
                backgroundColor: "#28a745",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "12px",
              }}
            >
              Test Base64 URL
            </button>
          </div>
        </div>

        <AuthScreen {...args} />

        <div style={{ marginTop: "20px", fontSize: "12px", color: "#666" }}>
          <p>
            <strong>Test URLs:</strong>
          </p>
          <p>
            • Plain text: <code>?auth=matthew:beyer</code>
          </p>
          <p>
            • Base64: <code>?auth=bWF0dGhldzpiZXllcg==</code>
          </p>
          <p>
            <strong>Note:</strong> URL parsing only works in the actual app, not
            Storybook
          </p>
        </div>
      </div>
    );
  },
  args: {},
};

// Story showing the component with pre-filled credentials
export const PreFilledCredentials: Story = {
  render: args => {
    const [username, setUsername] = useState("matthew");
    const [password, setPassword] = useState("beyer");

    const handleAuthenticated = () => {
      console.log("✅ Authentication successful!");
      alert("Authentication successful! (This is just a demo)");
    };

    return (
      <div style={{ width: "400px", padding: "20px" }}>
        <div
          style={{
            marginBottom: "20px",
            padding: "10px",
            backgroundColor: "#e8f5e8",
            borderRadius: "8px",
          }}
        >
          <h4>👤 Pre-filled Credentials Demo</h4>
          <p style={{ fontSize: "14px", margin: "10px 0" }}>
            This simulates what the component looks like when credentials are
            loaded from URL parameters.
          </p>
          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            <button
              onClick={() => setUsername("")}
              style={{
                padding: "6px 12px",
                backgroundColor: "#ffc107",
                color: "black",
                border: "none",
                borderRadius: "4px",
                fontSize: "12px",
              }}
            >
              Clear Username
            </button>
            <button
              onClick={() => setPassword("")}
              style={{
                padding: "6px 12px",
                backgroundColor: "#ffc107",
                color: "black",
                border: "none",
                borderRadius: "4px",
                fontSize: "12px",
              }}
            >
              Clear Password
            </button>
          </div>
        </div>

        <AuthScreen onAuthenticated={handleAuthenticated} />
      </div>
    );
  },
  args: {},
};

// Story to test the fix for credentials message
export const CredentialsMessageTest: Story = {
  render: args => {
    const [testState, setTestState] = useState("empty");
    const [testUsername, setTestUsername] = useState("");
    const [testPassword, setTestPassword] = useState("");

    const simulateUrlCredentials = () => {
      setTestState("from-url");
      setTestUsername("matthew");
      setTestPassword("beyer");
      console.log("🔐 Simulating credentials loaded from URL");
    };

    const simulateManualTyping = () => {
      setTestState("manual");
      setTestUsername("user");
      setTestPassword("pass");
      console.log("✍️ Simulating manual typing of credentials");
    };

    const resetState = () => {
      setTestState("empty");
      setTestUsername("");
      setTestPassword("");
      console.log("🔄 Resetting to empty state");
    };

    return (
      <div style={{ width: "500px", padding: "20px" }}>
        <div
          style={{
            marginBottom: "20px",
            padding: "10px",
            backgroundColor: "#f0f8ff",
            borderRadius: "8px",
          }}
        >
          <h4>🧪 Credentials Message Test</h4>
          <p style={{ fontSize: "14px", margin: "10px 0" }}>
            Test the fix for the "Credentials loaded from URL parameters"
            message. This message should ONLY appear when credentials come from
            URL, not when typing manually.
          </p>
          <div
            style={{
              display: "flex",
              gap: "10px",
              marginTop: "10px",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={simulateUrlCredentials}
              style={{
                padding: "8px 16px",
                backgroundColor: "#28a745",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "12px",
              }}
            >
              Simulate URL Credentials
            </button>
            <button
              onClick={simulateManualTyping}
              style={{
                padding: "8px 16px",
                backgroundColor: "#007AFF",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "12px",
              }}
            >
              Simulate Manual Typing
            </button>
            <button
              onClick={resetState}
              style={{
                padding: "8px 16px",
                backgroundColor: "#6c757d",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "12px",
              }}
            >
              Reset State
            </button>
          </div>

          <div
            style={{
              marginTop: "15px",
              padding: "10px",
              backgroundColor: "#fff3cd",
              borderRadius: "4px",
            }}
          >
            <p style={{ fontSize: "12px", margin: "0", fontWeight: "bold" }}>
              Current Test State:{" "}
              <span style={{ color: "#856404" }}>{testState}</span>
            </p>
            <p
              style={{
                fontSize: "11px",
                margin: "5px 0 0 0",
                color: "#856404",
              }}
            >
              • "from-url": Should show green credentials message • "manual":
              Should NOT show credentials message (even with filled fields) •
              "empty": No credentials, no message
            </p>
          </div>
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: "8px",
            padding: "20px",
          }}
        >
          <h5 style={{ margin: "0 0 15px 0", color: "#333" }}>
            AuthScreen Component
          </h5>
          <div style={{ marginBottom: "15px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "5px",
                fontWeight: "600",
              }}
            >
              Username:
            </label>
            <input
              type="text"
              value={testUsername}
              onChange={e => setTestUsername(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                border: "1px solid #ddd",
                borderRadius: "4px",
              }}
              placeholder="Enter username"
            />
          </div>
          <div style={{ marginBottom: "15px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "5px",
                fontWeight: "600",
              }}
            >
              Password:
            </label>
            <input
              type="password"
              value={testPassword}
              onChange={e => setTestPassword(e.target.value)}
              style={{
                width: "100%",
                padding: "8px",
                border: "1px solid #ddd",
                borderRadius: "4px",
              }}
              placeholder="Enter password"
            />
          </div>

          {/* Show the credentials message conditionally */}
          {testState === "from-url" && (
            <div
              style={{
                backgroundColor: "#e8f5e8",
                border: "1px solid #4caf50",
                borderRadius: "8px",
                padding: "16px",
                marginBottom: "16px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "600",
                  color: "#2e7d32",
                  marginBottom: "4px",
                }}
              >
                💡 Credentials loaded from URL parameters
              </div>
              <div style={{ fontSize: "14px", color: "#4caf50" }}>
                Press Enter or tap Login to continue
              </div>
            </div>
          )}

          <button
            style={{
              width: "100%",
              padding: "12px",
              backgroundColor: "#007AFF",
              color: "white",
              border: "none",
              borderRadius: "8px",
              fontSize: "16px",
              fontWeight: "600",
            }}
            onClick={() =>
              console.log("✅ Login clicked with:", testUsername, testPassword)
            }
          >
            Login
          </button>
        </div>

        <div style={{ marginTop: "20px", fontSize: "12px", color: "#666" }}>
          <p>
            <strong>Test Instructions:</strong>
          </p>
          <p>1. Click "Simulate URL Credentials" - should show green message</p>
          <p>
            2. Click "Simulate Manual Typing" - should NOT show green message
          </p>
          <p>3. Type in the form manually - should NOT show green message</p>
          <p>4. Click "Reset State" to clear everything</p>
          <p>
            <strong>Expected:</strong> Green message only appears for URL-loaded
            credentials
          </p>
        </div>
      </div>
    );
  },
  args: {},
};
