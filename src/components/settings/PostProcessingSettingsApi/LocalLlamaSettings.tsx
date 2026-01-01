import React, { useEffect, useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "../../ui/Button";
import { Dropdown } from "../../ui/Dropdown";
import { Input } from "../../ui/Input";
import { ComboBox } from "../../ui/ComboBox";
import {
  RefreshCcw,
  Download,
  Play,
  Square,
  FolderOpen,
  ExternalLink,
} from "lucide-react";
import { useSettings } from "../../../hooks/useSettings";
import { listen } from "@tauri-apps/api/event";

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
  published_at: string;
}

interface LocalModel {
  name: string;
  path: string;
  size: number;
}

const SUGGESTED_MODELS = [
  {
    label: "Llama 3.2 3B Instruct 2.02 GB ",
    value:
      "https://huggingface.co/unsloth/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
  },
  {
    label: "Qwen3 4B Instruct 2.5 GB",
    value:
      "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
  },
  {
    label: "Ministral 3 3B Instruct 2.15 GB",
    value:
      "https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF/resolve/main/Ministral-3-3B-Instruct-2512-Q4_K_M.gguf",
  },
];

export const LocalLlamaSettings: React.FC = () => {
  const {
    settings,
    refreshSettings,
    localLlamaServerStatus,
    setLocalLlamaServerStatus,
  } = useSettings();
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [selectedReleaseTag, setSelectedReleaseTag] = useState<string>("");
  const [selectedAssetUrl, setSelectedAssetUrl] = useState<string>("");
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState<string>("");
  const [downloadStatus, setDownloadStatus] = useState<string>("");

  const [modelUrl, setModelUrl] = useState("");
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [selectedModelPath, setSelectedModelPath] = useState<string>("");

  // Use global status from store instead of local state to prevent flicker
  const serverStatus = localLlamaServerStatus;
  const setServerStatus = setLocalLlamaServerStatus;

  const [actionStatus, setActionStatus] = useState<
    "idle" | "starting" | "stopping" | "restarting"
  >("idle");

  const fetchReleases = useCallback(async () => {
    try {
      const data = await invoke<GitHubRelease[]>("get_local_llama_releases");
      setReleases(data);
      if (data.length > 0 && !selectedReleaseTag) {
        setSelectedReleaseTag(data[0].tag_name);
      }
    } catch (e) {
      console.error("Failed to fetch releases", e);
    }
  }, [selectedReleaseTag]);

  const checkInstalledVersion = useCallback(async () => {
    try {
      const ver = await invoke<string | null>(
        "get_local_llama_installed_version",
      );
      setInstalledVersion(ver);
    } catch (e) {
      console.error("Failed to check installed version", e);
    }
  }, []);

  // Fetch models only (no selection logic inside)
  const fetchLocalModels = useCallback(async () => {
    try {
      const data = await invoke<LocalModel[]>("get_downloaded_local_models");
      setLocalModels(data);
    } catch (e) {
      console.error("Failed to fetch local models", e);
    }
  }, []);

  // Sync selection with global settings once models and settings are available
  useEffect(() => {
    if (localModels.length === 0) return;

    // specific check to avoid overriding user interaction if they haven't saved yet?
    // Actually, on mount selectedModelPath is "", so we want to fill it.
    // If user changes it, selectedModelPath becomes set.
    // But we only want to run this "auto-select" if selectedModelPath is empty (initial load).
    if (selectedModelPath) return;

    const savedModelName = settings?.post_process_models?.["local_llama"];
    if (savedModelName) {
      const found = localModels.find((m) => m.name === savedModelName);
      if (found) {
        setSelectedModelPath(found.path);
        return;
      }
    }

    // Fallback if no saved setting or saved model not found
    if (localModels.length > 0) {
      setSelectedModelPath(localModels[0].path);
    }
  }, [localModels, settings?.post_process_models, selectedModelPath]);

  const checkServerStatus = useCallback(async () => {
    try {
      const running = await invoke<boolean>("get_local_llama_status");
      setServerStatus(running);
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchReleases();
    checkInstalledVersion();
    fetchLocalModels();
    checkServerStatus();

    const interval = setInterval(checkServerStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  // Filter assets when release changes
  const windowsAssets = useMemo(() => {
    if (!selectedReleaseTag) return [];
    const release = releases.find((r) => r.tag_name === selectedReleaseTag);
    if (!release) return [];

    // Filter assets suitable for the current platform
    // Backend now pre-filters for [tag]-bin-[os], so we should just display valid archives.
    return release.assets.filter(
      (a) =>
        a.name.endsWith(".zip") ||
        a.name.endsWith(".tar.gz") ||
        a.name.endsWith(".tgz") ||
        a.name.endsWith(".gz"),
    );
  }, [releases, selectedReleaseTag]);

  // Set default asset when list changes
  // Set default asset when list changes
  useEffect(() => {
    if (windowsAssets.length > 0) {
      if (!selectedAssetUrl) {
        // Initial selection logic (prefer cuda-12)
        const cuda12 = windowsAssets.find((a) => a.name.includes("cuda-12"));
        if (cuda12) setSelectedAssetUrl(cuda12.browser_download_url);
        else setSelectedAssetUrl(windowsAssets[0].browser_download_url);
      } else {
        // Check if current selection is still valid
        const exists = windowsAssets.some(
          (a) => a.browser_download_url === selectedAssetUrl,
        );
        if (!exists) {
          // If invalid (e.g. changed release), select first
          setSelectedAssetUrl(windowsAssets[0].browser_download_url);
        }
      }
    } else if (windowsAssets.length === 0) {
      setSelectedAssetUrl("");
    }
  }, [windowsAssets, selectedAssetUrl]);

  const handleDownload = async () => {
    if (!selectedReleaseTag || !selectedAssetUrl) return;

    setIsDownloading(true);
    setDownloadStatus("Downloading...");
    setDownloadProgress(0);
    setDownloadSpeed("");

    try {
      await invoke("download_local_llama", {
        url: selectedAssetUrl,
        version: selectedReleaseTag,
      });

      setDownloadProgress(100);
      setDownloadSpeed("");
      setDownloadStatus("Extracted successfully.");
      checkInstalledVersion();
    } catch (e) {
      setDownloadStatus(`Error: ${e}`);
    } finally {
      setIsDownloading(false);
      setTimeout(() => setDownloadStatus(""), 5000);
    }
  };

  const [port, setPort] = useState(8080);

  const handleStartServer = async () => {
    if (!selectedModelPath) return;
    setActionStatus("starting");
    try {
      await invoke("start_local_llama", {
        modelPath: selectedModelPath,
        port: port,
      });
      // Refresh settings so the frontend knows about the new active provider/model
      await refreshSettings();
      setServerStatus(true);
    } catch (e) {
      console.error(e);
      alert(`Failed to start server: ${e}`);
    } finally {
      setActionStatus("idle");
    }
  };

  const handleStopServer = async () => {
    setActionStatus("stopping");
    try {
      await invoke("stop_local_llama");
      setServerStatus(false);
    } catch (e) {
      console.error(e);
    } finally {
      setActionStatus("idle");
    }
  };

  const isUpgradable =
    installedVersion &&
    selectedReleaseTag &&
    installedVersion !== selectedReleaseTag;
  const isInstalled = !!installedVersion;

  // Also check if they might be re-downloading different variant (e.g. switching CPU to CUDA)
  // We don't track installed *variant*, only version.
  // Allow re-download if installed.

  const isBusy = actionStatus !== "idle";

  const [isModelDownloading, setIsModelDownloading] = useState(false);
  const [modelDownloadStatus, setModelDownloadStatus] = useState("");

  useEffect(() => {
    const unlistenModel = listen("download_model_progress", (event: any) => {
      // payload: [downloaded, total, speed]
      const [downloaded, total, speed] = event.payload;
      if (total > 0) {
        setDownloadProgress((downloaded / total) * 100);
      }
      if (speed) {
        const speedInMB = speed / 1024 / 1024;
        setDownloadSpeed(`${speedInMB.toFixed(1)} MB/s`);
      }
    });

    const unlistenServer = listen("download_server_progress", (event: any) => {
      // payload: [downloaded, total, speed]
      const [downloaded, total, speed] = event.payload;
      if (total > 0) {
        setDownloadProgress((downloaded / total) * 100);
      }
      if (speed) {
        const speedInMB = speed / 1024 / 1024;
        setDownloadSpeed(`${speedInMB.toFixed(1)} MB/s`);
      }
    });

    return () => {
      unlistenModel.then((f) => f());
      unlistenServer.then((f) => f());
    };
  }, []);

  const handleOpenFolder = async () => {
    try {
      await invoke("open_local_models_folder");
    } catch (e) {
      console.error(e);
    }
  };

  const handleOpenServerFolder = async () => {
    try {
      await invoke("open_llama_server_folder");
    } catch (e) {
      console.error(e);
    }
  };

  const handleDownloadModel = async () => {
    if (!modelUrl) return;

    // Extract filename from URL (e.g., "model.gguf")
    const filename = modelUrl.split("/").pop();
    if (filename) {
      const existingModel = localModels.find((m) => m.name === filename);
      if (existingModel) {
        const confirmed = await confirm(
          `The model "${filename}" already exists. Do you want to download it again?`,
        );
        if (!confirmed) return;
      }
    }

    setIsModelDownloading(true);
    setDownloadProgress(0);
    setDownloadSpeed("");
    setModelDownloadStatus("Downloading model...");
    try {
      await invoke("download_local_model", { url: modelUrl });
      setModelDownloadStatus("Download complete!");
      fetchLocalModels();
      setModelUrl("");
    } catch (e) {
      console.error(e);
      setModelDownloadStatus(`Error: ${e}`);
    } finally {
      setIsModelDownloading(false);
      setDownloadProgress(0);
      setTimeout(() => setModelDownloadStatus(""), 5000);
    }
  };

  return (
    <div className="space-y-6">
      <SettingContainer
        title="Llama Server Manager"
        description="Download and manage the Local Llama server."
        layout="stacked"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_2fr] gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase">
                Release
              </label>
              <div className="flex gap-2 items-center">
                <Dropdown
                  options={releases.map((r) => ({
                    value: r.tag_name,
                    label: r.tag_name,
                  }))}
                  selectedValue={selectedReleaseTag}
                  onSelect={setSelectedReleaseTag}
                  placeholder="Select Release"
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  onClick={fetchReleases}
                  className="w-10 h-10 p-0 flex items-center justify-center shrink-0"
                >
                  <RefreshCcw className="w-4 h-4" />
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    openUrl("https://github.com/ggml-org/llama.cpp/releases")
                  }
                  className="w-10 h-10 p-0 flex items-center justify-center shrink-0"
                  title="View All Releases"
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-500 uppercase">
                Version (Asset)
              </label>
              <div className="flex gap-2 items-center">
                <Dropdown
                  options={windowsAssets.map((a) => ({
                    value: a.browser_download_url,
                    label: a.name,
                  }))}
                  selectedValue={selectedAssetUrl}
                  onSelect={setSelectedAssetUrl}
                  placeholder={
                    windowsAssets.length === 0
                      ? "No assets found"
                      : "Select Version"
                  }
                  className="flex-1"
                  disabled={windowsAssets.length === 0}
                />
                <Button
                  variant="primary"
                  onClick={handleDownload}
                  disabled={isDownloading || !selectedAssetUrl}
                  className="h-10 px-4 flex items-center justify-center whitespace-nowrap shrink-0"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {isInstalled ? "Re-Install" : "Download"}
                </Button>
              </div>
            </div>
          </div>

          {(isDownloading || downloadStatus) && (
            <div className="space-y-1">
              <div className="h-2 bg-gray-200 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 flex justify-start gap-2">
                <span>{downloadStatus}</span>
                {downloadSpeed && <span>- {downloadSpeed}</span>}
              </p>
            </div>
          )}

          <div className="flex justify-between items-center text-xs text-gray-400">
            <div className="flex gap-4 items-center">
              {isInstalled && (
                <span className="text-green-600">
                  Installed Version: {installedVersion}
                </span>
              )}
            </div>
            <button
              onClick={handleOpenServerFolder}
              className="flex items-center gap-1 hover:text-gray-600 transition-colors"
              title="Open Server Folder"
            >
              <FolderOpen className="w-3 h-3" />
              Open Folder
            </button>
          </div>
        </div>
      </SettingContainer>

      <SettingContainer
        title="Model Download"
        description="Download .gguf models directly from Hugging Face."
        layout="stacked"
        descriptionMode="tooltip"
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex gap-2">
              <ComboBox
                value={modelUrl}
                onChange={setModelUrl}
                options={SUGGESTED_MODELS}
                placeholder="https://huggingface.co/.../model.gguf or Select Model"
                className="flex-1"
                disabled={isModelDownloading}
              />
              <Button
                variant="primary"
                onClick={handleDownloadModel}
                disabled={isModelDownloading || !modelUrl}
              >
                {isModelDownloading ? "Downloading..." : "Download"}
              </Button>
            </div>

            {/* Progress Bar */}
            {isModelDownloading && (
              <div className="space-y-1">
                <div className="h-2 bg-gray-200 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
                <p className="text-xs text-center text-gray-500">
                  {downloadProgress.toFixed(1)}%{" "}
                  {downloadSpeed && `- ${downloadSpeed}`}
                </p>
              </div>
            )}

            {modelDownloadStatus && (
              <p
                className={`text-xs ${modelDownloadStatus.includes("Error") ? "text-red-500" : "text-green-500"}`}
              >
                {modelDownloadStatus}
              </p>
            )}

            <div className="flex justify-between items-center text-xs text-gray-400">
              <p>
                Place .gguf files in the <code>models/llama</code> folder.
              </p>
              <button
                onClick={handleOpenFolder}
                className="flex items-center gap-1 hover:text-gray-600 transition-colors"
                title="Open Models Folder"
              >
                <FolderOpen className="w-3 h-3" />
                Open Folder
              </button>
            </div>
          </div>
        </div>
      </SettingContainer>

      <SettingContainer
        title="Server Configuration"
        description="Select the local model to load and the port to run the server on."
        layout="stacked"
        descriptionMode="tooltip"
      >
        <div className="grid grid-cols-[1fr_120px] gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Local Model</label>
            <div className="flex gap-2 items-center">
              <Dropdown
                options={localModels.map((m) => ({
                  value: m.path,
                  label: `${m.name} (${(m.size / 1024 / 1024).toFixed(1)} MB)`,
                }))}
                selectedValue={selectedModelPath}
                onSelect={async (newPath) => {
                  if (newPath === selectedModelPath) return;

                  if (serverStatus) {
                    // Auto-restart flow
                    try {
                      setActionStatus("restarting");
                      // 1. Update state immediately so UI reflects target
                      setSelectedModelPath(newPath);

                      // 2. Stop valid server
                      // Note: we kept serverStatus=true initially to show "Restarting..." (isLoading=true + serverStatus=true)
                      await invoke("stop_local_llama");

                      // 3. Start new server
                      // Small delay to ensure port release if needed
                      await new Promise((r) => setTimeout(r, 500));
                      await invoke("start_local_llama", {
                        modelPath: newPath,
                        port: port,
                      });

                      // Refresh settings so the frontend knows about the new active provider/model
                      await refreshSettings();

                      // Ensure status is true at end
                      setServerStatus(true);
                    } catch (e) {
                      console.error("Failed to auto-restart:", e);
                      setServerStatus(false);
                    } finally {
                      setActionStatus("idle");
                    }
                  } else {
                    // Simple switch
                    setSelectedModelPath(newPath);
                  }
                }}
                placeholder="Select a Model"
                className="flex-1"
                disabled={isBusy}
              />
              <Button
                onClick={fetchLocalModels}
                variant="secondary"
                className="w-10 h-10 p-0 flex items-center justify-center shrink-0"
              >
                <RefreshCcw className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Port</label>
            <Input
              type="number"
              value={port}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setPort(Number(e.target.value))
              }
              className="w-full"
              disabled={serverStatus || isBusy}
            />
          </div>
        </div>
      </SettingContainer>

      <div className="grid grid-cols-2 gap-4">
        <Button
          variant={serverStatus ? "secondary" : "primary"}
          onClick={serverStatus ? handleStopServer : handleStartServer}
          disabled={isBusy || (!serverStatus && !selectedModelPath)}
          className="h-12 text-lg flex items-center justify-center"
        >
          {actionStatus === "restarting" ? (
            <>
              <RefreshCcw className="w-5 h-5 mr-2 animate-spin" />
              Restarting Server...
            </>
          ) : actionStatus === "starting" ? (
            <>
              <Play className="w-5 h-5 mr-2 fill-current" />
              Starting...
            </>
          ) : actionStatus === "stopping" ? (
            <>
              <Square className="w-5 h-5 mr-2 fill-current" />
              Stopping...
            </>
          ) : serverStatus ? (
            <>
              <Square className="w-5 h-5 mr-2 fill-current" />
              Stop Server
            </>
          ) : (
            <>
              <Play className="w-5 h-5 mr-2 fill-current" />
              Start Server
            </>
          )}
        </Button>

        <div
          className={`h-12 flex items-center justify-center px-3 border rounded text-center ${
            isBusy
              ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-600"
              : serverStatus
                ? "bg-green-500/10 border-green-500/20 text-green-600"
                : "bg-gray-500/10 border-gray-500/20 text-gray-500"
          }`}
        >
          <span className="text-sm font-medium">
            {actionStatus === "restarting"
              ? "Server is restarting..."
              : actionStatus === "starting"
                ? "Server is starting..."
                : actionStatus === "stopping"
                  ? "Server is stopping..."
                  : serverStatus
                    ? `Server is running on port ${port}`
                    : "Server is stopped"}
          </span>
        </div>
      </div>
    </div>
  );
};
