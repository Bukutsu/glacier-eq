import type { ComponentProps, ReactNode } from "react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";

// Persistent context for a failed page, field, or action. Unlike a toast,
// this stays beside the affected control until the error is resolved.
export function ErrorNotice({
  title,
  action,
  children,
  className = "",
  ...props
}: Omit<ComponentProps<typeof Alert>, "title" | "variant"> & {
  title?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Alert
      variant="destructive"
      className={`error-notice ${className}`}
      {...props}
    >
      <Icon name="error" />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{children}</AlertDescription>
      {action && <AlertAction>{action}</AlertAction>}
    </Alert>
  );
}
