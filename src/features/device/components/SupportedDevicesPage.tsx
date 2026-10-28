import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { invoke } from "@/lib/rpc";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { SupportedDeviceInfo } from "@/types";
import {
  filterDeviceModels,
  groupDeviceProfiles,
  usbId,
  type CatalogModel,
} from "../lib/deviceCatalog";

const COUNT = "mt-6 mb-3 text-[12px] text-[var(--muted-foreground)]";
const LIST = "m-0 list-none border-t border-[var(--border)] p-0";
const ITEM =
  "grid grid-cols-[minmax(0,1fr)_160px_90px] items-start gap-5 border-b border-[var(--border)] py-5 [&_[data-slot=badge]]:justify-self-end [&_h2]:m-0 [&_h2]:mb-[5px] [&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:leading-[1.4] max-[600px]:grid-cols-[minmax(0,1fr)_auto] max-[600px]:gap-x-4 max-[600px]:gap-y-2.5 max-[600px]:[&_[data-slot=badge]]:col-start-2 max-[600px]:[&_[data-slot=badge]]:row-start-1";
const IDENT =
  "min-w-0 [overflow-wrap:anywhere] [&_p]:m-0 [&_p]:mb-2 [&_p]:text-[12px] [&_p]:text-[var(--muted-foreground)] max-[600px]:col-start-1";
const USB = "flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--muted-foreground)]";
const CAP =
  "text-[13px] leading-[1.6] [&_small]:block [&_small]:text-[12px] [&_small]:text-[var(--muted-foreground)] max-[600px]:col-start-1";
const MAIN =
  "h-full select-text overflow-auto bg-[var(--background)] text-[var(--foreground)] [&_:is(a,select):focus-visible]:outline-2 [&_:is(a,select):focus-visible]:outline-offset-[3px] [&_:is(a,select):focus-visible]:outline-ring";
const CONTENT = "mx-auto max-w-[1080px] px-8 pt-7 pb-12 max-[600px]:px-[18px] max-[600px]:pt-5 max-[600px]:pb-9";
const NAV =
  "flex justify-between gap-6 [&_a]:text-[var(--foreground)] [&_a]:underline-offset-4 [&_a:first-child]:no-underline [&_a:first-child]:[font-weight:650]";
const HEADING =
  "pt-[44px] pb-6 max-[600px]:pt-8 [&_h1]:m-0 [&_h1]:mb-[14px] [&_h1]:[font-size:clamp(28px,5vw,42px)] [&_h1]:leading-[1.15] [&_h1]:tracking-[-0.03em] [&_p]:m-0 [&_p]:mb-2.5 [&_p]:max-w-[65ch] [&_p]:leading-[1.6] [&_p]:text-[var(--muted-foreground)]";
const LEGEND =
  "mb-7 [border-inline-start:3px_solid_var(--ring)] ps-[18px] [&_p]:my-1.5 [&_p]:max-w-[78ch] [&_p]:text-[13px] [&_p]:leading-[1.6] [&_p]:text-[var(--muted-foreground)] [&_strong]:me-[5px] [&_strong]:text-[var(--foreground)]";
const FILTERS =
  "grid grid-cols-[minmax(0,1fr)_180px] gap-4 max-[600px]:grid-cols-[minmax(0,1fr)] [&_label]:grid [&_label]:gap-2 [&_label]:text-[13px] [&_select]:h-11 [&_select]:w-full [&_select]:rounded-[var(--control-radius)] [&_select]:border [&_select]:border-[var(--input)] [&_select]:bg-[var(--field-background)] [&_select]:px-2.5 [&_select]:text-[var(--foreground)] [&_select]:[font:inherit]";
const FOOTER = "mt-7 text-[13px] leading-[1.6] text-[var(--muted-foreground)] [&_a]:text-[var(--foreground)] [&_a]:underline-offset-4";

