import { useDebugStore } from "@/features/diagnostics/stores/debugStore";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export function DebugEqBanner() {
  const enabled = useDebugStore((s) => s.autoDiscardEq);
  const disable = useDebugStore((s) => s.setAutoDiscardEq);
  if (!enabled) return null;
  return (
    <aside
      className="debug-eq-banner"
      role="status"
      aria-label="Auto-discard EQ warning"
    >
      <Icon name="error" />
      <div>
        <strong>Debug mode: auto-discard EQ edits is on</strong>
        <p>
          Reading from the DAC, including after reconnecting, replaces unsaved
          EQ edits without asking.
        </p>
      </div>
      <Button type="button" variant="default" onClick={() => disable(false)}>
        Turn off
      </Button>
    </aside>
  );
}
