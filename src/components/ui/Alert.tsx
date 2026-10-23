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
      className={`ui-alert ${className}`}
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
      className={`ui-alert-title ${className}`}
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
      className={`ui-alert-description ${className}`}
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
      className={`ui-alert-action ${className}`}
      {...props}
    />
  );
}
