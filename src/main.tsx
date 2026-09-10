import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Governance from "./Governance";
import "./styles.css";
import "./ops.css";
import "./governance.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <>
      <App />
      <Governance />
    </>
  </StrictMode>,
);
