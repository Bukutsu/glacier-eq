import babelParser from "@babel/eslint-parser";
import i18next from "eslint-plugin-i18next";
import {
  technicalText,
  textAttributes,
} from "./scripts/localization-policy.mjs";

// Lint component variables too, not just JSX. i18next-cli lint separately
// checks literal JSX text, including lowercase words allowed as identifiers here.
export default [
  {
    files: ["src/**/*.tsx"],
    ignores: ["src/**/*.test.tsx", "src/**/*.test-support.tsx"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { parserOpts: { plugins: ["typescript", "jsx"] } },
      },
    },
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "all",
          "should-validate-template": true,
          "jsx-attributes": { include: textAttributes },
          "object-properties": {
            exclude: [
              "value",
              "style",
              "--.*",
              "level",
              "source",
              "key",
              "font",
            ],
          },
          callees: {
            exclude: [
              "t",
              "i18n[.]t",
              "console[.].*",
              "invoke",
              "listen",
              "addEventListener",
              "removeEventListener",
              "includes",
              "startsWith",
              "endsWith",
              "getComputedStyle",
              /querySelector(?:All)?(?:<[^>]*>)?$/,
              "matchMedia",
              "closest",
              "getContext",
              "cssVar",
              "rgbWithAlpha",
              "diagnostic",
              "Error",
            ],
          },
          words: {
            exclude: [
              ...technicalText.map((text) =>
                text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              ),
              // Machine identifiers, URLs, CSS classes, SVG commands, and numeric notation.
              "^[a-z][A-Za-z0-9_.:/-]*$",
              "^https?://.*",
              "^-description$",
              "^[MLZ]$",
              "^border-.*",
              "[0-9!-/:-@[-`{-~…·]+",
              "^[0-9 /]+$",
              "Hz,",
              "dB, Q",
              "^[0-9]+px$",
              "^[0-9]+ [0-9]+px$",
              "CanonicalQ",
              "All",
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "PageUp",
              "PageDown",
              "Home",
              "End",
              "/etc/udev/rules.d/69-glacier-eq.rules",
            ],
          },
        },
      ],
    },
  },
];
