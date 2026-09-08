// [PERF-PROBE] Opt-in Tauri IPC benchmark. Loaded only when
// VITE_TAURI_PERF=1 so normal builds do not run it.
import { invoke } from "./rpc";

type ProbeResult = {
  operation: string;
  input_bytes: number;
  output_bytes: number;
  samples_ms: number[];
  median_ms: number;
  p95_ms: number;
};

type ProbeFailure = {
  operation: string;
  input_bytes: number;
  error: string;
};

const encoder = new TextEncoder();

async function getWorkdir(): Promise<string> {
  const configured = import.meta.env.VITE_TAURI_PERF_DIR;
  if (configured) return configured.replace(/\/+$/, "");
  try {
    const { appDataDir } = await import("@tauri-apps/api/path");
    return (await appDataDir()).replace(/\/+$/, "");
  } catch {
    return "/tmp/glacier-eq-tauri-perf";
  }
}

function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value) ?? "null").byteLength;
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)];
}

function median(values: number[]): number {
  return percentile(values, 50);
}

async function measure<T>(
  operation: string,
  command: string,
  args: Record<string, unknown> | undefined,
  runs: number,
): Promise<ProbeResult | ProbeFailure> {
  const inputBytes = byteLength(args);
  try {
    // Warm the dynamic Tauri import and the command path before timing.
    await invoke<T>(command, args);
    const samples: number[] = [];
    let output: T;
    for (let index = 0; index < runs; index += 1) {
      const start = performance.now();
      output = await invoke<T>(command, args);
      samples.push(performance.now() - start);
    }
    return {
      operation,
      input_bytes: inputBytes,
      output_bytes: byteLength(output!),
      samples_ms: samples.map((sample) => Number(sample.toFixed(3))),
      median_ms: Number(median(samples).toFixed(3)),
      p95_ms: Number(percentile(samples, 95).toFixed(3)),
    };
  } catch (error) {
    return {
      operation,
      input_bytes: inputBytes,
      error: String(error),
    };
  }
}

function makePoints(count: number, offset: number): [number, number][] {
  return Array.from({ length: count }, (_, index) => {
    const ratio = index / Math.max(1, count - 1);
    return [20 * 10 ** (3 * ratio), Math.sin(ratio * 12 + offset) * 4];
  });
}

function makeAutoEqText(targetBytes: number): string {
  let text = "# GraphicEQ:Flat\nPreamp: 0 dB\n";
  const padding = `# ${"x".repeat(298)}\n`;
  while (encoder.encode(text).byteLength + encoder.encode(padding).byteLength <= targetBytes) {
    text += padding;
  }
  return text;
}

function makePeq() {
  return {
    globalGain: 0,
    filters: Array.from({ length: 10 }, (_, index) => ({
      index,
      enabled: true,
      freq: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000][index],
      gain: Math.sin(index) * 3,
      q: 1,
      type: "Peak",
    })),
  };
}

export async function runTauriPerfProbe(): Promise<void> {
  const started = performance.now();
  const workdir = await getWorkdir();
  const outputFile = `${workdir}/ipc-results.json`;
  const payloadFile = `${workdir}/ipc-payload.txt`;
  const results: Array<ProbeResult | ProbeFailure> = [];
  const peq = makePeq();
  const smallAutoEq = makeAutoEqText(10_000);
  const largeAutoEq = makeAutoEqText(1_000_000);
  const payload = "# benchmark payload\n" + "x".repeat(999_900);

  results.push(await measure("get_settings", "get_settings", undefined, 10));
  results.push(await measure("list_supported_devices", "list_supported_devices", undefined, 10));
  results.push(await measure("list_devices", "list_devices", undefined, 5));
  results.push(await measure("list_profiles", "list_profiles", undefined, 10));
  results.push(await measure("peq_to_autoeq", "peq_to_autoeq", { peq }, 10));
  results.push(await measure("parse_autoeq_10kb", "parse_autoeq", { text: smallAutoEq }, 5));
  results.push(await measure("parse_autoeq_1mb", "parse_autoeq", { text: largeAutoEq }, 3));

  for (const count of [100, 1_000, 4_000]) {
    results.push(await measure(
      `run_autoeq_${count}_points`,
      "run_autoeq",
      {
        measurementPoints: makePoints(count, 0),
        targetPoints: makePoints(count, 1),
        nBands: 10,
        steps: 20,
        smoothType: "ie",
        fs: 96000,
      },
      3,
    ));
  }

  results.push(await measure(
    "save_text_file_1mb",
    "save_text_file",
    { path: payloadFile, content: payload },
    3,
  ));
  results.push(await measure(
    "read_text_file_1mb",
    "read_text_file",
    { path: payloadFile },
    3,
  ));

  const report = {
    kind: "tauri-ipc-probe",
    platform: navigator.platform,
    user_agent: navigator.userAgent,
    generated_at: new Date().toISOString(),
    elapsed_ms: Number((performance.now() - started).toFixed(3)),
    results,
  };
  try {
    await invoke("save_text_file", {
      path: outputFile,
      content: JSON.stringify(report, null, 2),
    });
    console.info("[PERF-PROBE] Tauri IPC results written to", outputFile, report);
  } catch (error) {
    // Android logcat is the fallback when a platform-specific app-data path
    // cannot be resolved by the filesystem command.
    console.info("[PERF-PROBE] Tauri IPC results", JSON.stringify(report));
    console.error("[PERF-PROBE] Could not persist results:", error);
  }
}
