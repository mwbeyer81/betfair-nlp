import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ChatScreen } from "./src/components/ChatScreen";
import { AuthScreen } from "./src/components/AuthScreen";
import { EventsScreen } from "./src/components/EventsScreen";
import { AllRunnersScreen } from "./src/components/AllRunnersScreen";
import { useRouter } from "./src/hooks/useRouter";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const { route, navigate } = useRouter();

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
