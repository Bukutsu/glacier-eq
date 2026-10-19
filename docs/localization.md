# Localization

The React UI uses [i18next](https://www.i18next.com/) and
[react-i18next](https://react.i18next.com/). Tauri hosts the same frontend as
the web app; it does not need a native translation plugin. Catalogs are
bundled with the app, so switching languages never needs a network request.

English is the source language. Initial catalogs also cover Thai, Simplified
Chinese, Spanish, Japanese, German, French, and Brazilian Portuguese.
These translations are machine-assisted drafts; native-speaker review is
still needed, especially for audio terminology and safety explanations.
Development builds include an expanded, accented test language to make
untranslated labels and cramped layouts easier to spot.

## Ownership

- `src/locales/en/`: source messages grouped by feature:
  `shell.json`, `settings.json`, `device.json`, `editor.json`, and `library.json`.
- `src/locales/languages.json`: supported language tags, native names, and
  text direction.
- `src/lib/i18n.ts`: initialization, bundled resources, and language preference.
- `src/lib/i18next.d.ts`: TypeScript checks keys against the English catalogs.
- `src/features/settings/components/LanguageSetting.tsx`: language picker.
- `i18next.config.mjs`: official CLI extraction, lint, and status settings.
- `eslint.config.mjs`: maintained i18next lint rule for component text.
- `scripts/localization-policy.mjs`: shared technical-text and UI-prop exceptions.

The preference is local to this installation/browser, separate from DAC
settings. “Follow system” uses the WebView/browser's preferred languages,
tries a regional tag and its parents, then a supported variant in the same
writing system, and falls back to English. For example, Thai `th-TH` selects
`th`, and Simplified Chinese `zh-SG` selects `zh-CN`. Traditional Chinese
does not automatically select the Simplified Chinese catalog. An explicit
choice overrides detection. Changes apply immediately and set the document's
`lang` and `dir`. Blocked storage does not prevent switching for the session.
The UI reports when it cannot save the preference.

## Adding UI text

Add a stable, descriptive key to the appropriate English catalog:

```json
{
  "profile": {
    "saved": "Saved {{name}}",
    "count_one": "{{count}} profile",
    "count_other": "{{count}} profiles"
  }
}
```

In a React component:

```tsx
const { t } = useTranslation("library");
return <Button aria-label={t("profilesView.saveProfile")}>{t("profilesView.saveProfile")}</Button>;
```

Use a translation hook in every component that renders translated text,
including memoized components. Outside React, import `i18n` from
`@/lib/i18n` and call `i18n.t("library:profilesView.saveProfile")` when the action
runs. Do not translate once at module initialization, or keep translated
labels in memoized data without a language dependency.

Translate complete sentences. Use named interpolation values and pass
`count` for plurals; do not join sentence fragments or add English suffixes.
Use `Trans` when a sentence contains a React link. Keep interpolation names
and component tags unchanged across translations. React handles text
escaping; never render translated HTML with `dangerouslySetInnerHTML`.

After adding translation calls, run `npm run locales:extract` to update the
catalogs, then fill the new entries in every supported language. Extraction
keeps existing translations and dynamic metadata keys; it does not delete
unused keys or translate text. New entries without source defaults are empty
so verification rejects them until they are filled.

Use `count` only for grammatical plurals. For a plain number embedded in a
label, use a descriptive interpolation name such as `modelCount`.

## Tooling

`npm run check:locales` runs during verification and both frontend builds:

- **ESLint + eslint-plugin-i18next** flags untranslated component strings,
  including conditional/template text and ordinary caption variables.
  Editors with ESLint support show these errors while editing.
- **i18next-cli lint** checks literal JSX/accessibility text and translation
  interpolation arguments.
- **i18next-cli extract --ci --dry-run** checks that catalogs match extraction
  without changing files. **status** checks used keys and translation coverage.
- The small catalog validator checks registered folders, namespaces, empty
  values, cross-language placeholders/component tags, and required plural
  forms. These checks supplement the CLI rather than parse UI source again.
- TypeScript checks translation keys against the English catalogs.

Useful commands:

```sh
npm run lint:locales       # editor-style checks, no file changes
npm run locales:extract   # update catalogs; review the diff and translate new entries
npm run locales:status    # report missing translations, no file changes
npm run check:locales     # all localization checks, no file changes
```

The lint rules are heuristic, not whole-program data-flow analysis.
ESLint scans component `.tsx` files in all-string mode; the CLI also scans
production `.ts` files for translation calls. Machine identifiers, technical
props, raw diagnostics, and commands have explicit exceptions. New user text
in helpers, uppercase constants, default parameters, or identifier-like
values can still escape detection. Review those paths and use the test
language. Do not silence a warning by moving UI text into an ignored field.
For a genuine technical false positive, use a narrowly scoped ESLint comment
with a reason; keep shared exceptions in `scripts/localization-policy.mjs`.

The Babel parser is used because the current TypeScript ESLint parser does
not support this project's TypeScript 7 peer version. Development tooling
requires Node 22.18+ on the 22.x line, or Node 24.11+.

## Adding a language

1. Copy the five files in `src/locales/en/` to a new language folder, using
   a canonical BCP 47 tag such as `th`, `de`, or `pt-BR`.
2. Translate the values. Preserve keys, named interpolation values such as
   `{{name}}`, and `Trans` component tags such as `<device>`.
3. Use the language's plural forms, not necessarily English's `one/other`.
   `Intl.PluralRules("th").resolvedOptions().pluralCategories`, for example,
   lists the forms needed for Thai.
4. Register its native name and direction in `src/locales/languages.json`:
   `"th": { "name": "ไทย", "direction": "ltr" }`.
5. Run `npm run check:locales`, `npm run verify`, and both frontend builds.
   Check the selector, relaunch with the saved choice, and review long labels
   at desktop and 320 px mobile widths.

Catalog folders are discovered at build time. Adding a language does not
require component changes or a new TypeScript declaration. Adding a new
namespace does require updating `src/lib/i18next.d.ts`.

Direction metadata sets reading direction; it does not establish complete
RTL layout support. Review physical left/right CSS and directional icons
when adding the first RTL language.

## Translation boundaries

Translate interface labels, accessible names, help, confirmations, and
frontend status/error explanations. Keep device/profile names, persistent
profile identities (including `Default EQ`), file formats, protocol names,
commands, units, raw backend errors, and diagnostics unchanged. Do not change
stored names or numeric protocol values when the language changes.

Existing notifications and already-open confirmation dialogs retain the
language they were created in. New messages use the current language.
Startup recovery in `src/lib/bootError.ts` deliberately stays independent
of the translation bundle, so it can work when that bundle fails to load.
Native OS dialogs may use the OS language for their own controls.

## Checks

```sh
npm run check:locales
npm test
npm run typecheck
```

For an interactive check, run `npm run dev:web`, open Settings → General,
and choose the test language. Check navigation, device controls, EQ editing,
profiles, and dialogs. Refresh to check persistence, then choose English or
Follow system. Repeat at narrow widths. Dummy-device checks do not verify
physical USB transport or native WebView behavior.
