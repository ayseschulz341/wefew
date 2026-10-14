import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = Number(process.env.PORT ?? 8080);
const backendHttp = `http://127.0.0.1:${backendPort}`;
const backendWs = `ws://127.0.0.1:${backendPort}`;

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    proxy: {
      "/api": backendHttp,
      "/ws": {
        target: backendWs,
        ws: true,
      },
    },
  },
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 900,
  },
});
