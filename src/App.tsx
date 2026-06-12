import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Bands } from "./components/Bands";
import { DeviceChooser } from "./components/DeviceChooser";
import { EqGraph } from "./components/EqGraph";
import { Header } from "./components/Header";
import { Icon } from "./components/Icon";
import { Preamp } from "./components/Preamp";
import { TargetSelector } from "./components/TargetSelector";
import { ToolsPanel, MeasureTab, AutoEqTab } from "./components/ToolsPanel";
import { DEFAULT_PROFILE_NAME } from "./constants";
import { DEV_DUMMY_DEVICE, buildDevDummyPeq, isDevDummyDevice } from "./lib/devDevice";
import { makeMeasurementName, nextMeasurementColor, normalizeMeasurementPoints } from "./lib/measurements";
import { getBuiltInTargets, makeTargetName, nextTargetColor } from "./lib/targetReferences";
import { buildDefaultState, normalizePeq } from "./lib/peq";
import type { DeviceInfo, Filter, GraphViewMode, MeasurementTrace, PEQData, Profile, TargetTrace, OperationProgress } from "./types";
import "./App.css";

const ANDROID_TOAST_DEDUPE_MS = 2000;

const sleep = (ms: number) => {
  const isAutomated = typeof navigator !== "undefined" && navigator.webdriver;
  return new Promise((resolve) => setTimeout(resolve, isAutomated ? 0 : ms));
};

declare global {
  interface Window {
    AndroidNotifier?: {
      showToast: (message: string) => void;
    };
  }
}

