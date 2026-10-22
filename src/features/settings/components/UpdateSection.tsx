// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon, type IconName } from "@/components/ui/Icon";
import {
  useAppUpdate,
  type UpdateState,
} from "@/features/settings/hooks/useAppUpdate";
import { openExternalLink } from "@/lib/externalLinks";

const LATEST_RELEASE_URL =
  "https://github.com/Bukutsu/glacier-eq/releases/latest";

const currentVersion = () =>
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

function percent(state: Extract<UpdateState, { phase: "downloading" }>) {
  if (state.total === null || state.total <= 0) return null;
  return Math.min(100, Math.round((state.received / state.total) * 100));
}

/**
 * Update card for the About page. Builds that cannot replace themselves
 * (distro packages, portable and development builds, Android) still show it,
 * greyed out with the reason, so the missing feature is explained rather than
 * silently absent. Web builds do not render it.
 */
export function UpdateSection() {
  const { t } = useTranslation("settings");
  const state = useAppUpdate((store) => store.state);
  const { detect, check, download, install } = useAppUpdate.getState();

  useEffect(() => {
    void detect();
  }, [detect]);

  const restart = async (version: string) => {
    const confirmed = await confirmDialog({
      title: t("updates.restartTitle"),
      message: t("updates.restartExplanation", { version }),
      confirmLabel: t("updates.restart"),
      cancelLabel: t("common.cancel"),
    });
    if (confirmed) await install();
  };

  return (
    <UpdateCard
      state={state}
      onCheck={() => void check()}
      onDownload={() => void download()}
      onRestart={(version) => void restart(version)}
    />
  );
}

export function UpdateCard({
  state,
  onCheck,
  onDownload,
  onRestart,
}: {
  state: UpdateState;
  onCheck: () => void;
  onDownload: () => void;
  onRestart: (version: string) => void;
}) {
  const { t } = useTranslation("settings");
  if (state.phase === "unknown") return null;

  // Android cannot replace itself, but the newest APK is one tap away.
  const apkLink = state.phase === "unsupported" && state.reason === "mobile";
  const unsupported = state.phase === "unsupported" && !apkLink;
  const busy =
    state.phase === "checking" ||
    state.phase === "downloading" ||
    state.phase === "restarting";

  let description: string;
  let action: {
    label: string;
    icon: IconName;
    primary: boolean;
    run: () => void;
  };
  switch (state.phase) {
    case "unsupported":
      description =
        state.reason === "systemPackage"
          ? t("updates.unsupported.systemPackage")
          : state.reason === "mobile"
            ? t("updates.unsupported.mobile")
            : t("updates.unsupported.unpackaged");
      action = apkLink
        ? {
            label: t("updates.getLatestApk"),
            icon: "open_in_new",
            primary: false,
            run: () => void openExternalLink(LATEST_RELEASE_URL),
          }
        : {
            label: t("updates.check"),
            icon: "refresh",
            primary: false,
            run: () => {},
          };
      break;
    case "checking":
      description = t("updates.checking");
      action = {
        label: t("common.checking"),
        icon: "refresh",
        primary: false,
        run: () => {},
      };
      break;
    case "upToDate":
      description = t("updates.upToDate", { version: currentVersion() });
      action = {
        label: t("updates.checkAgain"),
        icon: "refresh",
        primary: false,
        run: onCheck,
      };
      break;
    case "available":
      description = t("updates.available", { version: state.version });
      action = {
        label: t("updates.download"),
        icon: "file_download",
        primary: true,
        run: onDownload,
      };
      break;
    case "downloading": {
      const done = percent(state);
      description =
        done === null
          ? t("updates.downloading", { version: state.version })
          : t("updates.downloadingPercent", {
              version: state.version,
              percent: done,
            });
      action = {
        label: t("common.working"),
        icon: "file_download",
        primary: true,
        run: () => {},
      };
      break;
    }
    case "ready":
      description = t("updates.ready", { version: state.version });
      action = {
        label: t("updates.restart"),
        icon: "restart_alt",
        primary: true,
        run: () => onRestart(state.version),
      };
      break;
    case "restarting":
      description = t("updates.restarting", { version: state.version });
      action = {
        label: t("common.working"),
        icon: "restart_alt",
        primary: true,
        run: () => {},
      };
      break;
    case "error":
      description = t("updates.failed", { error: state.message });
      action = {
        label: t("updates.retry"),
        icon: "refresh",
        primary: false,
        run: onCheck,
      };
      break;
    case "idle":
      description = t("updates.idle", { version: currentVersion() });
      action = {
        label: t("updates.check"),
        icon: "refresh",
        primary: false,
        run: onCheck,
      };
      break;
  }

  const badge =
    state.phase === "available" || state.phase === "ready"
      ? t("updates.badgeAvailable")
      : unsupported
        ? t("updates.badgeUnsupported")
        : null;

  return (
    <>
      <div
        className="stack-card update-card"
        data-phase={state.phase}
        aria-disabled={unsupported || undefined}
        aria-label={t("updates.title")}
        role="group"
      >
        <div className="stack-pref-row update-row">
          <Icon
            className="update-icon"
            name={unsupported ? "lock" : "file_download"}
            size={20}
          />
          <div className="stack-pref-info">
            <span className="stack-pref-title update-title">
              {t("updates.title")}
              {badge !== null && <Badge>{badge}</Badge>}
            </span>
            <span
              className="stack-pref-desc"
              role={state.phase === "error" ? "alert" : "status"}
            >
              {description}
            </span>
          </div>
          <div className="stack-pref-control">
            <Button
              variant={action.primary ? "primary" : "default"}
              disabled={unsupported || busy}
              onClick={action.run}
            >
              <Icon name={action.icon} />
              <span>{action.label}</span>
            </Button>
          </div>
        </div>

        {state.phase === "downloading" && (
          <progress
            className="update-progress"
            max={100}
            value={percent(state) ?? undefined}
            aria-label={t("updates.downloadingPercent", {
              version: state.version,
              percent: percent(state) ?? 0,
            })}
          />
        )}

        {state.phase === "available" && state.notes !== null && (
          <details className="update-notes">
            <summary>{t("updates.notes")}</summary>
            <pre>{state.notes}</pre>
          </details>
        )}
      </div>
      {state.phase !== "unsupported" && (
        <p className="card-note">{t("updates.privacy")}</p>
      )}
    </>
  );
}
