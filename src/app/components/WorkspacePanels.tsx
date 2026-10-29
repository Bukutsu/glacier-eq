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
          <section className="left-pane leg:min-w-[0] leg:min-h-[0] leg:flex leg:flex-col leg:gap-[var(--space-4)] leg:overflow-y-auto leg:[overscroll-behavior:contain] leg:pr-[var(--space-2)] leg:col-[1] leg:row-[2] leg:max-[960px]:[.mobile-workspace_&]:gap-[10px] leg:max-[960px]:[.mobile-workspace_&]:overflow-visible! leg:max-[960px]:[.mobile-workspace_&]:[overscroll-behavior:auto]! leg:compact:[.mobile-workspace_&]:w-[100%]! leg:compact:[.mobile-workspace_&]:max-w-[100%]! leg:compact:[.mobile-workspace_&]:flex-[1] leg:compact:[.mobile-workspace_&&]:overflow-visible! leg:compact:[.mobile-workspace_&]:pr-[0]! leg:compact:[.mobile-workspace_&&]:gap-[12px] leg:[@media(min-width:_769px)_and_(max-width:_1150px)]:pr-[16px]! leg:compact:gap-[10px] leg:roomy:[.desktop-view-device_&]:hidden leg:roomy:[.desktop-view-settings_&&]:hidden">{deviceView}</section>
        )}
        <section className={activeTab === "profiles" ? "min-w-0" : "left-pane leg:min-w-[0] leg:min-h-[0] leg:flex leg:flex-col leg:gap-[var(--space-4)] leg:overflow-y-auto leg:[overscroll-behavior:contain] leg:pr-[var(--space-2)] leg:col-[1] leg:row-[2] leg:max-[960px]:[.mobile-workspace_&]:gap-[10px] leg:max-[960px]:[.mobile-workspace_&]:overflow-visible! leg:max-[960px]:[.mobile-workspace_&]:[overscroll-behavior:auto]! leg:compact:[.mobile-workspace_&]:w-[100%]! leg:compact:[.mobile-workspace_&]:max-w-[100%]! leg:compact:[.mobile-workspace_&]:flex-[1] leg:compact:[.mobile-workspace_&&]:overflow-visible! leg:compact:[.mobile-workspace_&]:pr-[0]! leg:compact:[.mobile-workspace_&&]:gap-[12px] leg:[@media(min-width:_769px)_and_(max-width:_1150px)]:pr-[16px]! leg:compact:gap-[10px] leg:roomy:[.desktop-view-device_&]:hidden leg:roomy:[.desktop-view-settings_&&]:hidden"}>
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
      className="right-rail leg:min-w-[0] leg:min-h-[0] leg:grid leg:[grid-template-rows:1fr] leg:gap-[16px] leg:overflow-hidden leg:col-[3] leg:row-[1] leg:max-[960px]:[.mobile-workspace_&]:flex leg:max-[960px]:[.mobile-workspace_&]:flex-col leg:max-[960px]:[.mobile-workspace_&]:gap-[12px] leg:max-[960px]:[.mobile-workspace_&]:overflow-visible leg:compact:[.mobile-workspace_&]:w-[100%]! leg:compact:[.mobile-workspace_&]:max-w-[100%]! leg:compact:[.mobile-workspace_&]:flex-[1] leg:compact:[.mobile-workspace_&]:overflow-visible! leg:compact:[.mobile-workspace_&]:pr-[0]! leg:compact:flex leg:compact:flex-col leg:compact:gap-[12px] leg:compact:overflow-visible leg:roomy:[.desktop-content>&]:col-[2] leg:roomy:[.desktop-content>&]:row-[2] leg:roomy:[.desktop-content>&]:p-[0] leg:roomy:[.desktop-content>&]:[border:1px_solid_var(--line-soft)] leg:roomy:[.desktop-content>&]:rounded-[var(--radius-card)] leg:roomy:[.desktop-content>&]:[background:var(--panel)] leg:roomy:[.desktop-view-device_.desktop-content>&]:[grid-column:1_/_-1] leg:roomy:[.desktop-view-device_.desktop-content>&]:flex leg:roomy:[.desktop-view-device_.desktop-content>&]:flex-col leg:roomy:[.desktop-view-device_.desktop-content>&]:items-center leg:roomy:[.desktop-view-device_.desktop-content>&]:[background:transparent] leg:roomy:[.desktop-view-device_.desktop-content>&]:[border:0] leg:roomy:[.desktop-view-settings_.desktop-content>&&]:[grid-column:1_/_-1] leg:roomy:[.desktop-view-settings_.desktop-content>&&]:flex leg:roomy:[.desktop-view-settings_.desktop-content>&&]:flex-col leg:roomy:[.desktop-view-settings_.desktop-content>&&]:items-center leg:roomy:[.desktop-view-settings_.desktop-content>&&]:[background:transparent] leg:roomy:[.desktop-view-settings_.desktop-content>&&]:[border:0] leg:roomy:[.desktop-view-tuning_.desktop-content>&]:[align-self:start] leg:roomy:[.desktop-view-tuning_.desktop-content>&]:max-h-[100%] cmp:roomy:[.desktop-view-profiles_.desktop-content>&]:[grid-column:1_/_-1] cmp:roomy:[.desktop-view-profiles_.desktop-content>&]:[background:transparent] cmp:roomy:[.desktop-view-profiles_.desktop-content>&]:[border:0]"
      aria-label={label}
    >
      <section className="tools-card leg:[background:var(--panel)] leg:rounded-[var(--radius-surface)] leg:[box-shadow:none] leg:min-w-[0] leg:p-[18px_18px_20px] leg:flex leg:flex-col leg:gap-[14px] leg:min-h-[0] leg:overflow-hidden leg:[overscroll-behavior:contain] leg:max-[960px]:[.mobile-workspace_&]:overflow-visible leg:compact:pl-[12px] leg:compact:pr-[12px] leg:compact:overflow-visible leg:roomy:[.desktop-content>.right-rail>&]:[background:transparent] leg:roomy:[.desktop-content>.right-rail>&]:[border:0] leg:roomy:[.desktop-content>.right-rail>&]:p-[var(--space-4)] leg:roomy:[.desktop-view-device_.desktop-content>.right-rail>&]:w-[min(100%,_1080px)] leg:roomy:[.desktop-view-device_.desktop-content>.right-rail>&]:flex-[1_1_auto] leg:roomy:[.desktop-view-device_.desktop-content>.right-rail>&]:p-[var(--space-4)_var(--space-5)] leg:roomy:[.desktop-view-settings_.desktop-content>.right-rail>&&]:w-[min(100%,_1080px)] leg:roomy:[.desktop-view-settings_.desktop-content>.right-rail>&&]:flex-[1_1_auto] leg:roomy:[.desktop-view-settings_.desktop-content>.right-rail>&&]:p-[var(--space-4)_var(--space-5)] cmp:roomy:[.desktop-view-profiles_.desktop-content>.right-rail>&]:p-[0] cmp:roomy:[.desktop-view-profiles_.desktop-content>.right-rail>&]:[background:transparent] cmp:roomy:[.desktop-view-device_.desktop-content>.right-rail>&]:w-[100%] cmp:roomy:[.desktop-view-device_.desktop-content>.right-rail>&&]:p-[0] cmp:roomy:[.desktop-view-settings_.desktop-content>.right-rail>&&]:w-[100%] cmp:roomy:[.desktop-view-settings_.desktop-content>.right-rail>&&&]:p-[0]">
        <div className="tab-panel leg:flex leg:flex-col leg:gap-[14px] leg:min-h-[0] leg:flex-[1_1_auto] leg:overflow-y-auto leg:pr-[4px] leg:max-[960px]:[.mobile-workspace_&]:overflow-visible! leg:max-[960px]:[.mobile-workspace_&]:[overscroll-behavior:auto]! cmp:roomy:[.desktop-view-profiles_&]:pr-[0]">{panel}</div>
      </section>
    </aside>
  );
}
