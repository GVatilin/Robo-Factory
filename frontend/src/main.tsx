import "@fontsource-variable/manrope";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Базовые стили и компоненты раньше страниц: стили страниц уточняют компоненты.
import "./index.css";
import "./ui/ui.css";

import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
