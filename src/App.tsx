import "./App.css";
import GitizenView from "./pages/GitizenView";
import { GitOperationsProvider } from "./context/ContextProvider";

export default function App(): React.JSX.Element {
  return (
    <GitOperationsProvider>
      <GitizenView />
    </GitOperationsProvider>
  );
}
