import { useState } from "react";
import type { MeasurementPoint } from "../types";
import { Icon } from "./Icon";
import { fuzzyMatch } from "../lib/search";
import { openFileDialog } from "../lib/rpc";
import { parseMeasurementText } from "../lib/measurements";
import { useOnlineDatabase, type OnlineDevice } from "../lib/onlineDb";
import { Modal } from "./Modal";

interface AddTraceModalProps {
  onClose: () => void;
  onAddMeasurement?: (name: string, points: MeasurementPoint[]) => void;
  onAddTarget?: (name: string, points: MeasurementPoint[]) => void;
  setStatus?: (value: string) => void;
}

export function AddTraceModal({
  onClose,
  onAddMeasurement,
  onAddTarget,
  setStatus,
}: AddTraceModalProps) {
  const {
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
  } = useOnlineDatabase(setStatus);
  const [loadedDevices, setLoadedDevices] = useState<Set<string>>(new Set());

  const handleDownload = async () => {
    try {
      const count = await download();
      setStatus?.(`Downloaded online database (${count} curves)`);
    } catch (error) {
      console.error(error);
      setStatus?.(`Failed to download database: ${error}`);
    }
  };

  const handleResetCache = async () => {
    if (window.confirm("Clear the cached online measurement database (~16MB)?")) {
      try {
        await clearCache();
        setStatus?.("Online database cache cleared.");
      } catch (error) {
        console.error(error);
        setStatus?.(`Failed to clear cache: ${error}`);
      }
    }
  };

  const handleFile = async (kind: "measurement" | "target") => {
    const result = await openFileDialog({ filters: [{ name: kind === "measurement" ? "Measurement" : "Target", extensions: ["csv", "txt"] }] });
    if (!result) return;
    try {
      const points = parseMeasurementText(result.text);
      const label = result.name.replace(/\.[^/.]+$/, "");
      if (kind === "measurement") {
        onAddMeasurement?.(label, points);
        setStatus?.(`Loaded measurement: ${label} (${points.length} points)`);
      } else {
        (onAddTarget ?? onAddMeasurement)?.(label, points);
        setStatus?.(`Loaded target: ${label} (${points.length} points)`);
      }
      onClose();
    } catch (error) {
      setStatus?.(`Failed to import ${kind}: ${error}`);
    }
  };

  const handleLoadDevice = async (dev: OnlineDevice) => {
    try {
      const points = await loadDevice(dev);
      onAddMeasurement?.(`${dev.brand} ${dev.name} (${dev.source})`, points);
      setLoadedDevices((prev) => new Set(prev).add(dev.id));
      onClose();
      setStatus?.(`Loaded: ${dev.brand} ${dev.name}`);
    } catch (error) {
      console.error(error);
      setStatus?.(`Failed to load: ${error}`);
    }
  };

  const query = searchQuery.trim().toLowerCase();
  const displayOnlineResults = !query
    ? []
    : manifest.filter((dev) => fuzzyMatch(query, `${dev.brand} ${dev.name}`)).slice(0, 50);

  return (
    <Modal title="Add Trace" onClose={onClose} className="add-trace-modal">
        <div className="add-trace-section">
          <div className="add-trace-section-title">From File</div>
          <div className="add-trace-file-grid">
            <button className="btn" onClick={() => handleFile("measurement")}>
              <Icon>playlist_add</Icon>
              <span>Measurement</span>
            </button>
            <button className="btn" onClick={() => handleFile("target")}>
              <Icon>add_box</Icon>
              <span>Target</span>
            </button>
          </div>
        </div>

        <div className="add-trace-section">
            <div className="add-trace-section-title">
              Online Search
              {downloaded && totalCount && (
                <span className="add-trace-section-count">{totalCount} curves</span>
              )}
            </div>
            {downloaded ? (
              <>
                <input type="text" className="curves-search-input"
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
    </Modal>
  );
}
