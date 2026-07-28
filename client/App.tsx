import { StatusBar } from "expo-status-bar";
import { useState, useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
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
import { RunnerDetailScreen } from "./src/components/RunnerDetailScreen";
import { RunnerHistoryScreen } from "./src/components/RunnerHistoryScreen";
import { TrainerDetailScreen } from "./src/components/TrainerDetailScreen";
import { SavedResultsListScreen } from "./src/components/SavedResultsListScreen";
import { SavedResultDetailScreen } from "./src/components/SavedResultDetailScreen";
import { DailyRacesScreen } from "./src/components/DailyRacesScreen";
import { DailyRaceEventScreen } from "./src/components/DailyRaceEventScreen";
import { DailyRaceScreen } from "./src/components/DailyRaceScreen";
import { DailyRunnerDetailScreen } from "./src/components/DailyRunnerDetailScreen";
import { useRouter } from "./src/hooks/useRouter";
import { chatApi } from "./src/services/chatApi";
import { buildReturnParams, resolveReturn } from "./src/utils/returnNav";
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
  // The /isp family is public — an anonymous user can browse it freely and
  // opt into signing up via this dismissible overlay (from a button on
  // IndustrySpScreen) rather than being forced through AuthScreen first.
  const [showAuthOverlay, setShowAuthOverlay] = useState(false);
  const { route, navigate, queryParams } = useRouter();
  const isIspRoute = route === "/isp" || route.startsWith("/isp/");

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

    // Support ?email=<email>&password=<password> in the URL for bookmarked access.
    const params = new URLSearchParams(window.location.search);
    const email = params.get("email");
    const password = params.get("password");
    if (email && password) {
      // Only strip email/password, not the whole query string — /isp's filter
      // params (minRunners, sort, etc.) can ride along in the same bookmarked URL.
      params.delete("email");
      params.delete("password");
      const clean = window.location.pathname + (params.toString() ? `?${params}` : "");
      window.history.replaceState({}, "", clean);
      chatApi.login(email, password).then((result) => {
        localStorage.setItem(TOKEN_KEY, result.token);
        chatApi.setToken(result.token);
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

  const onLogout = () => { localStorage.removeItem(TOKEN_KEY); setIsAuthenticated(false); };
  const onRequestAuth = () => setShowAuthOverlay(true);

  const content = (() => {
    // Events/Chat/Runners stay behind the login wall exactly as before.
    // The /isp family is public — it renders below regardless of
    // isAuthenticated (see isIspRoute).
    if (!isAuthenticated && !isIspRoute) {
      return <AuthScreen onAuthenticated={() => setIsAuthenticated(true)} />;
    }
    if (route === "/chat") {
      return <ChatScreen navigate={navigate} isAuthenticated={isAuthenticated} onLogout={onLogout} />;
    }
    if (route === "/runners") {
      return <AllRunnersScreen navigate={navigate} isAuthenticated={isAuthenticated} onLogout={onLogout} />;
    }
    if (route === "/isp") {
      return (
        <IndustrySpScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onRequestAuth={onRequestAuth}
          onLogout={onLogout}
          // Filter Apply/Reset update the URL directly via history.replaceState
          // (see updateUrlParams), which doesn't flow back through this hook's
          // `queryParams` state — read window.location.search directly here so
          // the just-applied filters (not a stale snapshot from mount) carry
          // over to the races screen. The races screen only understands a
          // single fromRow/toRow pair (not the A/B split), so whichever split
          // card's "View Races" button was clicked overwrites those two keys
          // explicitly — the fromRowA/toRowA/fromRowB/toRowB keys stay in the
          // query string too, but IspRacesScreen ignores them.
          onViewRaces={(fromRow, toRow) => {
            const params = new URLSearchParams(window.location.search);
            params.set("fromRow", String(fromRow));
            if (toRow != null) params.set("toRow", String(toRow));
            else params.delete("toRow");
            navigate("/isp/races", params.toString());
          }}
        />
      );
    }
    if (route === "/isp/races") {
      return (
        <IspRacesScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onLogout={onLogout}
          onRequestAuth={onRequestAuth}
          onBack={() => navigate("/isp", window.location.search.slice(1))}
          onNavigateToMeeting={(meetingId) =>
            navigate("/isp/meeting", `id=${encodeURIComponent(meetingId)}&${buildReturnParams(route)}`)
          }
          onNavigateToRace={(raceId) => navigate("/isp/race", `id=${raceId}&${buildReturnParams(route)}`)}
          onNavigateToRunner={(raceId, runnerId) =>
            navigate("/isp/runner", `raceId=${raceId}&runnerId=${runnerId}&${buildReturnParams(route)}`)
          }
          onNavigateToTrainer={(trainer, formCategory) =>
            navigate("/isp/trainer", `trainer=${encodeURIComponent(trainer)}&formCategory=${formCategory}&${buildReturnParams(route)}`)
          }
        />
      );
    }
    if (route === "/isp/meeting") {
      const meetingId = queryParams.get("id") ?? "";
      // Reachable from more than just the races list now (also from a saved
      // Result's Live Performance section) — "back" must resolve to
      // whichever screen the user actually drilled in from, same as the
      // runner/trainer screens below, not a hardcoded /isp/races.
      const back = resolveReturn(queryParams, "/isp/races");
      return (
        <IndustryMeetingScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onLogout={onLogout}
          onRequestAuth={onRequestAuth}
          meetingId={meetingId}
          onBack={() => navigate(back.route, back.query)}
          onNavigateToRace={(raceId) => navigate("/isp/race", `id=${raceId}&${buildReturnParams(route)}`)}
          onNavigateToRunner={(raceId, runnerId) =>
            navigate("/isp/runner", `raceId=${raceId}&runnerId=${runnerId}&${buildReturnParams(route)}`)
          }
          onNavigateToTrainer={(trainer, formCategory) =>
            navigate("/isp/trainer", `trainer=${encodeURIComponent(trainer)}&formCategory=${formCategory}&${buildReturnParams(route)}`)
          }
        />
      );
    }
    if (route === "/isp/race") {
      const raceId = parseInt(queryParams.get("id") ?? "", 10);
      // Same reasoning as /isp/meeting above — this screen's own "back" (via
      // onNavigateToMeeting once the race has loaded, or onNavigateToIsp as
      // the loading-state fallback) must resolve to wherever the user
      // actually came from, not a hardcoded /isp/races.
      const back = resolveReturn(queryParams, "/isp/races");
      return (
        <IndustryRaceScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onLogout={onLogout}
          onRequestAuth={onRequestAuth}
          raceId={raceId}
          // IndustryRaceScreen only ever calls onNavigateToMeeting as its own
          // back button's action ("go up to my meeting"), never as a forward
          // link — so this hop must forward this screen's own `back`
          // pointer (already resolved above) rather than create a fresh one
          // pointing back at this race. Otherwise the meeting screen's own
          // back button would return here instead of continuing on to
          // wherever this race itself was reached from (e.g. a saved
          // Result's Live Performance section), turning one "back" tap into
          // an infinite Race ⇄ Meeting loop that never reaches it.
          onNavigateToMeeting={(meetingId) =>
            navigate(
              "/isp/meeting",
              `id=${encodeURIComponent(meetingId)}&returnRoute=${encodeURIComponent(back.route)}&returnQuery=${encodeURIComponent(back.query)}`
            )
          }
          onNavigateToIsp={() => navigate(back.route, back.query)}
          onNavigateToRunner={(raceId, runnerId) =>
            navigate("/isp/runner", `raceId=${raceId}&runnerId=${runnerId}&${buildReturnParams(route)}`)
          }
          onNavigateToTrainer={(trainer, formCategory) =>
            navigate("/isp/trainer", `trainer=${encodeURIComponent(trainer)}&formCategory=${formCategory}&${buildReturnParams(route)}`)
          }
        />
      );
    }
    if (route === "/isp/runner") {
      const raceId = parseInt(queryParams.get("raceId") ?? "", 10);
      const runnerId = parseInt(queryParams.get("runnerId") ?? "", 10);
      const back = resolveReturn(queryParams, "/isp/races");
      return (
        <RunnerDetailScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onLogout={onLogout}
          onRequestAuth={onRequestAuth}
          raceId={raceId}
          runnerId={runnerId}
          onBack={() => navigate(back.route, back.query)}
          onNavigateToHistory={(runnerName) =>
            navigate("/isp/runner/history", `runnerName=${encodeURIComponent(runnerName)}&${buildReturnParams(route)}`)
          }
          onNavigateToTrainer={(trainer, formCategory) =>
            navigate("/isp/trainer", `trainer=${encodeURIComponent(trainer)}&formCategory=${formCategory}&${buildReturnParams(route)}`)
          }
        />
      );
    }
    if (route === "/isp/runner/history") {
      const runnerName = queryParams.get("runnerName") ?? "";
      const back = resolveReturn(queryParams, "/isp/races");
      return (
        <RunnerHistoryScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onLogout={onLogout}
          onRequestAuth={onRequestAuth}
          runnerName={runnerName}
          onBack={() => navigate(back.route, back.query)}
          onNavigateToRunner={(raceId, runnerId) =>
            navigate("/isp/runner", `raceId=${raceId}&runnerId=${runnerId}&${buildReturnParams(route)}`)
          }
        />
      );
    }
    if (route === "/isp/trainer") {
      const trainer = queryParams.get("trainer") ?? "";
      const formCategory = queryParams.get("formCategory") === "Jumps" ? "Jumps" : "Flat";
      const back = resolveReturn(queryParams, "/isp/races");
      return (
        <TrainerDetailScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onLogout={onLogout}
          onRequestAuth={onRequestAuth}
          trainer={trainer}
          formCategory={formCategory}
          onBack={() => navigate(back.route, back.query)}
          onNavigateToRunner={(raceId, runnerId) =>
            navigate("/isp/runner", `raceId=${raceId}&runnerId=${runnerId}&${buildReturnParams(route)}`)
          }
        />
      );
    }
    if (route === "/daily-races") {
      return (
        <DailyRacesScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onLogout={onLogout}
          date={queryParams.get("date") ?? undefined}
          onNavigateToEvent={(eventId) => navigate("/daily-races/event", `id=${encodeURIComponent(eventId)}`)}
          onNavigateToRace={(raceId) => navigate("/daily-races/race", `id=${encodeURIComponent(raceId)}`)}
        />
      );
    }
    if (route === "/daily-races/event") {
      const eventId = queryParams.get("id") ?? "";
      return (
        <DailyRaceEventScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onLogout={onLogout}
          eventId={eventId}
          onBack={() => navigate("/daily-races")}
          onNavigateToRace={(raceId) => navigate("/daily-races/race", `id=${encodeURIComponent(raceId)}`)}
        />
      );
    }
    if (route === "/daily-races/race") {
      const raceId = queryParams.get("id") ?? "";
      return (
        <DailyRaceScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onLogout={onLogout}
          raceId={raceId}
          onNavigateToEvent={(eventId) => navigate("/daily-races/event", `id=${encodeURIComponent(eventId)}`)}
          onNavigateToRunner={(raceId, runnerId) =>
            navigate("/daily-races/runner", `raceId=${encodeURIComponent(raceId)}&runnerId=${encodeURIComponent(runnerId)}&${buildReturnParams(route)}`)
          }
        />
      );
    }
    if (route === "/daily-races/runner") {
      const raceId = queryParams.get("raceId") ?? "";
      const runnerId = queryParams.get("runnerId") ?? "";
      const back = resolveReturn(queryParams, "/daily-races");
      return (
        <DailyRunnerDetailScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onLogout={onLogout}
          raceId={raceId}
          runnerId={runnerId}
          onBack={() => navigate(back.route, back.query)}
        />
      );
    }
    if (route === "/results") {
      return (
        <SavedResultsListScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onLogout={onLogout}
          onBack={() => navigate("/events")}
          onOpenResult={(id) => navigate("/results/detail", `id=${id}`)}
        />
      );
    }
    if (route === "/results/detail") {
      const id = queryParams.get("id") ?? "";
      return (
        <SavedResultDetailScreen
          navigate={navigate}
          isAuthenticated={isAuthenticated}
          onLogout={onLogout}
          id={id}
          onBack={() => navigate("/results")}
          onRestore={(filters) => navigate("/isp", new URLSearchParams(filters).toString())}
          onNavigateToMeeting={(meetingId) =>
            navigate("/isp/meeting", `id=${encodeURIComponent(meetingId)}&${buildReturnParams(route)}`)
          }
          onNavigateToRace={(raceId) => navigate("/isp/race", `id=${raceId}&${buildReturnParams(route)}`)}
        />
      );
    }
    return (
      <EventsScreen
        navigate={navigate}
        isAuthenticated={isAuthenticated}
        onLogout={onLogout}
      />
    );
  })();

  return (
    <PaperProvider theme={theme}>
      {content}
      {showAuthOverlay && (
        <View style={StyleSheet.absoluteFill}>
          <AuthScreen
            onAuthenticated={() => { setIsAuthenticated(true); setShowAuthOverlay(false); }}
            onCancel={() => setShowAuthOverlay(false)}
          />
        </View>
      )}
      <StatusBar style="light" />
    </PaperProvider>
  );
}
