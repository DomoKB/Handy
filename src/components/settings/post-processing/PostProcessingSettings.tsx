import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import Playground from "../../playground/Playground";
import { RefreshCcw } from "lucide-react";
import { commands } from "@/bindings";

import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "../../ui/Button";
import { ResetButton } from "../../ui/ResetButton";
import { Input } from "../../ui/Input";
import { Dropdown } from "../../ui/Dropdown";
import { Textarea } from "../../ui/Textarea";

import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { BaseUrlField } from "../PostProcessingSettingsApi/BaseUrlField";
import { ApiKeyField } from "../PostProcessingSettingsApi/ApiKeyField";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import { LocalLlamaSettings } from "../PostProcessingSettingsApi/LocalLlamaSettings";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { useSettings } from "../../../hooks/useSettings";

const DisabledNotice: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <div className="p-4 bg-mid-gray/5 rounded-lg border border-mid-gray/20">
    <p className="text-sm text-mid-gray">{children}</p>
  </div>
);

const PostProcessingSettingsApiComponent: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const state = usePostProcessProviderState();
  const enabled = getSetting("post_process_enabled") || false;



  return (
    <>
      <SettingContainer
        title={t("settings.postProcessing.title" /* Add translation later or use literal for now */)}
        description={t("Automatically refine your transcriptions using an LLM after you stop recording.")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <ToggleSwitch
          checked={enabled}
          onChange={(val) => updateSetting("post_process_enabled", val)}
          isUpdating={isUpdating("post_process_enabled")}
          label=""
          description=""
          descriptionMode="inline"
          grouped={true}
        />
      </SettingContainer>

      <div className={enabled ? "" : "opacity-50 pointer-events-none grayscale"}>
        <SettingContainer
          title={t("settings.postProcessing.api.provider.title")}
        description={t("settings.postProcessing.api.provider.description")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <div className="flex items-center gap-2">
          <ProviderSelect
            options={state.providerOptions}
            value={state.selectedProviderId}
            onChange={state.handleProviderSelect}
          />
        </div>
      </SettingContainer>

      {state.selectedProviderId === "local_llama" ? (
        <LocalLlamaSettings />
      ) : state.isAppleProvider ? (
        <SettingContainer
          title={t("settings.postProcessing.api.appleIntelligence.title")}
          description={t(
            "settings.postProcessing.api.appleIntelligence.description",
          )}
          descriptionMode="tooltip"
          layout="stacked"
          grouped={true}
        >
          <DisabledNotice>
            {t("settings.postProcessing.api.appleIntelligence.requirements")}
          </DisabledNotice>
        </SettingContainer>
      ) : (
        <>
          {state.selectedProviderId === "custom" && (
            <SettingContainer
              title={t("settings.postProcessing.api.baseUrl.title")}
              description={t("settings.postProcessing.api.baseUrl.description")}
              descriptionMode="tooltip"
              layout="horizontal"
              grouped={true}
            >
              <div className="flex items-center gap-2">
                <BaseUrlField
                  value={state.baseUrl}
                  onBlur={state.handleBaseUrlChange}
                  placeholder={t(
                    "settings.postProcessing.api.baseUrl.placeholder",
                  )}
                  disabled={
                    !state.selectedProvider?.allow_base_url_edit ||
                    state.isBaseUrlUpdating
                  }
                  className="min-w-[380px]"
                />
              </div>
            </SettingContainer>
          )}

          <SettingContainer
            title={t("settings.postProcessing.api.apiKey.title")}
            description={t("settings.postProcessing.api.apiKey.description")}
            descriptionMode="tooltip"
            layout="horizontal"
            grouped={true}
          >
            <div className="flex items-center gap-2">
              <ApiKeyField
                value={state.apiKey}
                onBlur={state.handleApiKeyChange}
                placeholder={t(
                  "settings.postProcessing.api.apiKey.placeholder",
                )}
                disabled={state.isApiKeyUpdating}
                className="min-w-[320px]"
              />
            </div>
          </SettingContainer>
        </>
      )}

      {state.selectedProviderId !== "local_llama" && (
        <SettingContainer
          title={t("settings.postProcessing.api.model.title")}
          description={
            state.isAppleProvider
              ? t("settings.postProcessing.api.model.descriptionApple")
              : state.isCustomProvider
                ? t("settings.postProcessing.api.model.descriptionCustom")
                : t("settings.postProcessing.api.model.descriptionDefault")
          }
          descriptionMode="tooltip"
          layout="stacked"
          grouped={true}
        >
          <div className="flex items-center gap-2">
            <ModelSelect
              value={state.model}
              options={state.modelOptions}
              disabled={state.isModelUpdating}
              isLoading={state.isFetchingModels}
              placeholder={
                state.isAppleProvider
                  ? t("settings.postProcessing.api.model.placeholderApple")
                  : state.modelOptions.length > 0
                    ? t(
                        "settings.postProcessing.api.model.placeholderWithOptions",
                      )
                    : t("settings.postProcessing.api.model.placeholderNoOptions")
              }
              onSelect={state.handleModelSelect}
              onCreate={state.handleModelCreate}
              onBlur={() => {}}
              className="flex-1 min-w-[380px]"
            />
            <ResetButton
              onClick={state.handleRefreshModels}
              disabled={state.isFetchingModels || state.isAppleProvider}
              ariaLabel={t("settings.postProcessing.api.model.refreshModels")}
              className="flex h-10 w-10 items-center justify-center"
            >
              <RefreshCcw
                className={`h-4 w-4 ${state.isFetchingModels ? "animate-spin" : ""}`}
              />
            </ResetButton>
          </div>
        </SettingContainer>
      )}
      </div>
    </>
  );
};

const PostProcessingSettingsPromptsComponent: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating, refreshSettings } =
    useSettings();
  const [isCreating, setIsCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");

  const prompts = getSetting("post_process_prompts") || [];
  const selectedPromptId = getSetting("post_process_selected_prompt_id") || "";
  const selectedPrompt =
    prompts.find((prompt) => prompt.id === selectedPromptId) || null;

  useEffect(() => {
    if (isCreating) return;

    if (selectedPrompt) {
      setDraftName(selectedPrompt.name);
      setDraftText(selectedPrompt.prompt);
    } else {
      setDraftName("");
      setDraftText("");
    }
  }, [
    isCreating,
    selectedPromptId,
    selectedPrompt?.name,
    selectedPrompt?.prompt,
  ]);

  const handlePromptSelect = (promptId: string | null) => {
    if (!promptId) return;
    updateSetting("post_process_selected_prompt_id", promptId);
    setIsCreating(false);
  };

  const handleCreatePrompt = async () => {
    if (!draftName.trim() || !draftText.trim()) return;

    try {
      const result = await commands.addPostProcessPrompt(
        draftName.trim(),
        draftText.trim(),
      );
      if (result.status === "ok") {
        await refreshSettings();
        updateSetting("post_process_selected_prompt_id", result.data.id);
        setIsCreating(false);
      }
    } catch (error) {
      console.error("Failed to create prompt:", error);
    }
  };

  const handleUpdatePrompt = async () => {
    if (!selectedPromptId || !draftName.trim() || !draftText.trim()) return;

    try {
      await commands.updatePostProcessPrompt(
        selectedPromptId,
        draftName.trim(),
        draftText.trim(),
      );
      await refreshSettings();
    } catch (error) {
      console.error("Failed to update prompt:", error);
    }
  };

  const handleDeletePrompt = async (promptId: string) => {
    if (!promptId) return;

    try {
      await commands.deletePostProcessPrompt(promptId);
      await refreshSettings();
      setIsCreating(false);
    } catch (error) {
      console.error("Failed to delete prompt:", error);
    }
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    if (selectedPrompt) {
      setDraftName(selectedPrompt.name);
      setDraftText(selectedPrompt.prompt);
    } else {
      setDraftName("");
      setDraftText("");
    }
  };

  const handleStartCreate = () => {
    setIsCreating(true);
    setDraftName("");
    setDraftText("");
  };



  const hasPrompts = prompts.length > 0;
  const isDirty =
    !!selectedPrompt &&
    (draftName.trim() !== selectedPrompt.name ||
      draftText.trim() !== selectedPrompt.prompt.trim());

  return (
    <SettingContainer
      title={t("settings.postProcessing.prompts.selectedPrompt.title")}
      description={t(
        "settings.postProcessing.prompts.selectedPrompt.description",
      )}
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Dropdown
            selectedValue={selectedPromptId || null}
            options={prompts.map((p) => ({
              value: p.id,
              label: p.name,
            }))}
            onSelect={(value) => handlePromptSelect(value)}
            placeholder={
              prompts.length === 0
                ? t("settings.postProcessing.prompts.noPrompts")
                : t("settings.postProcessing.prompts.selectPrompt")
            }
            disabled={
              isUpdating("post_process_selected_prompt_id") || isCreating
            }
            className="flex-1"
          />
          <Button
            onClick={handleStartCreate}
            variant="primary"
            size="md"
            disabled={isCreating}
          >
            {t("settings.postProcessing.prompts.createNew")}
          </Button>
        </div>

        {!isCreating && hasPrompts && selectedPrompt && (
          <div className="space-y-3">
            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-semibold">
                {t("settings.postProcessing.prompts.promptLabel")}
              </label>
              <Input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.prompts.promptLabelPlaceholder",
                )}
                variant="compact"
              />
            </div>

            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-semibold">
                {t("settings.postProcessing.prompts.promptInstructions")}
              </label>
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.prompts.promptInstructionsPlaceholder",
                )}
              />
              <p
                className="text-xs text-mid-gray/70"
                dangerouslySetInnerHTML={{
                  __html: t("settings.postProcessing.prompts.promptTip"),
                }}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleUpdatePrompt}
                variant="primary"
                size="md"
                disabled={!draftName.trim() || !draftText.trim() || !isDirty}
              >
                {t("settings.postProcessing.prompts.updatePrompt")}
              </Button>
              <Button
                onClick={() => handleDeletePrompt(selectedPromptId)}
                variant="secondary"
                size="md"
                disabled={!selectedPromptId || prompts.length <= 1}
              >
                {t("settings.postProcessing.prompts.deletePrompt")}
              </Button>
            </div>
          </div>
        )}

        {!isCreating && !selectedPrompt && (
          <div className="p-3 bg-mid-gray/5 rounded border border-mid-gray/20">
            <p className="text-sm text-mid-gray">
              {hasPrompts
                ? t("settings.postProcessing.prompts.selectToEdit")
                : t("settings.postProcessing.prompts.createFirst")}
            </p>
          </div>
        )}

        {isCreating && (
          <div className="space-y-3">
            <div className="space-y-2 block flex flex-col">
              <label className="text-sm font-semibold text-text">
                {t("settings.postProcessing.prompts.promptLabel")}
              </label>
              <Input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.prompts.promptLabelPlaceholder",
                )}
                variant="compact"
              />
            </div>

            <div className="space-y-2 flex flex-col">
              <label className="text-sm font-semibold">
                {t("settings.postProcessing.prompts.promptInstructions")}
              </label>
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder={t(
                  "settings.postProcessing.prompts.promptInstructionsPlaceholder",
                )}
              />
              <p
                className="text-xs text-mid-gray/70"
                dangerouslySetInnerHTML={{
                  __html: t("settings.postProcessing.prompts.promptTip"),
                }}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleCreatePrompt}
                variant="primary"
                size="md"
                disabled={!draftName.trim() || !draftText.trim()}
              >
                {t("settings.postProcessing.prompts.createPrompt")}
              </Button>
              <Button
                onClick={handleCancelCreate}
                variant="secondary"
                size="md"
              >
                {t("settings.postProcessing.prompts.cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </SettingContainer>
  );
};

