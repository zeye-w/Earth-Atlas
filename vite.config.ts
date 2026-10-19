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
    // Cesium alone is ~4 MB; keep it in its own long-lived chunk so app
    // changes do not invalidate it, and split React/icons out of the entry.
    chunkSizeWarningLimit: 4500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "cesium", test: /node_modules[\\/](cesium|@cesium)[\\/]/, priority: 20 },
            { name: "vendor", test: /node_modules[\\/](react|react-dom|scheduler|lucide-react)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});
