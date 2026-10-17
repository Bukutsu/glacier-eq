import { useEffect, useRef, useState } from "react";
import {
  isDatabaseDownloaded,
  fetchManifest,
  subscribeToDatabaseDownload,
  clearCachedDatabase,
  loadDeviceCurvePoints,
  type OnlineDevice,
  type DownloadSubscription,
} from "@/features/traces/lib/onlineDb";

export function useOnlineDatabase(setStatus?: (value: string) => void) {
  const [downloaded, setDownloaded] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [manifest, setManifest] = useState<OnlineDevice[]>([]);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loadingDevice, setLoadingDevice] = useState<string | null>(null);
  const downloadSubscriptionRef = useRef<DownloadSubscription | null>(null);

  useEffect(
    () => () => {
      downloadSubscriptionRef.current?.unsubscribe();
      downloadSubscriptionRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    isDatabaseDownloaded().then((res) => {
      if (active) setDownloaded(res);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!downloaded) return;
    let active = true;
    setLoadingManifest(true);
    fetchManifest()
      .then((devices) => {
        if (!active) return;
        setManifest(devices);
        setTotalCount(devices.length);
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load online manifest:", error);
        setStatus?.(`Failed to load online search manifest: ${error}`);
      })
      .finally(() => {
        if (active) setLoadingManifest(false);
      });
    return () => {
      active = false;
    };
  }, [downloaded, setStatus]);

  const download = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    downloadSubscriptionRef.current?.unsubscribe();
    const subscription = subscribeToDatabaseDownload(setDownloadProgress);
    downloadSubscriptionRef.current = subscription;
    try {
      const result = await subscription.result;
      if (downloadSubscriptionRef.current === subscription) {
        setDownloaded(true);
        setTotalCount(result.entries);
      }
      return result;
    } finally {
      subscription.unsubscribe();
      if (downloadSubscriptionRef.current === subscription) {
        downloadSubscriptionRef.current = null;
        setIsDownloading(false);
        setDownloadProgress(null);
      }
    }
  };

  const clearCache = async () => {
    await clearCachedDatabase();
    setDownloaded(false);
    setManifest([]);
    setSearchQuery("");
    setTotalCount(null);
  };

  const loadDevice = async (device: OnlineDevice) => {
    setLoadingDevice(device.id);
    try {
      return await loadDeviceCurvePoints(device.id);
    } finally {
      setLoadingDevice(null);
    }
  };

  return {
    downloaded,
    downloadProgress,
    isDownloading,
    manifest,
    loadingManifest,
    searchQuery,
    setSearchQuery,
    totalCount,
    loadingDevice,
    download,
    clearCache,
    loadDevice,
  };
}
