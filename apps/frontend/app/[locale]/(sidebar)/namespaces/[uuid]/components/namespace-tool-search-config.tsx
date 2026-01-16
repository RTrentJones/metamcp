"use client";

import { NamespaceWithServers, ToolSearchMethodEnum } from "@repo/zod-types";
import { Info, Save } from "lucide-react";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";

interface NamespaceToolSearchConfigProps {
  namespace: NamespaceWithServers;
}

export function NamespaceToolSearchConfig({
  namespace,
}: NamespaceToolSearchConfigProps) {
  const { t } = useTranslations();
  const utils = trpc.useUtils();

  // State for namespace defaults
  const [defaultDeferLoading, setDefaultDeferLoading] = useState(
    namespace.default_defer_loading ?? false,
  );
  const [defaultSearchMethod, setDefaultSearchMethod] = useState(
    namespace.default_search_method ?? ToolSearchMethodEnum.Enum.NONE,
  );

  // State for tool search config
  const [maxResults, setMaxResults] = useState<number>(10);
  const [providerConfigStr, setProviderConfigStr] = useState("");
  const [hasToolSearchConfig, setHasToolSearchConfig] = useState(false);

  // Sync state when namespace changes
  useEffect(() => {
    setDefaultDeferLoading(namespace.default_defer_loading ?? false);
    setDefaultSearchMethod(
      namespace.default_search_method ?? ToolSearchMethodEnum.Enum.NONE,
    );
  }, [namespace]);

  // Fetch tool search config
  const { data: toolSearchConfigResponse, isLoading: isLoadingConfig } =
    trpc.frontend.toolSearchConfig.get.useQuery({
      namespaceUuid: namespace.uuid,
    });

  // Update config state when data is loaded
  useEffect(() => {
    if (toolSearchConfigResponse?.success && toolSearchConfigResponse.data) {
      setHasToolSearchConfig(true);
      setMaxResults(toolSearchConfigResponse.data.max_results);
      setProviderConfigStr(
        toolSearchConfigResponse.data.provider_config
          ? JSON.stringify(toolSearchConfigResponse.data.provider_config, null, 2)
          : "",
      );
    } else {
      setHasToolSearchConfig(false);
    }
  }, [toolSearchConfigResponse]);

  // Update namespace mutation
  const updateNamespaceMutation = trpc.frontend.namespaces.update.useMutation({
    onSuccess: (response) => {
      if (response.success) {
        toast.success(t("namespaces:toolSearchConfig.namespaceDefaultsUpdated"));
        utils.frontend.namespaces.get.invalidate({ uuid: namespace.uuid });
      } else {
        toast.error(t("namespaces:toolSearchConfig.namespaceDefaultsUpdateFailed"));
      }
    },
    onError: (error) => {
      console.error("Error updating namespace defaults:", error);
      toast.error(t("namespaces:toolSearchConfig.namespaceDefaultsUpdateFailed"), {
        description: error.message,
      });
    },
  });

  // Upsert tool search config mutation
  const upsertToolSearchConfigMutation =
    trpc.frontend.toolSearchConfig.upsert.useMutation({
      onSuccess: (response) => {
        if (response.success) {
          toast.success(t("namespaces:toolSearchConfig.toolSearchConfigUpdated"));
          utils.frontend.toolSearchConfig.get.invalidate({
            namespaceUuid: namespace.uuid,
          });
        } else {
          toast.error(t("namespaces:toolSearchConfig.toolSearchConfigUpdateFailed"));
        }
      },
      onError: (error) => {
        console.error("Error updating tool search config:", error);
        toast.error(t("namespaces:toolSearchConfig.toolSearchConfigUpdateFailed"), {
          description: error.message,
        });
      },
    });

  const handleSaveNamespaceDefaults = () => {
    updateNamespaceMutation.mutate({
      uuid: namespace.uuid,
      name: namespace.name,
      description: namespace.description ?? undefined,
      mcpServerUuids: namespace.servers?.map((s) => s.uuid),
      default_defer_loading: defaultDeferLoading,
      default_search_method: defaultSearchMethod,
    });
  };

  const handleSaveToolSearchConfig = () => {
    // Validate provider_config JSON
    let providerConfig = null;
    if (providerConfigStr.trim()) {
      try {
        providerConfig = JSON.parse(providerConfigStr);
      } catch (error) {
        toast.error(t("namespaces:toolSearchConfig.invalidProviderConfigJson"), {
          description: t("namespaces:toolSearchConfig.providerConfigMustBeValidJson"),
        });
        return;
      }
    }

    upsertToolSearchConfigMutation.mutate({
      namespaceUuid: namespace.uuid,
      maxResults,
      providerConfig,
    });
  };

  const getSearchMethodBadge = (method: string) => {
    switch (method) {
      case ToolSearchMethodEnum.Enum.NONE:
        return <Badge variant="secondary">NONE</Badge>;
      case ToolSearchMethodEnum.Enum.REGEX:
        return <Badge variant="default">REGEX</Badge>;
      case ToolSearchMethodEnum.Enum.BM25:
        return <Badge variant="default">BM25</Badge>;
      case ToolSearchMethodEnum.Enum.EMBEDDINGS:
        return <Badge variant="default">EMBEDDINGS</Badge>;
      default:
        return <Badge variant="outline">{method}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Namespace Defaults Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold">
            {t("namespaces:toolSearchConfig.namespaceDefaults")}
          </h4>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-4 w-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs max-w-xs">
                {t("namespaces:toolSearchConfig.namespaceDefaultsTooltip")}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Default Defer Loading */}
          <div className="space-y-2">
            <Label htmlFor="defaultDeferLoading">
              {t("namespaces:toolSearchConfig.defaultDeferLoading")}
            </Label>
            <div className="flex items-center gap-2">
              <Switch
                id="defaultDeferLoading"
                checked={defaultDeferLoading}
                onCheckedChange={setDefaultDeferLoading}
              />
              <span className="text-sm text-muted-foreground">
                {defaultDeferLoading
                  ? t("namespaces:toolSearchConfig.enabled")
                  : t("namespaces:toolSearchConfig.disabled")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("namespaces:toolSearchConfig.defaultDeferLoadingDescription")}
            </p>
          </div>

          {/* Default Search Method */}
          <div className="space-y-2">
            <Label htmlFor="defaultSearchMethod">
              {t("namespaces:toolSearchConfig.defaultSearchMethod")}
            </Label>
            <Select
              value={defaultSearchMethod}
              onValueChange={(value) => setDefaultSearchMethod(value as any)}
            >
              <SelectTrigger id="defaultSearchMethod">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ToolSearchMethodEnum.Enum.NONE}>
                  {getSearchMethodBadge(ToolSearchMethodEnum.Enum.NONE)}
                </SelectItem>
                <SelectItem value={ToolSearchMethodEnum.Enum.REGEX}>
                  {getSearchMethodBadge(ToolSearchMethodEnum.Enum.REGEX)}
                </SelectItem>
                <SelectItem value={ToolSearchMethodEnum.Enum.BM25}>
                  {getSearchMethodBadge(ToolSearchMethodEnum.Enum.BM25)}
                </SelectItem>
                <SelectItem value={ToolSearchMethodEnum.Enum.EMBEDDINGS}>
                  {getSearchMethodBadge(ToolSearchMethodEnum.Enum.EMBEDDINGS)}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("namespaces:toolSearchConfig.defaultSearchMethodDescription")}
            </p>
          </div>
        </div>

        <Button
          onClick={handleSaveNamespaceDefaults}
          disabled={updateNamespaceMutation.isPending}
          size="sm"
        >
          <Save className="h-4 w-4 mr-2" />
          {updateNamespaceMutation.isPending
            ? t("namespaces:toolSearchConfig.saving")
            : t("namespaces:toolSearchConfig.saveDefaults")}
        </Button>
      </div>

      {/* Tool Search Config Section */}
      <div className="border-t pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold">
            {t("namespaces:toolSearchConfig.toolSearchConfig")}
          </h4>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-4 w-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs max-w-xs">
                {t("namespaces:toolSearchConfig.toolSearchConfigTooltip")}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>

        {isLoadingConfig ? (
          <div className="text-sm text-muted-foreground">
            {t("namespaces:toolSearchConfig.loadingConfig")}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Max Results */}
            <div className="space-y-2">
              <Label htmlFor="maxResults">
                {t("namespaces:toolSearchConfig.maxResults")}
              </Label>
              <Input
                id="maxResults"
                type="number"
                min={1}
                max={20}
                value={maxResults}
                onChange={(e) => setMaxResults(parseInt(e.target.value))}
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                {t("namespaces:toolSearchConfig.maxResultsDescription")}
              </p>
            </div>

            {/* Provider Config */}
            <div className="space-y-2">
              <Label htmlFor="providerConfig">
                {t("namespaces:toolSearchConfig.providerConfig")}
              </Label>
              <Textarea
                id="providerConfig"
                value={providerConfigStr}
                onChange={(e) => setProviderConfigStr(e.target.value)}
                placeholder={t("namespaces:toolSearchConfig.providerConfigPlaceholder")}
                className="font-mono text-xs"
                rows={6}
              />
              <p className="text-xs text-muted-foreground">
                {t("namespaces:toolSearchConfig.providerConfigDescription")}
              </p>
            </div>

            <Button
              onClick={handleSaveToolSearchConfig}
              disabled={upsertToolSearchConfigMutation.isPending}
              size="sm"
            >
              <Save className="h-4 w-4 mr-2" />
              {upsertToolSearchConfigMutation.isPending
                ? t("namespaces:toolSearchConfig.saving")
                : hasToolSearchConfig
                  ? t("namespaces:toolSearchConfig.updateConfig")
                  : t("namespaces:toolSearchConfig.createConfig")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
