import { useRef, type ComponentProps } from "react";
import { isTauri } from "@/lib/platform";
import { Button } from "./Button";
import { Icon } from "./Icon";

interface FileImportButtonProps {
  label: string;
  accept: string;
  onImport: (file?: File) => void;
  disabled?: boolean;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
}

/** Web uploads have a persistent input; native hosts keep their OS picker. */
export function FileImportButton({
  label,
  accept,
  onImport,
  disabled,
  className,
  variant,
}: FileImportButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        className={className}
        variant={variant}
        disabled={disabled}
        onClick={() => {
          if (isTauri()) onImport();
          else input.current?.click();
        }}
      >
        <Icon name="file_upload" />
        {label}
      </Button>
      {!isTauri() && (
        <input
          ref={input}
          type="file"
          accept={accept}
          aria-label={label}
          disabled={disabled}
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file && !disabled) onImport(file);
          }}
        />
      )}
    </>
  );
}
