import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@goodganglabs/lipsync-wasm-v1"],
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          vrm: ["@pixiv/three-vrm", "@pixiv/three-vrm-animation"],
          r3f: ["@react-three/fiber", "@react-three/drei"],
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": { target: "http://127.0.0.1:7860", changeOrigin: true },
      "/models": { target: "http://127.0.0.1:7860", changeOrigin: true },
      "/animations": { target: "http://127.0.0.1:7860", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:7860", ws: true },
      "/rtc": { target: "http://127.0.0.1:7860", changeOrigin: true },
    },
  },
});
