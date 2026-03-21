/**
 * SDK Metadata Extractor
 * Captures available tools and slash commands from Claude SDK initialization
 */

import { homedir } from "os";
import { query } from "./index";
import { extractCommandDescriptions } from "./commandDescriptionExtractor";
import type { SDKSystemMessage } from "./types";
import { logger } from "@/ui/logger";

export interface SDKMetadata {
  tools?: string[];
  slashCommands?: string[];
  slashCommandDescriptions?: Record<string, string>;
}

/**
 * Extract SDK metadata by running a minimal query and capturing the init message
 * @returns SDK metadata containing tools and slash commands
 */
export async function extractSDKMetadata(): Promise<SDKMetadata> {
  const abortController = new AbortController();

  try {
    logger.debug("[metadataExtractor] Starting SDK metadata extraction");

    // Run SDK with minimal tools allowed
    const sdkQuery = query({
      prompt: "hello",
      options: {
        allowedTools: ["Bash(echo)"],
        maxTurns: 1,
        abort: abortController.signal,
      },
    });

    // Wait for the first system message which contains tools and slash commands
    for await (const message of sdkQuery) {
      if (message.type === "system" && message.subtype === "init") {
        const systemMessage = message as SDKSystemMessage;

        // Abort the query since we got what we need
        abortController.abort();

        // Extract command descriptions from filesystem
        const slashCommandDescriptions =
          systemMessage.slash_commands?.length
            ? await extractCommandDescriptions(
                systemMessage.slash_commands,
                systemMessage.cwd,
                homedir(),
                systemMessage.plugins,
              )
            : undefined;

        const metadata: SDKMetadata = {
          tools: systemMessage.tools,
          slashCommands: systemMessage.slash_commands,
          slashCommandDescriptions,
        };

        logger.debug("[metadataExtractor] Captured SDK metadata:", metadata);

        return metadata;
      }
    }

    logger.debug("[metadataExtractor] No init message received from SDK");
    return {};
  } catch (error) {
    // Check if it's an abort error (expected)
    if (error instanceof Error && error.name === "AbortError") {
      logger.debug(
        "[metadataExtractor] SDK query aborted after capturing metadata",
      );
      return {};
    }
    logger.debug("[metadataExtractor] Error extracting SDK metadata:", error);
    return {};
  }
}

/**
 * Extract SDK metadata asynchronously without blocking
 * Fires the extraction and updates metadata when complete
 */
export function extractSDKMetadataAsync(
  onComplete: (metadata: SDKMetadata) => void,
): void {
  extractSDKMetadata()
    .then((metadata) => {
      if (metadata.tools || metadata.slashCommands) {
        onComplete(metadata);
      }
    })
    .catch((error) => {
      logger.debug("[metadataExtractor] Async extraction failed:", error);
    });
}
