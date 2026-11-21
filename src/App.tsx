import "./styles/global.css";
import GitizenView from "./pages/GitizenView/GitizenView";
import { AppProvider } from "./context/AppProvider";

export default function App(): React.JSX.Element {
  return (
    <AppProvider>
      <GitizenView />
    </AppProvider>
  );
}
