// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Root config files live outside the src tsconfig; lint them without the
    // type-aware project service so they are still checked.
    files: ["*.config.ts", "*.config.js"],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
  },
);
