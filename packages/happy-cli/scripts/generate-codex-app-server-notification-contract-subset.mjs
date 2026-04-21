#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

const defaultSourcePath =
  process.env.OPENAI_CODEX_SERVER_NOTIFICATION_SCHEMA ??
  "/tmp/openai-codex/codex-rs/app-server-protocol/schema/json/ServerNotification.json";

const outputPath = path.resolve(
  packageRoot,
  "src/codex-app/__fixtures__/server_notification_contract_subset.json",
);

const methodSubset = [
  "thread/tokenUsage/updated",
  "turn/started",
  "turn/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/mcpToolCall/progress",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "model/rerouted",
  "configWarning",
  "account/updated",
  "account/rateLimits/updated",
  "skills/changed",
  "mcpServer/startupStatus/updated",
];

function getMethod(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const methodProperty = entry.properties?.method;
  if (typeof methodProperty?.const === "string") {
    return methodProperty.const;
  }
  if (
    Array.isArray(methodProperty?.enum) &&
    typeof methodProperty.enum[0] === "string"
  ) {
    return methodProperty.enum[0];
  }

  return null;
}

function main() {
  if (!fs.existsSync(defaultSourcePath)) {
    throw new Error(
      `Upstream ServerNotification schema not found at: ${defaultSourcePath}\n` +
        "Set OPENAI_CODEX_SERVER_NOTIFICATION_SCHEMA to a valid local path.",
    );
  }

  const upstreamSchema = JSON.parse(fs.readFileSync(defaultSourcePath, "utf8"));

  if (!Array.isArray(upstreamSchema.oneOf)) {
    throw new Error("Expected upstream ServerNotification schema to contain a oneOf array.");
  }

  const selected = upstreamSchema.oneOf.filter((entry) =>
    methodSubset.includes(getMethod(entry)),
  );

  const selectedMethods = selected
    .map((entry) => getMethod(entry))
    .filter((value) => typeof value === "string");

  const missingMethods = methodSubset.filter(
    (method) => !selectedMethods.includes(method),
  );

  if (missingMethods.length > 0) {
    throw new Error(
      `Failed to extract methods from upstream schema: ${missingMethods.join(", ")}`,
    );
  }

  const subsetSchema = {
    $schema: upstreamSchema.$schema,
    title: "Happy Codex App Server Notification Contract Subset",
    description:
      "Generated subset of openai/codex app-server ServerNotification schema for the notification methods Happy currently consumes.",
    definitions: upstreamSchema.definitions,
    oneOf: selected,
    "x-generated-from": {
      upstreamSource: "openai/codex",
      sourceSchemaPath: defaultSourcePath,
      verifiedDate: new Date().toISOString().slice(0, 10),
      selectedMethods: methodSubset,
    },
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(subsetSchema, null, 2)}\n`);
  process.stdout.write(
    `Wrote ${selected.length} notification schemas to ${outputPath}\n`,
  );
}

main();
