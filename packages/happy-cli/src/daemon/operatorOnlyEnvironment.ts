export const OPERATOR_ONLY_ENV_VARS = new Set([
  // Anthropic
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  // OpenAI / Codex
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  // Google / Gemini
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  // Other providers
  "TOGETHER_API_KEY",
  "CODEX_HOME",
  // OAuth
  "CLAUDE_CODE_OAUTH_TOKEN",
  // Server internals that must never leak
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "GITHUB_CLIENT_SECRET",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
]);
