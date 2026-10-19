import "i18next";
import type shell from "@/locales/en/shell.json";
import type settings from "@/locales/en/settings.json";
import type device from "@/locales/en/device.json";
import type editor from "@/locales/en/editor.json";
import type library from "@/locales/en/library.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "shell";
    returnNull: false;
    strictKeyChecks: true;
    resources: {
      shell: typeof shell;
      settings: typeof settings;
      device: typeof device;
      editor: typeof editor;
      library: typeof library;
    };
  }
}
