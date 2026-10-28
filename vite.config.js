import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  server: {
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem}",
        "**/.git/**",
        "**/target/**",
        "**/.tools/**",
        "**/.local/**",
        "**/.cleanup/**",
        "**/*keypair*.json",
        "**/*wallet*.json",
      ],
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      buffer: "buffer/",
    },
  },
  define: {
    "process.env.BROWSER": JSON.stringify(true),
  },
});
