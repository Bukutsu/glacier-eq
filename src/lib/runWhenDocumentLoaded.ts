export function runWhenDocumentLoaded(
  readyState: DocumentReadyState,
  addLoadListener: (callback: () => void) => void,
  action: () => void,
): void {
  if (readyState === "complete") {
    action();
  } else {
    addLoadListener(action);
  }
}
