import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type NotificationLike = {
  method?: string;
  params?: unknown;
};

function loadJsonFixture<T>(name: string): T {
  const fixturePath = join(__dirname, "__fixtures__", name);
  return JSON.parse(readFileSync(fixturePath, "utf8")) as T;
}

function extractSchemaMethods(schema: Record<string, any>): string[] {
  if (!Array.isArray(schema.oneOf)) {
    return [];
  }

  return schema.oneOf
    .map((entry) => {
      const methodProperty = entry?.properties?.method;
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
    })
    .filter((value): value is string => typeof value === "string");
}

function getMethodSchema(
  schema: Record<string, any>,
  method: string,
): Record<string, any> | null {
  if (!Array.isArray(schema.oneOf)) {
    return null;
  }

  return (
    schema.oneOf.find((entry) => {
      const methodProperty = entry?.properties?.method;
      if (typeof methodProperty?.const === "string") {
        return methodProperty.const === method;
      }
      if (
        Array.isArray(methodProperty?.enum) &&
        typeof methodProperty.enum[0] === "string"
      ) {
        return methodProperty.enum[0] === method;
      }
      return false;
    }) ?? null
  );
}

describe("Codex app-server notification schema contract subset", () => {
  it("tracks the expected upstream notification methods", () => {
    const subsetSchema = loadJsonFixture<Record<string, any>>(
      "server_notification_contract_subset.json",
    );

    expect(extractSchemaMethods(subsetSchema).sort()).toEqual([
      "account/updated",
      "account/rateLimits/updated",
      "configWarning",
      "item/agentMessage/delta",
      "item/completed",
      "item/mcpToolCall/progress",
      "item/reasoning/summaryPartAdded",
      "item/reasoning/summaryTextDelta",
      "item/reasoning/textDelta",
      "item/started",
      "mcpServer/startupStatus/updated",
      "model/rerouted",
      "skills/changed",
      "thread/tokenUsage/updated",
      "turn/diff/updated",
      "turn/plan/updated",
      "turn/started",
      "turn/completed",
    ].sort());
  });

  it("validates local raw notification fixtures against the generated subset schema", () => {
    const subsetSchema = loadJsonFixture<Record<string, any>>(
      "server_notification_contract_subset.json",
    );
    const ajv = new Ajv({
      allErrors: true,
    });

    const fixtureNames = [
      "notification_contract_core.json",
      "notification_contract_items.json",
      "notification_contract_upstream_rich.json",
    ] as const;

    for (const fixtureName of fixtureNames) {
      const notifications = loadJsonFixture<NotificationLike[]>(fixtureName);
      for (const notification of notifications) {
        const methodSchema = getMethodSchema(
          subsetSchema,
          notification.method ?? "",
        );
        expect(
          methodSchema,
          `Missing schema for notification method ${notification.method}`,
        ).not.toBeNull();
        const validate = ajv.compile({
          $schema: subsetSchema.$schema,
          definitions: subsetSchema.definitions,
          ...methodSchema,
        });
        const valid = validate(notification);
        expect(
          valid,
          `${fixtureName} failed schema validation for method ${notification.method}: ${ajv.errorsText(validate.errors)}`,
        ).toBe(true);
      }
    }
  });
});
