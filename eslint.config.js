import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "dist",
    ".npm-cache",
    ".cleanup",
    ".local",
    ".tools",
    ".vercel",
    "test-results",
    "playwright-report",
    "hiperia",
    "hiperia-1",
    "hiperia_program/target",
  ]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    rules: { "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]" }] },
  },
  {
    files: [
      "**/*.test.js",
      "hiperia_program/**/*.js",
      "scripts/**/*.js",
      "eslint.config.js",
      "vite.config.js",
    ],
    languageOptions: { globals: globals.node },
  },
]);
