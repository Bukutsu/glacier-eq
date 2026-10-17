import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

interface DraftRecoveryProps {
  invalid: boolean;
  connected: boolean;
  isBusy: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}

export function DraftRecovery({
  invalid,
  connected,
  isBusy,
  onRestore,
  onDiscard,
}: DraftRecoveryProps) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className="header-draft-trigger"
        aria-label={
          invalid
            ? "EQ editing paused: discard the unreadable draft to continue"
            : "EQ editing paused: restore or discard unfinished EQ to continue"
        }
        title={
          invalid
            ? "Discard the unreadable draft to continue editing"
            : "Restore or discard your unfinished EQ to continue editing"
        }
      >
        <Icon name="lock" />
        <strong>Editing paused</strong>
        <span aria-hidden="true">·</span>
        <span>{invalid ? "Unreadable draft" : "Unfinished EQ"}</span>
        <Icon name="expand_more" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="ui-popup-positioner"
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={8}
        >
          <Popover.Popup className="header-draft-popup">
            <Popover.Title>
              {invalid
                ? "Stored draft could not be read"
                : "Restore unfinished EQ?"}
            </Popover.Title>
            <Popover.Description>
              {invalid
                ? "EQ editing is paused. Discard this unreadable draft to continue editing and saving unfinished edits."
                : "EQ editing is paused to protect your unfinished work. Restore or discard the draft to continue. Nothing will be written to a DAC."}
            </Popover.Description>
            {connected && !invalid && (
              <p className="header-draft-hint">
                Disconnect the DAC before restoring.
              </p>
            )}
            <div className="header-draft-actions">
              {!invalid && (
                <Button onClick={onRestore} disabled={connected || isBusy}>
                  Restore EQ
                </Button>
              )}
              <Button variant="ghost" onClick={onDiscard} disabled={isBusy}>
                Discard draft
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
