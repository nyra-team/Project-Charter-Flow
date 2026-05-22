import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initThemeEarly } from "./lib/use-theme";

initThemeEarly();

createRoot(document.getElementById("root")!).render(<App />);
