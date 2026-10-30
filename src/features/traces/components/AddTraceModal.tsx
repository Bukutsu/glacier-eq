import { ErrorNotice } from "@/components/feedback/ErrorNotice";
import type { StatusReporter } from "@/stores/toastStore";
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
  setStatus?: StatusReporter;
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
        result.sweepFailed ? "error" : undefined,
      );
    } catch (error) {
      if (!mountedRef.current) return;
      console.error(error);
      const message = t("addTraceModal.couldNotDownloadDatabase", {
        error: error,
      });
      setModalError({ key: "addTraceModal.couldNotDownloadDatabase", error });
      setStatus?.(message, "error");
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
        setStatus?.(message, "error");
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
        setStatus?.(message, "error");
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
        setStatus?.(message, "error");
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
      <div className="modal-body leg:p-[20px] leg:gap-[16px] leg:max-[540px]:p-[16px] leg:max-[540px]:gap-[12px]">
        <p className="leg:m-[0] leg:text-[color:var(--muted)] leg:text-[length:var(--type-label)] leg:leading-[1.5]">{t("addTraceModal.description")}</p>
        {modalError && (
          <ErrorNotice>
            {t(modalError.key, {
              error: modalError.error,
              name: modalError.name,
              name2: modalError.name2,
            })}
          </ErrorNotice>
        )}
        <div className="leg:flex leg:flex-col leg:gap-[8px] leg:p-[14px] leg:[border:1px_solid_var(--line-soft)] leg:rounded-[var(--radius-card)] leg:[background:var(--popover)] leg:max-[540px]:p-[12px]">
          <label className="leg:text-[length:var(--type-label)] leg:font-medium leg:text-[color:var(--text)]" htmlFor={searchId}>
            {t("addTraceModal.headphoneOrBrand")}
          </label>
          <Input
            ref={searchInputRef}
            id={searchId}
            name="measurement-search"
            type="search"
            className="leg:rounded-[var(--radius-control)]! leg:[background:var(--input-bg,_var(--surface-soft))]! leg:[border:1px_solid_var(--input-border,_var(--line-soft))]! leg:[transition:border-color_var(--motion-duration)_var(--motion-ease),_outline_var(--motion-duration)_var(--motion-ease)] leg:[font-family:var(--font-ui)] leg:text-[length:var(--type-body)] leg:text-[color:var(--text)] leg:p-[0_14px] leg:min-h-[44px] leg:w-[100%] leg:box-border leg:[&:focus]:[border-color:var(--ring)]! leg:[&:focus]:[outline:1px_solid_var(--focus-ring)] leg:[&:focus]:[outline-offset:2px] leg:[&::placeholder]:text-[color:var(--muted)] leg:pointer-coarse:[&&]:text-[length:16px]! leg:compact:min-h-[48px]! leg:compact:[&&&]:text-[length:17px]!"
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
            <div className="add-trace-owner leg:flex leg:flex-col leg:gap-[6px]">
              <label className="leg:text-[length:var(--type-label)] leg:font-medium leg:text-[color:var(--text)]" htmlFor={ownerId}>
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
                className="leg:min-h-[2.8em] leg:m-[0] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:leading-[1.4]"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {searchStatus}
              </p>
              <section
                className="leg:h-[min(320px,_35dvh)] leg:shrink-0 leg:overflow-y-auto leg:[overscroll-behavior:contain] leg:[scroll-padding-block:8px] leg:[background:var(--bg-dark)] leg:[border:1px_solid_var(--line-soft)] leg:rounded-[var(--radius-card)] leg:[&:focus-visible]:[outline:2px_solid_var(--ring)] leg:[&:focus-visible]:[outline-offset:2px]"
                aria-label={t("addTraceModal.measurementSearchResults")}
                aria-busy={loadingManifest || searchPending}
                tabIndex={results.length > 0 ? 0 : undefined}
              >
                {loadingManifest || searchPending ? (
                  <div className="online-result-empty leg:min-h-[160px] leg:p-[24px_16px] leg:flex leg:flex-col leg:items-center leg:justify-center leg:gap-[8px] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:leading-[1.5] leg:text-center">
                    <p>
                      {loadingManifest
                        ? t("addTraceModal.loadingMeasurements")
                        : t("addTraceModal.searchingMeasurements")}
                    </p>
                  </div>
                ) : !query ? (
                  <div className="online-result-empty leg:min-h-[160px] leg:p-[24px_16px] leg:flex leg:flex-col leg:items-center leg:justify-center leg:gap-[8px] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:leading-[1.5] leg:text-center">
                    <Icon name="search" />
                    <p>{t("addTraceModal.searchHeadphoneMeasurements")}</p>
                    <span>{t("addTraceModal.searchHelp")}</span>
                  </div>
                ) : results.length === 0 ? (
                  <div className="online-result-empty leg:min-h-[160px] leg:p-[24px_16px] leg:flex leg:flex-col leg:items-center leg:justify-center leg:gap-[8px] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)] leg:leading-[1.5] leg:text-center">
                    <p>{t("addTraceModal.noMeasurementsFound")}</p>
                    <span>{t("addTraceModal.noMatchesHint")}</span>
                  </div>
                ) : (
                  <ul className="leg:[list-style:none] leg:m-[0] leg:p-[0]">
                    {results.map((device) => {
                      const name = `${device.brand} ${device.name}`;
                      const added = loadedDevices.has(device.id);
                      const adding = loadingDevice === device.id;
                      return (
                        <li key={device.id} className="leg:flex leg:items-center leg:justify-between leg:p-[8px_10px] leg:min-h-[64px] leg:gap-[12px] leg:[border-bottom:1px_solid_var(--line-subtle)] leg:text-left leg:[transition:background_var(--motion-duration)_var(--motion-ease)] leg:[&:last-child]:[border-bottom:0] leg:[&:hover]:[background:var(--hover-bg)] leg:[&&:focus-within]:[background:var(--hover-bg)] leg:max-[540px]:p-[8px] leg:max-[540px]:gap-[10px] leg:compact:min-h-[48px]">
                          <div className="leg:flex leg:flex-col leg:gap-[4px] leg:min-w-[0] leg:flex-[1]">
                            <div className="leg:text-[color:var(--text)] leg:text-[length:var(--type-label)] leg:font-medium leg:leading-[1.4] leg:[overflow-wrap:anywhere]">{name}</div>
                            <div className="leg:flex leg:flex-wrap leg:gap-[4px_12px] leg:text-[length:var(--type-small)] leg:leading-[1.4] leg:text-[color:var(--muted)] leg:[overflow-wrap:anywhere]">
                              <span className="online-result-source">
                                <span className="leg:text-[color:var(--text)] leg:font-medium">
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
                            className={`leg:[.add-trace-modal_&]:min-h-[44px] leg:[.add-trace-modal_&]:min-w-[72px] leg:[.add-trace-modal_&]:p-[8px_10px] leg:[.add-trace-modal_&]:text-[length:var(--type-label)] leg:[.add-trace-modal_&]:gap-[6px] leg:[.add-trace-modal_&]:shrink-0 leg:[.add-trace-modal_&]:whitespace-nowrap ${added ? " added" : ""}`}
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
            <div className="add-trace-download-prompt leg:flex leg:flex-col leg:gap-[12px] leg:p-[16px] leg:[background:var(--bg-dark)] leg:text-[color:var(--muted)] leg:text-[length:var(--type-label)] leg:leading-[1.5]">
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
        <div className="add-trace-file-row leg:flex leg:items-center leg:gap-[16px] leg:p-[12px_14px] leg:[border:1px_solid_var(--line-soft)] leg:rounded-[var(--radius-card)] leg:[background:var(--popover)] leg:max-[540px]:flex-wrap leg:max-[540px]:gap-[12px]">
          <FileImportButton
            className="leg:[.add-trace-modal_&]:min-h-[44px] leg:[.add-trace-modal_&]:text-[length:var(--type-label)] leg:[.add-trace-modal_&]:whitespace-nowrap leg:[.add-trace-modal_&]:shrink-0 leg:compact:min-h-[44px]"
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
          <details className="add-trace-cache leg:[border-top:1px_solid_var(--line-soft)] leg:text-[color:var(--muted)] leg:text-[length:var(--type-small)]">
            <summary>
              {t("addTraceModal.offlineDatabase")}{" "}
              <span>
                {totalCount !== null
                  ? t("addTraceModal.curveCount", { count: totalCount })
                  : t("addTraceModal.savedOnThisDevice")}
              </span>
              <Icon name="expand_more" className="leg:flex-[0_0_auto] leg:text-[color:var(--muted)] leg:[transition:transform_var(--motion-duration)_var(--motion-ease)] leg:[details[open]>summary_&]:[transform:rotate(180deg)] leg:[.add-trace-cache_summary_&]:ml-[auto]" />
            </summary>
            <div className="leg:flex leg:items-center leg:gap-[16px] leg:pt-[4px] leg:max-[540px]:flex-wrap leg:max-[540px]:gap-[12px]">
              <p className="leg:m-[0] leg:text-[length:var(--type-small)] leg:leading-[1.5]">
                {t("addTraceModal.clearCacheHelp")}
              </p>
              <Button
                variant="ghost"
                className="leg:[.add-trace-modal_&]:min-h-[44px] leg:[.add-trace-modal_&]:p-[8px_12px] leg:[.add-trace-modal_&]:text-[length:var(--type-small)] leg:[.add-trace-modal_&]:whitespace-nowrap leg:[.add-trace-modal_&]:shrink-0 leg:compact:min-h-[44px]! leg:compact:h-[44px]!"
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
