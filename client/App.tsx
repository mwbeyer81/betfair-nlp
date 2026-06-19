import { StatusBar } from "expo-status-bar";
import { useState, useEffect } from "react";
import { ChatScreen } from "./src/components/ChatScreen";
import { AuthScreen } from "./src/components/AuthScreen";
import { EventsScreen } from "./src/components/EventsScreen";
import { AllRunnersScreen } from "./src/components/AllRunnersScreen";
import { RunnerScreen } from "./src/components/RunnerScreen";
import { useRouter, parseRunnerRoute } from "./src/hooks/useRouter";
import { chatApi } from "./src/services/chatApi";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const { route, navigate } = useRouter();

  // Support ?u=<username>&p=<password> in the URL so the app can be bookmarked
  // with credentials pre-filled (e.g. https://app.example.com/?u=matthew&p=beyer).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const u = params.get("u");
    const p = params.get("p");
    if (u && p) {
      chatApi.setCredentials(u, p);
      setIsAuthenticated(true);
      // Remove credentials from the URL bar without reloading
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
    }
  }, []);

  if (!isAuthenticated) {
    return <AuthScreen onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  if (route === "/chat") {
    return (
      <>
        <ChatScreen
          onLogout={() => setIsAuthenticated(false)}
          onNavigateToEvents={() => navigate("/events")}
        />
        <StatusBar style="light" />
      </>
    );
  }

  const runnerParams = parseRunnerRoute(route);
  if (runnerParams) {
    return (
      <>
        <RunnerScreen
          eventId={runnerParams.eventId}
          runnerId={runnerParams.runnerId}
          runnerName={runnerParams.runnerName}
          onBack={() => navigate("/runners")}
        />
        <StatusBar style="light" />
      </>
    );
  }

  if (route === "/runners") {
    return (
      <>
        <AllRunnersScreen
          onNavigateToEvents={() => navigate("/events")}
          onNavigateToRunner={(eventId, runnerId, runnerName) =>
            navigate(`/runner/${eventId}/${runnerId}?name=${encodeURIComponent(runnerName)}`)
          }
        />
        <StatusBar style="light" />
      </>
    );
  }

  return (
    <>
      <EventsScreen
        onNavigateToChat={() => navigate("/chat")}
        onNavigateToAllRunners={() => navigate("/runners")}
        onLogout={() => setIsAuthenticated(false)}
      />
      <StatusBar style="light" />
    </>
  );
}
