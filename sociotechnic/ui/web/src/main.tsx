import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AgentIdentityProvider } from "./components/agent-identity";
import { ThemeProvider } from "./theme/provider";
import "./index.css";
import "./agent-library.css";

const root = document.getElementById("root");
if (!root) throw new Error("Console root is missing");
createRoot(root).render(<StrictMode><ThemeProvider><AgentIdentityProvider><App /></AgentIdentityProvider></ThemeProvider></StrictMode>);
