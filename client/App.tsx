import { StatusBar } from "expo-status-bar";
import { ChatScreen } from "./src/components/ChatScreen";

export default function App() {
  return (
    <>
      <ChatScreen />
      <StatusBar style="light" />
    </>
  );
}