export function DeviceCatalogResults({
  models,
  query,
  status,
}: {
  models: CatalogModel[];
  query: string;
  status: string;
}) {
  const { t } = useTranslation("device");
  const visible = filterDeviceModels(models, query, status);
  return (
    <>
      <p role="status" className={COUNT}>
        {t("catalog.results", { shown: visible.length, total: models.length })}
      </p>
      {visible.length === 0 ? (
        <p className="py-6">{t("catalog.noResults")}</p>
      ) : (
        <ul className={LIST}>
          {visible.map(({ profile, variants }) => (
            <li
              key={JSON.stringify([profile.name, profile.protocol])}
              className={ITEM}
            >
              <div className={IDENT}>
                <h2>{profile.name}</h2>
                <p>
                  {profile.family} · {profile.protocol}
                </p>
                <div className={USB}>
                  {variants.map((variant) => (
                    <span
                      key={JSON.stringify([
                        variant.vendor_id,
                        variant.product_id,
                      ])}
                    >
                      {usbId(variant.vendor_id)}
                      {variant.product_id == null
                        ? ` · ${t(variant.usb_product_names?.length ? "catalog.nameMatch" : "catalog.vendorMatch")}`
                        : `:${usbId(variant.product_id)}`}
                    </span>
                  ))}
                </div>
              </div>
              <div className={CAP}>
                {profile.hardware_eq
                  ? t("catalog.bands", { bands: profile.num_bands })
                  : t("catalog.controlsOnly")}
                {!profile.hardware_eq && profile.controls === "dawn_pro" && (
                  <small>{t("catalog.nativeOnly")}</small>
                )}
              </div>
              <Badge
                className={profile.status === "Tested" ? "text-[var(--green)]! border-[var(--green)]!" : ""}
              >
                {profile.status === "Tested"
                  ? t("deviceChooser.tested")
                  : profile.status === "Untested"
                    ? t("deviceChooser.untested")
                    : profile.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function SupportedDevicesPage() {
  const { t } = useTranslation("device");
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const status = ["Tested", "Untested"].includes(params.get("status") ?? "")
    ? params.get("status")!
    : "";
  const [models, setModels] = useState<CatalogModel[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    void invoke<SupportedDeviceInfo[]>("list_supported_devices")
      .then((profiles) => {
        if (active) setModels(groupDeviceProfiles(profiles));
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  useEffect(() => {
    const old = document.title;
    document.title = t("catalog.title");
    return () => {
      document.title = old;
    };
  }, [t]);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  return (
    <main className={MAIN}>
      <div className={CONTENT}>
        <nav className={NAV} aria-label={t("catalog.navigation")}>
          <Link to="/eq">Glacier EQ</Link>
          <Link to="/eq">{t("catalog.openApp")}</Link>
        </nav>
        <header className={HEADING}>
          <h1>{t("catalog.title")}</h1>
          <p>{t("catalog.description")}</p>
          <p className="text-[12px]">
            {t("catalog.build", { version: __APP_VERSION__ })}
          </p>
        </header>
        <section
          className={LEGEND}
          aria-label={t("catalog.statusMeaning")}
        >
          <p>
            <strong>{t("deviceChooser.tested")}</strong>{" "}
            {t("catalog.testedDescription")}
          </p>
          <p>
            <strong>{t("deviceChooser.untested")}</strong>{" "}
            {t("catalog.untestedDescription")}
          </p>
          <p>{t("catalog.scope")}</p>
        </section>
        <div className={FILTERS}>
          <label htmlFor="catalog-search">
            {t("catalog.search")}
            <Input
              id="catalog-search"
              type="search"
              value={query}
              placeholder={t("catalog.searchPlaceholder")}
              onChange={(event) => change("q", event.target.value)}
            />
          </label>
          <label htmlFor="catalog-status">
            {t("catalog.status")}
            <select
              id="catalog-status"
              value={status}
              onChange={(event) => change("status", event.target.value)}
            >
              <option value="">{t("catalog.allStatuses")}</option>
              <option value="Tested">{t("deviceChooser.tested")}</option>
              <option value="Untested">{t("deviceChooser.untested")}</option>
            </select>
          </label>
        </div>
        {error ? (
          <ErrorNotice
            action={
              <Button onClick={() => setAttempt((value) => value + 1)}>
                {t("catalog.retry")}
              </Button>
            }
          >
            {t("catalog.loadError")}
          </ErrorNotice>
        ) : models === null ? (
          <p role="status">{t("catalog.loading")}</p>
        ) : (
          <DeviceCatalogResults models={models} query={query} status={status} />
        )}
        <footer className={FOOTER}>
          <p className="max-w-[78ch]">{t("catalog.matchingNote")}</p>
          <a href="https://github.com/Bukutsu/glacier-eq/issues">
            {t("catalog.report")}
          </a>
        </footer>
      </div>
    </main>
  );
}
