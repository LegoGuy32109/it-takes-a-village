import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 2000,
  },
  plugins: [fresh(), tailwindcss()],
});
