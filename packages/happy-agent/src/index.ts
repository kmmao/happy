#!/usr/bin/env node

import { Command } from "commander";
import { hostname } from "node:os";
import { version } from "../package.json";
import { loadConfig } from "./config";
import type { Config } from "./config";
import { requireCredentials } from "./credentials";
import type { Credentials } from "./credentials";
import { authLogin, authLogout, authStatus } from "./auth";
import {
  listSessions,
  listActiveSessions,
  createSession,
  getSessionMessages,
  deleteSession,
  getOrCreateMachine,
  listMachines,
} from "./api";
import type { DecryptedSession } from "./api";
import { SessionClient } from "./session";

// ---------------------------------------------------------------------------
// Library exports — for consumers using @kmmao/happy-agent as a package
// ---------------------------------------------------------------------------

export { loadConfig } from "./config";
export type { Config } from "./config";
export { readCredentials, requireCredentials } from "./credentials";
export type { Credentials } from "./credentials";
export { authLogin, authLogout, authStatus } from "./auth";
export {
  listSessions,
  listActiveSessions,
  createSession,
  deleteSession,
  getSessionMessages,
  resolveSessionEncryption,
  fetchMessagesAfterSeq,
  sendMessagesBatch,
  getOrCreateMachine,
  listMachines,
} from "./api";
export type {
  EncryptionVariant,
  SessionEncryption,
  DecryptedSession,
  DecryptedMessage,
} from "./api";
export { SessionClient } from "./session";
export type { SessionClientOptions } from "./session";
export { MachineClient } from "./api/machineClient";
export type { MachineClientOptions, EphemeralEvent } from "./api/machineClient";
export { startDaemon, stopDaemon, daemonStatus } from "./daemon/run";
export { RpcHandlerManager, createRpcHandlerManager } from "./api/rpc/RpcHandlerManager";
export type { RpcHandler, RpcHandlerConfig } from "./api/rpc/types";
import {
  formatSessionTable,
  formatSessionStatus,
  formatMessageHistory,
  formatJson,
} from "./output";
import { startDaemon, stopDaemon, daemonStatus } from "./daemon/run";

// --- Helpers ---

async function resolveSession(
  config: Config,
  creds: Credentials,
  sessionId: string,
): Promise<DecryptedSession> {
  if (!sessionId || sessionId.trim().length === 0) {
    throw new Error("Session ID is required");
  }
  const sessions = await listSessions(config, creds);
  const matches = sessions.filter((s) => s.id.startsWith(sessionId));
  if (matches.length === 0) {
    throw new Error(`No session found matching "${sessionId}"`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous session ID "${sessionId}" matches ${matches.length} sessions. Be more specific.`,
    );
  }
  return matches[0];
}

function createClient(
  session: DecryptedSession,
  creds: Credentials,
  config: Config,
): SessionClient {
  return new SessionClient({
    sessionId: session.id,
    encryptionKey: session.encryption.key,
    encryptionVariant: session.encryption.variant,
    token: creds.token,
    serverUrl: config.serverUrl,
    initialAgentState: session.agentState ?? null,
  });
}

// --- CLI ---

const program = new Command();

program
  .name("happy-agent")
  .description("CLI client for controlling Happy Coder agents remotely")
  .version(version);

program
  .command("auth")
  .description("Manage authentication")
  .addCommand(
    new Command("login")
      .description("Authenticate via QR code or web URL")
      .option("--web", "Use web URL instead of QR code (for SSH/headless environments)")
      .action(async (opts: { web?: boolean }) => {
        const config = loadConfig();
        await authLogin(config, { web: opts.web });
      }),
  )
  .addCommand(
    new Command("logout")
      .description("Clear stored credentials")
      .action(async () => {
        const config = loadConfig();
        await authLogout(config);
      }),
  )
  .addCommand(
    new Command("status")
      .description("Show authentication status")
      .action(async () => {
        const config = loadConfig();
        await authStatus(config);
      }),
  );

program
  .command("list")
  .description("List all sessions")
  .option("--active", "Show only active sessions")
  .option("--json", "Output as JSON")
  .action(async (opts: { active?: boolean; json?: boolean }) => {
    const config = loadConfig();
    const creds = requireCredentials(config);
    const sessions = opts.active
      ? await listActiveSessions(config, creds)
      : await listSessions(config, creds);
    if (opts.json) {
      console.log(formatJson(sessions));
    } else {
      console.log(formatSessionTable(sessions));
    }
  });

program
  .command("status")
  .description("Get live session state")
  .argument("<session-id>", "Session ID or prefix")
  .option("--json", "Output as JSON")
  .action(async (sessionId: string, opts: { json?: boolean }) => {
    const config = loadConfig();
    const creds = requireCredentials(config);
    const session = await resolveSession(config, creds, sessionId);

    const client = createClient(session, creds, config);

    let liveData = false;
    try {
      // Wait for connection, then wait for a state-change event or a short timeout
      await new Promise<void>((resolve) => {
        let resolved = false;
        const done = () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          client.removeAllListeners("state-change");
          client.removeAllListeners("connect_error");
          resolve();
        };

        const timeout = setTimeout(done, 3000);

        client.once(
          "state-change",
          (data: { metadata: unknown; agentState: unknown }) => {
            session.metadata = data.metadata ?? session.metadata;
            session.agentState = data.agentState ?? session.agentState;
            liveData = true;
            done();
          },
        );

        client.once("connect_error", () => {
          done();
        });
      });
    } finally {
      client.close();
    }

    if (opts.json) {
      console.log(formatJson(session));
    } else {
      if (!liveData) {
        console.log("> Note: showing cached data (could not get live status).");
      }
      console.log(formatSessionStatus(session));
    }
  });

program
  .command("create")
  .description("Create a new session")
  .requiredOption("--tag <tag>", "Session tag")
  .option("--path <path>", "Working directory path")
  .option("--json", "Output as JSON")
  .action(async (opts: { tag: string; path?: string; json?: boolean }) => {
    const config = loadConfig();
    const creds = requireCredentials(config);
    const metadata = {
      tag: opts.tag,
      path: opts.path ?? process.cwd(),
      host: hostname(),
    };
    const session = await createSession(config, creds, {
      tag: opts.tag,
      metadata,
    });
    if (opts.json) {
      console.log(formatJson(session));
    } else {
      console.log(
        ["## Session Created", "", `- Session ID: \`${session.id}\``].join(
          "\n",
        ),
      );
    }
  });

