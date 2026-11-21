import "./RepoPanel.css";
import { useAppContext } from "../../context/AppContext";
import FileDiff from "./FileDiff";
import HistoryList from "./HistoryList";

export default function RepoPanel(): React.JSX.Element {
  const { view } = useAppContext();

  return (
    <section className="center">
      {view === "diff" ? <FileDiff /> : <HistoryList />}
    </section>
  );
}
