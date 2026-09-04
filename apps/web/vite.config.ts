import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
});