program
  .command("send")
  .description("Send a message to a session")
  .argument("<session-id>", "Session ID or prefix")
  .argument("<message>", "Message text")
  .option("--wait", "Wait for agent to become idle")
  .option(
    "--timeout <seconds>",
    "Timeout in seconds when using --wait",
    (v: string) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n <= 0)
        throw new Error("--timeout must be a positive integer");
      return n;
    },
    300,
  )
  .option("--json", "Output as JSON")
  .action(
    async (
      sessionId: string,
      message: string,
      opts: { wait?: boolean; timeout: number; json?: boolean },
    ) => {
      const config = loadConfig();
      const creds = requireCredentials(config);
      const session = await resolveSession(config, creds, sessionId);

      const client = createClient(session, creds, config);
      try {
        await client.waitForConnect();
        client.sendMessage(message);

        if (opts.wait) {
          await client.waitForIdle(opts.timeout * 1000);
        } else {
          // Delay to allow the Socket.IO event to flush before closing
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } finally {
        client.close();
      }

      if (opts.json) {
        console.log(formatJson({ sessionId: session.id, message, sent: true }));
      } else {
        console.log(
          [
            "## Message Sent",
            "",
            `- Session ID: \`${session.id}\``,
            `- Waited For Idle: ${opts.wait ? "yes" : "no"}`,
          ].join("\n"),
        );
      }
    },
  );

program
  .command("history")
  .description("Read message history")
  .argument("<session-id>", "Session ID or prefix")
  .option("--limit <n>", "Limit number of messages", (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n <= 0)
      throw new Error("--limit must be a positive integer");
    return n;
  })
  .option("--json", "Output as JSON")
  .action(
    async (sessionId: string, opts: { limit?: number; json?: boolean }) => {
      const config = loadConfig();
      const creds = requireCredentials(config);
      const session = await resolveSession(config, creds, sessionId);
      let messages = await getSessionMessages(
        config,
        creds,
        session.id,
        session.encryption,
      );

      // Sort chronologically by createdAt
      messages.sort((a, b) => a.createdAt - b.createdAt);

      // Apply limit
      if (opts.limit && opts.limit > 0) {
        messages = messages.slice(-opts.limit);
      }

      if (opts.json) {
        console.log(formatJson(messages));
      } else {
        console.log(formatMessageHistory(messages));
      }
    },
  );

