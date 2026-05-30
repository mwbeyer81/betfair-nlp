import { StatusBar } from "expo-status-bar";
import { useState, useEffect } from "react";
import { ChatScreen } from "./src/components/ChatScreen";
import { AuthScreen } from "./src/components/AuthScreen";
import { EventsScreen } from "./src/components/EventsScreen";
import { AllRunnersScreen } from "./src/components/AllRunnersScreen";
import { useRouter } from "./src/hooks/useRouter";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const { route, navigate } = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("msw") === "1") {
      import("./src/mocks/browser").then(({ worker }) => {
        worker.start({ onUnhandledRequest: "bypass" });
      });
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

  if (route === "/runners") {
    return (
      <>
        <AllRunnersScreen onNavigateToEvents={() => navigate("/events")} />
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
