import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/Icon";
import type { DeviceCapabilities, PEQData } from "@/types";
import type { EqEditor } from "../hooks/useEqEditor";
import { formatDb } from "../lib/peq";
import { Bands } from "./Bands";
import { Preamp } from "./Preamp";

export function EqEditorControls({
  editor,
  capabilities,
  committedPeq,
  disabled,
  mobile,
  snapToIso,
}: {
  editor: EqEditor;
  capabilities: DeviceCapabilities;
  committedPeq: PEQData | null;
  disabled: boolean;
  mobile: boolean;
  snapToIso: boolean;
}) {
  const { t } = useTranslation("shell");
  const preamp = (
    <Preamp
      value={editor.peq.global_gain}
      resetValue={committedPeq?.global_gain}
      range={capabilities.global_gain_range}
      integerMode={capabilities.integer_preamp}
      onStartChange={editor.handlePreampStartChange}
      onEndChange={editor.handleEndChange}
      onChange={editor.handlePreampChange}
      disabled={disabled}
    />
  );
  const bands = (
    <Bands
      peq={editor.peq}
      committedPeq={committedPeq}
      capabilities={capabilities}
      onFilterChange={editor.updateFilter}
      onStartChange={editor.handleStartChange}
      onEndChange={editor.handleEndChange}
      activeBandIndex={editor.activeBandIndex}
      onActiveBandChange={editor.setActiveBandIndex}
      snapToIso={snapToIso}
      disabled={disabled}
      isMobile={mobile}
    />
  );
  return mobile ? (
    <>
      {bands}
      <details className="mobile-preamp-details">
        <summary>
          <span>{t("workspace.preamp")}</span>
          <span>
            {formatDb(editor.peq.global_gain)} <Icon name="expand_more" />
          </span>
        </summary>
        {preamp}
      </details>
    </>
  ) : (
    <>
      {preamp}
      {bands}
    </>
  );
}
