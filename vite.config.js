import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served from https://schady4.github.io/multiplayer-ai/ (a project page,
// not a user/org page), so assets need the repo name as a base path.
export default defineConfig({
  plugins: [react()],
  base: "/multiplayer-ai/",
});
