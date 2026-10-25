import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "@/components/ui/Modal";
const LazyDiagnosticsPanel = lazy(() =>
  import("@/features/diagnostics/components/DiagnosticsPanel").then(
    ({ DiagnosticsPanel }) => ({ default: DiagnosticsPanel }),
  ),
);

export function DiagnosticsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("shell");
  return (
    <Modal
      title={t("navigation.diagnostics")}
      className="wide"
      onClose={onClose}
      style={{
        width: "min(800px, 94vw)",
        height: "75vh",
        maxHeight: "75vh",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Suspense fallback={<div role="status" aria-busy="true">{t("workspace.loading")}</div>}>
          <LazyDiagnosticsPanel />
        </Suspense>
      </div>
    </Modal>
  );
}
