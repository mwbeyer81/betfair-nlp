import { StatusBar } from "expo-status-bar";
import { useState, useEffect } from "react";
import { Provider as PaperProvider } from "react-native-paper";
import { ChatScreen } from "./src/components/ChatScreen";
import { AuthScreen } from "./src/components/AuthScreen";
import { EventsScreen } from "./src/components/EventsScreen";
import { AllRunnersScreen } from "./src/components/AllRunnersScreen";
import { IndustrySpScreen } from "./src/components/IndustrySpScreen";
import { useRouter } from "./src/hooks/useRouter";
import { chatApi } from "./src/services/chatApi";
import { theme } from "./src/theme";

const TOKEN_KEY = "auth_token";

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { route, navigate } = useRouter();

  // Restore token from localStorage on mount, then check for ?u=&p= URL params.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored && !isTokenExpired(stored)) {
      chatApi.setToken(stored);
      setIsAuthenticated(true);
    } else if (stored) {
      localStorage.removeItem(TOKEN_KEY);
    }

    // Support ?u=<username>&p=<password> in the URL for bookmarked access.
    const params = new URLSearchParams(window.location.search);
    const u = params.get("u");
    const p = params.get("p");
    if (u && p) {
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
      chatApi.login(u, p).then((token) => {
        localStorage.setItem(TOKEN_KEY, token);
        chatApi.setToken(token);
        setIsAuthenticated(true);
      }).catch(() => {
        // Invalid URL credentials — fall through to login screen
      });
    }
  }, []);

  const content = (() => {
    if (!isAuthenticated) {
      return <AuthScreen onAuthenticated={() => setIsAuthenticated(true)} />;
    }
    if (route === "/chat") {
      return (
        <ChatScreen
          onLogout={() => { localStorage.removeItem(TOKEN_KEY); setIsAuthenticated(false); }}
          onNavigateToEvents={() => navigate("/events")}
        />
      );
    }
    if (route === "/runners") {
      return <AllRunnersScreen onNavigateToEvents={() => navigate("/events")} />;
    }
    if (route === "/isp") {
      return <IndustrySpScreen onNavigateToEvents={() => navigate("/events")} />;
    }
    return (
      <EventsScreen
        onNavigateToChat={() => navigate("/chat")}
        onNavigateToAllRunners={() => navigate("/runners")}
        onNavigateToIsp={() => navigate("/isp")}
        onLogout={() => { localStorage.removeItem(TOKEN_KEY); setIsAuthenticated(false); }}
      />
    );
  })();

  return (
    <PaperProvider theme={theme}>
      {content}
      <StatusBar style="light" />
    </PaperProvider>
  );
}
