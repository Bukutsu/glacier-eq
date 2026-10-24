import { createHash } from "node:crypto";

const BUILD_ID_MARKER = "__GLACIER_EQ_BUILD_ASSET_SET_ID__";

export function stampServiceWorker(source, assets) {
  const marker = `"${BUILD_ID_MARKER}"`;
  if (source.split(marker).length !== 2) {
    throw new Error("Service worker must contain exactly one build identity marker");
  }
  const identity = createHash("sha256")
    .update(JSON.stringify({ assets, source }))
    .digest("hex");
  return {
    identity,
    source: source.replace(marker, JSON.stringify(identity)),
  };
}
