import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "vite";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const localPath = (path: string) => relative(root, path).split(sep).join("/");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return entry.name === "wasm_pkg" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test(?:-support)?\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

function imports(path: string, includeTypes = false) {
  const source = readFileSync(path, "utf8");
  return parseSync(path, source).program.body.flatMap((node) => {
    if (
      node.type !== "ImportDeclaration" ||
      (!includeTypes && node.importKind === "type")
    )
      return [];
    if (
      !includeTypes &&
      node.specifiers.length > 0 &&
      node.specifiers.every(
        (specifier) =>
          specifier.type === "ImportSpecifier" &&
          specifier.importKind === "type",
      )
    )
      return [];
    const specifier = node.source.value;
    if (specifier.startsWith("@/")) return [specifier.slice(2)];
    if (specifier.startsWith("."))
      return [localPath(resolve(dirname(path), specifier))];
    return [specifier];
  });
}

describe("frontend ownership boundaries", () => {
  const paths = sourceFiles(root);

  it("keeps feature code independent of app composition", () => {
    const violations = paths
      .filter((path) => localPath(path).startsWith("features/"))
      .flatMap((path) =>
        imports(path, true)
          .filter((target) => target.startsWith("app/"))
          .map((target) => `${localPath(path)} imports ${target}`),
      );
    expect(
      violations,
      "Move shared contracts out of app/; app composes features.",
    ).toEqual([]);
  });

  it("keeps reusable UI independent of features", () => {
    const violations = paths
      .filter((path) => localPath(path).startsWith("components/ui/"))
      .flatMap((path) =>
        imports(path, true)
          .filter((target) => /^(app|features)\//.test(target))
          .map((target) => `${localPath(path)} imports ${target}`),
      );
    expect(
      violations,
      "Feature-specific UI belongs in features/<owner>/components/.",
    ).toEqual([]);
  });

  it("keeps feature helpers and operations free of React UI imports", () => {
    const violations = paths
      .filter((path) =>
        /^features\/[^/]+\/(lib|operations)\//.test(localPath(path)),
      )
      .flatMap((path) =>
        imports(path)
          .filter(
            (target) =>
              target === "react" ||
              target.includes("/components/") ||
              target.startsWith("components/"),
          )
          .map((target) => `${localPath(path)} imports ${target}`),
      );
    expect(
      violations,
      "Put React state in hooks/ and inject operation boundaries.",
    ).toEqual([]);
  });
});
