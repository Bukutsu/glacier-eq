import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import { useTranslation } from "react-i18next";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MeasurementPoint } from "@/types";
import { Icon } from "@/components/ui/Icon";
import {
  findOnlineMeasurements,
  ONLINE_RESULT_LIMIT,
} from "@/features/traces/lib/onlineSearch";
import { openFileDialog } from "@/lib/rpc";
import { readTextFile } from "@/lib/textFile";
import { FileImportButton } from "@/components/ui/FileImportButton";
import {
  parseMeasurementText,
  identifyTraceKind,
} from "@/features/traces/lib/measurements";
import { useOnlineDatabase } from "@/features/traces/hooks/useOnlineDatabase";
import { type OnlineDevice } from "@/features/traces/lib/onlineDb";
import { Modal } from "@/components/ui/Modal";
import { confirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SearchSelect } from "@/components/ui/SearchSelect";

interface AddTraceModalProps {
  onClose: () => void;
  /** Explicit intent from Tuning; the curve manager keeps auto-detection. */
  importKind?: "measurement";
  onAddMeasurement?: (name: string, points: MeasurementPoint[]) => void;
  onAddTarget?: (name: string, points: MeasurementPoint[]) => void;
  setStatus?: (value: string) => void;
}

export function AddTraceModal({
  onClose,
  importKind,
  onAddMeasurement,
  onAddTarget,
  setStatus,
}: AddTraceModalProps) {
  const { t } = useTranslation("library");
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
  const [selectedOwner, setSelectedOwner] = useState("");
  const [modalError, setModalError] = useState<{
    key:
      | "addTraceModal.couldNotDownloadDatabase"
      | "addTraceModal.couldNotClearCache"
      | "addTraceModal.couldNotImportFile"
      | "addTraceModal.couldNotLoad";
    error: unknown;
    name?: string;
    name2?: string;
  } | null>(null);
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const downloadButtonRef = useRef<HTMLButtonElement>(null);
  const searchId = useId();
  const ownerId = useId();

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
          ? t("addTraceModal.downloadedCleanupFailed", {
              count: result.entries,
            })
          : t("addTraceModal.downloaded", { count: result.entries }),
      );
    } catch (error) {
      if (!mountedRef.current) return;
      console.error(error);
      const message = t("addTraceModal.couldNotDownloadDatabase", {
        error: error,
      });
      setModalError({ key: "addTraceModal.couldNotDownloadDatabase", error });
      setStatus?.(message);
    }
  };

  const handleResetCache = async () => {
    setModalError(null);
    if (
      await confirmDialog({
        title: t("addTraceModal.clearDatabaseCache"),
        message: t("addTraceModal.clearCacheMessage"),
        confirmLabel: t("addTraceModal.clearCache"),
        danger: true,
      })
    ) {
      try {
        await clearCache();
        if (!mountedRef.current) return;
        setSelectedOwner("");
        setStatus?.(t("addTraceModal.databaseCacheCleared"));
      } catch (error) {
        if (!mountedRef.current) return;
        console.error(error);
        const message = t("addTraceModal.couldNotClearCache", { error: error });
        setModalError({ key: "addTraceModal.couldNotClearCache", error });
        setStatus?.(message);
      }
    }
  };

  const handleImportFile = async (selectedFile?: File) => {
    const request = ++loadRequestRef.current;
    setModalError(null);
    try {
      const result = selectedFile
        ? await readTextFile(selectedFile)
        : await openFileDialog({
            filters: [
              {
                name: t("addTraceModal.frequencyResponseCsvTxt"),
                extensions: ["csv", "txt"],
              },
            ],
          });
      if (!result || request !== loadRequestRef.current || !mountedRef.current)
        return;
      const points = parseMeasurementText(result.text);
      const label = result.name.replace(/\.[^/.]+$/, "");
      const kind =
        importKind ??
        identifyTraceKind(result.name, result.text, points.length);

      if (kind === "target") {
        (onAddTarget ?? onAddMeasurement)?.(label, points);
        setStatus?.(
          t("addTraceModal.loadedTarget", {
            count: points.length,
            name: label,
          }),
        );
      } else {
        onAddMeasurement?.(label, points);
        setStatus?.(
          t("addTraceModal.loadedMeasurement", {
            count: points.length,
            name: label,
          }),
        );
      }
      onClose();
    } catch (error) {
      if (request === loadRequestRef.current && mountedRef.current) {
        const message = t("addTraceModal.couldNotImportFile", { error: error });
        setModalError({ key: "addTraceModal.couldNotImportFile", error });
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
      setStatus?.(
        t("addTraceModal.loaded", { name: dev.brand, name2: dev.name }),
      );
    } catch (error) {
      if (request === loadRequestRef.current && mountedRef.current) {
        console.error(error);
        const message = t("addTraceModal.couldNotLoad", {
          name: dev.brand,
          name2: dev.name,
          error: error,
        });
        setModalError({
          key: "addTraceModal.couldNotLoad",
          error,
          name: dev.brand,
          name2: dev.name,
        });
        setStatus?.(message);
      }
    }
  };

  const query = debouncedQuery.trim().toLowerCase();
  const searchPending = searchQuery.trim().toLowerCase() !== query;
  const { results, total, owners } = useMemo(
    () => findOnlineMeasurements(manifest, query, selectedOwner || undefined),
    [manifest, query, selectedOwner],
  );
  const ownerOptions = useMemo(
    () => [
      { value: "", label: t("addTraceModal.allOwners") },
      ...owners.map((owner) => ({ value: owner, label: owner })),
    ],
    [owners, t],
  );

  useEffect(() => {
    if (selectedOwner && !owners.includes(selectedOwner)) setSelectedOwner("");
  }, [owners, selectedOwner]);
  const searchStatus = loadingManifest
    ? t("addTraceModal.loadingIndex")
    : searchPending
      ? t("addTraceModal.searching")
      : !query
        ? t("addTraceModal.searchByBrandOrModelName")
        : total === 0
          ? t("addTraceModal.noMatchingMeasurements")
          : total > ONLINE_RESULT_LIMIT
            ? t("addTraceModal.limitedMatches", {
                shown: ONLINE_RESULT_LIMIT,
                total: total.toLocaleString(),
              })
            : t("addTraceModal.matchesFound", { count: total });

  return (
    <Modal
      title={
        importKind
          ? t("tuningPanel.addMeasurement")
          : t("addTraceModal.addACurve")
      }
      onClose={onClose}
      className="add-trace-modal"
    >
      <div className="modal-body add-trace-body">
        <p className="add-trace-intro">{t("addTraceModal.description")}</p>
        {modalError && (
          <ErrorNotice>
            {t(modalError.key, {
              error: modalError.error,
              name: modalError.name,
              name2: modalError.name2,
            })}
          </ErrorNotice>
        )}
        <div className="add-trace-section">
          <label className="add-trace-section-title" htmlFor={searchId}>
            {t("addTraceModal.headphoneOrBrand")}
          </label>
          <Input
            ref={searchInputRef}
            id={searchId}
            name="measurement-search"
            type="search"
            className="curves-search-input"
            placeholder={t("addTraceModal.searchPlaceholder")}
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
          {downloaded && (
            <div className="add-trace-owner">
              <label className="add-trace-section-title" htmlFor={ownerId}>
                {t("addTraceModal.measurementOwner")}
              </label>
              <SearchSelect
                id={ownerId}
                value={selectedOwner}
                options={ownerOptions}
                disabled={loadingManifest || owners.length === 0}
                onChange={setSelectedOwner}
                searchLabel={t("addTraceModal.measurementOwner")}
                searchPlaceholder={t("addTraceModal.searchOwnerPlaceholder")}
                emptyText={t("addTraceModal.noOwnerMatches")}
              />
            </div>
          )}
          {downloaded ? (
            <>
              <p
                id={`${searchId}-status`}
                className="add-trace-search-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {searchStatus}
              </p>
              <section
                className="add-trace-online-results"
                aria-label={t("addTraceModal.measurementSearchResults")}
                aria-busy={loadingManifest || searchPending}
                tabIndex={results.length > 0 ? 0 : undefined}
              >
                {loadingManifest || searchPending ? (
                  <div className="online-result-empty">
                    <p>
                      {loadingManifest
                        ? t("addTraceModal.loadingMeasurements")
                        : t("addTraceModal.searchingMeasurements")}
                    </p>
                  </div>
                ) : !query ? (
                  <div className="online-result-empty">
                    <Icon name="search" />
                    <p>{t("addTraceModal.searchHeadphoneMeasurements")}</p>
                    <span>{t("addTraceModal.searchHelp")}</span>
                  </div>
                ) : results.length === 0 ? (
                  <div className="online-result-empty">
                    <p>{t("addTraceModal.noMeasurementsFound")}</p>
                    <span>{t("addTraceModal.noMatchesHint")}</span>
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
                              <span className="online-result-source">
                                <span className="online-result-owner-label">
                                  {t("addTraceModal.measurementOwner")}:
                                </span>{" "}
                                {device.source}
                              </span>
                              {device.price !== null && (
                                <span className="online-result-price">
                                  ${device.price}
                                </span>
                              )}
                            </div>
                          </div>
                          <Button
                            className={`online-result-action${added ? " added" : ""}`}
                            disabled={loadingDevice !== null || added}
                            aria-label={
                              added
                                ? t("addTraceModal.added", { name: name })
                                : t("addTraceModal.addMeasurement", {
                                    name: name,
                                  })
                            }
                            onClick={() => handleLoadDevice(device)}
                          >
                            <Icon
                              name={
                                added
                                  ? "check"
                                  : adding
                                    ? "hourglass_empty"
                                    : "add"
                              }
                            />
                            <span>
                              {added
                                ? t("addTraceModal.addedButton")
                                : adding
                                  ? t("addTraceModal.adding")
                                  : t("addTraceModal.add")}
                            </span>
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
              <p id={`${searchId}-status`}>{t("addTraceModal.downloadHelp")}</p>
              {isDownloading ? (
                <>
                  <progress
                    max={1}
                    value={downloadProgress ?? 0}
                    aria-label={t("addTraceModal.measurementDatabaseDownload")}
                  />
                  <span role="status">
                    {t("addTraceModal.downloadProgress", {
                      percent: Math.round((downloadProgress ?? 0) * 100),
                    })}
                  </span>
                </>
              ) : (
                <Button
                  ref={downloadButtonRef}
                  className="self-start min-h-11"
                  onClick={handleDownload}
                >
                  {t("addTraceModal.downloadDatabase")}
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="add-trace-file-row">
          <FileImportButton
            className="add-trace-file-btn"
            label={t("addTraceModal.importFile")}
            accept=".csv,.txt"
            onImport={(file) => void handleImportFile(file)}
          />
          <p>
            {importKind
              ? t("tuningPanel.measurement")
              : t("addTraceModal.measurementOrTargetFile")}
            <br />
            <span>{t("addTraceModal.csvOrTxt")}</span>
          </p>
        </div>
        {downloaded && (
          <details className="add-trace-cache">
            <summary>
              {t("addTraceModal.offlineDatabase")}{" "}
              <span>
                {totalCount !== null
                  ? t("addTraceModal.curveCount", { count: totalCount })
                  : t("addTraceModal.savedOnThisDevice")}
              </span>
              <Icon name="expand_more" className="disclosure-chevron" />
            </summary>
            <div className="add-trace-cache-row">
              <p className="add-trace-cache-status">
                {t("addTraceModal.clearCacheHelp")}
              </p>
              <Button
                variant="ghost"
                className="add-trace-clear-cache-btn"
                onClick={handleResetCache}
                disabled={loadingDevice !== null || isDownloading}
              >
                <Icon name="delete" /> {t("addTraceModal.clearCache")}
              </Button>
            </div>
          </details>
        )}
      </div>
    </Modal>
  );
}
