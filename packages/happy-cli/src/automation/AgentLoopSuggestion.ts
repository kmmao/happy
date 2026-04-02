import { access, readFile, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import type { AgentLoopDefinition } from "./AgentLoopStore";
import type { AgentLoopCreateInput } from "./AgentLoopCoordinator";

export type AgentLoopSuggestionConfidence = "high" | "medium";

export interface AgentLoopSuggestion {
  key: string;
  name: string;
  description: string;
  rationale: string;
  directory: string;
  intervalMs: number;
  agent: "claude" | "codex" | "gemini";
  fileWatchEnabled?: boolean;
  githubBridgeEnabled?: boolean;
  ciBridgeEnabled?: boolean;
  eventSourceAllowlist?: string[];
  eventKeywordFilters?: string[];
  goal?: string;
  currentFocus?: string;
  workingMemory?: string;
  lastReflectionSummary?: string;
  maxConsecutiveFailures?: number;
  retryBackoffMs?: number;
  prompt: string;
  tags: string[];
  confidence: AgentLoopSuggestionConfidence;
  alreadyConfigured: boolean;
  existingLoopId?: string;
}

export interface AgentLoopSuggestInput {
  directory: string;
  agent?: "claude" | "codex" | "gemini";
  projectId?: string;
  profileId?: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<any | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return undefined;
  }
}

async function readUtf8IfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

async function rootHasFileEndingWith(repoDir: string, suffix: string): Promise<boolean> {
  try {
    const entries = await readdir(repoDir, { withFileTypes: true });
    return entries.some((e) => e.isFile() && e.name.endsWith(suffix));
  } catch {
    return false;
  }
}

function mergedDependencies(pkg: unknown): Record<string, string> {
  if (!pkg || typeof pkg !== "object") {
    return {};
  }
  const p = pkg as Record<string, unknown>;
  const out: Record<string, string> = {};
  const merge = (block: unknown) => {
    if (block && typeof block === "object") {
      Object.assign(out, block as Record<string, string>);
    }
  };
  merge(p.dependencies);
  merge(p.devDependencies);
  return out;
}

function packageRefsVue(pkg: unknown): boolean {
  const d = mergedDependencies(pkg);
  return Boolean(d.vue || d.nuxt || d["@vitejs/plugin-vue"]);
}

function packageRefsTaro(pkg: unknown): boolean {
  return Boolean(mergedDependencies(pkg)["@tarojs/taro"]);
}

function packageRefsUniApp(pkg: unknown): boolean {
  const d = mergedDependencies(pkg);
  return Boolean(
    d["@dcloudio/uni-app"] ||
      d["@dcloudio/uni-app-vue"] ||
      d["@dcloudio/uni-cli-shared"] ||
      d["@dcloudio/uni-ui"] ||
      d["@dcloudio/uni-components"],
  );
}

function packageRefsUmi(pkg: unknown): boolean {
  const d = mergedDependencies(pkg);
  return Boolean(d.umi || d["@umijs/max"] || d["@umijs/preset-react"]);
}

async function pubspecLooksLikeFlutter(repoDir: string): Promise<boolean> {
  const raw = await readUtf8IfExists(join(repoDir, "pubspec.yaml"));
  if (!raw) {
    return false;
  }
  return /sdk:\s*flutter\b/m.test(raw);
}

