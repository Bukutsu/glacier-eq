import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MeasurementPoint } from "../types";
import { Icon } from "./Icon";
import { findOnlineMeasurements, ONLINE_RESULT_LIMIT } from "../lib/onlineSearch";
import { openFileDialog } from "../lib/rpc";
import { parseMeasurementText, identifyTraceKind } from "../lib/measurements";
import { useOnlineDatabase, type OnlineDevice } from "../lib/onlineDb";
import { Modal } from "./Modal";
import { confirmDialog } from "./ConfirmDialog";
import { Button } from "./ui/Button";

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
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const [modalError, setModalError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const downloadButtonRef = useRef<HTMLButtonElement>(null);
  const searchId = useId();

  useEffect(() => {
    if (downloaded) searchInputRef.current?.focus();
    else downloadButtonRef.current?.focus();
  }, [downloaded]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Invalidate pending file/curve loads so a completion after close
      // cannot add measurements from an unmounted context.
      loadRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const handleDownload = async () => {
    setModalError(null);
    try {
      const result = await download();
      // The modal can close while the download is in flight; its siblings
      // below already guard on mountedRef, and without it this resolved
      // download wrote into the shared toast store for a closed modal.
      if (!mountedRef.current) return;
      setStatus?.(
        result.sweepFailed
          ? `Downloaded ${result.entries} curves. Cleanup of old cached data failed and will be retried on the next download.`
          : `Downloaded ${result.entries} curves`,
      );
    } catch (error) {
      if (!mountedRef.current) return;
      console.error(error);
      const message = `Could not download database: ${error}`;
      setModalError(message);
      setStatus?.(message);
    }
  };

  const handleResetCache = async () => {
    setModalError(null);
    if (await confirmDialog({
      title: "Clear database cache?",
      message: "Clear the cached measurement database (~16 MB)?",
      confirmLabel: "Clear cache",
      danger: true,
    })) {
      try {
        await clearCache();
        if (!mountedRef.current) return;
        setStatus?.("Database cache cleared.");
      } catch (error) {
        if (!mountedRef.current) return;
        console.error(error);
        const message = `Could not clear cache: ${error}`;
        setModalError(message);
        setStatus?.(message);
      }
    }
  };

  const handleImportFile = async () => {
    const request = ++loadRequestRef.current;
    setModalError(null);
    try {
      const result = await openFileDialog({
        filters: [{ name: "Frequency response (.csv, .txt)", extensions: ["csv", "txt"] }],
      });
      if (!result || request !== loadRequestRef.current || !mountedRef.current) return;
      const points = parseMeasurementText(result.text);
      const label = result.name.replace(/\.[^/.]+$/, "");
      const kind = identifyTraceKind(result.name, result.text, points.length);

      if (kind === "target") {
        (onAddTarget ?? onAddMeasurement)?.(label, points);
        setStatus?.(`Loaded target: ${label} (${points.length} points)`);
      } else {
        onAddMeasurement?.(label, points);
        setStatus?.(`Loaded measurement: ${label} (${points.length} points)`);
      }
      onClose();
    } catch (error) {
      if (request === loadRequestRef.current && mountedRef.current) {
        const message = `Could not import file: ${error}`;
        setModalError(message);
        setStatus?.(message);
      }
    }
  };

  const handleLoadDevice = async (dev: OnlineDevice) => {
    const request = ++loadRequestRef.current;
    setModalError(null);
    try {
      const points = await loadDevice(dev);
      if (request !== loadRequestRef.current || !mountedRef.current) return;
      onAddMeasurement?.(`${dev.brand} ${dev.name} (${dev.source})`, points);
      setLoadedDevices((prev) => new Set(prev).add(dev.id));
      onClose();
      setStatus?.(`Loaded: ${dev.brand} ${dev.name}`);
    } catch (error) {
      if (request === loadRequestRef.current && mountedRef.current) {
        console.error(error);
        const message = `Could not load ${dev.brand} ${dev.name}: ${error}`;
        setModalError(message);
        setStatus?.(message);
      }
    }
  };

  const query = debouncedQuery.trim().toLowerCase();
  const searchPending = searchQuery.trim().toLowerCase() !== query;
  const { results, total } = useMemo(() => findOnlineMeasurements(manifest, query), [manifest, query]);
  const searchStatus = loadingManifest ? "Loading the search index…"
    : searchPending ? "Searching…"
    : !query ? "Search by brand or model name."
    : total === 0 ? "No matching measurements."
    : total > ONLINE_RESULT_LIMIT ? `Showing ${ONLINE_RESULT_LIMIT} of ${total.toLocaleString()} matches. Narrow your search to see more.`
    : `${total} measurement${total === 1 ? "" : "s"} found.`;

  return (
    <Modal title="Add a curve" onClose={onClose} className="add-trace-modal">
      <div className="modal-body add-trace-body">
        <p className="add-trace-intro">Search for a headphone measurement or import a curve from a file.</p>
        {modalError && (
          <div className="modal-inline-error" role="alert">
            <Icon name="error" />
            <span>{modalError}</span>
          </div>
        )}
        <div className="add-trace-section">
          <label className="add-trace-section-title" htmlFor={searchId}>Headphone or brand</label>
          <input
            ref={searchInputRef}
            id={searchId}
            name="measurement-search"
            type="search"
            className="curves-search-input"
            placeholder="For example, HD 600"
            autoComplete="off"
            spellCheck={false}
            disabled={!downloaded}
            aria-describedby={`${searchId}-status`}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              // Search inputs consume Escape to clear text. Here it closes the dialog.
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              }
            }}
          />
          {downloaded ? (
            <>
              <p id={`${searchId}-status`} className="add-trace-search-status" role="status" aria-live="polite" aria-atomic="true">{searchStatus}</p>
              <section className="add-trace-online-results" aria-label="Measurement search results"
                aria-busy={loadingManifest || searchPending} tabIndex={results.length > 0 ? 0 : undefined}>
                {loadingManifest || searchPending ? (
                  <div className="online-result-empty"><p>{loadingManifest ? "Loading measurements…" : "Searching measurements…"}</p></div>
                ) : !query ? (
                  <div className="online-result-empty">
                    <Icon name="search" />
                    <p>Search headphone measurements</p>
                    <span>Search the measurements in the offline database.</span>
                  </div>
                ) : results.length === 0 ? (
                  <div className="online-result-empty">
                    <p>No measurements found</p>
                    <span>Try a shorter name or check the spelling.</span>
                  </div>
                ) : (
                  <ul className="online-result-list">
                    {results.map((device) => {
                      const name = `${device.brand} ${device.name}`;
                      const added = loadedDevices.has(device.id);
                      const adding = loadingDevice === device.id;
                      return (
                        <li key={device.id} className="online-result-item">
                          <div className="online-result-info">
                            <div className="online-result-name">{name}</div>
                            <div className="online-result-meta">
                              <span className="online-result-source">{device.source}</span>
                              {device.price !== null && <span className="online-result-price">${device.price}</span>}
                            </div>
                          </div>
                          <Button className={`online-result-action${added ? " added" : ""}`}
                            disabled={loadingDevice !== null || added}
                            aria-label={added ? `${name} added` : `Add ${name} measurement`}
                            onClick={() => handleLoadDevice(device)}>
                            <Icon name={added ? "check" : adding ? "hourglass_empty" : "add"} />
                            <span>{added ? "Added" : adding ? "Adding…" : "Add"}</span>
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <div className="add-trace-download-prompt">
              <p id={`${searchId}-status`}>Download the measurement database once to search it offline.</p>
              {isDownloading ? (
                <>
                  <progress max={1} value={downloadProgress ?? 0} aria-label="Measurement database download" />
                  <span role="status">Downloading… {Math.round((downloadProgress ?? 0) * 100)}%</span>
                </>
              ) : (
                <Button ref={downloadButtonRef} className="self-start min-h-11" onClick={handleDownload}>Download database</Button>
              )}
            </div>
          )}
        </div>
        <div className="add-trace-file-row">
          <Button className="add-trace-file-btn" onClick={handleImportFile}>
            <Icon name="file_upload" /> Import file
          </Button>
          <p>Measurement or target file<br /><span>.csv or .txt</span></p>
        </div>
        {downloaded && (
          <details className="add-trace-cache">
            <summary>Offline database <span>{totalCount !== null ? `${totalCount.toLocaleString()} curves` : "Saved on this device"}</span></summary>
            <div className="add-trace-cache-row">
              <p className="add-trace-cache-status">Clearing the cache removes the downloaded database. Added curves are retained.</p>
              <Button variant="ghost" className="add-trace-clear-cache-btn" onClick={handleResetCache} disabled={loadingDevice !== null || isDownloading}>
                <Icon name="delete" /> Clear cache
              </Button>
            </div>
          </details>
        )}
      </div>
    </Modal>
  );
}
