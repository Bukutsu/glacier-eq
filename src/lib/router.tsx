// Minimal hash router. The app has a handful of in-app links and no data
// loading, so this replaces react-router (~25 kB gzipped) with what is used.
// Location state lives in history.state.usr, the slot modalHistory preserves
// when it merges its sentinel keys into the current entry.
import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from "react";

export interface Location {
  pathname: string;
  search: string;
  // Whatever the navigating code stored; callers narrow it before use.
  state: { [key: string]: unknown } | null;
}

function read(): Location {
  const hash = window.location.hash.slice(1) || "/";
  const queryAt = hash.indexOf("?");
  const path = queryAt < 0 ? hash : hash.slice(0, queryAt);
  const usr: unknown = window.history.state?.usr;
  return {
    pathname: path.startsWith("/") ? path : `/${path}`,
    search: queryAt < 0 ? "" : hash.slice(queryAt),
    state: typeof usr === "object" ? (usr as Location["state"]) : null,
  };
}

let current = read();
const listeners = new Set<() => void>();

function sync(): void {
  const next = read();
  // Modal sentinels move history without changing the location; keep the
  // snapshot stable so they do not re-render every route consumer.
  if (
    next.pathname === current.pathname &&
    next.search === current.search &&
    JSON.stringify(next.state) === JSON.stringify(current.state)
  )
    return;
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
  }
  listeners.add(listener);
  sync();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    }
  };
}

export interface NavigateOptions {
  replace?: boolean;
  state?: Location["state"];
}

export function navigate(to: string | number, options: NavigateOptions = {}) {
  if (typeof to === "number") {
    window.history.go(to);
    return;
  }
  window.history[options.replace ? "replaceState" : "pushState"](
    { usr: options.state ?? null },
    "",
    `#${to}`,
  );
  sync();
}

export function useLocation(): Location {
  return useSyncExternalStore(subscribe, () => current);
}

export function useNavigate() {
  return navigate;
}

export function useSearchParams(): [
  URLSearchParams,
  (next: URLSearchParams, options?: NavigateOptions) => void,
] {
  const { search, pathname } = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const setParams = useCallback(
    (next: URLSearchParams, options?: NavigateOptions) => {
      const query = next.toString();
      navigate(query ? `${pathname}?${query}` : pathname, options);
    },
    [pathname],
  );
  return [params, setParams];
}

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  useEffect(() => navigate(to, { replace }), [to, replace]);
  return null;
}

export function Link({
  to,
  state,
  onClick,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: string;
  state?: Location["state"];
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      (rest.target && rest.target !== "_self") ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    navigate(to, { state });
  };
  return <a {...rest} href={`#${to}`} onClick={handleClick} />;
}
