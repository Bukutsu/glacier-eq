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
import "@/styles/device-catalog.css";

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
      <p role="status" className="catalog-count">
        {t("catalog.results", { shown: visible.length, total: models.length })}
      </p>
      {visible.length === 0 ? (
        <p className="catalog-empty">{t("catalog.noResults")}</p>
      ) : (
        <ul className="catalog-models">
          {visible.map(({ profile, variants }) => (
            <li
              key={JSON.stringify([profile.name, profile.protocol])}
              className="catalog-model"
            >
              <div className="catalog-identity">
                <h2>{profile.name}</h2>
                <p>
                  {profile.family} · {profile.protocol}
                </p>
                <div className="catalog-usb">
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
              <div className="catalog-capability">
                {profile.hardware_eq
                  ? t("catalog.bands", { bands: profile.num_bands })
                  : t("catalog.controlsOnly")}
                {!profile.hardware_eq && profile.controls === "dawn_pro" && (
                  <small>{t("catalog.nativeOnly")}</small>
                )}
              </div>
              <Badge
                className={profile.status === "Tested" ? "catalog-tested" : ""}
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
    <main className="device-catalog">
      <div className="catalog-content">
        <nav className="catalog-nav" aria-label={t("catalog.navigation")}>
          <Link to="/eq">Glacier EQ</Link>
          <Link to="/eq">{t("catalog.openApp")}</Link>
        </nav>
        <header className="catalog-heading">
          <h1>{t("catalog.title")}</h1>
          <p>{t("catalog.description")}</p>
          <p className="catalog-version">
            {t("catalog.build", { version: __APP_VERSION__ })}
          </p>
        </header>
        <section
          className="catalog-legend"
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
        <div className="catalog-filters">
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
        <footer className="catalog-footer">
          <p>{t("catalog.matchingNote")}</p>
          <a href="https://github.com/Bukutsu/glacier-eq/issues">
            {t("catalog.report")}
          </a>
        </footer>
      </div>
    </main>
  );
}
