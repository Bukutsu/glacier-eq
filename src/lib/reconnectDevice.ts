export interface ReconnectCandidate {
  path: string;
  profile_name: string | null;
  product_string: string | null;
}

export function chooseReconnectDevice<T extends ReconnectCandidate>(
  devices: readonly T[],
  targetPath: string,
  targetName: string,
): T | null {
  const exactPathMatch = targetPath
    ? devices.find((device) => device.path === targetPath)
    : undefined;
  if (exactPathMatch) return exactPathMatch;

  const nameMatches = targetName
    ? devices.filter(
        (device) => device.profile_name === targetName || device.product_string === targetName,
      )
    : [];
  if (nameMatches.length === 1) return nameMatches[0];
  if (!targetName && devices.length === 1) return devices[0];
  return null;
}
