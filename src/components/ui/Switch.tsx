import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

const ROOT = "group relative inline-flex shrink-0 items-center justify-center w-11 h-11 p-0 border-0 bg-transparent cursor-pointer data-[disabled]:opacity-[0.45] data-[disabled]:cursor-not-allowed focus-visible:[outline:2px_solid_var(--ring)] focus-visible:outline-offset-2 focus-visible:rounded-[var(--control-radius)]";
const TRACK = "flex items-center box-border w-[42px] h-6 p-0.5 border border-[var(--input)] rounded-[var(--radius-pill)] bg-[var(--control)] group-data-[checked]:bg-[var(--primary)] group-data-[checked]:border-[var(--primary)]";
const THUMB = "block w-[18px] h-[18px] rounded-[var(--radius-pill)] bg-[var(--muted-foreground)] [transition:transform_var(--motion-duration)_var(--motion-ease)] group-data-[checked]:[transform:translateX(18px)] group-data-[checked]:bg-[var(--primary-foreground)] motion-reduce:transition-none";

export function Switch({
  id,
  label,
  descriptionId,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  descriptionId?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <SwitchPrimitive.Root
      id={id}
      render={<button type="button" />}
      nativeButton
      className={ROOT}
      data-slot="switch"
      aria-label={label}
      aria-describedby={descriptionId}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    >
      <span className={TRACK}>
        <SwitchPrimitive.Thumb className={THUMB} />
      </span>
    </SwitchPrimitive.Root>
  );
}
