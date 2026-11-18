import { lazy, Suspense, type ComponentProps } from "react";
import type { AddTraceModal as AddTraceModalType } from "./AddTraceModal";

// The modal and the online measurement database it searches are only needed
// after the user opens it, so keep them out of the startup bundle.
const Loaded = lazy(() =>
  import("./AddTraceModal").then(({ AddTraceModal }) => ({
    default: AddTraceModal,
  })),
);

export type AddTraceModalProps = ComponentProps<typeof AddTraceModalType>;

export function AddTraceModal(props: AddTraceModalProps) {
  return (
    <Suspense fallback={null}>
      <Loaded {...props} />
    </Suspense>
  );
}
