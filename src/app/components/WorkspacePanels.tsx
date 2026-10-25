import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";
import { Navigate } from "react-router";
import { useTranslation } from "react-i18next";
import { DeviceView } from "@/features/device/components/DeviceView";
import { SettingsView } from "@/features/settings/components/SettingsView";
import type { ProfilesViewProps } from "@/features/profiles/components/ProfilesView";
import { workspacePath, type MobileTab } from "@/lib/tabs";

const ProfilesView = lazy(() =>
  import("@/features/profiles/components/ProfilesView").then(
    ({ ProfilesView }) => ({ default: ProfilesView }),
  ),
);
const MobileProfilesView = lazy(() =>
  import("@/features/profiles/components/MobileProfilesView").then(
    ({ MobileProfilesView }) => ({ default: MobileProfilesView }),
  ),
);
const TuningPanel = lazy(() =>
  import("@/features/tuning/components/TuningPanel").then(
    ({ TuningPanel }) => ({ default: TuningPanel }),
  ),
);

export interface WorkspacePanelsProps {
  activeTab: MobileTab;
  mobile: boolean;
  profiles: ProfilesViewProps;
  tuning: ComponentProps<typeof TuningPanel>;
  device: ComponentProps<typeof DeviceView>;
  settings: ComponentProps<typeof SettingsView>;
}

export function WorkspacePanels({
  activeTab,
  mobile,
  profiles,
  tuning,
  device,
  settings,
}: WorkspacePanelsProps) {
  const { t } = useTranslation("shell");
  if (activeTab === "eq") return null;
  const deviceView = (
    <DeviceView
      key={`${device.connected}:${device.deviceInfo?.path ?? "none"}`}
      {...device}
    />
  );
  let content: ReactNode;
  switch (activeTab) {
    case "profiles":
      content = mobile ? (
        <MobileProfilesView {...profiles} />
      ) : (
        <ProfilesView {...profiles} />
      );
      break;
    case "tuning":
      content = <TuningPanel {...tuning} />;
      break;
    case "device":
      content =
        mobile && device.section === "root" ? (
          <Navigate to={workspacePath("settings")} replace />
        ) : (
          deviceView
        );
      break;
    case "settings":
      content = <SettingsView {...settings} />;
      break;
  }
  const panel = (
    <Suspense
      fallback={
        <div role="status" aria-busy="true">
          {t("workspace.loading")}
        </div>
      }
    >
      {content}
    </Suspense>
  );
  if (mobile)
    return (
      <>
        {activeTab === "settings" && settings.section === "root" && (
          <section className="left-pane">{deviceView}</section>
        )}
        <section className={activeTab === "profiles" ? "mobile-profile-pane" : "left-pane"}>
          {panel}
        </section>
      </>
    );
  const label = {
    profiles: t("navigation.profiles"),
    tuning: t("navigation.tuning"),
    device: t("navigation.device"),
    settings: t("navigation.settings"),
  }[activeTab];
  return (
    <aside
      id="workspace-content"
      tabIndex={-1}
      className="right-rail"
      aria-label={label}
    >
      <section className="tools-card">
        <div className="tab-panel">{panel}</div>
      </section>
    </aside>
  );
}
