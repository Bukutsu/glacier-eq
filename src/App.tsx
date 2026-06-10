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
import { buildDefaultState, normalizePeq } from "./lib/peq";
import type { DeviceInfo, Filter, PEQData, Profile } from "./types";
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
  const [dirty, setDirty] = useState(false);
  const selectedPresetRef = useRef(selectedPreset);

  useEffect(() => {
    selectedPresetRef.current = selectedPreset;
  }, [selectedPreset]);

  const deviceName = useMemo(() => {
    const selected = devices.find((device) => device.path === selectedDevice);
    return selected?.profile_name || selected?.product_string || "EPZ TP35 Pro";
  }, [devices, selectedDevice]);

  const applyProfile = useCallback((profile: Profile) => {
    const data = normalizePeq(profile.data, { enableLoadedFilters: true });
    selectedPresetRef.current = profile.name;
    setPeq(data);
    setSelectedPreset(profile.name);
    setNewProfileName(profile.name);
    setDirty(false);
  }, []);

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

  const connectDevice = useCallback(async () => {
    if (!selectedDevice) return;
    setIsBusy(true);
    try {
      await invoke("connect_device", { path: selectedDevice });
      setConnected(true);
      setStatus("Ready");
    } catch (error) {
      setStatus(`Connection failed: ${error}`);
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice]);

  const pullEq = useCallback(async () => {
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
  }, []);

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
    selectedPresetRef.current = DEFAULT_PROFILE_NAME;
    setPeq(buildDefaultState());
    setSelectedPreset(DEFAULT_PROFILE_NAME);
    setDirty(true);
  };

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
            <section className="graph-card"><EqGraph peq={peq} /></section>
            <Preamp value={peq.global_gain} onChange={(global_gain) => {
              setDirty(true);
              setPeq((previous) => ({ ...previous, global_gain }));
            }} />
            <Bands peq={peq} onFilterChange={updateFilter} />
          </section>
          <ToolsPanel
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
