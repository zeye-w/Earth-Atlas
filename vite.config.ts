import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// Cesium workers, terrain assets, and widgets need separate static hosting.
// This follows the official Cesium + Vite pattern (no Cesium ion needed).
const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesium";

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: ["Workers", "Assets", "ThirdParty", "Widgets"].map((dir) => ({
        src: cesiumSource + "/" + dir,
        dest: cesiumBaseUrl,
        // vite-plugin-static-copy v4 preserves the full source path by default.
        // Strip node_modules/cesium/Build/Cesium (4 segments) while retaining
        // Workers/, Assets/, ThirdParty/, and Widgets/ below /cesium/.
        rename: { stripBase: 4 },
      })),
    }),
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify("/" + cesiumBaseUrl),
  },
  build: {
    chunkSizeWarningLimit: 2300,
  },
});
