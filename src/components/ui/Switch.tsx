import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

export function Switch({
  id, label, descriptionId, checked, disabled, onCheckedChange,
}: {
  id: string;
  label: string;
  descriptionId?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <SwitchPrimitive.Root id={id} render={<button type="button" />} nativeButton
      className="ui-switch" data-slot="switch" aria-label={label} aria-describedby={descriptionId}
      checked={checked} disabled={disabled} onCheckedChange={onCheckedChange}>
      <span className="ui-switch-track"><SwitchPrimitive.Thumb className="ui-switch-thumb" /></span>
    </SwitchPrimitive.Root>
  );
}
