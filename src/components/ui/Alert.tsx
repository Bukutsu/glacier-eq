/*!
 * Adapted from shadcn/ui Alert (https://github.com/shadcn-ui/ui), MIT License.
 * Copyright (c) 2023 shadcn
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { ComponentProps } from "react";

const ROOT = "grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 gap-y-1 min-w-0 w-full p-3 border border-[var(--border)] rounded-[var(--control-radius)] bg-[var(--card)] text-[var(--foreground)] text-[13px] leading-[1.5] text-start [overflow-wrap:anywhere] [&>.app-icon]:col-start-1 [&>.app-icon]:row-start-1 [&>.app-icon]:mt-0.5 [&>.app-icon]:h-4 [&>.app-icon]:w-4 [&>.app-icon]:text-[var(--muted-foreground)] data-[variant=destructive]:[&>.app-icon]:text-[var(--destructive-foreground)]";
const TITLE = "col-start-2 font-medium";
const DESCRIPTION = "col-start-2 min-w-0 whitespace-pre-wrap text-[var(--muted-foreground)] [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_a]:underline [&_a]:underline-offset-[3px]";
const ACTION = "col-start-2 flex flex-wrap gap-2 pt-1";

export function Alert({
  variant = "default",
  className = "",
  ...props
}: ComponentProps<"div"> & { variant?: "default" | "destructive" }) {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role="alert"
      className={`${ROOT} ${className}`}
      {...props}
    />
  );
}

export function AlertTitle({
  className = "",
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={`${TITLE} ${className}`}
      {...props}
    />
  );
}

export function AlertDescription({
  className = "",
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={`${DESCRIPTION} ${className}`}
      {...props}
    />
  );
}

export function AlertAction({
  className = "",
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={`${ACTION} ${className}`}
      {...props}
    />
  );
}
