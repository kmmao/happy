const SENSITIVE_ENV_NAME_PATTERN =
  /(^|_)(AUTH_TOKEN|API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|SESSION_KEY|ENCRYPTION_KEY|ACCESS_KEY|CLIENT_SECRET|OAUTH_TOKEN|PROVISION_TOKEN)$/;

const SHELL_ENV_REFERENCE_PATTERN = /\$\{?\s*([A-Z_][A-Z0-9_]*)\b/g;

function normalizeKey(key: string): string {
  return key
    .trim()
    .replace(/^--?/, "")
    .replace(/-/g, "_")
    .toUpperCase();
}

export function isSensitiveEnvVarName(name: string): boolean {
  return SENSITIVE_ENV_NAME_PATTERN.test(normalizeKey(name));
}

export function findSensitiveEnvVarReferences(text: string): string[] {
  const matches = new Set<string>();
  for (const match of text.matchAll(SHELL_ENV_REFERENCE_PATTERN)) {
    const name = match[1];
    if (name && isSensitiveEnvVarName(name)) {
      matches.add(name);
    }
  }
  return Array.from(matches);
}

export function summarizeShellCommandForLog(command: string): {
  preview: string;
  sensitiveEnvVars: string[];
} {
  const sensitiveEnvVars = findSensitiveEnvVarReferences(command);
  if (sensitiveEnvVars.length > 0) {
    return {
      preview: `[redacted sensitive shell command referencing ${sensitiveEnvVars.join(", ")}]`,
      sensitiveEnvVars,
    };
  }

  const compact = command.replace(/\s+/g, " ").trim();
  const preview =
    compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;

  return {
    preview,
    sensitiveEnvVars: [],
  };
}

export function sanitizeProcessArgv(argv: string[]): string[] {
  let nextValueIsSensitive = false;

  return argv.map((arg) => {
    if (nextValueIsSensitive) {
      nextValueIsSensitive = false;
      return "[REDACTED]";
    }

    const assignmentIndex = arg.indexOf("=");
    if (assignmentIndex > 0) {
      const key = arg.slice(0, assignmentIndex);
      const value = arg.slice(assignmentIndex + 1);
      if (value && isSensitiveEnvVarName(key)) {
        return `${key}=[REDACTED]`;
      }
    }

    if (arg.startsWith("--")) {
      if (assignmentIndex > 0) {
        const key = arg.slice(0, assignmentIndex);
        if (isSensitiveEnvVarName(key)) {
          return `${key}=[REDACTED]`;
        }
      } else if (isSensitiveEnvVarName(arg)) {
        nextValueIsSensitive = true;
      }
    }

    return arg;
  });
}
