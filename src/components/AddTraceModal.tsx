import { useState, useEffect } from "react";
import type { TargetTrace, AppSettings, MeasurementPoint } from "../types";
import { Icon } from "./Icon";
import { Checkbox } from "./Checkbox";
import { SearchBar } from "./SearchBar";
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
  onAddMeasurementFile: () => void;
  onAddTargetFile: () => void;
  allTargets: TargetTrace[];
  activeTargetIds: string[];
  onToggleTarget: (id: string) => void;
  onRemoveTarget: (id: string) => void;
  settings?: AppSettings;
  onAddMeasurement?: (name: string, points: MeasurementPoint[]) => void;
  setStatus?: (value: string) => void;
}

export function AddTraceModal({
  onClose,
  onAddMeasurementFile,
  onAddTargetFile,
  allTargets,
  activeTargetIds,
  onToggleTarget,
  onRemoveTarget,
  settings,
  onAddMeasurement,
  setStatus,
}: AddTraceModalProps) {
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
    if (window.confirm("Clear the cached online measurement database (~16MB)?")) {
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

  const handleLoadDevice = async (dev: OnlineDevice) => {
    setLoadingDevice(dev.id);
    try {
      const points = await loadDeviceCurvePoints(dev.id);
      onAddMeasurement?.(`${dev.brand} ${dev.name} (${dev.source})`, points);
      setStatus?.(`Loaded: ${dev.brand} ${dev.name}`);
    } catch (error) {
      console.error(error);
      setStatus?.(`Failed to load: ${error}`);
    } finally {
      setLoadingDevice(null);
    }
  };

  const query = searchQuery.trim().toLowerCase();
  const searchTokens = query.split(/\s+/).filter(Boolean);
  const displayOnlineResults = searchTokens.length === 0
    ? []
    : manifest
        .filter((dev) => {
          const full = `${dev.brand} ${dev.name}`.toLowerCase();
          return searchTokens.every((token) => full.includes(token));
        })
        .slice(0, 50);

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
            <button className="btn" onClick={onAddMeasurementFile}>
              <Icon>playlist_add</Icon>
              <span>Measurement</span>
            </button>
            <button className="btn" onClick={onAddTargetFile}>
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
                          className="online-result-action"
                          disabled={loadingDevice !== null}
                          onClick={() => handleLoadDevice(dev)}
                        >
                          {loadingDevice === dev.id ? <span>Loading...</span> : <Icon>download</Icon>}
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

        {allTargets.length > 0 && (
          <div className="add-trace-section">
            <div className="add-trace-section-title">Target Curves</div>
            <div className="add-trace-target-list">
              {allTargets.map((target) => {
                const active = activeTargetIds.includes(target.id);
                return (
                  <div className="add-trace-target-item" key={target.id}>
                    <label className="add-trace-target-toggle">
                      <Checkbox
                        checked={active}
                        onChange={() => onToggleTarget(target.id)}
                      />
                      <span className="curve-swatch" style={{ backgroundColor: target.color }} />
                      <span>{target.name}</span>
                    </label>
                    {!target.builtIn && (
                      <button
                        className="curve-delete"
                        title={`Delete ${target.name}`}
                        onClick={() => onRemoveTarget(target.id)}
                      >
                        <Icon>delete</Icon>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
