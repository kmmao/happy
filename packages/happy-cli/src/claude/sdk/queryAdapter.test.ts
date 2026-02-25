import { describe, it, expect, vi } from "vitest"
import { mapOptions } from "./queryAdapter"
import type { QueryOptions } from "./types"

describe("queryAdapter", () => {
  describe("mapOptions", () => {
    it("should map direct 1:1 fields", () => {
      const opts: QueryOptions = {
        cwd: "/test/path",
        allowedTools: ["Bash", "Read"],
        disallowedTools: ["Write"],
        executable: "node",
        executableArgs: ["--max-old-space-size=8192"],
        maxTurns: 10,
        pathToClaudeCodeExecutable: "/usr/local/bin/claude.cjs",
        permissionMode: "bypassPermissions",
        continue: true,
        resume: "session-123",
        model: "claude-opus-4-6",
        fallbackModel: "claude-sonnet-4-6",
        strictMcpConfig: true,
      }

      const result = mapOptions(opts)

      expect(result.cwd).toBe("/test/path")
      expect(result.allowedTools).toEqual(["Bash", "Read"])
      expect(result.disallowedTools).toEqual(["Write"])
      expect(result.executable).toBe("node")
      expect(result.executableArgs).toEqual(["--max-old-space-size=8192"])
      expect(result.maxTurns).toBe(10)
      expect(result.pathToClaudeCodeExecutable).toBe(
        "/usr/local/bin/claude.cjs",
      )
      expect(result.permissionMode).toBe("bypassPermissions")
      expect(result.continue).toBe(true)
      expect(result.resume).toBe("session-123")
      expect(result.model).toBe("claude-opus-4-6")
      expect(result.fallbackModel).toBe("claude-sonnet-4-6")
      expect(result.strictMcpConfig).toBe(true)
    })

    it("should map abort signal to abortController", () => {
      const controller = new AbortController()
      const opts: QueryOptions = { abort: controller.signal }

      const result = mapOptions(opts)

      expect(result.abortController).toBeDefined()
      expect(result.abortController!.signal.aborted).toBe(false)

      // Aborting the original signal should propagate
      controller.abort()
      expect(result.abortController!.signal.aborted).toBe(true)
    })

    it("should handle already-aborted signal", () => {
      const controller = new AbortController()
      controller.abort()

      const opts: QueryOptions = { abort: controller.signal }
      const result = mapOptions(opts)

      expect(result.abortController!.signal.aborted).toBe(true)
    })

    it("should map canCallTool to canUseTool", async () => {
      const mockCanCallTool = vi.fn().mockResolvedValue({
        behavior: "allow" as const,
        updatedInput: {},
      })

      const opts: QueryOptions = { canCallTool: mockCanCallTool }
      const result = mapOptions(opts)

      expect(result.canUseTool).toBeDefined()

      // Call the adapted function with official SDK signature
      const signal = new AbortController().signal
      await result.canUseTool!(
        "Bash",
        { command: "ls" },
        {
          signal,
          toolUseID: "tool-123",
          suggestions: [],
          decisionReason: "user requested",
        },
      )

      // Verify the self-built callback received the simplified signature
      expect(mockCanCallTool).toHaveBeenCalledWith(
        "Bash",
        { command: "ls" },
        { signal },
      )
    })

    it("should map settingsPath to extraArgs", () => {
      const opts: QueryOptions = { settingsPath: "/tmp/settings.json" }
      const result = mapOptions(opts)

      expect(result.extraArgs).toEqual({ settings: "/tmp/settings.json" })
    })

    it("should map customSystemPrompt to systemPrompt string", () => {
      const opts: QueryOptions = {
        customSystemPrompt: "You are a helpful assistant.",
      }
      const result = mapOptions(opts)

      expect(result.systemPrompt).toBe("You are a helpful assistant.")
    })

    it("should map appendSystemPrompt to systemPrompt preset", () => {
      const opts: QueryOptions = {
        appendSystemPrompt: "Always explain your reasoning.",
      }
      const result = mapOptions(opts)

      expect(result.systemPrompt).toEqual({
        type: "preset",
        preset: "claude_code",
        append: "Always explain your reasoning.",
      })
    })

    it("should prioritize customSystemPrompt over appendSystemPrompt", () => {
      const opts: QueryOptions = {
        customSystemPrompt: "Custom prompt",
        appendSystemPrompt: "Append prompt",
      }
      const result = mapOptions(opts)

      // customSystemPrompt takes priority
      expect(result.systemPrompt).toBe("Custom prompt")
    })

    it("should strip CLAUDECODE from env", () => {
      process.env.CLAUDECODE = "true"
      const opts: QueryOptions = {}
      const result = mapOptions(opts)

      expect(result.env).toBeDefined()
      expect(result.env!.CLAUDECODE).toBeUndefined()

      // Cleanup
      delete process.env.CLAUDECODE
    })

    it("should not mutate original process.env", () => {
      process.env.CLAUDECODE = "true"
      const opts: QueryOptions = {}
      mapOptions(opts)

      // Original env should still have CLAUDECODE
      expect(process.env.CLAUDECODE).toBe("true")

      // Cleanup
      delete process.env.CLAUDECODE
    })

    it("should map mcpServers", () => {
      const servers = {
        myServer: { command: "node", args: ["server.js"] },
      }
      const opts: QueryOptions = { mcpServers: servers }
      const result = mapOptions(opts)

      expect(result.mcpServers).toEqual(servers)
    })

    it("should return empty options for empty input", () => {
      const result = mapOptions({})

      // Only env should be set (CLAUDECODE stripping)
      expect(result.env).toBeDefined()
      expect(result.cwd).toBeUndefined()
      expect(result.model).toBeUndefined()
      expect(result.abortController).toBeUndefined()
    })
  })
})
