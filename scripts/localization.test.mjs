import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareCatalogs, flattenCatalog } from "./check-locales.mjs";
import { ESLint } from "eslint";
import { runLinter, runExtractor } from "i18next-cli";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import config from "../i18next.config.mjs";

const eslint = new ESLint();
async function findUntranslatedUi(source) {
  const directory = await mkdtemp(path.join(tmpdir(), "glacier-i18n-"));
  const file = path.join(directory, "Probe.tsx");
  try {
    await writeFile(file, source);
    const [result] = await eslint.lintText(source, {
      filePath: "src/LocalizationProbe.tsx",
    });
    assert.ok(
      !result.messages.some((message) => message.fatal),
      JSON.stringify(result.messages),
    );
    const official = await runLinter({
      ...config,
      extract: { ...config.extract, input: [file], ignore: [] },
    });
    return [...result.messages, ...Object.values(official.files).flat()].filter(
      (issue) => issue.severity !== "warning",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("catalog validation", () => {
  it("rejects missing, extra, empty, and malformed entries", () => {
    assert.match(
      compareCatalogs({ greeting: "Hello" }, {}, "en").join(),
      /Missing/,
    );
    assert.match(
      compareCatalogs({}, { greeting: "Hello" }, "en").join(),
      /Unknown/,
    );
    assert.throws(() => flattenCatalog({ greeting: "" }), /Empty/);
    assert.throws(
      () => flattenCatalog({ greeting: ["Hello"] }),
      /Expected an object/,
    );
  });
  it("requires the same interpolation variables", () => {
    assert.match(
      compareCatalogs(
        { greeting: "Hello {{name}}" },
        { greeting: "Hi {{person}}" },
        "en",
      ).join(),
      /Interpolation mismatch/,
    );
    assert.deepEqual(
      compareCatalogs(
        { greeting: "{{name}}" },
        { greeting: "{{name}} {{name}}" },
        "en",
      ),
      [],
    );
  });
  it("preserves linked React component tags", () => {
    assert.match(
      compareCatalogs(
        { message: "Go to <device>Device</device>" },
        { message: "Go to Device" },
        "en",
      ).join(),
      /Component tag mismatch/,
    );
    assert.deepEqual(
      compareCatalogs(
        { message: "Go to <device>Device</device>" },
        { message: "<device>Gerät</device> öffnen" },
        "de",
      ),
      [],
    );
  });
  it("validates language-specific plurals instead of demanding English forms", () => {
    const source = {
      items_one: "{{count}} item",
      items_other: "{{count}} items",
    };
    assert.deepEqual(
      compareCatalogs(source, { items_other: "{{count}} 個" }, "ja"),
      [],
    );
    assert.match(
      compareCatalogs(source, { items_other: "{{count}}" }, "ar").join(),
      /items_few/,
    );
    assert.deepEqual(
      compareCatalogs(
        source,
        {
          items_zero: "{{count}}",
          items_one: "{{count}}",
          items_two: "{{count}}",
          items_few: "{{count}}",
          items_many: "{{count}}",
          items_other: "{{count}}",
        },
        "ar",
      ),
      [],
    );
  });
});
describe("maintained localization lint configuration", () => {
  const untranslated = [
    '<button title="Save">Save</button>',
    '<input placeholder={busy ? "Working" : "Name"} />',
    '<button>{"New untranslated action"}</button>',
    '<button>{ok ? "Enable device" : "Disable device"}</button>',
    '<input aria-valuetext="Maximum volume" />',
    "<p>{`Saved ${name}`}</p>",
    '<p>{`${ready ? "Ready" : "Waiting"}`}</p>',
    'const caption = "Save changes"; const view = <button>{caption}</button>;',
    "<button>save</button>",
  ];
  for (const source of untranslated) {
    it(`rejects ${source}`, async () => {
      assert.ok((await findUntranslatedUi(source)).length > 0);
    });
  }
  it("allows translations, user data, and technical notation", async () => {
    assert.deepEqual(
      await findUntranslatedUi(
        '<button className="main-button" aria-label={t("save")}>{ready === "connected" && t("save")}{name}<span>dB</span></button>',
      ),
      [],
    );
  });
});

describe("official extraction safety", () => {
  it("checks without writes, preserves dynamic keys, and leaves new entries empty", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "glacier-extract-"));
    const source = path.join(directory, "Probe.tsx");
    const output = path.join(directory, "en-shell.json");
    const original =
      JSON.stringify(
        { saved: "Existing translation", dynamic: "Metadata label" },
        null,
        2,
      ) + "\n";
    try {
      await writeFile(
        source,
        't("saved"); t("newAction"); t("items", { count: 2 });',
      );
      await writeFile(output, original);
      const fixtureConfig = {
        ...config,
        locales: ["en"],
        extract: {
          ...config.extract,
          input: [source],
          ignore: [],
          output: (language, namespace) =>
            path.join(directory, `${language}-${namespace}.json`),
        },
      };
      const dry = await runExtractor(fixtureConfig, {
        isDryRun: true,
        quiet: true,
      });
      assert.equal(dry.hasErrors, false);
      assert.equal(dry.anyFileUpdated, true);
      assert.equal(await readFile(output, "utf8"), original);
      await runExtractor(fixtureConfig, { quiet: true });
      assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
        saved: "Existing translation",
        dynamic: "Metadata label",
        newAction: "",
        items_one: "",
        items_other: "",
      });
      const repeat = await runExtractor(fixtureConfig, {
        isDryRun: true,
        quiet: true,
      });
      assert.equal(repeat.anyFileUpdated, false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
