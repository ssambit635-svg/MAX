import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.MAX_API_PORT ?? "7999";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // The browser preview is proxied from another origin, so never restrict by host.
    allowedHosts: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    target: "chrome120",
    sourcemap: false,

  },
});
