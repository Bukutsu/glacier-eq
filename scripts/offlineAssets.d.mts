export type OfflineAsset = {
  path: string;
  hash: string;
};

export function stampServiceWorker(
  source: string,
  assets: readonly OfflineAsset[],
): { identity: string; source: string };
