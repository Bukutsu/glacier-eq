import { beforeEach } from "vitest";
import { i18n } from "@/lib/i18n";

// Render tests use the bundled catalogs, regardless of the host language or
// language changes made by another test.
beforeEach(async () => {
  if (i18n.language !== "en") await i18n.changeLanguage("en");
});