function App() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 768px)").matches);
  const isAndroid = typeof navigator !== "undefined" && (
    document.body.classList.contains("is-android") ||
    /android/i.test(navigator.userAgent) ||
    typeof window.AndroidNotifier !== "undefined"
  );
  const [activeTab, setActiveTab] = useState<"eq" | "tuning" | "profiles" | "settings">("eq");

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const listener = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const [peq, setPeq] = useState<PEQData>(buildDefaultState);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [connected, setConnected] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [status, setStatus] = useState("Ready");
  const lastAndroidToastRef = useRef<{ message: string; shownAt: number } | null>(null);

  // Show native Android Toast when status changes, instead of the web StatusBanner
  useEffect(() => {
    if (!isAndroid || status === "Ready") return;
    const now = Date.now();
    const lastToast = lastAndroidToastRef.current;
    if (lastToast?.message === status && now - lastToast.shownAt < ANDROID_TOAST_DEDUPE_MS) {
      return;
    }
    lastAndroidToastRef.current = { message: status, shownAt: now };
    try {
      window.AndroidNotifier?.showToast(status);
    } catch {
      // Native bridge not available, fall through silently
    }
  }, [status, isAndroid]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PROFILE_NAME);
  const [profileSearch, setProfileSearch] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [measurements, setMeasurements] = useState<MeasurementTrace[]>([]);
  const builtInTargets = useMemo(getBuiltInTargets, []);
  const [userTargets, setUserTargets] = useState<TargetTrace[]>([]);
  const allTargets = useMemo(() => [...builtInTargets, ...userTargets], [builtInTargets, userTargets]);
  const [activeTargetIds, setActiveTargetIds] = useState<string[]>(() => builtInTargets[0] ? [builtInTargets[0].id] : []);
  const activeTargets = useMemo(
    () => allTargets.filter((target) => activeTargetIds.includes(target.id)),
    [activeTargetIds, allTargets],
  );
  const [graphViewMode, setGraphViewMode] = useState<GraphViewMode>(() => (
    window.localStorage.getItem("glacier-graph-view-mode") === "level" ? "level" : "shape"
  ));
  const [dirty, setDirty] = useState(false);
  const selectedPresetRef = useRef(selectedPreset);
  const peqRef = useRef(peq);

  useEffect(() => {
    peqRef.current = peq;
  }, [peq]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("glacier-measurements");
      if (!saved) return;

      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;

      const normalized = parsed
        .filter((trace): trace is MeasurementTrace => (
          trace &&
          typeof trace.id === "string" &&
          typeof trace.name === "string" &&
          typeof trace.color === "string" &&
          typeof trace.visible === "boolean" &&
          Array.isArray(trace.points)
        ))
        .map((trace) => ({
          ...trace,
          points: normalizeMeasurementPoints(trace.points),
        }));

      setMeasurements(normalized);
    } catch {
      // Ignore malformed local measurement cache.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("glacier-measurements", JSON.stringify(measurements));
  }, [measurements]);

  useEffect(() => {
    try {
      const savedTargets = window.localStorage.getItem("glacier-user-targets");
      if (savedTargets) {
        const parsedTargets = JSON.parse(savedTargets);
        if (Array.isArray(parsedTargets)) {
          setUserTargets(parsedTargets
            .filter((target): target is TargetTrace => (
              target &&
              typeof target.id === "string" &&
              typeof target.name === "string" &&
              typeof target.color === "string" &&
              Array.isArray(target.points)
            ))
            .map((target) => ({
              ...target,
              builtIn: false,
              points: normalizeMeasurementPoints(target.points),
            })));
        }
      }

      const savedActiveIds = window.localStorage.getItem("glacier-active-targets");
      if (savedActiveIds) {
        const parsedActiveIds = JSON.parse(savedActiveIds);
        if (Array.isArray(parsedActiveIds) && parsedActiveIds.every((id) => typeof id === "string")) {
          setActiveTargetIds(parsedActiveIds);
        }
      }
    } catch {
      // Ignore malformed local target cache.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("glacier-user-targets", JSON.stringify(userTargets));
  }, [userTargets]);

  useEffect(() => {
    window.localStorage.setItem("glacier-active-targets", JSON.stringify(activeTargetIds));
  }, [activeTargetIds]);

  useEffect(() => {
    window.localStorage.setItem("glacier-graph-view-mode", graphViewMode);
  }, [graphViewMode]);

  const [undoStack, setUndoStack] = useState<PEQData[]>([]);
  const [redoStack, setRedoStack] = useState<PEQData[]>([]);

  const pushToUndoStack = useCallback((currentPeq: PEQData) => {
    setUndoStack((prev) => {
      if (prev.length > 0 && JSON.stringify(prev[prev.length - 1]) === JSON.stringify(currentPeq)) {
        return prev;
      }
      const next = [...prev, currentPeq];
      if (next.length > 50) {
        next.shift();
      }
      return next;
    });
    setRedoStack([]);
  }, []);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, peqRef.current]);
    setPeq(prev);
    setDirty(true);
  }, [undoStack]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, peqRef.current]);
    setPeq(next);
    setDirty(true);
  }, [redoStack]);

  const handleStartChange = useCallback(() => {
    pushToUndoStack(peqRef.current);
  }, [pushToUndoStack]);

  useEffect(() => {
    selectedPresetRef.current = selectedPreset;
  }, [selectedPreset]);

  const deviceName = useMemo(() => {
    const selected = devices.find((device) => device.path === selectedDevice);
    return selected?.profile_name || selected?.product_string || "EPZ TP35 Pro";
  }, [devices, selectedDevice]);

  const applyProfile = useCallback((profile: Profile) => {
    pushToUndoStack(peqRef.current);
    const data = normalizePeq(profile.data, { enableLoadedFilters: true });
    selectedPresetRef.current = profile.name;
    setPeq(data);
    setSelectedPreset(profile.name);
    setNewProfileName(profile.name);
    setDirty(false);
  }, [pushToUndoStack]);

  const importPeq = useCallback((data: PEQData, name: string, isSaved: boolean) => {
    pushToUndoStack(peqRef.current);
    const normalized = normalizePeq(data, { enableLoadedFilters: true });
    setPeq(normalized);
    setSelectedPreset(name);
    setNewProfileName(name);
    setDirty(!isSaved);
  }, [pushToUndoStack]);

  const loadProfiles = useCallback(async () => {
    try {
      const loaded = await invoke<Profile[]>("list_profiles");
      setProfiles(loaded);

      const current = selectedPresetRef.current;
      const selected = loaded.find((profile) => profile.name === current) ?? loaded[0];
      if (selected) {
        applyProfile(selected);
      } else if (current === DEFAULT_PROFILE_NAME) {
        setPeq(buildDefaultState());
      }
    } catch (error) {
      setStatus(`Profile load failed: ${error}`);
    }
  }, [applyProfile]);

  const scanDevices = useCallback(async () => {
    setIsBusy(true);
    setStatus("Scanning for devices...");
    try {
      const realDevices = await invoke<DeviceInfo[]>("list_devices");
      const list = import.meta.env.DEV ? [...realDevices, DEV_DUMMY_DEVICE] : realDevices;
      setDevices(list);
      if (list[0]) setSelectedDevice(list[0].path);
      setStatus(list.length ? `Found ${list.length} device(s)` : "No compatible DACs found");
    } catch (error) {
      if (import.meta.env.DEV) {
        setDevices([DEV_DUMMY_DEVICE]);
        setSelectedDevice(DEV_DUMMY_DEVICE.path);
        setStatus("Hardware scan failed; using dummy DAC for dev review");
        return;
      }
      setStatus(`Scan failed: ${error}`);
    } finally {
      setIsBusy(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    let active = true;
    let unlistenFn: (() => void) | null = null;

    const safeUnlisten = (fn: () => void) => {
      try {
        const p = fn() as any;
        if (p && typeof p.catch === "function") {
          p.catch((err: any) => {
            console.warn("Failed to unlisten from operation-progress (async):", err);
          });
        }
      } catch (err) {
        console.warn("Failed to unlisten from operation-progress (sync):", err);
      }
    };

    listen<OperationProgress>("operation-progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      if (active) {
        unlistenFn = fn;
      } else {
        safeUnlisten(fn);
      }
    });

    return () => {
      active = false;
      if (unlistenFn) {
        safeUnlisten(unlistenFn);
      }
    };
  }, []);

  useEffect(() => {
    scanDevices();
  }, [scanDevices]);

  const pullEq = useCallback(async () => {
    pushToUndoStack(peqRef.current);
    setProgress(null);
    setIsBusy(true);
    try {
      let data: PEQData;
      if (isDevDummyDevice(selectedDevice)) {
        setProgress({ message: "Initializing read connection...", percentage: 5 });
        await sleep(200);
        setProgress({ message: "Reading band 1/10...", percentage: 15 });
        await sleep(150);
        setProgress({ message: "Reading band 4/10...", percentage: 40 });
        await sleep(150);
        setProgress({ message: "Reading band 7/10...", percentage: 65 });
        await sleep(150);
        setProgress({ message: "Reading band 10/10...", percentage: 85 });
        await sleep(150);
        setProgress({ message: "Reading device preamp...", percentage: 90 });
        await sleep(150);
        setProgress({ message: "Read successful", percentage: 100 });
        await sleep(400);
        data = buildDevDummyPeq();
      } else {
        data = await invoke<PEQData>("get_eq_state");
        await sleep(400);
      }
      setPeq(normalizePeq(data));
      selectedPresetRef.current = "Pulled from device";
      setSelectedPreset("Pulled from device");
      setDirty(false);
      setStatus(isDevDummyDevice(selectedDevice) ? "Loaded dummy DAC EQ" : "Pull successful");
    } catch (error) {
      setStatus(`Pull failed: ${error}`);
    } finally {
      setIsBusy(false);
      setProgress(null);
    }
  }, [pushToUndoStack, selectedDevice]);

  const connectDevice = useCallback(async () => {
    if (!selectedDevice) return;
    setIsBusy(true);
    try {
      if (isDevDummyDevice(selectedDevice)) {
        setConnected(true);
        setStatus("Connected to dummy DAC");
        await pullEq();
        return;
      }

      await invoke("connect_device", { path: selectedDevice });
      setConnected(true);
      setStatus("Ready");

      const settings = await invoke<{ auto_pull_on_connect: boolean }>("get_settings");
      if (settings.auto_pull_on_connect) {
        // We call the inner fetch code of pullEq directly or call pullEq itself.
        // Since pullEq sets state asynchronously, calling it is safe.
        await pullEq();
      }
    } catch (error) {
      setStatus(`Connection failed: ${error}`);
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice, pullEq]);

  const pushEq = useCallback(async () => {
    setProgress(null);
    setIsBusy(true);
    try {
      if (isDevDummyDevice(selectedDevice)) {
        setProgress({ message: "Initializing push connection...", percentage: 10 });
        await sleep(200);
        setProgress({ message: "Writing band 1/10...", percentage: 20 });
        await sleep(150);
        setProgress({ message: "Writing band 5/10...", percentage: 45 });
        await sleep(150);
        setProgress({ message: "Writing band 10/10...", percentage: 70 });
        await sleep(150);
        setProgress({ message: "Writing preamp...", percentage: 75 });
        await sleep(150);
        setProgress({ message: "Committing changes to device...", percentage: 80 });
        await sleep(200);
        setProgress({ message: "Verifying changes...", percentage: 90 });
        await sleep(200);
        setProgress({ message: "Push successful", percentage: 100 });
        await sleep(400);
      } else {
        await invoke("set_eq_state", { peq });
        await sleep(400);
      }
      setDirty(false);
      setStatus(isDevDummyDevice(selectedDevice) ? "Dummy DAC push simulated" : "Push successful");
    } catch (error) {
      setStatus(`Push failed: ${error}`);
    } finally {
      setIsBusy(false);
      setProgress(null);
    }
  }, [peq, selectedDevice]);

  const disconnectDevice = useCallback(async () => {
    setIsBusy(true);
    try {
      if (!isDevDummyDevice(selectedDevice)) {
        await invoke("disconnect_device");
      }
      setConnected(false);
      setStatus("Disconnected");
    } catch (error) {
      setStatus(`Disconnect failed: ${error}`);
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice]);

  const saveProfile = useCallback(async () => {
    const name = newProfileName.trim() || selectedPreset;
    if (!name || name === DEFAULT_PROFILE_NAME || name === "Pulled from device") {
      setStatus("Enter a profile name before saving.");
      return;
    }

    try {
      await invoke("save_profile", { name, peq });
      selectedPresetRef.current = name;
      setSelectedPreset(name);
      setNewProfileName("");
      setDirty(false);
      await loadProfiles();
      setStatus("Profile saved");
    } catch (error) {
      setStatus(`Save failed: ${error}`);
    }
  }, [loadProfiles, newProfileName, peq, selectedPreset]);

  const deleteSelectedProfile = useCallback(async () => {
    if (selectedPreset === DEFAULT_PROFILE_NAME) return;

    try {
      await invoke("delete_profile", { name: selectedPreset });
      selectedPresetRef.current = DEFAULT_PROFILE_NAME;
      setSelectedPreset(DEFAULT_PROFILE_NAME);
      setPeq(buildDefaultState());
      await loadProfiles();
      setStatus("Profile deleted");
    } catch (error) {
      setStatus(`Delete failed: ${error}`);
    }
  }, [loadProfiles, selectedPreset]);

  const openProfilesDir = useCallback(async () => {
    try {
      await invoke("open_profiles_dir");
    } catch (error) {
      setStatus(`Open profiles folder failed: ${error}`);
    }
  }, []);

  const updateFilter = (index: number, updated: Filter) => {
    setDirty(true);
    setPeq((previous) => {
      const filters = [...previous.filters];
      filters[index] = updated;
      return { ...previous, filters };
    });
  };

  const reset = () => {
    pushToUndoStack(peqRef.current);
    selectedPresetRef.current = DEFAULT_PROFILE_NAME;
    setPeq(buildDefaultState());
    setSelectedPreset(DEFAULT_PROFILE_NAME);
    setDirty(true);
  };

  const addMeasurement = useCallback((name: string, points: MeasurementTrace["points"]) => {
    setMeasurements((current) => [
      ...current,
      {
        id: `${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        name: makeMeasurementName(name, current),
        color: nextMeasurementColor(current),
        visible: true,
        points: normalizeMeasurementPoints(points),
      },
    ]);
  }, []);

  const removeMeasurement = useCallback((id: string) => {
    setMeasurements((current) => current.filter((trace) => trace.id !== id));
  }, []);

  const toggleMeasurement = useCallback((id: string) => {
    setMeasurements((current) =>
      current.map((trace) => trace.id === id ? { ...trace, visible: !trace.visible } : trace),
    );
  }, []);

  const clearMeasurements = useCallback(() => {
    setMeasurements([]);
  }, []);

  const toggleTarget = useCallback((id: string) => {
    setActiveTargetIds((current) => (
      current.includes(id) ? current.filter((targetId) => targetId !== id) : [...current, id]
    ));
  }, []);

  const addTarget = useCallback((name: string, points: TargetTrace["points"]) => {
    setUserTargets((current) => {
      const nextTarget = {
        id: `user-target:${Date.now()}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        name: makeTargetName(name, [...builtInTargets, ...current]),
        color: nextTargetColor(builtInTargets.length + current.length),
        builtIn: false,
        points: normalizeMeasurementPoints(points),
      };
      setActiveTargetIds((activeIds) => [...activeIds, nextTarget.id]);
      return [...current, nextTarget];
    });
  }, [builtInTargets]);

  const removeTarget = useCallback((id: string) => {
    setUserTargets((current) => current.filter((target) => target.id !== id));
    setActiveTargetIds((current) => current.filter((targetId) => targetId !== id));
  }, []);

  const undoRedoRef = useRef({
    undo,
    redo,
    save: saveProfile,
    reset,
    pull: pullEq,
    push: pushEq,
  });

  useEffect(() => {
    undoRedoRef.current = {
      undo,
      redo,
      save: saveProfile,
      reset,
      pull: pullEq,
      push: pushEq,
    };
  }, [undo, redo, saveProfile, reset, pullEq, pushEq]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isEditingText = active && (
        active.tagName === "INPUT" || 
        active.tagName === "TEXTAREA" || 
        (active as HTMLElement).isContentEditable
      );

      const isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl) {
        if (isEditingText) {
          if (e.key.toLowerCase() === "s") {
            e.preventDefault();
            undoRedoRef.current.save();
          } else if (e.shiftKey && e.key.toLowerCase() === "r") {
            e.preventDefault();
            undoRedoRef.current.reset();
          } else if (e.key.toLowerCase() === "r") {
            e.preventDefault();
            undoRedoRef.current.pull();
          }
          return;
        }

        if (e.shiftKey && e.key.toLowerCase() === "z") {
          e.preventDefault();
          undoRedoRef.current.redo();
        } else if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          undoRedoRef.current.undo();
        } else if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          undoRedoRef.current.redo();
        } else if (e.key.toLowerCase() === "s") {
          e.preventDefault();
          undoRedoRef.current.save();
        } else if (e.shiftKey && e.key.toLowerCase() === "r") {
          e.preventDefault();
          undoRedoRef.current.reset();
        } else if (e.key.toLowerCase() === "r") {
          e.preventDefault();
          undoRedoRef.current.pull();
        } else if (e.key === "Enter") {
          e.preventDefault();
          undoRedoRef.current.push();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div id="app">
      <Header
        connected={connected}
        isBusy={isBusy}
        progress={progress}
        profile={selectedPreset}
        deviceName={deviceName}
        dirty={dirty}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={undo}
        onRedo={redo}
        onPull={pullEq}
        onPush={pushEq}
        onDisconnect={disconnectDevice}
      />
      {!isAndroid && connected && status !== "Ready" && <StatusBanner status={status} onClose={() => setStatus("Ready")} />}
      {!connected ? (
        <DeviceChooser
          devices={devices}
          onScan={scanDevices}
          onConnect={connectDevice}
          selectedDevice={selectedDevice}
          setSelectedDevice={setSelectedDevice}
          status={status}
          isBusy={isBusy}
        />
      ) : isMobile ? (
        <main className="workspace mobile-workspace">
          <div className="mobile-content-area">
            {activeTab === "eq" && (
              <section className="left-pane">
                <section className="graph-card">
                  <EqGraph
                    peq={peq}
                    measurements={measurements}
                    targets={activeTargets}
                    viewMode={graphViewMode}
                  />
                </section>
                <Preamp
                  value={peq.global_gain}
                  onStartChange={handleStartChange}
                  onChange={(global_gain) => {
                    setDirty(true);
                    setPeq((previous) => ({ ...previous, global_gain }));
                  }}
                />
                <Bands peq={peq} onFilterChange={updateFilter} onStartChange={handleStartChange} />
              </section>
            )}
            {activeTab === "tuning" && (
              <section className="left-pane">
                <section className="graph-card">
                  <EqGraph
                    peq={peq}
                    measurements={measurements}
                    targets={activeTargets}
                    viewMode={graphViewMode}
                  />
                </section>

                <TargetSelector
                  targets={allTargets}
                  activeTargetIds={activeTargetIds}
                  onToggleTarget={toggleTarget}
                  onAddTarget={addTarget}
                  onRemoveTarget={removeTarget}
                  setStatus={setStatus}
                />

                <section className="tuning-card card">
                  <div className="tuning-card-header">
                    <Icon>auto_awesome</Icon>
                    <strong>AutoEQ (Tuning Assistant)</strong>
                  </div>
                  <div className="tuning-card-body">
                    <AutoEqTab
                      measurements={measurements}
                      allTargets={allTargets}
                      onImportPEQ={importPeq}
                      setStatus={setStatus}
                    />
                  </div>
                </section>

                <section className="tuning-card card">
                  <div className="tuning-card-header">
                    <Icon>analytics</Icon>
                    <strong>Measurement Traces</strong>
                  </div>
                  <div className="tuning-card-body" style={{ padding: 0 }}>
                    <MeasureTab
                      measurements={measurements}
                      onAddMeasurement={addMeasurement}
                      onRemoveMeasurement={removeMeasurement}
                      onToggleMeasurement={toggleMeasurement}
                      onClearMeasurements={clearMeasurements}
                      setStatus={setStatus}
                    />
                  </div>
                </section>
              </section>
            )}
            {activeTab === "profiles" && (
              <ToolsPanel
                peq={peq}
                onImportPEQ={importPeq}
                profiles={profiles}
                selectedPreset={selectedPreset}
                profileSearch={profileSearch}
                setProfileSearch={setProfileSearch}
                newProfileName={newProfileName}
                setNewProfileName={setNewProfileName}
                onSelectProfile={applyProfile}
                onReloadProfiles={loadProfiles}
                onOpenProfilesDir={openProfilesDir}
                onReset={reset}
                onSave={saveProfile}
                onDelete={deleteSelectedProfile}
                setStatus={setStatus}
                measurements={measurements}
                onAddMeasurement={addMeasurement}
                onRemoveMeasurement={removeMeasurement}
                onToggleMeasurement={toggleMeasurement}
                onClearMeasurements={clearMeasurements}
                canUndo={undoStack.length > 0}
                canRedo={redoStack.length > 0}
                onUndo={undo}
                onRedo={redo}
                availableTabs={["Preset", "Import"]}
                defaultTab="Preset"
                showDiagnostics={false}
              />
            )}
            {activeTab === "settings" && (
              <ToolsPanel
                peq={peq}
                onImportPEQ={importPeq}
                profiles={profiles}
                selectedPreset={selectedPreset}
                profileSearch={profileSearch}
                setProfileSearch={setProfileSearch}
                newProfileName={newProfileName}
                setNewProfileName={setNewProfileName}
                onSelectProfile={applyProfile}
                onReloadProfiles={loadProfiles}
                onOpenProfilesDir={openProfilesDir}
                onReset={reset}
                onSave={saveProfile}
                onDelete={deleteSelectedProfile}
                setStatus={setStatus}
                measurements={measurements}
                onAddMeasurement={addMeasurement}
                onRemoveMeasurement={removeMeasurement}
                onToggleMeasurement={toggleMeasurement}
                onClearMeasurements={clearMeasurements}
                canUndo={undoStack.length > 0}
                canRedo={redoStack.length > 0}
                onUndo={undo}
                onRedo={redo}
                availableTabs={["Settings"]}
                defaultTab="Settings"
                showActions={false}
                graphViewMode={graphViewMode}
                onGraphViewModeChange={setGraphViewMode}
              />
            )}
          </div>
          <nav className="mobile-tab-bar">
            <button
              className={`mobile-tab-item ${activeTab === "eq" ? "active" : ""}`}
              onClick={() => setActiveTab("eq")}
            >
              <Icon>tune</Icon>
              <span>EQ</span>
            </button>
            <button
              className={`mobile-tab-item ${activeTab === "tuning" ? "active" : ""}`}
              onClick={() => setActiveTab("tuning")}
            >
              <Icon>auto_awesome</Icon>
              <span>Tuning</span>
            </button>
            <button
              className={`mobile-tab-item ${activeTab === "profiles" ? "active" : ""}`}
              onClick={() => setActiveTab("profiles")}
            >
              <Icon>folder</Icon>
              <span>Profiles</span>
            </button>
            <button
              className={`mobile-tab-item ${activeTab === "settings" ? "active" : ""}`}
              onClick={() => setActiveTab("settings")}
            >
              <Icon>settings</Icon>
              <span>Settings</span>
            </button>
          </nav>
        </main>
      ) : (
        <main className="workspace">
          <section className="left-pane">
            <section className="graph-card">
              <EqGraph
                peq={peq}
                measurements={measurements}
                targets={activeTargets}
                viewMode={graphViewMode}
              />
            </section>
            <TargetSelector
              targets={allTargets}
              activeTargetIds={activeTargetIds}
              onToggleTarget={toggleTarget}
              onAddTarget={addTarget}
              onRemoveTarget={removeTarget}
              setStatus={setStatus}
            />
            <Preamp
              value={peq.global_gain}
              onStartChange={handleStartChange}
              onChange={(global_gain) => {
                setDirty(true);
                setPeq((previous) => ({ ...previous, global_gain }));
              }}
            />
            <Bands peq={peq} onFilterChange={updateFilter} onStartChange={handleStartChange} />
          </section>
          <ToolsPanel
            peq={peq}
            onImportPEQ={importPeq}
            profiles={profiles}
            selectedPreset={selectedPreset}
            profileSearch={profileSearch}
            setProfileSearch={setProfileSearch}
            newProfileName={newProfileName}
            setNewProfileName={setNewProfileName}
            onSelectProfile={applyProfile}
            onReloadProfiles={loadProfiles}
            onOpenProfilesDir={openProfilesDir}
            onReset={reset}
            onSave={saveProfile}
            onDelete={deleteSelectedProfile}
            setStatus={setStatus}
            measurements={measurements}
            allTargets={allTargets}
            onAddMeasurement={addMeasurement}
            onRemoveMeasurement={removeMeasurement}
            onToggleMeasurement={toggleMeasurement}
            onClearMeasurements={clearMeasurements}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            onUndo={undo}
            onRedo={redo}
            graphViewMode={graphViewMode}
            onGraphViewModeChange={setGraphViewMode}
          />
        </main>
      )}
    </div>
  );
}


function StatusBanner({ status, onClose }: { status: string; onClose: () => void }) {
  return (
    <div className="status-banner">
      <Icon>info</Icon>{status}<button onClick={onClose}><Icon>close</Icon></button>
    </div>
  );
}

export default App;