export const PostProcessingSettingsApi = React.memo(
  PostProcessingSettingsApiComponent,
);
PostProcessingSettingsApi.displayName = "PostProcessingSettingsApi";

export const PostProcessingSettingsPrompts = React.memo(
  PostProcessingSettingsPromptsComponent,
);
PostProcessingSettingsPrompts.displayName = "PostProcessingSettingsPrompts";

export const PostProcessingSettings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"provider" | "prompts" | "playground">("provider");

  return (
    <div className="max-w-3xl w-full mx-auto space-y-6 h-full flex flex-col">
      <div className="border-b border-mid-gray/20">
        <div className="flex space-x-6">
          <button
            onClick={() => setActiveTab("provider")}
            className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === "provider"
                ? "border-logo-primary text-logo-primary"
                : "border-transparent text-mid-gray hover:text-text hover:border-mid-gray/30"
            }`}
          >
            Providers
          </button>
          <button
            onClick={() => setActiveTab("prompts")}
            className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === "prompts"
                ? "border-logo-primary text-logo-primary"
                : "border-transparent text-mid-gray hover:text-text hover:border-mid-gray/30"
            }`}
          >
            Prompts
          </button>
          <button
            onClick={() => setActiveTab("playground")}
            className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === "playground"
                ? "border-logo-primary text-logo-primary"
                : "border-transparent text-mid-gray hover:text-text hover:border-mid-gray/30"
            }`}
          >
            Playground
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {activeTab === "provider" && (
          <SettingsGroup title="API (OpenAI Compatible)">
            <PostProcessingSettingsApi />
          </SettingsGroup>
        )}
        {activeTab === "prompts" && (
            <SettingsGroup title="Prompts Manager" description="Create and manage your custom prompts.">
                <PostProcessingSettingsPrompts />
            </SettingsGroup>
        )}
        {activeTab === "playground" && (
          <div className="h-[calc(100vh-180px)] border border-mid-gray/20 rounded-lg overflow-hidden bg-background">
            <Playground />
          </div>
        )}
      </div>
    </div>
  );
};
