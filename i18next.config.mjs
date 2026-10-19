import { defineConfig, recommendedAcceptedAttributes } from "i18next-cli";
import languages from "./src/locales/languages.json" with { type: "json" };

import {
  technicalText,
  textAttributes,
} from "./scripts/localization-policy.mjs";

const technicalWords = new Set(technicalText);

export default defineConfig({
  locales: Object.keys(languages),
  extract: {
    input: ["src/**/*.{ts,tsx}"],
    ignore: [
      "src/**/*.test.ts",
      "src/**/*.test-support.ts",
      "src/wasm_pkg/**",
      "src/testSetup.ts",
    ],
    output: "src/locales/{{language}}/{{namespace}}.json",
    defaultNS: "shell",
    primaryLanguage: "en",
    removeUnusedKeys: false, // Dynamic metadata keys are intentionally retained.
    sort: false,
    defaultValue: "", // New entries must be translated, never shipped as key names.
  },
  lint: {
    acceptedTags: "all",
    acceptedAttributes: [
      ...new Set([...recommendedAcceptedAttributes, ...textAttributes]),
    ],
  },
  plugins: [
    {
      name: "technical-ui-text",
      lintOnResult: (_file, issues) =>
        issues.filter(
          (issue) =>
            issue.type !== "hardcoded" ||
            !technicalWords.has(issue.text.replace(/\s+/g, " ").trim()),
        ),
    },
  ],
});
