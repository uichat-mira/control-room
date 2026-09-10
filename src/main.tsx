import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./ops.css";
import "./governance.css";
import "./visual.css";
import "./navigation.css";

const root = createRoot(document.getElementById("root")!);

async function render() {
  const Page = window.location.pathname === "/docs"
    ? (await import("./DocsPage")).default
    : (await import("./App")).default;

  root.render(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
}

void render();
