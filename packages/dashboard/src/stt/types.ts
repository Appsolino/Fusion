export type VoiceModelStatus = "not-installed" | "queued" | "downloading" | "installed" | "error";
export type VoiceModelErrorReason = "checksum-unpinned" | "checksum-mismatch" | "network" | "extraction-failed" | "unsafe-archive" | "incomplete-install" | "cancelled";
export interface VoiceModelState { status: VoiceModelStatus; progress?: number; bytesDownloaded?: number; totalBytes?: number; errorReason?: VoiceModelErrorReason; errorMessage?: string; checksumVerified?: boolean; installedPath?: string; }
export type VoiceRuntimeStatus = "available" | "unavailable";
export type VoiceModelId = "parakeet-v3";
export const DEFAULT_VOICE_MODEL_ID: VoiceModelId = "parakeet-v3";
export const SUPPORTED_VOICE_LANGUAGES = ["en"] as const;
export const DEFAULT_VOICE_LANGUAGE = "en";
export interface VoiceModelAsset { url: string; filename: string; sha256: string | null; expectedFiles: string[]; }
/** The upstream release page has no published digest for a concrete v3 archive yet. */
export const PARAKEET_V3_ASSET: VoiceModelAsset = { url: "https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models", filename: "upstream-pending-verification", sha256: null, expectedFiles: [] };
export const VOICE_MODEL_REGISTRY: Record<VoiceModelId, VoiceModelAsset> = { "parakeet-v3": PARAKEET_V3_ASSET };
export function resolveVoiceModelId(raw?: string): { id: VoiceModelId } | { unsupported: string } { return raw === undefined || raw === DEFAULT_VOICE_MODEL_ID ? { id: DEFAULT_VOICE_MODEL_ID } : { unsupported: raw }; }
export function resolveVoiceLanguage(raw?: string): { language: string } | { unsupported: string } { return raw === undefined || raw === DEFAULT_VOICE_LANGUAGE ? { language: DEFAULT_VOICE_LANGUAGE } : { unsupported: raw }; }