program
  .command("stop")
  .description("Stop a session")
  .argument("<session-id>", "Session ID or prefix")
  .action(async (sessionId: string) => {
    const config = loadConfig();
    const creds = requireCredentials(config);
    const session = await resolveSession(config, creds, sessionId);

    const client = createClient(session, creds, config);
    try {
      await client.waitForConnect();
      client.sendStop();

      // Delay to allow the Socket.IO event to flush before closing
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      client.close();
    }

    console.log(
      ["## Session Stopped", "", `- Session ID: \`${session.id}\``].join("\n"),
    );
  });

program
  .command("delete")
  .description("Delete a session permanently")
  .argument("<session-id>", "Session ID or prefix")
  .action(async (sessionId: string) => {
    const config = loadConfig();
    const creds = requireCredentials(config);
    const session = await resolveSession(config, creds, sessionId);
    await deleteSession(config, creds, session.id);
    console.log(
      ["## Session Deleted", "", `- Session ID: \`${session.id}\``].join("\n"),
    );
  });

program
  .command("wait")
  .description("Wait for agent to become idle")
  .argument("<session-id>", "Session ID or prefix")
  .option(
    "--timeout <seconds>",
    "Timeout in seconds",
    (v: string) => {
      const n = parseInt(v, 10);
      if (isNaN(n) || n <= 0)
        throw new Error("--timeout must be a positive integer");
      return n;
    },
    300,
  )
  .action(async (sessionId: string, opts: { timeout: number }) => {
    const config = loadConfig();
    const creds = requireCredentials(config);
    const session = await resolveSession(config, creds, sessionId);

    const client = createClient(session, creds, config);
    try {
      await client.waitForConnect();
      await client.waitForIdle(opts.timeout * 1000);
      console.log(
        ["## Session Idle", "", `- Session ID: \`${session.id}\``].join("\n"),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(msg);
      process.exitCode = 1;
    } finally {
      client.close();
    }
  });

program
  .command("machine")
  .description("Manage machine identity")
  .addCommand(
    new Command("register")
      .description("Register this machine with the server")
      .option("--json", "Output as JSON")
      .action(async (opts: { json?: boolean }) => {
        const config = loadConfig();
        const creds = requireCredentials(config);
        const metadata = {
          host: hostname(),
          platform: process.platform,
          happyCliVersion: version,
          homeDir: config.homeDir,
          happyHomeDir: config.homeDir,
          happyLibDir: config.homeDir,
        };
        const machine = await getOrCreateMachine(config, creds, metadata);
        if (opts.json) {
          console.log(formatJson({ id: machine.id, metadata: machine.metadata }));
        } else {
          console.log(
            [
              "## Machine Registered",
              "",
              `- Machine ID: \`${machine.id}\``,
              `- Host: ${machine.metadata.host}`,
              `- Platform: ${machine.metadata.platform}`,
            ].join("\n"),
          );
        }
      }),
  )
  .addCommand(
    new Command("list")
      .description("List all registered machines")
      .option("--json", "Output as JSON")
      .action(async (opts: { json?: boolean }) => {
        const config = loadConfig();
        const creds = requireCredentials(config);
        const machines = await listMachines(config, creds);
        if (opts.json) {
          console.log(formatJson(machines));
        } else {
          if (machines.length === 0) {
            console.log("No machines registered.");
          } else {
            console.log(`## Machines (${machines.length})`);
            for (const m of machines) {
              console.log(`- \`${m.id}\``);
            }
          }
        }
      }),
  );

program
  .command("daemon")
  .description("Run as a persistent background daemon")
  .addCommand(
    new Command("start")
      .description("Start the agent daemon (connects to server, handles triggers)")
      .option("--directory <dir>", "Working directory for spawned sessions")
      .option("--foreground", "Run in foreground (do not detach)")
      .action(async (opts: { directory?: string; foreground?: boolean }) => {
        await startDaemon(opts);
      }),
  )
  .addCommand(
    new Command("stop")
      .description("Stop the running daemon")
      .action(() => {
        stopDaemon();
      }),
  )
  .addCommand(
    new Command("status")
      .description("Check daemon status")
      .action(() => {
        daemonStatus();
      }),
  );

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
