export type ContextUsageData = {
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  model?: string;
  categories?: Array<{ name: string; tokens: number; color?: string }>;
  messageBreakdown?: {
    toolCallTokens: number;
    toolResultTokens: number;
    attachmentTokens: number;
    assistantMessageTokens: number;
    userMessageTokens: number;
  };
};

export type ContextBreakdownItem = {
  key: string;
  label: string;
  tokens: number;
  percentage: number;
  color?: string;
};

export type ContextBreakdownSource =
  | "sdk-categories"
  | "message-breakdown-fallback";

type ContextBreakdownLabelKey =
  | "agentInput.context.systemLabel"
  | "agentInput.context.userLabel"
  | "agentInput.context.assistantLabel"
  | "agentInput.context.toolCallLabel"
  | "agentInput.context.toolResultLabel"
  | "agentInput.context.attachmentLabel"
  | "agentInput.context.sourceInfoTitle"
  | "agentInput.context.sourceSdkCategories"
  | "agentInput.context.sourceFallback"
  | "agentInput.context.sourceSdkCategoriesMessage"
  | "agentInput.context.sourceFallbackMessage";

type TranslateFn = (key: ContextBreakdownLabelKey) => string;

export type ContextBreakdownSourceInfo = {
  label: string;
  title: string;
  message: string;
};

function toPercentage(tokens: number, totalTokens: number): number {
  if (tokens <= 0 || totalTokens <= 0) {
    return 0;
  }

  return Math.round((tokens / totalTokens) * 100);
}

function getKnownCategoryLabel(name: string, translate: TranslateFn): string | null {
  const normalized = name.trim().toLowerCase();

  if (/(^|\\s)system(\\s|$)|prompt/.test(normalized)) {
    return translate("agentInput.context.systemLabel");
  }
  if (/assistant/.test(normalized)) {
    return translate("agentInput.context.assistantLabel");
  }
  if (/(^|\\s)user(\\s|$)/.test(normalized)) {
    return translate("agentInput.context.userLabel");
  }
  if (/tool.?call/.test(normalized)) {
    return translate("agentInput.context.toolCallLabel");
  }
  if (/tool.?result/.test(normalized)) {
    return translate("agentInput.context.toolResultLabel");
  }
  if (/attachment|image|file/.test(normalized)) {
    return translate("agentInput.context.attachmentLabel");
  }

  return null;
}

function sortBreakdown(items: ContextBreakdownItem[]): ContextBreakdownItem[] {
  return items.sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
}

export function getContextBreakdownSource(
  sdkContextUsage?: ContextUsageData | null,
): ContextBreakdownSource | null {
  if (!sdkContextUsage) {
    return null;
  }

  if (sdkContextUsage.categories && sdkContextUsage.categories.length > 0) {
    return "sdk-categories";
  }

  if (sdkContextUsage.messageBreakdown) {
    return "message-breakdown-fallback";
  }

  return null;
}

export function getContextBreakdownSourceInfo(
  source: ContextBreakdownSource | null | undefined,
  translate: TranslateFn = (key) => key,
): ContextBreakdownSourceInfo | null {
  if (!source) {
    return null;
  }

  if (source === "sdk-categories") {
    return {
      label: translate("agentInput.context.sourceSdkCategories"),
      title: translate("agentInput.context.sourceInfoTitle"),
      message: translate("agentInput.context.sourceSdkCategoriesMessage"),
    };
  }

  return {
    label: translate("agentInput.context.sourceFallback"),
    title: translate("agentInput.context.sourceInfoTitle"),
    message: translate("agentInput.context.sourceFallbackMessage"),
  };
}

export function getContextBreakdownItems(
  sdkContextUsage?: ContextUsageData | null,
  translate: TranslateFn = (key) => key,
): ContextBreakdownItem[] {
  if (!sdkContextUsage) {
    return [];
  }

  const totalTokens = sdkContextUsage.totalTokens;

  if (sdkContextUsage.categories && sdkContextUsage.categories.length > 0) {
    return sortBreakdown(
      sdkContextUsage.categories
        .filter((category) => category.tokens > 0)
        .map((category) => ({
          key: category.name,
          label: getKnownCategoryLabel(category.name, translate) ?? category.name,
          tokens: category.tokens,
          percentage: toPercentage(category.tokens, totalTokens),
          color: category.color,
        })),
    );
  }

  if (!sdkContextUsage.messageBreakdown) {
    return [];
  }

  const { messageBreakdown } = sdkContextUsage;

  return sortBreakdown(
    [
      {
        key: "tool-call",
        label: translate("agentInput.context.toolCallLabel"),
        tokens: messageBreakdown.toolCallTokens,
      },
      {
        key: "tool-result",
        label: translate("agentInput.context.toolResultLabel"),
        tokens: messageBreakdown.toolResultTokens,
      },
      {
        key: "attachment",
        label: translate("agentInput.context.attachmentLabel"),
        tokens: messageBreakdown.attachmentTokens,
      },
      {
        key: "assistant",
        label: translate("agentInput.context.assistantLabel"),
        tokens: messageBreakdown.assistantMessageTokens,
      },
      {
        key: "user",
        label: translate("agentInput.context.userLabel"),
        tokens: messageBreakdown.userMessageTokens,
      },
    ]
      .filter((item) => item.tokens > 0)
      .map((item) => ({
        ...item,
        percentage: toPercentage(item.tokens, totalTokens),
      })),
  );
}

export function getContextBreakdownSummary(
  items: ContextBreakdownItem[],
  previewLimit: number = 2,
): string | null {
  const previewItems = items
    .slice(0, Math.max(0, previewLimit))
    .map((item) => `${item.label} ${item.percentage}%`);

  if (previewItems.length === 0) {
    return null;
  }

  const remainingCount = items.length - previewItems.length;
  const previewText = previewItems.join(" · ");

  return remainingCount > 0
    ? `${previewText} · +${remainingCount}`
    : previewText;
}
