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
  Plus,
  Trash2,
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



export const LocalLlamaSettings: React.FC = () => {
  const {
    settings,
    refreshSettings,
    updateSetting,
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
      const running = await invoke<boolean>("get_local_llama_server_status");
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
  
  // Sync local port state with settings when they load
  useEffect(() => {
    if (settings && (settings as any).local_llama_port) {
      setPort((settings as any).local_llama_port);
    }
  }, [settings]);

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

  const handleAddModelLink = () => {
    if (!modelUrl) return;
    const label = modelUrl.split("/").pop() || modelUrl;
    const currentLinks = settings?.model_download_links || [];
    if (currentLinks.some((l: any) => l.value === modelUrl)) return;

    const newLinks = [...currentLinks, { label, value: modelUrl }];
    updateSetting("model_download_links", newLinks);
  };

  const handleRemoveModelLink = (value: string) => {
    const currentLinks = settings?.model_download_links || [];
    const newLinks = currentLinks.filter((l: any) => l.value !== value);
    updateSetting("model_download_links", newLinks);
  };

  const modelDownloadOptions = useMemo(() => {
    return (settings?.model_download_links || []).map((l: any) => ({
      label: l.label,
      value: l.value,
    }));
  }, [settings?.model_download_links]);

  return (
    <div className="space-y-4">
      <SettingContainer
        title="Llama Server Manager"
        description="Download and manage the Local Llama server."
        layout="stacked"
      >
        <div className="space-y-3">
          {/* Step 1: Release Selection */}
          <div className="space-y-2 p-3 bg-mid-gray/5 rounded-lg border border-mid-gray/10">
            <div className="flex justify-between items-center mb-1">
              <label className="text-[10px] font-bold text-mid-gray uppercase tracking-widest pl-1">
                Step 1: Select Release
              </label>
            </div>
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
              {isInstalled && (
                <div className="h-9 px-3 flex items-center justify-center bg-green-500/10 text-green-600 text-[10px] font-black border border-green-500/20 rounded-lg whitespace-nowrap shadow-sm">
                  V{installedVersion}
                </div>
              )}
              <Button
                variant="secondary"
                onClick={async () => {
                  await fetchReleases();
                  await checkInstalledVersion();
                }}
                className="w-10 h-9 p-0 flex items-center justify-center shrink-0"
                title="Refresh Releases & Status"
              >
                <RefreshCcw className="w-6 h-6 text-mid-gray" />
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  openUrl("https://github.com/ggml-org/llama.cpp/releases")
                }
                className="w-10 h-9 p-0 flex items-center justify-center shrink-0"
                title="View on GitHub"
              >
                <ExternalLink className="w-6 h-6 text-mid-gray" />
              </Button>
            </div>
          </div>

          {/* Step 2: Architecture selection and Installation */}
          <div className="space-y-2 p-3 bg-mid-gray/5 rounded-lg border border-mid-gray/10">
            <label className="text-[10px] font-bold text-mid-gray uppercase tracking-widest pl-1 mb-1 block">
              Step 2: Architecture & Setup
            </label>
            <div className="space-y-2">
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
                      : "Choose Architecture"
                  }
                  className="flex-1"
                  disabled={windowsAssets.length === 0}
                />
                <Button
                  variant="primary"
                  onClick={handleDownload}
                  disabled={isDownloading || !selectedAssetUrl}
                  className="px-4 h-9 flex items-center justify-center text-xs font-bold shadow-sm shrink-0"
                >
                  <Download className="w-5 h-5 mr-1.5" />
                  {isInstalled ? "Re-Install" : "Setup Server"}
                </Button>
              </div>

              {(isDownloading || downloadStatus) && (
                <div className="space-y-1.5 pt-1">
                  <div className="h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-logo-primary transition-all duration-300"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] font-bold text-mid-gray uppercase">
                    <span>{downloadStatus} {downloadProgress > 0 && downloadProgress < 100 ? `(${downloadProgress.toFixed(1)}%)` : ""}</span>
                    {downloadSpeed && <span>{downloadSpeed}</span>}
                  </div>
                </div>
              )}

              <div className="flex justify-end px-1">
                <button
                  onClick={handleOpenServerFolder}
                  className="flex items-center gap-1.5 text-[10px] font-medium text-mid-gray/50 hover:text-logo-primary transition-colors"
                >
                  <FolderOpen className="w-4 h-4" />
                  Manage Server Files
                </button>
              </div>
            </div>
          </div>
        </div>
      </SettingContainer>

      <SettingContainer
        title="Model Download"
        description="Get models from Hugging Face."
        layout="stacked"
        descriptionMode="tooltip"
      >
        <div className="space-y-2 pt-1">
          <div className="flex gap-2">
            <ComboBox
              value={modelUrl}
              onChange={setModelUrl}
              options={modelDownloadOptions}
              placeholder="Model URL or Select"
              className="flex-1 font-medium"
              disabled={isModelDownloading}
              variant="compact"
            />
            <Button
              variant="secondary"
              onClick={handleAddModelLink}
              disabled={!modelUrl || isModelDownloading}
              className="w-10 h-9 p-0 flex items-center justify-center shrink-0"
              title="Add to list"
            >
              <Plus className="w-6 h-6" />
            </Button>
            {modelDownloadOptions.some((o: any) => o.value === modelUrl) && (
              <Button
                variant="secondary"
                onClick={() => handleRemoveModelLink(modelUrl)}
                disabled={isModelDownloading}
                className="w-10 h-9 p-0 flex items-center justify-center shrink-0 text-red-500 hover:text-red-700"
                title="Remove from list"
              >
                <Trash2 className="w-6 h-6" />
              </Button>
            )}
            <Button
              variant="primary"
              onClick={handleDownloadModel}
              disabled={isModelDownloading || !modelUrl}
              className="px-4 h-9 flex items-center justify-center shrink-0 text-xs font-bold shadow-sm"
            >
              {isModelDownloading ? "Starting..." : "Download"}
            </Button>
          </div>

          {isModelDownloading && (
            <div className="space-y-1.5">
              <div className="h-1.5 bg-mid-gray/20 rounded-full overflow-hidden">
                <div className="h-full bg-logo-primary" style={{ width: `${downloadProgress}%` }} />
              </div>
              <div className="flex justify-between text-[10px] font-bold text-mid-gray uppercase">
                <span>{downloadProgress.toFixed(1)}%</span>
                {downloadSpeed && <span>{downloadSpeed}</span>}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center text-[10px] font-medium text-mid-gray/50 px-1">
            <p>Files in: <code>models/llama</code></p>
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-1.5 hover:text-logo-primary transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Manage Models
            </button>
          </div>
        </div>
      </SettingContainer>

      <div className="space-y-3">
        <SettingContainer
          title="Server Configuration"
          description="Select model and port."
          layout="stacked"
          descriptionMode="tooltip"
        >
          <div className="flex gap-2 items-end">
            <div className="flex-[2] space-y-1">
              <label className="text-[10px] font-bold text-mid-gray uppercase tracking-widest pl-1">
                Local Model
              </label>
              <Dropdown
                options={localModels.map((m) => ({
                  value: m.path,
                  label: `${m.name} (${(m.size / 1024 / 1024).toFixed(0)} MB)`,
                }))}
                selectedValue={selectedModelPath}
                onSelect={async (newPath) => {
                  if (newPath === selectedModelPath) return;
                  if (serverStatus) {
                    try {
                      setActionStatus("restarting");
                      setSelectedModelPath(newPath);
                      await invoke("stop_local_llama");
                      await new Promise((r) => setTimeout(r, 500));
                      await invoke("start_local_llama", { modelPath: newPath, port: port });
                      await refreshSettings();
                      setServerStatus(true);
                    } catch (e) {
                      console.error("Failed to auto-restart:", e);
                      setServerStatus(false);
                    } finally {
                      setActionStatus("idle");
                    }
                  } else {
                    setSelectedModelPath(newPath);
                  }
                }}
                placeholder="Select"
                className="w-full"
                disabled={isBusy}
              />
            </div>

            <Button
              onClick={fetchLocalModels}
              variant="secondary"
              className="w-10 h-9 p-0 flex items-center justify-center shrink-0 mb-[2px]"
              title="Refresh List"
            >
              <RefreshCcw className="w-6 h-6 text-mid-gray" />
            </Button>

            <div className="w-24 space-y-1">
              <label className="text-[10px] font-bold text-mid-gray uppercase tracking-widest pl-1">
                Port
              </label>
              <Input
                type="number"
                value={port}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = Number(e.target.value);
                  setPort(val);
                  updateSetting("local_llama_port" as any, val);
                }}
                className="h-9 w-full font-bold text-center"
                variant="compact"
                disabled={serverStatus || isBusy}
              />
            </div>

            <div className="space-y-1 flex flex-col justify-end h-full pb-1">
              <label className="flex items-center gap-2 cursor-pointer group" title="Automatically start server on app launch">
                <div className="relative flex items-center">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={(settings as any)?.local_llama_auto_start ?? false}
                    onChange={(e) => updateSetting("local_llama_auto_start" as any, e.target.checked)}
                    disabled={isBusy}
                  />
                  <div className="w-9 h-5 bg-mid-gray/20 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-logo-primary/50 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-logo-primary peer-disabled:opacity-50"></div>
                </div>
                <span className="text-[10px] font-bold text-mid-gray uppercase tracking-widest group-hover:text-mid-gray/80 transition-colors">
                  Auto-Start
                </span>
              </label>
            </div>
          </div>
        </SettingContainer>

        <div className="flex gap-2 items-stretch h-12">
          <Button
            variant={serverStatus ? "secondary" : "primary"}
            onClick={serverStatus ? handleStopServer : handleStartServer}
            disabled={isBusy || (!serverStatus && (!isInstalled || !selectedModelPath))}
            className="flex-1 h-full text-xs font-bold flex items-center justify-center shadow-sm"
          >
            {actionStatus === "restarting" ? (
              <><RefreshCcw className="w-5 h-5 mr-2 animate-spin" />Restarting</>
            ) : actionStatus === "starting" ? (
              <><Play className="w-5 h-5 mr-2 fill-current" />Starting</>
            ) : actionStatus === "stopping" ? (
              <><Square className="w-5 h-5 mr-2 fill-current" />Stopping</>
            ) : serverStatus ? (
              <><Square className="w-5 h-5 mr-2 fill-current" />Stop Server</>
            ) : (
              <><Play className="w-5 h-5 mr-2 fill-current" />Start Server</>
            )}
          </Button>

          <div
            className={`px-4 flex items-center justify-center border rounded-lg text-center transition-all duration-300 min-w-[120px] ${
              isBusy
                ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-600"
                : serverStatus
                  ? "bg-green-500/10 border-green-500/20 text-green-600"
                  : "bg-mid-gray/5 border-mid-gray/10 text-mid-gray"
            }`}
          >
            <div className="flex flex-col items-center">
              <span className="text-[9px] font-bold uppercase tracking-thicker opacity-60 leading-none mb-0.5">Status</span>
              <span className="text-[11px] font-black uppercase tracking-wider leading-none">
                {serverStatus ? `Live: ${port}` : "Offline"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
