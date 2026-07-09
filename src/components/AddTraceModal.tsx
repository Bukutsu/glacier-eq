import { useState, useEffect } from "react";
import type { AppSettings, MeasurementPoint } from "../types";
import { Icon } from "./Icon";
import { SearchBar } from "./SearchBar";
import { fuzzyMatch } from "../lib/search";
import { openFileDialog } from "../lib/rpc";
import { useConfirm } from "./ConfirmDialog";
import { parseMeasurementText } from "../lib/measurements";
import {
  isDatabaseDownloaded,
  clearCachedDatabase,
  downloadDatabase,
  fetchManifest,
  loadDeviceCurvePoints,
  type OnlineDevice,
} from "../lib/onlineDb";

interface AddTraceModalProps {
  onClose: () => void;
  settings?: AppSettings;
  onAddMeasurement?: (name: string, points: MeasurementPoint[]) => void;
  onAddTarget?: (name: string, points: MeasurementPoint[]) => void;
  setStatus?: (value: string) => void;
}

export function AddTraceModal({
  onClose,
  settings,
  onAddMeasurement,
  onAddTarget,
  setStatus,
}: AddTraceModalProps) {
  const confirm = useConfirm();
  const enableOnlineMeasurements = settings?.enable_online_measurements;

  // Online search state
  const [downloaded, setDownloaded] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [manifest, setManifest] = useState<OnlineDevice[]>([]);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loadingDevice, setLoadingDevice] = useState<string | null>(null);
  const [loadedDevices, setLoadedDevices] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (enableOnlineMeasurements) {
      isDatabaseDownloaded().then(setDownloaded);
    }
  }, [enableOnlineMeasurements]);

  useEffect(() => {
    if (enableOnlineMeasurements && downloaded) {
      setLoadingManifest(true);
      fetchManifest()
        .then((devices) => {
          setManifest(devices);
          setTotalCount(devices.length);
        })
        .catch((err) => {
          console.error("Failed to load online manifest:", err);
          setStatus?.(`Failed to load online search manifest: ${err}`);
        })
        .finally(() => setLoadingManifest(false));
    }
  }, [enableOnlineMeasurements, downloaded]);

  const handleDownload = async () => {
    setIsDownloading(true);
    setDownloadProgress(0);
    try {
      const count = await downloadDatabase((percent) => setDownloadProgress(percent));
      setDownloaded(true);
      setTotalCount(count);
      setStatus?.(`Downloaded online database (${count} curves)`);
    } catch (error) {
      console.error(error);
      setStatus?.(`Database download failed: ${error}`);
    } finally {
      setIsDownloading(false);
      setDownloadProgress(null);
    }
  };

  const handleResetCache = async () => {
    if (await confirm("Clear the cached online measurement database (~16MB)?")) {
      try {
        await clearCachedDatabase();
        setDownloaded(false);
        setManifest([]);
        setSearchQuery("");
        setTotalCount(null);
        setStatus?.("Online database cache cleared.");
      } catch (error) {
        console.error(error);
        setStatus?.(`Failed to clear cache: ${error}`);
      }
    }
  };

  const handleMeasurementFile = async () => {
    const result = await openFileDialog({ filters: [{ name: "Measurement", extensions: ["csv", "txt"] }] });
    if (!result) return;
    try {
      const points = parseMeasurementText(result.text);
      const label = result.name.replace(/\.[^/.]+$/, "");
      onAddMeasurement?.(label, points);
      setStatus?.(`Loaded measurement: ${label} (${points.length} points)`);
      onClose();
    } catch (error) {
      setStatus?.(`Measurement import failed: ${error}`);
    }
  };

  const handleTargetFile = async () => {
    const result = await openFileDialog({ filters: [{ name: "Target", extensions: ["csv", "txt"] }] });
    if (!result) return;
    try {
      const points = parseMeasurementText(result.text);
      const label = result.name.replace(/\.[^/.]+$/, "");
      (onAddTarget ?? onAddMeasurement)?.(label, points);
      setStatus?.(`Loaded target: ${label} (${points.length} points)`);
      onClose();
    } catch (error) {
      setStatus?.(`Target import failed: ${error}`);
    }
  };

  const handleLoadDevice = async (dev: OnlineDevice) => {
    setLoadingDevice(dev.id);
    try {
      const points = await loadDeviceCurvePoints(dev.id);
      onAddMeasurement?.(`${dev.brand} ${dev.name} (${dev.source})`, points);
      setLoadedDevices((prev) => {
        const next = new Set(prev);
        next.add(dev.id);
        return next;
      });
      onClose();
      setStatus?.(`Loaded: ${dev.brand} ${dev.name}`);
    } catch (error) {
      console.error(error);
      setStatus?.(`Failed to load: ${error}`);
    } finally {
      setLoadingDevice(null);
    }
  };

  const query = searchQuery.trim().toLowerCase();
  const displayOnlineResults = !query
    ? []
    : manifest.filter((dev) => fuzzyMatch(query, `${dev.brand} ${dev.name}`)).slice(0, 50);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className="modal-content add-trace-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <strong>Add Trace</strong>
          <button className="modal-close-btn" onClick={onClose}><Icon>close</Icon></button>
        </div>

        <div className="add-trace-section">
          <div className="add-trace-section-title">From File</div>
          <div className="add-trace-file-grid">
            <button className="btn" onClick={handleMeasurementFile}>
              <Icon>playlist_add</Icon>
              <span>Measurement</span>
            </button>
            <button className="btn" onClick={handleTargetFile}>
              <Icon>add_box</Icon>
              <span>Target</span>
            </button>
          </div>
        </div>

        {enableOnlineMeasurements && (
          <div className="add-trace-section">
            <div className="add-trace-section-title">
              Online Search
              {downloaded && totalCount && (
                <span className="add-trace-section-count">{totalCount} curves</span>
              )}
            </div>
            {downloaded ? (
              <>
                <SearchBar
                  placeholder="Search online database..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div className="add-trace-online-results">
                  {loadingManifest ? (
                    <div className="online-result-empty">Loading index...</div>
                  ) : searchQuery.trim() && displayOnlineResults.length === 0 ? (
                    <div className="online-result-empty">No matches</div>
                  ) : (
                    displayOnlineResults.map((dev) => (
                      <div key={dev.id} className="online-result-item">
                        <div className="online-result-info">
                          <div className="online-result-name">
                            {dev.brand} {dev.name}
                            {dev.price !== null && <span className="online-result-price">${dev.price}</span>}
                          </div>
                          <div className="online-result-source">{dev.source}</div>
                        </div>
                        <button
                          className={`online-result-action${loadedDevices.has(dev.id) ? " added" : ""}`}
                          disabled={loadingDevice !== null || loadedDevices.has(dev.id)}
                          onClick={() => handleLoadDevice(dev)}
                        >
                          {loadingDevice === dev.id ? <span>Loading...</span> : loadedDevices.has(dev.id) ? <Icon>check</Icon> : <Icon>download</Icon>}
                        </button>
                      </div>
                    ))
                  )}
                  {!searchQuery.trim() && (
                    <div className="online-result-empty">Type to search online curves</div>
                  )}
                </div>
                <div className="add-trace-cache-row">
                  <button className="tool-link-button" onClick={handleResetCache}>Clear Cache</button>
                </div>
              </>
            ) : (
              <div className="add-trace-download-prompt">
                <span>Download the online database to search measurements.</span>
                {downloadProgress !== null ? (
                  <span>Downloading... {Math.round(downloadProgress * 100)}%</span>
                ) : (
                  <button className="btn" onClick={handleDownload} disabled={isDownloading}>
                    Download Cache
                  </button>
                )}
              </div>
            )}
          </div>
        )}

      </section>
    </div>
  );
}
