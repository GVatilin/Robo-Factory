import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// В режиме разработки запросы /api проксируются на бэкенд (в Docker это делает nginx).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.VITE_API_PROXY ?? "http://localhost:8000",
    },
  },
  build: {
    // 3D-сцена (three.js) — отдельный чанк ~250 КБ gzip, загружается лениво после текста страницы.
    chunkSizeWarningLimit: 1000,
  },
});
