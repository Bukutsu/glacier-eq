import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bands } from "./components/Bands";
import { DeviceChooser } from "./components/DeviceChooser";
import { EqGraph } from "./components/EqGraph";
import { Header } from "./components/Header";
import { Icon } from "./components/Icon";
import { Preamp } from "./components/Preamp";
import { ToolsPanel } from "./components/ToolsPanel";
import { DEFAULT_PROFILE_NAME } from "./constants";
import { makeMeasurementName, nextMeasurementColor, normalizeMeasurementPoints } from "./lib/measurements";
import { buildDefaultState, normalizePeq } from "./lib/peq";
import type { DeviceInfo, Filter, MeasurementTrace, PEQData, Profile } from "./types";
import "./App.css";

function App() {
  const [peq, setPeq] = useState<PEQData>(buildDefaultState);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [connected, setConnected] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PROFILE_NAME);
  const [profileSearch, setProfileSearch] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [measurements, setMeasurements] = useState<MeasurementTrace[]>([]);
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
      const list = await invoke<DeviceInfo[]>("list_devices");
      setDevices(list);
      if (list[0]) setSelectedDevice(list[0].path);
      setStatus(list.length ? `Found ${list.length} device(s)` : "No compatible DACs found");
    } catch (error) {
      setStatus(`Scan failed: ${error}`);
    } finally {
      setIsBusy(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    scanDevices();
  }, [scanDevices]);

  const pullEq = useCallback(async () => {
    pushToUndoStack(peqRef.current);
    setIsBusy(true);
    try {
      const data = await invoke<PEQData>("get_eq_state");
      setPeq(normalizePeq(data));
      selectedPresetRef.current = "Pulled from device";
      setSelectedPreset("Pulled from device");
      setDirty(false);
      setStatus("Pull successful");
    } catch (error) {
      setStatus(`Pull failed: ${error}`);
    } finally {
      setIsBusy(false);
    }
  }, [pushToUndoStack]);

  const connectDevice = useCallback(async () => {
    if (!selectedDevice) return;
    setIsBusy(true);
    try {
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
    setIsBusy(true);
    try {
      await invoke("set_eq_state", { peq });
      setDirty(false);
      setStatus("Push successful");
    } catch (error) {
      setStatus(`Push failed: ${error}`);
    } finally {
      setIsBusy(false);
    }
  }, [peq]);

  const disconnectDevice = useCallback(async () => {
    setIsBusy(true);
    try {
      await invoke("disconnect_device");
      setConnected(false);
      setStatus("Disconnected");
    } catch (error) {
      setStatus(`Disconnect failed: ${error}`);
    } finally {
      setIsBusy(false);
    }
  }, []);

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
        profile={selectedPreset}
        deviceName={deviceName}
        dirty={dirty}
        onPull={pullEq}
        onPush={pushEq}
        onDisconnect={disconnectDevice}
      />
      {connected && status !== "Ready" && <StatusBanner status={status} onClose={() => setStatus("Ready")} />}
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
      ) : (
        <main className="workspace">
          <section className="left-pane">
            <section className="graph-card"><EqGraph peq={peq} measurements={measurements} /></section>
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
            onAddMeasurement={addMeasurement}
            onRemoveMeasurement={removeMeasurement}
            onToggleMeasurement={toggleMeasurement}
            onClearMeasurements={clearMeasurements}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            onUndo={undo}
            onRedo={redo}
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