async function hasHelmChart(repoDir: string): Promise<boolean> {
  const direct = [
    join(repoDir, "Chart.yaml"),
    join(repoDir, "chart", "Chart.yaml"),
    join(repoDir, "helm", "Chart.yaml"),
  ];
  for (const p of direct) {
    if (await pathExists(p)) {
      return true;
    }
  }
  const chartsDir = join(repoDir, "charts");
  if (!(await pathExists(chartsDir))) {
    return false;
  }
  try {
    const subs = await readdir(chartsDir, { withFileTypes: true });
    for (const e of subs) {
      if (e.isDirectory() && (await pathExists(join(chartsDir, e.name, "Chart.yaml")))) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function findMatchingLoop(existingLoops: AgentLoopDefinition[], directory: string, name: string): AgentLoopDefinition | undefined {
  const targetDirectory = normalize(directory);
  const targetName = normalize(name);
  return existingLoops.find((loop) => normalize(loop.directory) === targetDirectory && normalize(loop.name) === targetName);
}

function buildSuggestion(
  base: Omit<AgentLoopSuggestion, "alreadyConfigured" | "existingLoopId">,
  existingLoops: AgentLoopDefinition[],
): AgentLoopSuggestion {
  const existing = findMatchingLoop(existingLoops, base.directory, base.name);
  return {
    ...base,
    alreadyConfigured: Boolean(existing),
    existingLoopId: existing?.id,
  };
}

export async function suggestAgentLoops(
  input: AgentLoopSuggestInput,
  existingLoops: AgentLoopDefinition[] = [],
): Promise<AgentLoopSuggestion[]> {
  const directory = input.directory.trim();
  if (!directory) {
    return [];
  }

  const suggestions: AgentLoopSuggestion[] = [];
  const agent = input.agent ?? "claude";
  const packageJson = await readJsonFile(join(directory, "package.json"));
  const hasCi = await pathExists(join(directory, ".github", "workflows"));
  const hasDocs = await pathExists(join(directory, "docs")) || await pathExists(join(directory, "README.md"));
  const hasDocker = await pathExists(join(directory, "Dockerfile")) || await pathExists(join(directory, "docker-compose.yml")) || await pathExists(join(directory, "docker-compose.yaml"));
  const hasGit = await pathExists(join(directory, ".git"));

  if (hasCi) {
    suggestions.push(buildSuggestion({
      key: "ci-watchdog",
      name: "CI Watchdog",
      description: "Wake on CI signals and keep the main branch healthy.",
      rationale: "Detected GitHub Actions workflow files.",
      directory,
      intervalMs: 10 * 60_000,
      agent,
      fileWatchEnabled: true,
      githubBridgeEnabled: true,
      ciBridgeEnabled: true,
      eventSourceAllowlist: ["github-webhook", "ci-webhook", "ci-workflow", "ci-check", "file-watch"],
      eventKeywordFilters: ["ci", "workflow", "test", "flake"],
      goal: "Keep CI healthy without waiting for manual checks.",
      currentFocus: "Watch workflow failures and triage the highest-signal breakages.",
      workingMemory: "Use event-triggered wakeups for failed workflow runs and preserve the active investigation path.",
      lastReflectionSummary: "Start by correlating recent CI failures with the latest code changes.",
      maxConsecutiveFailures: 3,
      retryBackoffMs: 5 * 60_000,
      prompt: "Continuously inspect CI outcomes, triage failures, correlate them with recent changes, and take the highest-value next maintenance action. Update loop memory before ending each run.",
      tags: ["ci", "quality", "autonomy"],
      confidence: "high",
    }, existingLoops));
  }

  if (packageJson) {
    const packageManager = typeof packageJson.packageManager === "string" ? packageJson.packageManager : undefined;
    suggestions.push(buildSuggestion({
      key: "dependency-hygiene",
      name: "Dependency Hygiene",
      description: "Track dependency drift, lockfile churn, and maintenance opportunities.",
      rationale: `Detected package.json${packageManager ? ` (${packageManager})` : ""}.`,
      directory,
      intervalMs: 24 * 60 * 60_000,
      agent,
      goal: "Keep dependencies healthy and reduce surprise breakage.",
      currentFocus: "Watch for risky dependency drift and recurring lockfile churn.",
      workingMemory: "Capture which packages are unstable, blocked upgrades, and test impact from previous updates.",
      lastReflectionSummary: "Start with the highest-risk or highest-churn dependency surfaces.",
      prompt: "Review package metadata, dependency churn, and recent maintenance signals. Identify the next dependency hygiene task worth doing, and keep the memory file updated with blockers and planned follow-ups.",
      tags: ["dependencies", "maintenance"],
      confidence: "medium",
    }, existingLoops));
  }

  if (hasDocs) {
    suggestions.push(buildSuggestion({
      key: "docs-drift",
      name: "Docs Drift",
      description: "Continuously detect documentation drift against the codebase.",
      rationale: "Detected repository docs surface (docs/ or README.md).",
      directory,
      intervalMs: 12 * 60 * 60_000,
      agent,
      goal: "Keep operator and contributor docs aligned with the real system.",
      currentFocus: "Find the highest-impact stale docs and usage guides.",
      workingMemory: "Track recurring stale areas, missing setup notes, and docs that block onboarding.",
      lastReflectionSummary: "Begin with recent code changes that likely invalidated docs.",
      prompt: "Inspect recent project changes and compare them to docs. Identify stale instructions, missing caveats, or high-value documentation updates, then update loop memory with what changed and what remains.",
      tags: ["docs", "quality"],
      confidence: "medium",
    }, existingLoops));
  }

  if (hasDocker) {
    suggestions.push(buildSuggestion({
      key: "runtime-smoke",
      name: "Runtime Smoke",
      description: "Watch deployment/runtime surfaces and prepare the next smoke validation step.",
      rationale: "Detected container/runtime descriptors.",
      directory,
      intervalMs: 6 * 60 * 60_000,
      agent,
      goal: "Maintain confidence that the packaged runtime still behaves as expected.",
      currentFocus: "Check the most failure-prone runtime surface first.",
      workingMemory: "Record unstable startup paths, missing env vars, and unresolved runtime regressions.",
      lastReflectionSummary: "Start from the last known runtime regression or risky infrastructure change.",
      maxConsecutiveFailures: 2,
      retryBackoffMs: 30 * 60_000,
      prompt: "Review container/runtime descriptors, recent infra changes, and smoke-test signals. Decide the next runtime validation or hardening action that reduces deployment risk, then update loop memory.",
      tags: ["runtime", "smoke", "deployment"],
      confidence: "medium",
    }, existingLoops));
  }

  const hasGoMod = await pathExists(join(directory, "go.mod"));
  if (hasGoMod) {
    suggestions.push(buildSuggestion({
      key: "go-module-steward",
      name: "Go Module Steward",
      description: "Track Go module hygiene, toolchain signals, and test/build regressions.",
      rationale: "Detected go.mod.",
      directory,
      intervalMs: 12 * 60 * 60_000,
      agent,
      fileWatchEnabled: true,
      goal: "Keep Go modules and local builds trustworthy over time.",
      currentFocus: "Surface the highest-risk module, test, or compatibility issue to address next.",
      workingMemory: "Note flaky packages, blocked upgrades, CGO or toolchain caveats worth revisiting.",
      lastReflectionSummary: "Start from recent go.sum or module graph churn if visible.",
      maxConsecutiveFailures: 3,
      retryBackoffMs: 15 * 60_000,
      prompt: "Review go.mod/go.sum (if present), tests, and recent changes. Identify the next Go-specific maintenance action (deps, build tags, race/data races, CI gaps) and update loop memory with concrete follow-ups.",
      tags: ["go", "modules", "maintenance"],
      confidence: "medium",
    }, existingLoops));
  }

  const hasCargoToml = await pathExists(join(directory, "Cargo.toml"));
  if (hasCargoToml) {
    suggestions.push(buildSuggestion({
      key: "rust-crate-health",
      name: "Rust Crate Health",
      description: "Watch Cargo workspace health, dependency advisories, and build/test signals.",
      rationale: "Detected Cargo.toml.",
      directory,
      intervalMs: 12 * 60 * 60_000,
      agent,
      fileWatchEnabled: true,
      goal: "Keep Rust builds and dependencies in good shape.",
      currentFocus: "Prioritize warnings, outdated crates, or failing test clusters.",
      workingMemory: "Track recurring rustc/clippy findings and blocked crate upgrades.",
      lastReflectionSummary: "Begin from the noisiest warning class or last failed check.",
      maxConsecutiveFailures: 3,
      retryBackoffMs: 15 * 60_000,
      prompt: "Inspect Cargo.toml/workspace layout, clippy/test signals if inferable from the tree, and recent changes. Propose the single best next Rust maintenance step and capture it in loop memory.",
      tags: ["rust", "cargo", "quality"],
      confidence: "medium",
    }, existingLoops));
  }

  const hasPythonRoot =
    (await pathExists(join(directory, "pyproject.toml"))) ||
    (await pathExists(join(directory, "requirements.txt"))) ||
    (await pathExists(join(directory, "setup.py"))) ||
    (await pathExists(join(directory, "Pipfile")));
  if (hasPythonRoot) {
    suggestions.push(buildSuggestion({
      key: "python-packaging",
      name: "Python Packaging",
      description: "Track Python env and packaging drift (deps, pins, tooling).",
      rationale: "Detected pyproject.toml, requirements.txt, setup.py, or Pipfile.",
      directory,
      intervalMs: 24 * 60 * 60_000,
      agent,
      goal: "Reduce surprise breakage from Python dependency and tooling drift.",
      currentFocus: "Find the next high-value packaging or env hygiene task.",
      workingMemory: "Record interpreter constraints, known broken pins, and test gaps.",
      lastReflectionSummary: "Start from lockfile or dependency file churn if present.",
      prompt: "Review Python packaging files and project layout. Identify outdated pins, missing bounds, or tooling gaps; propose one concrete next step and update loop memory.",
      tags: ["python", "dependencies", "packaging"],
      confidence: "medium",
    }, existingLoops));
  }

  const hasJvmBuild =
    (await pathExists(join(directory, "pom.xml"))) ||
    (await pathExists(join(directory, "build.gradle"))) ||
    (await pathExists(join(directory, "build.gradle.kts"))) ||
    (await pathExists(join(directory, "settings.gradle"))) ||
    (await pathExists(join(directory, "settings.gradle.kts")));
  if (hasJvmBuild) {
    suggestions.push(buildSuggestion({
      key: "jvm-build-hygiene",
      name: "JVM Build Hygiene",
      description: "Watch Gradle/Maven build health and dependency churn.",
      rationale: "Detected Maven or Gradle project markers.",
      directory,
      intervalMs: 12 * 60 * 60_000,
      agent,
      fileWatchEnabled: true,
      goal: "Keep JVM builds reproducible and dependency graphs understandable.",
      currentFocus: "Surface failing tasks, slow configurations, or risky dependency bumps.",
      workingMemory: "Track flaky plugins, JDK/toolchain notes, and blocked upgrades.",
      lastReflectionSummary: "Start from the last build failure class or lockfile churn.",
      maxConsecutiveFailures: 3,
      retryBackoffMs: 20 * 60_000,
      prompt: "Review Gradle/Maven files and typical build outputs if inferable. Choose the next JVM build or dependency hygiene action and record outcomes in loop memory.",
      tags: ["jvm", "gradle", "maven"],
      confidence: "medium",
    }, existingLoops));
  }

  const hasTerraform =
    (await pathExists(join(directory, "main.tf"))) ||
    (await pathExists(join(directory, "terraform", "main.tf")));
  if (hasTerraform) {
    suggestions.push(buildSuggestion({
      key: "terraform-watch",
      name: "Terraform Watch",
      description: "Track infrastructure-as-code drift and plan/apply hygiene.",
      rationale: "Detected Terraform root module (main.tf).",
      directory,
      intervalMs: 24 * 60 * 60_000,
      agent,
      goal: "Keep Terraform modules consistent with intent and safer to change.",
      currentFocus: "Identify drift, state risks, or module coupling worth fixing next.",
      workingMemory: "Note sensitive resources, manual changes, and recurring plan noise.",
      lastReflectionSummary: "Start from recent .tf changes or obvious module smell.",
      prompt: "Scan .tf files for obvious drift, hard-coded secrets smell, or module structure issues. Propose one high-leverage next step for IaC hygiene and update loop memory.",
      tags: ["terraform", "iac", "infra"],
      confidence: "medium",
    }, existingLoops));
  }

  const hasSwiftPm = await pathExists(join(directory, "Package.swift"));
  if (hasSwiftPm) {
    suggestions.push(buildSuggestion({
      key: "swift-package-health",
      name: "Swift Package Health",
      description: "Watch SwiftPM package metadata, targets, and dependency health.",
      rationale: "Detected Package.swift.",
      directory,
      intervalMs: 12 * 60 * 60_000,
      agent,
      fileWatchEnabled: true,
      goal: "Keep Swift packages buildable and dependencies sane.",
      currentFocus: "Surface the next SwiftPM or platform compatibility issue to tackle.",
      workingMemory: "Track platform matrix gaps and blocked package updates.",
      lastReflectionSummary: "Start from manifest or dependency churn.",
      prompt: "Review Package.swift and package layout. Identify the next Swift-specific maintenance action and capture follow-ups in loop memory.",
      tags: ["swift", "spm", "apple"],
      confidence: "medium",
    }, existingLoops));
  }

  const hasMakefile =
    (await pathExists(join(directory, "Makefile"))) ||
    (await pathExists(join(directory, "makefile")));
  if (hasMakefile) {
    suggestions.push(buildSuggestion({
      key: "makefile-pipeline",
      name: "Makefile Pipeline",
      description: "Keep Make-based workflows documented and reliable.",
      rationale: "Detected Makefile.",
      directory,
      intervalMs: 24 * 60 * 60_000,
      agent,
      goal: "Reduce breakage from opaque or stale Make targets.",
      currentFocus: "Find fragile targets, missing PHONY hygiene, or undocumented flows.",
      workingMemory: "Record commonly broken targets and env prerequisites.",
      lastReflectionSummary: "Start from targets that CI or contributors rely on most.",
      prompt: "Read the Makefile(s) and infer primary developer workflows. Propose one improvement (docs, target safety, composability) and update loop memory.",
      tags: ["make", "build", "tooling"],
      confidence: "medium",
    }, existingLoops));
  }

  const hasGemfile = await pathExists(join(directory, "Gemfile"));
  if (hasGemfile) {
    suggestions.push(buildSuggestion({
      key: "ruby-bundle-steward",
      name: "Ruby Bundle Steward",
      description: "Track Ruby/Bundler dependency and gem hygiene.",
      rationale: "Detected Gemfile.",
      directory,
      intervalMs: 24 * 60 * 60_000,
      agent,
      goal: "Keep Ruby dependencies and bundle installs predictable.",
      currentFocus: "Surface risky gem upgrades, native extension pain, or CI bundle drift.",
      workingMemory: "Record blocked gems, Ruby version constraints, and recurring bundle errors.",
      lastReflectionSummary: "Start from Gemfile.lock churn or security-advisory surfaces if visible.",
      prompt: "Review Gemfile/Gemfile.lock if present and typical Ruby project layout. Propose the next Ruby-specific maintenance action and update loop memory.",
      tags: ["ruby", "bundler", "gems"],
      confidence: "medium",
    }, existingLoops));
  }

  const hasDotNetProject =
    (await rootHasFileEndingWith(directory, ".sln")) ||
    (await rootHasFileEndingWith(directory, ".csproj"));
  if (hasDotNetProject) {
    suggestions.push(buildSuggestion({
      key: "dotnet-build-health",
      name: ".NET Build Health",
      description: "Watch .NET solution/project build health and package drift.",
      rationale: "Detected .sln or .csproj in repository root.",
      directory,
      intervalMs: 12 * 60 * 60_000,
      agent,
      fileWatchEnabled: true,
      goal: "Keep .NET builds green and dependencies understandable.",
      currentFocus: "Prioritize failing targets, TFMs, or NuGet/package noise.",
      workingMemory: "Track flaky tests, analyzer warnings worth fixing, and blocked upgrades.",
      lastReflectionSummary: "Start from the last build/test failure class.",
      maxConsecutiveFailures: 3,
      retryBackoffMs: 20 * 60_000,
      prompt: "Inspect .sln/.csproj and project structure. Choose the next .NET maintenance or build-hygiene step and record it in loop memory.",
      tags: ["dotnet", "csharp", "nuget"],
      confidence: "medium",
    }, existingLoops));
  }

  if (await pubspecLooksLikeFlutter(directory)) {
    suggestions.push(buildSuggestion({
      key: "flutter-app-health",
      name: "Flutter App Health",
      description: "Watch Flutter/Dart pubspec, platforms, and dependency health.",
      rationale: "Detected pubspec.yaml with Flutter SDK.",
      directory,
      intervalMs: 12 * 60 * 60_000,
      agent,
      fileWatchEnabled: true,
      goal: "Keep Flutter apps buildable across target platforms.",
      currentFocus: "Surface the next dependency, embedding, or platform-matrix issue.",
      workingMemory: "Track plugin breakage, iOS/Android build caveats, and blocked pub upgrades.",
      lastReflectionSummary: "Start from pubspec or platform folder churn.",
      prompt: "Review pubspec.yaml and lib/ layout. Propose the next Flutter-specific maintenance action and update loop memory.",
      tags: ["flutter", "dart", "mobile"],
      confidence: "medium",
    }, existingLoops));
  }

  if (await hasHelmChart(directory)) {
    suggestions.push(buildSuggestion({
      key: "helm-chart-watch",
      name: "Helm Chart Watch",
      description: "Track Helm chart templates, values, and release hygiene.",
      rationale: "Detected Chart.yaml (chart root, chart/, helm/, or charts/*).",
      directory,
      intervalMs: 24 * 60 * 60_000,
      agent,
      goal: "Keep Helm charts safe to upgrade and consistent with cluster reality.",
      currentFocus: "Find values drift, risky defaults, or chart coupling to fix next.",
      workingMemory: "Note manual overrides, sensitive values patterns, and recurring upgrade pain.",
      lastReflectionSummary: "Start from Chart.yaml or values.yaml changes.",
      prompt: "Review Chart.yaml, templates/, and values files. Propose one Helm-specific improvement and update loop memory.",
      tags: ["helm", "kubernetes", "charts"],
      confidence: "medium",
    }, existingLoops));
  }

  const uniappLikely =
    packageRefsUniApp(packageJson) ||
    ((await pathExists(join(directory, "pages.json"))) &&
      (await pathExists(join(directory, "manifest.json"))));
  if (uniappLikely) {
    suggestions.push(buildSuggestion({
      key: "uniapp-hybrid",
      name: "Uni-app Hybrid",
      description: "Maintain uni-app / Vue hybrid builds across H5, mini-program, and app targets.",
      rationale: "Detected DCloud uni-app markers (pages.json+manifest.json or @dcloudio/* deps).",
      directory,
      intervalMs: 12 * 60 * 60_000,
      agent,
      fileWatchEnabled: true,
      goal: "Reduce breakage across uni-app multi-end builds and native capabilities.",
      currentFocus: "Surface manifest/pages config drift, conditional compilation, or platform SDK issues.",
      workingMemory: "Track problematic pages, native module gaps, and build toolchain quirks per target.",
      lastReflectionSummary: "Start from manifest or pages.json churn.",
      maxConsecutiveFailures: 3,
      retryBackoffMs: 15 * 60_000,
      prompt: "Review pages.json, manifest.json, and uni-app entry layout. Propose the next cross-platform or build-pipeline fix and update loop memory.",
      tags: ["uni-app", "vue", "china-ecosystem", "mobile"],
      confidence: "medium",
    }, existingLoops));
  }

  if (packageRefsTaro(packageJson)) {
    suggestions.push(buildSuggestion({
      key: "taro-cross-end",
      name: "Taro Cross-end",
      description: "Maintain Taro multi-end (WeChat, H5, RN) build and config hygiene.",
      rationale: "Detected @tarojs/taro in package.json.",
      directory,
      intervalMs: 12 * 60 * 60_000,
      agent,
      fileWatchEnabled: true,
      githubBridgeEnabled: true,
      goal: "Keep Taro configs and shared UI stable across targets.",
      currentFocus: "Find config/index drift, adapter issues, or build-target regressions.",
      workingMemory: "Record target-specific hacks, plugin limits, and env differences.",
      lastReflectionSummary: "Start from config or package version churn.",
      maxConsecutiveFailures: 3,
      retryBackoffMs: 15 * 60_000,
      prompt: "Review Taro config and src structure. Propose the next Taro-specific maintenance step and update loop memory.",
      tags: ["taro", "mini-program", "china-ecosystem", "react"],
      confidence: "medium",
    }, existingLoops));
  }

  if (packageRefsUmi(packageJson)) {
    suggestions.push(buildSuggestion({
      key: "umi-framework-steward",
      name: "Umi Framework Steward",
      description: "Maintain Umi / Umi Max routes, plugins, and build config hygiene.",
      rationale: "Detected umi or @umijs/* in package.json.",
      directory,
      intervalMs: 12 * 60 * 60_000,
      agent,
      fileWatchEnabled: true,
      goal: "Keep Umi-based SPAs and admin shells maintainable across upgrades.",
      currentFocus: "Surface config drift, plugin conflicts, or route/layout regressions.",
      workingMemory: "Track custom plugins, locale/i18n edges, and blocked major bumps.",
      lastReflectionSummary: "Start from .umirc or config churn.",
      maxConsecutiveFailures: 3,
      retryBackoffMs: 15 * 60_000,
      prompt: "Review Umi config (.umirc.*, config/config.ts), routes, and plugins. Propose the next Umi-specific maintenance step and update loop memory.",
      tags: ["umi", "china-ecosystem", "react", "spa"],
      confidence: "medium",
    }, existingLoops));
  }

  const hasWeChatMpConfig = await pathExists(join(directory, "project.config.json"));
  if (hasWeChatMpConfig && !uniappLikely && !packageRefsTaro(packageJson)) {
    suggestions.push(buildSuggestion({
      key: "wechat-miniprogram",
      name: "WeChat Mini Program",
      description: "Watch WeChat mini-program project config, pages, and API usage hygiene.",
      rationale: "Detected project.config.json without uni-app/Taro markers (native MP workspace).",
      directory,
      intervalMs: 12 * 60 * 60_000,
      agent,
      fileWatchEnabled: true,
      goal: "Keep native WeChat MP projects maintainable and policy-compliant.",
      currentFocus: "Surface app.json/pages drift, deprecated APIs, or upload/build pipeline issues.",
      workingMemory: "Track plugin usage, cloud calls, and review-blocker patterns.",
      lastReflectionSummary: "Start from project.config.json or app.json changes.",
      prompt: "Review project.config.json, app.json, and mini-program source layout. Propose the next MP-specific improvement and update loop memory.",
      tags: ["wechat", "mini-program", "china-ecosystem"],
      confidence: "medium",
    }, existingLoops));
  }

  if (!uniappLikely) {
    const hasVueConfig =
      (await pathExists(join(directory, "vue.config.js"))) ||
      (await pathExists(join(directory, "vue.config.ts"))) ||
      (await pathExists(join(directory, "vue.config.cjs"))) ||
      (await pathExists(join(directory, "vue.config.mjs")));
    const hasNuxtConfig =
      (await pathExists(join(directory, "nuxt.config.ts"))) ||
      (await pathExists(join(directory, "nuxt.config.js"))) ||
      (await pathExists(join(directory, "nuxt.config.mjs")));
    const hasQuasarConfig =
      (await pathExists(join(directory, "quasar.config.js"))) ||
      (await pathExists(join(directory, "quasar.config.ts"))) ||
      (await pathExists(join(directory, "quasar.config.cjs")));
    const hasViteConfig =
      (await pathExists(join(directory, "vite.config.ts"))) ||
      (await pathExists(join(directory, "vite.config.js"))) ||
      (await pathExists(join(directory, "vite.config.mjs"))) ||
      (await pathExists(join(directory, "vite.config.cts")));
    const deps = mergedDependencies(packageJson);
    const viteWithVue =
      hasViteConfig &&
      Boolean(deps.vue && (deps.vite || deps["@vitejs/plugin-vue"]));
    const vueStackLikely =
      hasVueConfig ||
      hasNuxtConfig ||
      hasQuasarConfig ||
      viteWithVue ||
      packageRefsVue(packageJson);
    if (vueStackLikely) {
      suggestions.push(buildSuggestion({
        key: "vue-frontend-steward",
        name: "Vue Frontend Steward",
        description: "Maintain Vue / Nuxt / Quasar / Vite+Vue SPA hygiene and build pipeline.",
        rationale: "Detected vue.config*, nuxt.config*, quasar.config*, Vite+Vue, or vue/nuxt deps.",
        directory,
        intervalMs: 12 * 60 * 60_000,
        agent,
        fileWatchEnabled: true,
        goal: "Keep Vue-family frontends buildable and dependency graphs sane.",
        currentFocus: "Surface the next router, build, or browser-target issue worth fixing.",
        workingMemory: "Track flaky dev server issues, env modes, and blocked major upgrades.",
        lastReflectionSummary: "Start from config file or lockfile churn.",
        maxConsecutiveFailures: 3,
        retryBackoffMs: 15 * 60_000,
        prompt: "Review Vue/Nuxt/Vite/Quasar configs and src structure. Propose the next frontend maintenance action and update loop memory.",
        tags: ["vue", "nuxt", "vite", "frontend"],
        confidence: "medium",
      }, existingLoops));
    }
  }

  if (hasGit) {
    suggestions.push(buildSuggestion({
      key: "project-guardian",
      name: "Project Guardian",
      description: "Maintain a broad project-health watchtower loop.",
      rationale: "Detected a Git repository; this is a generic health-maintenance baseline.",
      directory,
      intervalMs: 4 * 60 * 60_000,
      agent,
      fileWatchEnabled: true,
      githubBridgeEnabled: true,
      ciBridgeEnabled: true,
      eventSourceAllowlist: ["github-webhook", "ci-webhook", "ci-workflow", "ci-check", "file-watch"],
      goal: "Maintain overall project health proactively.",
      currentFocus: "Scan for the highest-leverage issue across CI, docs, and maintenance.",
      workingMemory: "Track cross-cutting risks, recurring friction, and opportunities worth revisiting later.",
      lastReflectionSummary: "Start with the single most leveraged maintenance frontier.",
      maxConsecutiveFailures: 3,
      retryBackoffMs: 10 * 60_000,
      prompt: "Act as a broad project-health guardian: scan the repo, maintenance surfaces, CI signals, and docs drift, then take or propose the single best next action. Keep your memory current for the next wakeup.",
      tags: ["guardian", "health", "autonomy"],
      confidence: hasCi ? "medium" : "high",
    }, existingLoops));
  }

  return suggestions.sort((a, b) => {
    if (a.alreadyConfigured !== b.alreadyConfigured) {
      return a.alreadyConfigured ? 1 : -1;
    }
    const confidenceOrder = { high: 0, medium: 1 } as const;
    const byConfidence = confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    if (byConfidence !== 0) {
      return byConfidence;
    }
    return a.name.localeCompare(b.name);
  });
}

export function suggestionToCreateInput(
  suggestion: AgentLoopSuggestion,
  overrides: Pick<AgentLoopCreateInput, "projectId" | "profileId" | "runNow"> = {},
): AgentLoopCreateInput {
  return {
    name: suggestion.name,
    prompt: suggestion.prompt,
    directory: suggestion.directory,
    intervalMs: suggestion.intervalMs,
    agent: suggestion.agent,
    fileWatchEnabled: suggestion.fileWatchEnabled,
    githubBridgeEnabled: suggestion.githubBridgeEnabled,
    goal: suggestion.goal,
    currentFocus: suggestion.currentFocus,
    maxConsecutiveFailures: suggestion.maxConsecutiveFailures,
    retryBackoffMs: suggestion.retryBackoffMs,
    workingMemory: suggestion.workingMemory,
    lastReflectionSummary: suggestion.lastReflectionSummary,
    projectId: overrides.projectId,
    profileId: overrides.profileId,
    runNow: overrides.runNow,
  };
}
