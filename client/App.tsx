import { StatusBar } from "expo-status-bar";
import { useState, useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { Provider as PaperProvider } from "react-native-paper";
import { useFonts } from "@expo-google-fonts/inter/useFonts";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { ChatScreen } from "./src/components/ChatScreen";
import { AuthScreen } from "./src/components/AuthScreen";
import { EventsScreen } from "./src/components/EventsScreen";
import { AllRunnersScreen } from "./src/components/AllRunnersScreen";
import { IndustrySpScreen } from "./src/components/IndustrySpScreen";
import { IspRacesScreen } from "./src/components/IspRacesScreen";
import { IndustryMeetingScreen } from "./src/components/IndustryMeetingScreen";
import { IndustryRaceScreen } from "./src/components/IndustryRaceScreen";
import { useRouter } from "./src/hooks/useRouter";
import { chatApi } from "./src/services/chatApi";
import { theme, colors } from "./src/theme";

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
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
  });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { route, navigate, queryParams } = useRouter();

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
      // Only strip u/p, not the whole query string — /isp's filter params
      // (minRunners, sort, etc.) can ride along in the same bookmarked URL.
      params.delete("u");
      params.delete("p");
      const clean = window.location.pathname + (params.toString() ? `?${params}` : "");
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

  if (!fontsLoaded && !fontError) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

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
      return (
        <IndustrySpScreen
          onNavigateToEvents={() => navigate("/events")}
          // Filter Apply/Reset update the URL directly via history.replaceState
          // (see updateUrlParams), which doesn't flow back through this hook's
          // `queryParams` state — read window.location.search directly here so
          // the just-applied filters (not a stale snapshot from mount) carry
          // over to the races screen.
          onViewRaces={() => navigate("/isp/races", window.location.search.slice(1))}
        />
      );
    }
    if (route === "/isp/races") {
      return (
        <IspRacesScreen
          onBack={() => navigate("/isp", window.location.search.slice(1))}
          onNavigateToMeeting={(meetingId) => navigate("/isp/meeting", `id=${encodeURIComponent(meetingId)}`)}
          onNavigateToRace={(raceId) => navigate("/isp/race", `id=${raceId}`)}
        />
      );
    }
    if (route === "/isp/meeting") {
      const meetingId = queryParams.get("id") ?? "";
      return (
        <IndustryMeetingScreen
          meetingId={meetingId}
          // The user drilled into this meeting from the races list, so "back"
          // returns there (not the filters screen they aren't editing).
          onBack={() => navigate("/isp/races")}
          onNavigateToRace={(raceId) => navigate("/isp/race", `id=${raceId}`)}
        />
      );
    }
    if (route === "/isp/race") {
      const raceId = parseInt(queryParams.get("id") ?? "", 10);
      return (
        <IndustryRaceScreen
          raceId={raceId}
          onNavigateToMeeting={(meetingId) => navigate("/isp/meeting", `id=${encodeURIComponent(meetingId)}`)}
          onNavigateToIsp={() => navigate("/isp/races")}
        />
      );
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
