import { describe, expect, it, vi } from "vitest";
import { createVoiceModelManager } from "../model-manager.js";
import { createParakeetService } from "../parakeet-service.js";
import { resolveVoiceLanguage, resolveVoiceModelId } from "../types.js";

describe("voice STT graceful degradation", () => {
  it("refuses an unpinned archive synchronously without fetching", () => {
    const fetch = vi.fn();
    const manager = createVoiceModelManager({ cacheDir: "/unused", fetch, asset: { url: "https://example.test/model", filename: "model.tar", sha256: null, expectedFiles: [] } });
    expect(manager.scheduleDownload()).toMatchObject({ accepted: false, state: { status: "error", errorReason: "checksum-unpinned" } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps unknown model identifiers and languages out of runtime configuration", () => {
    expect(resolveVoiceModelId(undefined)).toEqual({ id: "parakeet-v3" });
    expect(resolveVoiceModelId("../unsafe")).toEqual({ unsupported: "../unsafe" });
    expect(resolveVoiceLanguage(undefined)).toEqual({ language: "en" });
    expect(resolveVoiceLanguage("fr")).toEqual({ unsupported: "fr" });
  });
  it("reports a missing native binding as unavailable without throwing", async () => {
    const manager = createVoiceModelManager({ cacheDir: "/unused" });
    const service = createParakeetService({ manager, loadBinding: async () => { throw new Error("ERR_MODULE_NOT_FOUND"); } });
    await expect(service.getRuntimeStatus()).resolves.toMatchObject({ status: "unavailable" });
  });

  it("reports a loaded but incompatible native binding as unavailable", async () => {
    const manager = { getState: async () => ({ status: "installed" as const, installedPath: "/model" }) } as ReturnType<typeof createVoiceModelManager>;
    const service = createParakeetService({ manager, loadBinding: async () => ({}) });
    await expect(service.getRuntimeStatus()).resolves.toEqual({ status: "unavailable", unavailableReason: "OfflineRecognizer unavailable" });
  });

  it("uses sherpa's OfflineRecognizer and stream API for incremental decoding", async () => {
    let decoded = false;
    const stream = { acceptWaveform: vi.fn(), free: vi.fn() };
    const recognizer = { createStream: vi.fn(() => stream), decode: vi.fn(() => { decoded = true; }), getResult: vi.fn((received) => ({ text: received === stream && decoded ? "fresh" : "stale" })), close: vi.fn() };
    const OfflineRecognizer = vi.fn(function () { return recognizer; });
    const manager = { getState: async () => ({ status: "installed" as const, installedPath: "/model" }) } as ReturnType<typeof createVoiceModelManager>;
    const service = createParakeetService({ manager, loadBinding: async () => ({ OfflineRecognizer: OfflineRecognizer as never }) });
    const session = await service.createSession({ modelId: "parakeet-v3", language: "en" });
    expect(session.acceptChunk(Buffer.from([0, 0]), { final: false })).toEqual({ partial: "fresh" });
    expect(OfflineRecognizer).toHaveBeenCalledWith(expect.objectContaining({ modelConfig: expect.objectContaining({ transducer: expect.any(Object), tokens: "/model/tokens.txt" }) }));
    expect(stream.acceptWaveform).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 16_000, samples: expect.any(Float32Array) }));
    expect(recognizer.decode).toHaveBeenCalledWith(stream);
    expect(recognizer.getResult).toHaveBeenCalledWith(stream);
    expect(recognizer.decode).toHaveBeenCalledBefore(recognizer.getResult);
    session.close();
    expect(stream.free).toHaveBeenCalledOnce();
  });
});
