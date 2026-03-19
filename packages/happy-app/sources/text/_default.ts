/**
 * English translations for the Happy app
 * Values can be:
 * - String constants for static text
 * - Functions with typed object parameters for dynamic text
 */

/**
 * English plural helper function
 * @param options - Object containing count, singular, and plural forms
 * @returns The appropriate form based on count
 */
function plural({
  count,
  singular,
  plural,
}: {
  count: number;
  singular: string;
  plural: string;
}): string {
  return count === 1 ? singular : plural;
}

export const en = {
  tabs: {
    // Tab navigation labels
    inbox: "Inbox",
    sessions: "Terminals",
    project: "Project",
    openclaw: "OpenClaw",
    settings: "Settings",
  },

  inbox: {
    // Inbox screen
    emptyTitle: "Empty Inbox",
    emptyDescription: "Connect with friends to start sharing sessions",
    updates: "Updates",
  },

  common: {
    // Simple string constants
    cancel: "Cancel",
    authenticate: "Authenticate",
    save: "Save",
    saveAs: "Save As",
    error: "Error",
    success: "Success",
    ok: "OK",
    continue: "Continue",
    back: "Back",
    create: "Create",
    rename: "Rename",
    reset: "Reset",
    logout: "Logout",
    yes: "Yes",
    no: "No",
    discard: "Discard",
    version: "Version",
    copied: "Copied",
    copy: "Copy",
    submit: "Submit",
    scanning: "Scanning...",
    urlPlaceholder: "https://example.com",
    home: "Home",
    message: "Message",
    files: "Files",
    fileViewer: "File Viewer",
    loading: "Loading...",
    retry: "Retry",
    delete: "Delete",
    optional: "optional",
  },

  profile: {
    userProfile: "User Profile",
    details: "Details",
    firstName: "First Name",
    lastName: "Last Name",
    username: "Username",
    status: "Status",
  },

  status: {
    connected: "connected",
    connecting: "connecting",
    disconnected: "disconnected",
    error: "error",
    online: "online",
    offline: "offline",
    lastSeen: ({ time }: { time: string }) => `last seen ${time}`,
    permissionRequired: "permission required",
    needsAttention: "waiting for you",
    apiRetry: ({
      attempt,
      maxRetries,
    }: {
      attempt: number;
      maxRetries: number;
    }) => `retrying API (${attempt}/${maxRetries})…`,
    activeNow: "Active now",
    unknown: "unknown",
  },

  time: {
    justNow: "just now",
    minutesAgo: ({ count }: { count: number }) =>
      `${count} minute${count !== 1 ? "s" : ""} ago`,
    hoursAgo: ({ count }: { count: number }) =>
      `${count} hour${count !== 1 ? "s" : ""} ago`,
  },

  connect: {
    restoreAccount: "Restore Account",
    enterSecretKey: "Please enter a secret key",
    invalidSecretKey: "Invalid secret key. Please check and try again.",
    enterUrlManually: "Enter URL manually",
  },

  settings: {
    title: "Settings",
    connectedAccounts: "Connected Accounts",
    connectAccount: "Connect account",
    github: "GitHub",
    machines: "Machines",
    features: "Features",
    social: "Social",
    account: "Account",
    accountSubtitle: "Manage your account details",
    appearance: "Appearance",
    appearanceSubtitle: "Customize how the app looks",
    voiceAssistant: "Voice Assistant",
    voiceAssistantSubtitle: "Configure voice interaction preferences",
    featuresTitle: "Features",
    featuresSubtitle: "Enable or disable app features",
    developer: "Developer",
    developerTools: "Developer Tools",
    about: "About",
    aboutFooter:
      "Happy Coder is a Codex and Claude Code mobile client. It's fully end-to-end encrypted and your account is stored only on your device. Not affiliated with Anthropic.",
    whatsNew: "What's New",
    whatsNewSubtitle: "See the latest updates and improvements",
    reportIssue: "Report an Issue",
    privacyPolicy: "Privacy Policy",
    termsOfService: "Terms of Service",
    eula: "EULA",
    supportUs: "Support us",
    supportUsSubtitlePro: "Thank you for your support!",
    supportUsSubtitle: "Support project development",
    scanQrCodeToAuthenticate: "Scan QR code to authenticate",
    githubConnected: ({ login }: { login: string }) => `Connected as @${login}`,
    connectGithubAccount: "Connect your GitHub account",
    claudeAuthSuccess: "Successfully connected to Claude",
    exchangingTokens: "Exchanging tokens...",
    usage: "Usage",
    usageSubtitle: "View your API usage and costs",
    profiles: "Profiles",
    profilesSubtitle: "Manage environment variable profiles for sessions",
    gitHosts: "Git Hosts",
    gitHostsSubtitle: "Configure Git host provider mappings",

    // Dynamic settings messages
    accountConnected: ({ service }: { service: string }) =>
      `${service} account connected`,
    machineStatus: ({
      name,
      status,
    }: {
      name: string;
      status: "online" | "offline";
    }) => `${name} is ${status}`,
    featureToggled: ({
      feature,
      enabled,
    }: {
      feature: string;
      enabled: boolean;
    }) => `${feature} ${enabled ? "enabled" : "disabled"}`,
  },

  settingsAppearance: {
    // Appearance settings screen
    theme: "Theme",
    themeDescription: "Choose your preferred color scheme",
    themeOptions: {
      adaptive: "Adaptive",
      light: "Light",
      dark: "Dark",
    },
    themeDescriptions: {
      adaptive: "Match system settings",
      light: "Always use light theme",
      dark: "Always use dark theme",
    },
    display: "Display",
    displayDescription: "Control layout and spacing",
    inlineToolCalls: "Inline Tool Calls",
    inlineToolCallsDescription: "Show main agent tool calls in chat",
    expandTodoLists: "Expand Todo Lists",
    expandTodoListsDescription: "Show all todos instead of just changes",
    expandToolDetails: "Expand Tool Details",
    expandToolDetailsDescription: "Expand sub-agent tool lists by default",
    showLineNumbersInDiffs: "Show Line Numbers in Diffs",
    showLineNumbersInDiffsDescription: "Display line numbers in code diffs",
    showLineNumbersInToolViews: "Show Line Numbers in Tool Views",
    showLineNumbersInToolViewsDescription:
      "Display line numbers in tool view diffs",
    wrapLinesInDiffs: "Wrap Lines in Diffs",
    wrapLinesInDiffsDescription:
      "Wrap long lines instead of horizontal scrolling in diff views",
    alwaysShowContextSize: "Always Show Context Size",
    alwaysShowContextSizeDescription:
      "Display context usage even when not near limit",
    avatarStyle: "Avatar Style",
    avatarStyleDescription: "Choose session avatar appearance",
    avatarOptions: {
      pixelated: "Pixelated",
      gradient: "Gradient",
      brutalist: "Brutalist",
    },
    showFlavorIcons: "Show AI Provider Icons",
    showFlavorIconsDescription: "Display AI provider icons on session avatars",
    compactSessionView: "Compact Session View",
    compactSessionViewDescription:
      "Show active sessions in a more compact layout",
    collapsibleInput: "Collapsible Input",
    collapsibleInputDescription:
      "Auto-collapse the input box when a session has messages",
    realtimeSessionSort: "Real-Time Session Sorting",
    realtimeSessionSortDescription:
      "Sort sessions by recent activity (disable for stable order by creation time)",
  },

  settingsFeatures: {
    // Features settings screen
    experiments: "Experiments",
    experimentsDescription:
      "Enable experimental features that are still in development. These features may be unstable or change without notice.",
    experimentalFeatures: "Experimental Features",
    experimentalFeaturesEnabled: "Experimental features enabled",
    experimentalFeaturesDisabled: "Using stable features only",
    webFeatures: "Web Features",
    webFeaturesDescription:
      "Features available only in the web version of the app.",
    enterToSend: "Enter to Send",
    enterToSendEnabled: "Press Enter to send (Shift+Enter for a new line)",
    enterToSendDisabled: "Enter inserts a new line",
    commandPalette: "Command Palette",
    commandPaletteEnabled: "Press ⌘K to open",
    commandPaletteDisabled: "Quick command access disabled",
    markdownCopyV2: "Markdown Copy v2",
    markdownCopyV2Subtitle: "Long press opens copy modal",
    hideInactiveSessions: "Hide inactive sessions",
    hideInactiveSessionsSubtitle: "Show only active chats in your list",
    enhancedSessionWizard: "Enhanced Session Wizard",
    enhancedSessionWizardEnabled: "Profile-first session launcher active",
    enhancedSessionWizardDisabled: "Using standard session launcher",
    showAgentActivity: "Agent Activity",
    showAgentActivityEnabled: "Show real-time agent activity in chat",
    showAgentActivityDisabled: "Agent activity details hidden",
    sttCorrection: "Voice Transcript Correction",
    sttCorrectionEnabled: "AI corrects speech recognition errors",
    sttCorrectionDisabled: "Using raw speech recognition output",
    showProjectTab: "Project Tab",
    showProjectTabSubtitle: "Show project (kanban) tab in the tab bar",
    webNotifications: "Browser Notifications",
    webNotificationsEnabled: "Notify when tasks complete or need approval",
    webNotificationsDisabled: "No browser notifications",
    webNotificationsDenied: "Blocked by browser — enable in site settings",
    webNotificationsPersistent: "Pin Notifications",
    webNotificationsPersistentEnabled: "Notifications stay until dismissed",
    webNotificationsPersistentDisabled: "Notifications auto-close after 5s",
  },

  errors: {
    networkError: "Network error occurred",
    serverError: "Server error occurred",
    unknownError: "An unknown error occurred",
    connectionTimeout: "Connection timed out",
    authenticationFailed: "Authentication failed",
    permissionDenied: "Permission denied",
    fileNotFound: "File not found",
    invalidFormat: "Invalid format",
    operationFailed: "Operation failed",
    tryAgain: "Please try again",
    contactSupport: "Contact support if the problem persists",
    sessionNotFound: "Session not found",
    voiceSessionFailed: "Failed to start voice session",
    voiceServiceUnavailable: "Voice service is temporarily unavailable",
    oauthInitializationFailed: "Failed to initialize OAuth flow",
    tokenStorageFailed: "Failed to store authentication tokens",
    oauthStateMismatch: "Security validation failed. Please try again",
    tokenExchangeFailed: "Failed to exchange authorization code",
    oauthAuthorizationDenied: "Authorization was denied",
    webViewLoadFailed: "Failed to load authentication page",
    failedToLoadProfile: "Failed to load user profile",
    userNotFound: "User not found",
    sessionDeleted: "Session has been deleted",
    sessionDeletedDescription: "This session has been permanently removed",

    // Error functions with context
    fieldError: ({ field, reason }: { field: string; reason: string }) =>
      `${field}: ${reason}`,
    validationError: ({
      field,
      min,
      max,
    }: {
      field: string;
      min: number;
      max: number;
    }) => `${field} must be between ${min} and ${max}`,
    retryIn: ({ seconds }: { seconds: number }) =>
      `Retry in ${seconds} ${seconds === 1 ? "second" : "seconds"}`,
    errorWithCode: ({
      message,
      code,
    }: {
      message: string;
      code: number | string;
    }) => `${message} (Error ${code})`,
    disconnectServiceFailed: ({ service }: { service: string }) =>
      `Failed to disconnect ${service}`,
    connectServiceFailed: ({ service }: { service: string }) =>
      `Failed to connect ${service}. Please try again.`,
    failedToLoadFriends: "Failed to load friends list",
    failedToAcceptRequest: "Failed to accept friend request",
    failedToRejectRequest: "Failed to reject friend request",
    failedToRemoveFriend: "Failed to remove friend",
    searchFailed: "Search failed. Please try again.",
    failedToSendRequest: "Failed to send friend request",
  },

  newSession: {
    // Used by new-session screen and launch flows
    title: "Start New Session",
    noMachinesFound:
      "No machines found. Start a Happy session on your computer first.",
    allMachinesOffline: "All machines appear offline",
    machineDetails: "View machine details →",
    directoryDoesNotExist: "Directory Not Found",
    createDirectoryConfirm: ({ directory }: { directory: string }) =>
      `The directory ${directory} does not exist. Do you want to create it?`,
    sessionStarted: "Session Started",
    sessionStartedMessage: "The session has been started successfully.",
    sessionSpawningFailed: "Session spawning failed - no session ID returned.",
    startingSession: "Starting session...",
    startNewSessionInFolder: "New session here",
    failedToStart:
      "Failed to start session. Make sure the daemon is running on the target machine.",
    sessionTimeout:
      "Session startup timed out. The machine may be slow or the daemon may not be responding.",
    notConnectedToServer:
      "Not connected to server. Check your internet connection.",
    noMachineSelected: "Please select a machine to start the session",
    noPathSelected: "Please select a directory to start the session in",
    profileConfigEmpty: ({ name }: { name: string }) =>
      `Profile "${name}" has no environment variables configured. Please edit the profile and add the required environment variables.`,
    sessionType: {
      title: "Session Type",
      simple: "Simple",
      worktree: "Worktree",
      comingSoon: "Coming soon",
    },
    worktree: {
      creating: ({ name }: { name: string }) =>
        `Creating worktree '${name}'...`,
      notGitRepo: "Worktrees require a git repository",
      failed: ({ error }: { error: string }) =>
        `Failed to create worktree: ${error}`,
      success: "Worktree created successfully",
    },
    gitRepos: {
      title: "Git Repositories",
      showingCount: ({ showing, total }: { showing: number; total: number }) =>
        `Showing ${showing} of ${total} repos`,
    },
  },

  sessionHistory: {
    // Used by session history screen
    title: "Session History",
    empty: "No sessions found",
    today: "Today",
    yesterday: "Yesterday",
    daysAgo: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? "day" : "days"} ago`,
    viewAll: "View all sessions",
  },

  session: {
    inputPlaceholder: "Type a message ...",
    startedByDaemon: "daemon",
    sentImage: "Sent an image",
    sentImages: ({ count }: { count: number }) => `Sent ${count} images`,
    imageAttached: "Image attached",
    imageLabel: ({ index }: { index: number }) => `Image ${index}`,
    imageUploadFailed: ({ failed, total }: { failed: number; total: number }) =>
      `${failed} of ${total} images failed to upload`,
    couldNotAttachFile: "Could not attach this file",
    imageLoadFailed: "Failed to load image",
    bookmarkOption: "Bookmark",
    appendToInput: "Edit in input",
    messageQueued: "Queued",
    cancelQueued: "Cancel",
  },

  bookmark: {
    sourceAI: "AI",
    sourceUser: "Me",
  },

  commandPalette: {
    placeholder: "Type a command or search...",
  },

  server: {
    // Used by Server Configuration screen (app/(app)/server.tsx)
    serverConfiguration: "Server Configuration",
    enterServerUrl: "Please enter a server URL",
    notValidHappyServer: "Not a valid Happy Server",
    changeServer: "Change Server",
    continueWithServer: "Continue with this server?",
    resetToDefault: "Reset to Default",
    resetServerDefault: "Reset server to default?",
    validating: "Validating...",
    validatingServer: "Validating server...",
    serverReturnedError: "Server returned an error",
    failedToConnectToServer: "Failed to connect to server",
    currentlyUsingCustomServer: "Currently using custom server",
    customServerUrlLabel: "Custom Server URL",
    advancedFeatureFooter:
      "This is an advanced feature. Only change the server if you know what you're doing. You will need to log out and log in again after changing servers.",
  },

  worktreeInfo: {
    title: "Worktree",
    branch: "Branch",
    parentBranch: "Parent Branch",
    status: "Status",
    errorLabel: "Error",
    state: {
      creating: "Creating",
      active: "Active",
      merging: "Merging",
      merged: "Merged",
      cleaning: "Cleaning",
      cleaned: "Cleaned",
      error: "Error",
    },
    merge: {
      title: "Merge Strategy",
      preview: "Merge Preview",
      description: ({ parentBranch }: { parentBranch: string }) =>
        `How do you want to merge into ${parentBranch}?`,
      action: "Merge",
      createPr: "Create Pull Request",
      directMerge: "Direct Merge",
      openPr: "Open PR",
      keepBranch: "Keep Branch",
      deleteBranch: "Delete Branch",
      filesChanged: "file(s) changed",
      commits: ({ count }: { count: number }) => `Commits (${count})`,
      noCommits: "No commits to merge",
      prSuccess: ({ url }: { url: string }) => `PR created: ${url}`,
      directSuccess: "Merged successfully",
      directSuccessDeleteBranch: ({ branchName }: { branchName: string }) =>
        `Merged successfully. Delete branch '${branchName}'?`,
      failed: ({ error }: { error: string }) => `Merge failed: ${error}`,
    },
    cleanup: {
      title: "Remove Worktree",
      action: "Remove Worktree",
      confirm: "Remove this worktree and its branch?",
      notMerged:
        "This worktree has not been merged yet. Removing it may lose changes. Continue?",
      remove: "Remove",
      success: "Worktree removed",
      successAndArchived: "Worktree removed and session archived",
      failed: ({ error }: { error: string }) =>
        `Failed to remove worktree: ${error}`,
    },
  },

  sessionInfo: {
    // Used by Session Info screen (app/(app)/session/[id]/info.tsx)
    killSession: "Kill Session",
    killSessionConfirm: "Are you sure you want to terminate this session?",
    archiveSession: "Archive Session",
    archiveSessionConfirm: "Are you sure you want to archive this session?",
    happySessionIdCopied: "Happy Session ID copied to clipboard",
    failedToCopySessionId: "Failed to copy Happy Session ID",
    happySessionId: "Happy Session ID",
    claudeCodeSessionId: "Claude Code Session ID",
    claudeCodeSessionIdCopied: "Claude Code Session ID copied to clipboard",
    profile: "AI Profile",
    aiProvider: "AI Provider",
    failedToCopyClaudeCodeSessionId: "Failed to copy Claude Code Session ID",
    metadataCopied: "Metadata copied to clipboard",
    failedToCopyMetadata: "Failed to copy metadata",
    failedToKillSession: "Failed to kill session",
    failedToArchiveSession: "Failed to archive session",
    connectionStatus: "Connection Status",
    created: "Created",
    lastUpdated: "Last Updated",
    sequence: "Sequence",
    quickActions: "Quick Actions",
    viewMachine: "View Machine",
    viewMachineSubtitle: "View machine details and sessions",
    killSessionSubtitle: "Immediately terminate the session",
    archiveSessionSubtitle: "Archive this session and stop it",
    metadata: "Metadata",
    host: "Host",
    path: "Path",
    operatingSystem: "Operating System",
    processId: "Process ID",
    startedBy: "Started By",
    startedByDaemon: "Daemon",
    startedByTerminal: "Terminal",
    happyHome: "Happy Home",
    copyMetadata: "Copy Metadata",
    agentState: "Agent State",
    controlledByUser: "Controlled by User",
    pendingRequests: "Pending Requests",
    activity: "Activity",
    thinking: "Thinking",
    thinkingSince: "Thinking Since",
    cliVersion: "CLI Version",
    cliVersionOutdated: "CLI Update Required",
    cliVersionOutdatedMessage: ({
      currentVersion,
      requiredVersion,
    }: {
      currentVersion: string;
      requiredVersion: string;
    }) =>
      `Version ${currentVersion} installed. Update to ${requiredVersion} or later`,
    updateCliInstructions: "Please run npm install -g happy-coder@latest",
    resumeSession: "Resume Session",
    resumeSessionSubtitle:
      "Resume this session with full context on the same machine",
    forkSession: "Fork Session",
    forkSessionSubtitle:
      "Create a new session branching from this point with full context",
    forkSessionSuccess: "Session forked successfully",
    forkSessionFailed: "Failed to fork session",
    deleteSession: "Delete Session",
    deleteSessionSubtitle: "Permanently remove this session",
    deleteSessionConfirm: "Delete Session Permanently?",
    deleteSessionWarning:
      "This action cannot be undone. All messages and data associated with this session will be permanently deleted.",
    deleteSessionWorktreeWarning: ({ branchName }: { branchName: string }) =>
      `This session has a worktree branch '${branchName}' with unmerged changes. Deleting will also remove the branch and its changes permanently.`,
    deleteSessionWorktreePrWarning: ({ branchName }: { branchName: string }) =>
      `This session has a worktree branch '${branchName}' with an open PR. The branch will be kept for the PR, but the session data will be permanently deleted.`,
    failedToDeleteSession: "Failed to delete session",
    sessionDeleted: "Session deleted successfully",
    deleteAllArchivedSessions: "Delete All Archived Sessions",
    deleteAllArchivedWarning: ({ count }: { count: number }) =>
      `This will permanently delete ${count} archived session(s) and all their messages. This cannot be undone.`,
  },

  components: {
    emptyMainScreen: {
      // Used by EmptyMainScreen component
      readyToCode: "Ready to code?",
      installCli: "Install the Happy CLI",
      runIt: "Run it",
      scanQrCode: "Scan the QR code",
      openCamera: "Open Camera",
    },
  },

  agentInput: {
    permissionMode: {
      title: "PERMISSION MODE",
      default: "Default",
      acceptEdits: "Accept Edits",
      plan: "Plan Mode",
      dontAsk: "Don't Ask",
      bypassPermissions: "Yolo",
      badgeAcceptAllEdits: "Accept All Edits",
      badgeBypassAllPermissions: "Yolo",
      badgePlanMode: "Plan Mode",
      badgeDontAsk: "Don't Ask",
    },
    agent: {
      claude: "Claude",
      codex: "Codex",
      gemini: "Gemini",
    },
    model: {
      title: "MODEL",
      configureInCli: "Configure models in CLI settings",
    },
    codexPermissionMode: {
      title: "CODEX PERMISSION MODE",
      default: "CLI Settings",
      readOnly: "Read Only Mode",
      safeYolo: "Safe YOLO",
      yolo: "YOLO",
      badgeReadOnly: "Read Only Mode",
      badgeSafeYolo: "Safe YOLO",
      badgeYolo: "YOLO",
    },
    codexModel: {
      title: "CODEX MODEL",
      gpt53Codex: "GPT-5.3 Codex",
      gpt53CodexSpark: "GPT-5.3 Codex Spark",
      gpt52Codex: "GPT-5.2 Codex",
      gpt51CodexMax: "GPT-5.1 Codex Max",
      gpt51Codex: "GPT-5.1 Codex",
      gpt5Codex: "GPT-5 Codex",
    },
    geminiPermissionMode: {
      title: "GEMINI PERMISSION MODE",
      default: "Default",
      readOnly: "Read Only",
      safeYolo: "Safe YOLO",
      yolo: "YOLO",
      badgeReadOnly: "Read Only",
      badgeSafeYolo: "Safe YOLO",
      badgeYolo: "YOLO",
    },
    context: {
      remaining: ({ percent }: { percent: number }) => `${percent}% left`,
      breakdownTitle: "Token Breakdown",
      breakdownMessage:
        "↓ Cache Read – Tokens reused from previous context cache. Reduces cost significantly.\n\nin Input – New tokens sent this turn (your message + tool results).\n\nout Output – Tokens generated by the model this turn.\n\n↑ Cache Write – Tokens written to cache this turn, reusable as Cache Read next turn.",
    },
    suggestion: {
      fileLabel: "FILE",
      folderLabel: "FOLDER",
    },
    effort: {
      title: "EFFORT LEVEL",
      low: "Low",
      lowDesc: "Fast responses, less reasoning",
      medium: "Medium",
      mediumDesc: "Default reasoning depth",
      high: "High",
      highDesc: "Deeper reasoning",
      max: "Max",
      maxDesc: "Extended thinking, best quality",
    },
    thinking: {
      title: "THINKING",
      adaptive: "Adaptive",
      adaptiveDesc: "Model decides when to think",
      enabled: "Enabled",
      enabledDesc: "Always show reasoning",
      disabled: "Disabled",
      disabledDesc: "No extended thinking",
    },
    noMachinesAvailable: "No machines",
    continue: "Continue — Claude hit the turn limit",
  },

  machineLauncher: {
    showLess: "Show less",
    showAll: ({ count }: { count: number }) => `Show all (${count} paths)`,
    enterCustomPath: "Enter custom path",
    offlineUnableToSpawn: "Unable to spawn new session, offline",
  },

  sidebar: {
    sessionsTitle: "Happy",
  },

  toolView: {
    input: "Input",
    output: "Output",
  },

  diff: {
    toolbar: {
      unified: "Unified",
      split: "Split",
      expand: "Expand",
      collapse: "Collapse",
      copyDiff: "Copy",
      copied: "Copied!",
    },
  },

  codeReview: {
    accept: "Accept",
    reject: "Reject",
    accepted: "Accepted",
    rejected: "Rejected",
    rejectConfirmTitle: "Reject Change",
    rejectConfirmMessage: ({ filePath }: { filePath: string }) =>
      `Ask Claude to revert changes to ${filePath}?`,
    rejectConfirm: "Reject & Revert",
  },

  tools: {
    fullView: {
      description: "Description",
      inputParams: "Input Parameters",
      output: "Output",
      error: "Error",
      completed: "Tool completed successfully",
      noOutput: "No output was produced",
      running: "Tool is running...",
      rawJsonDevMode: "Raw JSON (Dev Mode)",
      simpleMode: "Simple",
      developerMode: "Developer",
      simple: {
        readFile: ({ file }: { file: string }) => `Read file ${file}`,
        editFile: ({ file }: { file: string }) => `Modified file ${file}`,
        writeFile: ({ file }: { file: string }) => `Created file ${file}`,
        runCommand: "Executed command",
        searchCode: ({ pattern }: { pattern: string }) =>
          `Searched for "${pattern}"`,
        findFiles: ({ pattern }: { pattern: string }) =>
          `Found files matching "${pattern}"`,
        launchAgent: ({ type }: { type: string }) => `Launched ${type} agent`,
        webSearch: ({ query }: { query: string }) => `Searched: ${query}`,
        fetchUrl: ({ host }: { host: string }) =>
          `Fetched content from ${host}`,
        updateTodos: ({ count }: { count: number }) =>
          `Updated task list (${count} items)`,
        mcpTool: ({ name }: { name: string }) => `Called tool ${name}`,
        unknownTool: ({ name }: { name: string }) => `Executed ${name}`,
        status: "Status",
        duration: "Duration",
        fileName: "File",
        command: "Command",
        pattern: "Pattern",
        agent: "Agent",
        query: "Query",
        url: "URL",
        description: "Description",
        linesAdded: ({ count }: { count: number }) => `+${count} added`,
        linesRemoved: ({ count }: { count: number }) => `-${count} removed`,
        filesMatched: ({ count }: { count: number }) =>
          `${count} files matched`,
        succeeded: "Completed successfully",
        failed: "Failed",
        running: "Running...",
      },
    },
    taskView: {
      initializing: "Initializing agent...",
      moreTools: ({ count }: { count: number }) =>
        `+${count} more ${plural({ count, singular: "tool", plural: "tools" })}`,
      collapseTools: "Collapse",
      agentThinking: "Thinking...",
      subagentRunning: ({ type }: { type: string }) => `Running ${type}...`,
    },
    multiEdit: {
      editNumber: ({ index, total }: { index: number; total: number }) =>
        `Edit ${index} of ${total}`,
      replaceAll: "Replace All",
    },
    contextMenu: {
      copyPath: "Copy File Path",
      copyCommand: "Copy Command",
      copyOutput: "Copy Output",
    },
    names: {
      task: "Task",
      terminal: "Terminal",
      searchFiles: "Search Files",
      search: "Search",
      searchContent: "Search Content",
      listFiles: "List Files",
      planProposal: "Plan proposal",
      readFile: "Read File",
      editFile: "Edit File",
      writeFile: "Write File",
      fetchUrl: "Fetch URL",
      readNotebook: "Read Notebook",
      editNotebook: "Edit Notebook",
      todoList: "Todo List",
      webSearch: "Web Search",
      reasoning: "Reasoning",
      applyChanges: "Update file",
      viewDiff: "Current file changes",
      question: "Question",
    },
    askUserQuestion: {
      submit: "Submit Answer",
      multipleQuestions: ({ count }: { count: number }) => `${count} questions`,
      other: "Other",
      otherDescription: "Type your own answer",
      otherPlaceholder: "Type your answer...",
      recommended: "Recommended",
    },
    planFile: {
      refreshFromFile: "Refresh from file",
    },
    desc: {
      terminalCmd: ({ cmd }: { cmd: string }) => `Terminal(cmd: ${cmd})`,
      searchPattern: ({ pattern }: { pattern: string }) =>
        `Search(pattern: ${pattern})`,
      searchPath: ({ basename }: { basename: string }) =>
        `Search(path: ${basename})`,
      fetchUrlHost: ({ host }: { host: string }) => `Fetch URL(url: ${host})`,
      editNotebookMode: ({ path, mode }: { path: string; mode: string }) =>
        `Edit Notebook(file: ${path}, mode: ${mode})`,
      todoListCount: ({ count }: { count: number }) =>
        `Todo List(count: ${count})`,
      webSearchQuery: ({ query }: { query: string }) =>
        `Web Search(query: ${query})`,
      grepPattern: ({ pattern }: { pattern: string }) =>
        `grep(pattern: ${pattern})`,
      multiEditEdits: ({ path, count }: { path: string; count: number }) =>
        `${path} (${count} edits)`,
      readingFile: ({ file }: { file: string }) => `Reading ${file}`,
      writingFile: ({ file }: { file: string }) => `Writing ${file}`,
      modifyingFile: ({ file }: { file: string }) => `Modifying ${file}`,
      modifyingFiles: ({ count }: { count: number }) =>
        `Modifying ${count} files`,
      modifyingMultipleFiles: ({
        file,
        count,
      }: {
        file: string;
        count: number;
      }) => `${file} and ${count} more`,
      showingDiff: "Showing changes",
    },
  },

  files: {
    searchPlaceholder: "Search files...",
    detachedHead: "detached HEAD",
    summary: ({ staged, unstaged }: { staged: number; unstaged: number }) =>
      `${staged} staged • ${unstaged} unstaged`,
    notRepo: "Not a git repository",
    notUnderGit: "This directory is not under git version control",
    searching: "Searching files...",
    noFilesFound: "No files found",
    noFilesInProject: "No files in project",
    tryDifferentTerm: "Try a different search term",
    searchResults: ({ count }: { count: number }) =>
      `Search Results (${count})`,
    projectRoot: "Project root",
    stagedChanges: ({ count }: { count: number }) =>
      `Staged Changes (${count})`,
    unstagedChanges: ({ count }: { count: number }) =>
      `Unstaged Changes (${count})`,
    // File viewer strings
    loadingFile: ({ fileName }: { fileName: string }) =>
      `Loading ${fileName}...`,
    binaryFile: "Binary File",
    cannotDisplayBinary: "Cannot display binary file content",
    diff: "Diff",
    file: "File",
    fileEmpty: "File is empty",
    noChanges: "No changes to display",
    // Browse mode strings
    browseTab: "Browse",
    changesTab: "Changes",
    directory: "Directory",
    emptyDirectory: "This directory is empty",
    submodule: "Submodule",
    submoduleNotInitialized: "Not initialized",
    childReposSummary: ({ count }: { count: number }) =>
      `${count} Git ${count === 1 ? "repository" : "repositories"}`,
  },

  changes: {
    summary: ({ files }: { files: number }) =>
      `${files} file${files === 1 ? "" : "s"} changed`,
    noChanges: "No file changes in this session",
    editCount: ({ count }: { count: number }) => `${count} edits`,
  },

  settingsVoice: {
    // Voice settings screen
    languageTitle: "Language",
    languageDescription:
      "Choose your preferred language for voice assistant interactions. This setting syncs across all your devices.",
    preferredLanguage: "Preferred Language",
    preferredLanguageSubtitle: "Language used for voice assistant responses",
    language: {
      searchPlaceholder: "Search languages...",
      title: "Languages",
      footer: ({ count }: { count: number }) =>
        `${count} ${plural({ count, singular: "language", plural: "languages" })} available`,
      autoDetect: "Auto-detect",
    },
    // TTS provider settings
    ttsProviderTitle: "TTS Provider",
    ttsProviderDescription:
      "Choose between free Edge TTS or paid ElevenLabs TTS with your own API key.",
    ttsProviderEdge: "Edge TTS (Free)",
    ttsProviderEdgeSubtitle: "Microsoft Edge TTS, free and unlimited",
    ttsProviderElevenLabs: "ElevenLabs (Paid)",
    ttsProviderElevenLabsSubtitle: "High quality, requires your own API key",
    elevenLabsApiKey: "API Key",
    elevenLabsApiKeyPlaceholder: "Enter your ElevenLabs API key",
    elevenLabsVoiceId: "Voice ID",
    elevenLabsVoiceIdPlaceholder: "Default: Rachel",
    elevenLabsVoiceIdSubtitle: "Leave empty for default voice (Rachel)",
  },

  voiceStatusBar: {
    // Voice assistant status bar
    connecting: "Connecting...",
    connectionError: "Connection Error",
    listening: "Listening...",
    processing: "Processing...",
    speaking: "Speaking",
    voiceAssistantActive: "Voice Assistant Active",
    voiceAssistant: "Voice Assistant",
    tapToEnd: "Tap to end",
    permissionRequested: ({ toolName }: { toolName: string }) =>
      `Permission requested for ${toolName}`,
    done: "Done.",
  },

  settingsAccount: {
    // Account settings screen
    accountInformation: "Account Information",
    status: "Status",
    statusActive: "Active",
    statusNotAuthenticated: "Not Authenticated",
    anonymousId: "Anonymous ID",
    publicId: "Public ID",
    notAvailable: "Not available",
    linkNewDevice: "Link New Device",
    linkNewDeviceSubtitle: "Scan QR code to link device",
    profile: "Profile",
    name: "Name",
    github: "GitHub",
    tapToDisconnect: "Tap to disconnect",
    server: "Server",
    backup: "Backup",
    backupDescription:
      "Your secret key is the only way to recover your account. Save it in a secure place like a password manager.",
    secretKey: "Secret Key",
    tapToReveal: "Tap to reveal",
    tapToHide: "Tap to hide",
    secretKeyLabel: "SECRET KEY (TAP TO COPY)",
    secretKeyCopied:
      "Secret key copied to clipboard. Store it in a safe place!",
    secretKeyCopyFailed: "Failed to copy secret key",
    privacy: "Privacy",
    privacyDescription:
      "Help improve the app by sharing anonymous usage data. No personal information is collected.",
    analytics: "Analytics",
    analyticsDisabled: "No data is shared",
    analyticsEnabled: "Anonymous usage data is shared",
    dangerZone: "Danger Zone",
    logout: "Logout",
    logoutSubtitle: "Sign out and clear local data",
    logoutConfirm:
      "Are you sure you want to logout? Make sure you have backed up your secret key!",
  },

  settingsLanguage: {
    // Language settings screen
    title: "Language",
    description:
      "Choose your preferred language for the app interface. This will sync across all your devices.",
    currentLanguage: "Current Language",
    automatic: "Automatic",
    automaticSubtitle: "Detect from device settings",
    needsRestart: "Language Changed",
    needsRestartMessage:
      "The app needs to restart to apply the new language setting.",
    restartNow: "Restart Now",
  },

  connectButton: {
    authenticate: "Authenticate Terminal",
    authenticateWithUrlPaste: "Authenticate Terminal with URL paste",
    pasteAuthUrl: "Paste the auth URL from your terminal",
  },

  updateBanner: {
    updateAvailable: "Update available",
    pressToApply: "Press to apply the update",
    whatsNew: "What's new",
    seeLatest: "See the latest updates and improvements",
    nativeUpdateAvailable: "App Update Available",
    tapToUpdateAppStore: "Tap to update in App Store",
    tapToUpdatePlayStore: "Tap to update in Play Store",
  },

  changelog: {
    // Used by the changelog screen
    version: ({ version }: { version: string }) => `Version ${version}`,
    noEntriesAvailable: "No changelog entries available.",
  },

  terminal: {
    // Used by terminal connection screens
    webBrowserRequired: "Web Browser Required",
    webBrowserRequiredDescription:
      "Terminal connection links can only be opened in a web browser for security reasons. Please use the QR code scanner or open this link on a computer.",
    processingConnection: "Processing connection...",
    invalidConnectionLink: "Invalid Connection Link",
    invalidConnectionLinkDescription:
      "The connection link is missing or invalid. Please check the URL and try again.",
    connectTerminal: "Connect Terminal",
    terminalRequestDescription:
      "A terminal is requesting to connect to your Happy Coder account. This will allow the terminal to send and receive messages securely.",
    connectionDetails: "Connection Details",
    publicKey: "Public Key",
    encryption: "Encryption",
    endToEndEncrypted: "End-to-end encrypted",
    acceptConnection: "Accept Connection",
    connecting: "Connecting...",
    reject: "Reject",
    security: "Security",
    securityFooter:
      "This connection link was processed securely in your browser and was never sent to any server. Your private data will remain secure and only you can decrypt the messages.",
    securityFooterDevice:
      "This connection was processed securely on your device and was never sent to any server. Your private data will remain secure and only you can decrypt the messages.",
    clientSideProcessing: "Client-Side Processing",
    linkProcessedLocally: "Link processed locally in browser",
    linkProcessedOnDevice: "Link processed locally on device",
  },

  modals: {
    // Used across connect flows and settings
    authenticateTerminal: "Authenticate Terminal",
    pasteUrlFromTerminal: "Paste the authentication URL from your terminal",
    deviceLinkedSuccessfully: "Device linked successfully",
    terminalConnectedSuccessfully: "Terminal connected successfully",
    invalidAuthUrl: "Invalid authentication URL",
    developerMode: "Developer Mode",
    developerModeEnabled: "Developer mode enabled",
    developerModeDisabled: "Developer mode disabled",
    disconnectGithub: "Disconnect GitHub",
    disconnectGithubConfirm:
      "Are you sure you want to disconnect your GitHub account?",
    disconnectService: ({ service }: { service: string }) =>
      `Disconnect ${service}`,
    disconnectServiceConfirm: ({ service }: { service: string }) =>
      `Are you sure you want to disconnect ${service} from your account?`,
    disconnect: "Disconnect",
    failedToConnectTerminal: "Failed to connect terminal",
    cameraPermissionsRequiredToConnectTerminal:
      "Camera permissions are required to connect terminal",
    failedToLinkDevice: "Failed to link device",
    cameraPermissionsRequiredToScanQr:
      "Camera permissions are required to scan QR codes",
  },

  navigation: {
    // Navigation titles and screen headers
    connectTerminal: "Connect Terminal",
    linkNewDevice: "Link New Device",
    restoreWithSecretKey: "Restore with Secret Key",
    whatsNew: "What's New",
    friends: "Friends",
  },

  welcome: {
    // Main welcome screen for unauthenticated users
    title: "Codex and Claude Code mobile client",
    subtitle:
      "End-to-end encrypted and your account is stored only on your device.",
    createAccount: "Create account",
    linkOrRestoreAccount: "Link or restore account",
    loginWithMobileApp: "Login with mobile app",
    loginWithSecretKey: "Login with secret key",
  },

  review: {
    // Used by utils/requestReview.ts
    enjoyingApp: "Enjoying the app?",
    feedbackPrompt: "We'd love to hear your feedback!",
    yesILoveIt: "Yes, I love it!",
    notReally: "Not really",
  },

  items: {
    // Used by Item component for copy toast
    copiedToClipboard: ({ label }: { label: string }) =>
      `${label} copied to clipboard`,
  },

  machine: {
    launchNewSessionInDirectory: "Launch New Session in Directory",
    offlineUnableToSpawn: "Launcher disabled while machine is offline",
    offlineHelp:
      "• Make sure your computer is online\n• Run `happy daemon status` to diagnose\n• Are you running the latest CLI version? Upgrade with `npm install -g happy-coder@latest`",
    daemon: "Daemon",
    status: "Status",
    stopDaemon: "Stop Daemon",
    lastKnownPid: "Last Known PID",
    lastKnownHttpPort: "Last Known HTTP Port",
    startedAt: "Started At",
    cliVersion: "CLI Version",
    daemonStateVersion: "Daemon State Version",
    activeSessions: ({ count }: { count: number }) =>
      `Active Sessions (${count})`,
    machineGroup: "Machine",
    host: "Host",
    machineId: "Machine ID",
    username: "Username",
    homeDirectory: "Home Directory",
    platform: "Platform",
    architecture: "Architecture",
    lastSeen: "Last Seen",
    never: "Never",
    metadataVersion: "Metadata Version",
    untitledSession: "Untitled Session",
    back: "Back",
  },

  message: {
    switchedToMode: ({ mode }: { mode: string }) => `Switched to ${mode} mode`,
    unknownEvent: "Unknown event",
    usageLimitUntil: ({ time }: { time: string }) =>
      `Usage limit reached until ${time}`,
    usageLimitReached: "Usage limit reached. Please wait and try again.",
    unknownTime: "unknown time",
    turnStats: ({
      model,
      tokens,
      duration,
    }: {
      model: string;
      tokens: string;
      duration: string;
    }) => `${model} · ${tokens} tokens · ${duration}`,
    turnStatsNoModel: ({
      tokens,
      duration,
    }: {
      tokens: string;
      duration: string;
    }) => `${tokens} tokens · ${duration}`,
    sessionSummary: ({ tokens }: { tokens: string }) => `Σ${tokens} tokens`,
    turnCount: ({ count }: { count: number }) =>
      `${plural({ count, singular: `${count} turn`, plural: `${count} turns` })}`,
    thinkingMarker: "Thinking",
  },

  codex: {
    // Codex permission dialog buttons
    permissions: {
      yesForSession: "Yes, and don't ask for a session",
      stopAndExplain: "Stop, and explain what to do",
    },
  },

  claude: {
    // Claude permission dialog buttons
    permissions: {
      yesAllowAllEdits: "Yes, allow all edits during this session",
      yesForTool: "Yes, don't ask again for this tool",
      noTellClaude: "No, and provide feedback",
    },
  },

  plan: {
    approve: "Approve plan",
    approveAutoEdits: "Approve & auto-approve edits",
    rejectWithFeedback: "Reject with feedback",
    rejectTitle: "Why reject this plan?",
    rejectMessage: "Your feedback helps Claude improve the plan",
    rejectPlaceholder: "Describe what should change...",
  },

  textSelection: {
    // Text selection screen
    selectText: "Select text range",
    title: "Select Text",
    noTextProvided: "No text provided",
    textNotFound: "Text not found or expired",
    textCopied: "Text copied to clipboard",
    failedToCopy: "Failed to copy text to clipboard",
    noTextToCopy: "No text available to copy",
  },

  markdown: {
    // Markdown copy functionality
    codeCopied: "Code copied",
    copyFailed: "Copy failed",
    mermaidCopied: "Mermaid source copied",
    mermaidRenderFailed: "Failed to render mermaid diagram",
  },

  artifacts: {
    // Artifacts feature
    title: "Artifacts",
    countSingular: "1 artifact",
    countPlural: ({ count }: { count: number }) => `${count} artifacts`,
    empty: "No artifacts yet",
    emptyDescription: "Create your first artifact to get started",
    new: "New Artifact",
    edit: "Edit Artifact",
    delete: "Delete",
    updateError: "Failed to update artifact. Please try again.",
    notFound: "Artifact not found",
    discardChanges: "Discard changes?",
    discardChangesDescription:
      "You have unsaved changes. Are you sure you want to discard them?",
    deleteConfirm: "Delete artifact?",
    deleteConfirmDescription: "This action cannot be undone",
    titleLabel: "TITLE",
    titlePlaceholder: "Enter a title for your artifact",
    bodyLabel: "CONTENT",
    bodyPlaceholder: "Write your content here...",
    emptyFieldsError: "Please enter a title or content",
    createError: "Failed to create artifact. Please try again.",
    save: "Save",
    saving: "Saving...",
    loading: "Loading artifacts...",
    error: "Failed to load artifact",
  },

  friends: {
    // Friends feature
    title: "Friends",
    manageFriends: "Manage your friends and connections",
    searchTitle: "Find Friends",
    pendingRequests: "Friend Requests",
    myFriends: "My Friends",
    noFriendsYet: "You don't have any friends yet",
    findFriends: "Find Friends",
    remove: "Remove",
    pendingRequest: "Pending",
    sentOn: ({ date }: { date: string }) => `Sent on ${date}`,
    accept: "Accept",
    reject: "Reject",
    addFriend: "Add Friend",
    alreadyFriends: "Already Friends",
    requestPending: "Request Pending",
    searchInstructions: "Enter a username to search for friends",
    searchPlaceholder: "Enter username...",
    searching: "Searching...",
    userNotFound: "User not found",
    noUserFound: "No user found with that username",
    checkUsername: "Please check the username and try again",
    howToFind: "How to Find Friends",
    findInstructions:
      "Search for friends by their username. Both you and your friend need to have GitHub connected to send friend requests.",
    requestSent: "Friend request sent!",
    requestAccepted: "Friend request accepted!",
    requestRejected: "Friend request rejected",
    friendRemoved: "Friend removed",
    confirmRemove: "Remove Friend",
    confirmRemoveMessage: "Are you sure you want to remove this friend?",
    cannotAddYourself: "You cannot send a friend request to yourself",
    bothMustHaveGithub:
      "Both users must have GitHub connected to become friends",
    status: {
      none: "Not connected",
      requested: "Request sent",
      pending: "Request pending",
      friend: "Friends",
      rejected: "Rejected",
    },
    acceptRequest: "Accept Request",
    removeFriend: "Remove Friend",
    removeFriendConfirm: ({ name }: { name: string }) =>
      `Are you sure you want to remove ${name} as a friend?`,
    requestSentDescription: ({ name }: { name: string }) =>
      `Your friend request has been sent to ${name}`,
    requestFriendship: "Request friendship",
    cancelRequest: "Cancel friendship request",
    cancelRequestConfirm: ({ name }: { name: string }) =>
      `Cancel your friendship request to ${name}?`,
    denyRequest: "Deny friendship",
    nowFriendsWith: ({ name }: { name: string }) =>
      `You are now friends with ${name}`,
  },

  usage: {
    // Usage panel strings
    today: "Today",
    last7Days: "Last 7 days",
    last30Days: "Last 30 days",
    totalTokens: "Total Tokens",
    totalCost: "Total Cost",
    tokens: "Tokens",
    cost: "Cost",
    usageOverTime: "Usage over time",
    byModel: "By Model",
    byTokenType: "By Token Type",
    noData: "No usage data available",
  },

  feed: {
    // Feed notifications for friend requests and acceptances
    friendRequestFrom: ({ name }: { name: string }) =>
      `${name} sent you a friend request`,
    friendRequestGeneric: "New friend request",
    friendAccepted: ({ name }: { name: string }) =>
      `You are now friends with ${name}`,
    friendAcceptedGeneric: "Friend request accepted",
  },

  profiles: {
    // Profile management feature
    title: "Profiles",
    subtitle: "Manage environment variable profiles for sessions",
    noProfile: "No Profile",
    noProfileDescription: "Use default environment settings",
    defaultModel: "Default Model",
    addProfile: "Add Profile",
    profileName: "Profile Name",
    enterName: "Enter profile name",
    baseURL: "Base URL",
    authToken: "Auth Token",
    enterToken: "Enter auth token",
    model: "Model",
    setupInstructions: "Setup Instructions",
    viewSetupGuide: "View Official Setup Guide",
    defaultSessionType: "Default Session Type",
    defaultPermissionMode: "Default Permission Mode",
    permissionDefault: "Default",
    permissionDefaultDesc: "Ask for permissions",
    permissionAcceptEdits: "Accept Edits",
    permissionAcceptEditsDesc: "Auto-approve edits",
    permissionPlan: "Plan",
    permissionPlanDesc: "Plan before executing",
    permissionYolo: "Yolo",
    permissionYoloDesc: "Skip all permissions",
    spawnInTmux: "Spawn Sessions in Tmux",
    tmuxEnabledDesc:
      "Sessions spawn in new tmux windows. Configure session name and temp directory below.",
    tmuxDisabledDesc: "Sessions spawn in regular shell (no tmux integration)",
    tmuxSession: "Tmux Session",
    tmuxSessionName: "Tmux Session Name",
    enterTmuxSession: "Enter tmux session name",
    tmuxSessionHint:
      'Leave empty to use first existing tmux session (or create "happy" if none exist). Specify name (e.g., "my-work") for specific session.',
    tmuxSessionPlaceholder: "Empty = first existing session",
    tmuxDisabledPlaceholder: "Disabled - tmux not enabled",
    tmuxTempDir: "Tmux Temp Directory",
    enterTmuxTempDir: "Enter temp directory path",
    tmuxTempDirHint:
      "Temporary directory for tmux session files. Leave empty for system default.",
    tmuxTempDirPlaceholder: "/tmp (optional)",
    tmuxUpdateEnvironment: "Update environment automatically",
    startupBashScript: "Startup Bash Script",
    startupScriptEnabledDesc:
      "Executed before spawning each session. Use for dynamic setup, environment checks, or custom initialization.",
    startupScriptDisabledDesc: "No startup script - sessions spawn directly",
    startupScriptPlaceholder:
      "#!/bin/bash\necho 'Initializing...'\n# Your script here",
    disabled: "Disabled",
    nameRequired: "Profile name is required",
    deleteConfirm: 'Are you sure you want to delete the profile "{name}"?',
    editProfile: "Edit Profile",
    addProfileTitle: "Add New Profile",
    delete: {
      title: "Delete Profile",
      message: ({ name }: { name: string }) =>
        `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      confirm: "Delete",
      cancel: "Cancel",
    },
  },

  git: {
    title: "Git",
    tabChanges: "Changes",
    tabHistory: "History",
    tabBranches: "Branches",
    tabStash: "Stash",
    tabIssues: "Issues",
    tabPRs: "PRs",
    // History
    historyEmpty: "No commits yet",
    historyLoading: "Loading commits...",
    historyLoadMore: "Loading more...",
    historyNoMore: "All commits loaded",
    commitFiles: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? "file" : "files"} changed`,
    // Branches
    localBranches: "Local Branches",
    remoteBranches: "Remote Branches",
    currentBranch: "Current",
    noBranches: "No branches found",
    noUpstream: "No upstream",
    // Branch operations
    createBranch: "Create Branch",
    enterBranchName: "Enter branch name",
    branchNamePlaceholder: "feature/my-branch",
    switchBranchSuccess: ({ name }: { name: string }) =>
      `Switched to '${name}'`,
    createBranchSuccess: ({ name }: { name: string }) =>
      `Branch '${name}' created`,
    dirtyWorkingTree:
      "Please commit or stash your changes before switching branches",
    branchSwitchFailed: "Failed to switch branch",
    branchCreateFailed: "Failed to create branch",
    invalidBranchName: "Invalid branch name",
    branchAlreadyExists: ({ name }: { name: string }) =>
      `Branch '${name}' already exists`,
    // Stash
    stashEmpty: "No stashed changes",
    stashFiles: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? "file" : "files"} changed`,
    // Repo selector
    rootRepo: "Root",
    // Remote operations
    fetch: "Fetch",
    pull: "Pull",
    push: "Push",
    fetchSuccess: "Fetched from remote",
    pullSuccess: "Pulled from remote",
    pushSuccess: "Pushed to remote",
    fetchFailed: "Failed to fetch",
    pullFailed: "Failed to pull",
    pushFailed: "Failed to push",
    noUpstreamHint: "No upstream branch",
    upToDate: "Up to date",
    // File operations
    stage: "Stage",
    unstage: "Unstage",
    discard: "Discard",
    addToGitignore: "Add to .gitignore",
    commit: "Commit",
    stageAll: "Stage All",
    unstageAll: "Unstage All",
    discardAll: "Discard All",
    stageSuccess: "Files staged",
    unstageSuccess: "Files unstaged",
    discardSuccess: "Changes discarded",
    gitignoreSuccess: "Added to .gitignore",
    commitSuccess: "Changes committed",
    stageFailed: "Failed to stage files",
    unstageFailed: "Failed to unstage files",
    discardFailed: "Failed to discard changes",
    gitignoreFailed: "Failed to add to .gitignore",
    commitFailed: "Failed to commit",
    discardConfirmTitle: "Discard Changes?",
    discardConfirmMessage: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? "file" : "files"} will be permanently reverted. This cannot be undone.`,
    discardAllConfirmMessage:
      "All unstaged changes will be permanently lost. This cannot be undone.",
    selectedCount: ({ count }: { count: number }) => `${count} selected`,
    commitMessagePlaceholder: "Enter commit message...",
    noStagedFiles: "No staged files to commit",
  },

  issues: {
    open: "Open",
    closed: "Closed",
    loading: "Loading issues...",
    noIssues: "No issues found",
    noRepo: "No GitHub/Gitea repository detected",
    noBody: "No description provided",
    sendToChat: "Send to Chat",
    openInBrowser: "Open in Browser",
    closeIssue: "Close Issue",
    reopenIssue: "Reopen Issue",
    addComment: "Add Comment",
    commentPlaceholder: "Enter your comment...",
    newIssue: "New Issue",
    newIssueTitlePlaceholder: "Issue title...",
    newIssueBody: "Issue Description (Optional)",
    newIssueBodyPlaceholder: "Describe the issue...",
    pageOf: ({ page }: { page: number }) => `Page ${page}`,
    launchSession: "Launch Session",
    viewProcessingSession: "View Processing Session",
    processing: "Processing",
    launchFailed: ({ error }: { error: string }) =>
      `Failed to launch session: ${error}`,
    autoClosedComment: ({ branchName }: { branchName: string }) =>
      `This issue was automatically closed after merging branch \`${branchName}\`.`,
    editIssue: "Edit Issue",
    editTitle: "Edit Issue Title",
    editTitlePlaceholder: "Issue title...",
    editBody: "Edit Issue Body",
    editBodyPlaceholder: "Describe the issue...",
    sortBy: "Sort By",
    sortCreated: "Created",
    sortUpdated: "Updated",
    sortComments: "Comments",
    noOpenIssues: "No open issues",
    noClosedIssues: "No closed issues",
    tryClosedHint: "Try viewing closed issues",
    createFirstIssue: "Create Issue",
    createIssueTitle: "Create Issue",
    labelSelect: "Labels",
    noLabelsAvailable: "No labels available",
    createButton: "Create",
    statusProcessing: "Processing",
    statusCompleted: "Completed",
    statusFailed: "Failed",
    statusCancelled: "Cancelled",
    sectionMetadata: "Metadata",
    sectionDescription: "Description",
    sectionWorktree: "Worktree",
    metaRepository: "Repository",
    metaAuthor: "Author",
    metaLabels: "Labels",
    metaCreated: "Created",
    metaBranch: "Branch",
    metaParentBranch: "Parent Branch",
    noDescriptionProvided: "No description provided",
    sectionTask: "Task Instructions",
    cannotArchiveProcessing:
      "This session is processing an issue. Please wait until it completes.",
  },

  prs: {
    open: "Open",
    closed: "Closed",
    all: "All",
    draft: "Draft",
    loading: "Loading pull requests...",
    noRepo: "No GitHub/Gitea repository detected",
    noOpenPRs: "No open pull requests",
    noClosedPRs: "No closed pull requests",
    noPRs: "No pull requests found",
    tryClosedHint: "Try viewing closed PRs",
    sortBy: "Sort By",
    sortCreated: "Created",
    sortUpdated: "Updated",
    ci_pending: "Pending",
    ci_success: "Passed",
    ci_failure: "Failed",
    ci_error: "Error",
    review_approved: "Approved",
    review_changes_requested: "Changes Requested",
    review_commented: "Reviewed",
    review_pending: "Review Pending",
    review_dismissed: "Dismissed",
    merged: "Merged",
    noBody: "No description provided",
    viewChanges: "View Changes",
    files: "files",
    merge: "Merge",
    mergeHint: "Merge code into base branch now",
    mergeCommit: "Merge Commit",
    squashMerge: "Squash and Merge",
    rebaseMerge: "Rebase and Merge",
    recommended: "Recommended",
    chooseMergeMethod: "Choose Merge Method",
    approve: "Approve",
    approveHint: "Review only, does not merge",
    approved: "Approved!",
    cannotApproveOwn: "Cannot approve your own pull request",
    closePR: "Close PR",
    addComment: "Add Comment",
    commentPlaceholder: "Enter your comment...",
    openInBrowser: "Open in Browser",
    ciChecks: "CI Checks",
    reviews: "Reviews",
    comments: "Comments",
    noChecks: "No CI checks found",
    noReviews: "No reviews yet",
    noComments: "No comments yet",
    loadFailed: "Failed to load data",
  },

  gitHosts: {
    title: "Git Hosts",
    description:
      "Configure which Git hosts use GitHub API vs Gitea API. GitHub.com is detected automatically. Other hosts default to Gitea. For HTTP hosts, prefix with http:// (e.g. http://10.0.0.1:3000).",
    empty:
      "No custom hosts configured. GitHub.com is detected automatically, other hosts default to Gitea.",
    addHost: "Add Host",
    editHost: "Edit Host",
    tabBasic: "Basic",
    tabAutoIssue: "Auto Issue",
    tabWebhooks: "Webhooks",
    hostLabel: "Host",
    providerLabel: "Provider",
    tokenLabel: "API Token",
    tokenPlaceholder: "Optional — required for private repos",
    tokenHint:
      "Generate at Settings → Applications → Access Tokens in your Gitea instance. Required scopes: issue, repository, admin:repo_hook.",
    tokenHintGitHub:
      "Personal Access Token with admin:repo_hook scope. Enables auto-creating webhooks on save.",
    deleteTitle: "Delete Host",
    deleteMessage: ({ host }: { host: string }) =>
      `Remove "${host}" from configured hosts?`,
    duplicateTitle: "Duplicate Host",
    duplicateMessage: ({ host }: { host: string }) =>
      `"${host}" is already configured.`,
    autoIssueSectionTitle: "Auto Issue Session",
    autoIssueDescription:
      "Automatically launch a Claude Code session when an issue with a specific label is detected. Only issues created by allowed authors will trigger.",
    autoIssueLabel: "Trigger Label",
    autoIssueLabelPlaceholder: "e.g. claude, auto-fix",
    autoIssueAllowedAuthors: "Allowed Authors",
    autoIssueAllowedAuthorsPlaceholder: "username1, username2",
    webhookSectionTitle: "Webhook Repos",
    webhookDescription:
      "Receive webhook events from your Git host to automatically process issues without polling. Add repos to monitor below.",
    webhookAddRepo: "Add Webhook Repo",
    webhookRemoveRepo: "Remove",
    webhookRepoUrl: "Repository URL",
    webhookRepoUrlPlaceholder: "https://github.com/owner/repo",
    webhookMachineId: "Target Machine",
    webhookMachineIdPlaceholder: "Select a machine",
    webhookRepoPath: "Local Repository Path",
    webhookRepoPathPlaceholder: "/path/to/repo",
    webhookSecretLabel: "Webhook Secret",
    webhookSecretCopied: "Secret copied to clipboard",
    webhookUrlLabel: "Webhook URL",
    webhookUrlCopied: "URL copied to clipboard",
    webhookUrlHint:
      "Configure this URL and secret in your repository's webhook settings.",
    webhookSyncSuccess: "Webhook routes synced",
    webhookSyncError: "Failed to sync webhook routes",
    webhookNoMachines: "No machines available",
    scanRepos: "Scan Repos",
    scanning: "Scanning...",
    scanEmpty: "No git repos found on this machine",
    scanError: "Scan failed — make sure the machine is online",
    scanSearchPlaceholder: "Search repos...",
    webhookGuideTitle: ({ provider }: { provider: string }) =>
      `${provider} Webhook Setup`,
    guideStep1GitHub: "Go to your repo → Settings → Webhooks → Add webhook",
    guideStep1Gitea:
      "Go to your repo → Settings → Webhooks → Add Webhook → Gitea",
    guideStep2: "Paste the Webhook URL shown below",
    guideStep3: "Paste the Webhook Secret shown below",
    guideStep4: 'Content type: select "application/json"',
    guideStep5: 'Events: select "Issues" only, then save',
    webhookTestSuccess: "Server is reachable",
    webhookTestFail: ({ status }: { status: string }) =>
      `Server returned HTTP ${status}`,
    webhookTestError: "Cannot reach server — check your network",
    remoteWebhookSuccess: "Webhook created on remote repo",
    remoteWebhookFail: ({ error }: { error: string }) =>
      `Failed to create remote webhook: ${error}`,
    tokenRequiredForRemote:
      "API Token required to auto-create webhooks on remote",
    webhookRepoSaved: "Webhook saved",
    webhookFieldsRequired: "Please fill in repo URL, machine, and secret",
    webhookSaveHostFirst: "Please save the Git Host first",
    webhookRepoDeleted: "Webhook deleted",
    webhookDeleteConfirm: "Remove this webhook repo and delete server route?",
  },

  quickCommands: {
    searchPlaceholder: "Search commands...",
    noResults: "No commands found",
    groups: {
      favorites: "Favorites",
      root: "Project Scripts",
      shell: "Shell Commands",
    },
  },

  kanban: {
    // Kanban board
    emptyTitle: "No Tasks Yet",
    emptySubtitle: "Create your first task to start organizing your work",
    newTask: "New Task",
    taskDetail: "Task Detail",
    taskNotFound: "Task Not Found",
    details: "Details",
    titlePlaceholder: "Task title",
    titleRequired: "Title is required",
    descriptionPlaceholder: "Description (optional)",
    column: "Status",
    priorityLabel: "Priority",
    machine: "Machine",
    machineOnline: "Online",
    machineOffline: "Offline",
    directory: "Directory",
    directoryHint: "Working directory for the session",
    sessionPromptLabel: "Session Prompt",
    sessionPromptPlaceholder:
      "Instructions for Claude when starting this task...",
    sessionPromptHint:
      "Pre-filled prompt when creating a session from this task",
    linkedSessions: "Linked Sessions",
    actionsLabel: "Actions",
    startSession: "Start Session",
    noMachineSelected: "Please select a machine first",
    machineNotOnline: "Selected machine is not online",
    noDirectory: "Please specify a working directory",
    spawnFailed: "Failed to start session",
    sessionNotFound: "Session not found",
    sessionActive: "Active",
    sessionInactive: "Inactive",
    deleteConfirmTitle: "Delete Task",
    deleteConfirmMessage: "Are you sure you want to delete this task?",
    actions: {
      moveTo: "Move To",
    },
    stats: {
      totalTasks: ({ count }: { count: number }) => `${count} tasks`,
      activeSessions: ({ count }: { count: number }) => `${count} active`,
    },
    columns: {
      backlog: "Backlog",
      todo: "To Do",
      inProgress: "In Progress",
      review: "Review",
      done: "Done",
    },
    columnEmpty: {
      backlog: {
        title: "No Backlog Items",
        subtitle: "Items waiting to be planned will appear here",
      },
      todo: {
        title: "Nothing To Do",
        subtitle: "Add tasks that are ready to be worked on",
      },
      inProgress: {
        title: "Nothing Running",
        subtitle: "Move tasks here when you start working",
      },
      review: {
        title: "Nothing In Review",
        subtitle: "Tasks waiting for review will appear here",
      },
      done: {
        title: "No Completed Tasks",
        subtitle: "Completed tasks will be shown here",
      },
    },
    priority: {
      low: "Low",
      medium: "Medium",
      high: "High",
      urgent: "Urgent",
    },
    templates: {
      pickTitle: "Choose Template",
      useTemplate: "Use Template",
      manage: "Manage Templates",
      title: "Prompt Templates",
      newTemplate: "New Template",
      editing: "Edit Template",
      namePlaceholder: "Template name",
      contentPlaceholder:
        "Template content...\nUse {{title}}, {{description}}, {{directory}}, {{tags}} as variables",
      deleteTitle: "Delete Template",
      deleteMessage: "Are you sure you want to delete this template?",
      builtInBadge: "Built-in",
      empty: "No templates yet",
      builtIn: {
        coding: "Code Development",
        bugfix: "Bug Fix",
        review: "Code Review",
      },
    },
  },

  projects: {
    notFound: "Project not found",
    emptyTitle: "No Projects",
    emptySubtitle: "Connect a CLI or tap the button below to add a project",
    allProjects: "All Projects",
    tabSessions: "Sessions",
    tabGit: "Git",
    tabHealth: "Health",
    tabActions: "Actions",
    tabResearch: "Research",
    noSessions: "No sessions yet",
    sessions: "Sessions",
    noGitInfo: "No git information available",
    gitInfo: "Git Info",
    branch: "Branch",
    ahead: "Ahead",
    behind: "Behind",
    dirty: "Uncommitted Changes",
    branchAndRemote: "Branch & Remote",
    upstreamBranch: "Upstream",
    remoteUrl: "Remote",
    fileChanges: "File Changes",
    modifiedCount: "Modified",
    untrackedCount: "Untracked",
    stagedCount: "Staged",
    lineChanges: "Line Changes",
    stagedLines: "Staged",
    unstagedLines: "Unstaged",
    stash: "Stash",
    stashCount: "Stash Entries",
    gitHost: "Git Host",
    addGitHost: "Add Git Host",
    noRemoteUrl: "No remote URL detected",
    lastUpdated: "Last updated",
    addProject: "Add Project",
    selectMachine: "Select Machine",
    projectPath: "Project Path",
    pathPlaceholder: "/path/to/your/project",
    noMachines: "No machines available. Connect a CLI first.",
    deleteProject: "Delete Project",
    deleteConfirmTitle: "Delete Project",
    deleteConfirmMessage: "This will remove the project from your list. This cannot be undone.",
    hasActiveSessions: "Cannot delete: project has active sessions",
    create: "Create",
  },

  project: {
    segments: {
      board: "Board",
    },
  },

  webNotification: {
    taskComplete: "Task Complete",
    permissionRequest: "Approval Needed",
  },

  openclaw: {
    // OpenClaw gateway integration
    title: "OpenClaw",
    connect: "Connect",
    connecting: "Connecting...",
    connected: "Connected",
    disconnect: "Disconnect",
    notConnected: "Not Connected",
    notConnectedDescription:
      "Connect to your OpenClaw gateway to start chatting.",
    connectToGateway: "Connect to Gateway",
    connectTitle: "Connect to OpenClaw",
    connectDescription:
      "Enter your OpenClaw gateway URL to connect. The gateway runs locally on your computer.",
    connectionSettings: "Connection Settings",
    gatewayUrl: "Gateway URL",
    token: "Access Token",
    tokenDescription: "Generate from OpenClaw CLI or control UI",
    tokenPlaceholder: "Enter gateway access token",
    password: "Password",
    passwordOptional: "Optional, for password-protected gateways",
    passwordPlaceholder: "Enter password if required",
    connectionFailed: "Connection Failed",
    checkSettings: "Please check your connection settings and try again.",
    connectFooter:
      "Your connection is direct to your local gateway. No data passes through external servers.",
    localConnection: "Local Connection",
    localConnectionDescription:
      "All communication happens directly with your gateway.",
    viewSessions: "View Sessions",
    connectedTo: "Connected to",
    newChat: "New Chat",
    recentSessions: "Recent Sessions",
    noSessions: "No sessions yet. Start a new chat to begin.",
    chat: "Chat",
    startConversation: "Start a conversation with OpenClaw",
    messagePlaceholder: "Type a message...",
    pairingRequired: "Pairing Required",
    pairingDescription:
      "This device needs to be approved before it can connect to your gateway.",
    pairingInstructions: "How to Approve",
    pairingStep1Title: "Open OpenClaw",
    pairingStep1Description:
      "Click the OpenClaw icon in your menu bar or system tray",
    pairingStep2Title: "Find the pairing request",
    pairingStep2Description: 'Look for "Happy" in the pending devices list',
    pairingStep3Title: "Approve the device",
    pairingStep3Description: 'Click "Approve" to allow this device to connect',
    retryConnection: "Retry Connection",
    deviceInfo: "Device Info",
    deviceId: "Device ID",
    newSession: "New Session",
    newSessionTitle: "Start a New Conversation",
    newSessionDescription:
      "Type your message below to start chatting with OpenClaw.",
    newSessionPlaceholder: "What would you like to talk about?",
    tokenCommand: "Get Token Command",
    tokenCommandHint: "Run this command in your terminal:",
    tokenCommandValue: "clawdbot dashboard --no-open",
    tokenCommandDescription:
      'This will print a URL with your token. Copy the token value after "?token="',
    thinking: "Thinking",
    usingTools: "Using tools",
    errorOccurred: "An error occurred",
  },

  preview: {
    title: "Preview",
    detectingPorts: "Detecting dev servers...",
    noPorts: "No dev servers detected",
    noPortsHint: "Start a dev server first, then tap Detect",
    detect: "Detect",
    refresh: "Refresh",
    capture: "Capture",
    capturing: "Capturing screenshot...",
    urlPlaceholder: "http://localhost:3000",
    customUrl: "Custom URL",
    screenshotFailed: "Screenshot capture failed",
    devServers: "Dev Servers",
    screenshotAt: ({ url }: { url: string }) => `Screenshot of ${url}`,
    portItem: ({ port, process }: { port: number; process: string }) =>
      `Port ${port} — ${process}`,
    setBaseline: "Set as Baseline",
    clearBaseline: "Clear Baseline",
    baselineSet: "Baseline saved",
    compare: "Compare",
    comparing: "Comparing with baseline...",
    before: "Before",
    after: "After",
    diff: "Diff",
    noBaseline: "No baseline set",
    noBaselineHint: "Capture a screenshot first, then set it as baseline",
    comparisonFailed: "Comparison failed",
    unavailableTitle: "agent-browser not found",
    unavailableHint:
      "Install agent-browser on the CLI machine to use the preview feature. Run: npm install -g @anthropic-ai/agent-browser",
    emptyHint:
      "Select a dev server or enter a URL to capture a screenshot of your frontend.",
  },

  supervisor: {
    // General
    title: "Health Monitor",
    description:
      "AI-powered code analysis that monitors your project's health across multiple dimensions.",
    notSynced: "Project not synced to server yet",
    scanNow: "Scan Now",
    scanStarting: "Starting...",
    loading: "Loading...",
    alreadyRunning: "A scan is already in progress",
    settings: "Supervisor Settings",

    // Status
    status_pending: "Pending",
    status_running: "Running",
    status_completed: "Completed",
    status_failed: "Failed",
    status_cancelled: "Cancelled",
    statusWaitingCli: "Waiting for CLI...",
    statusAnalyzing: "AI analyzing code...",
    elapsed: ({ time }: { time: string }) => `Elapsed: ${time}`,

    // Triggers
    triggerManual: "Manual Scan",
    triggerScheduled: "Scheduled",
    triggerEvent: "Event",
    triggerPush: "Push Trigger",

    // Severity
    severityCritical: "Critical",
    severityHigh: "High",
    severityMedium: "Medium",
    severityLow: "Low",

    // Actions
    pendingActions: ({ count }: { count: number }) =>
      `Pending Actions (${count})`,
    actionsCount: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? "action" : "actions"}`,
    approve: "Approve",
    skip: "Skip",
    ignore: "Ignore",
    triggerFix: "Fix",
    suggestedFix: "Suggested Fix",
    fixStatus: "Fix Status",

    // Run history
    runHistory: "Run History",
    noRuns: "No scan runs yet",
    moreRuns: ({ count }: { count: number }) =>
      `${count} more ${count === 1 ? "run" : "runs"}`,
    showMoreRuns: ({ count }: { count: number }) =>
      `Show ${count} more ${count === 1 ? "run" : "runs"}`,
    justNow: "Just now",
    minutesAgo: ({ count }: { count: number }) => `${count}m ago`,
    hoursAgo: ({ count }: { count: number }) => `${count}h ago`,
    daysAgo: ({ count }: { count: number }) => `${count}d ago`,

    // Cost
    costSection: "Cost (30 days)",
    costRunsCount: "Runs",
    costTotalTokens: "Total Tokens",
    costTotalUsd: "Total Cost",
    costPeriod: ({ days }: { days: number }) => `Last ${days} days`,

    // Trend
    trendSection: "Severity Trend",

    // Related projects
    relatedProjects: "Related Projects",

    // Summary card (Phase 6b)
    summaryGrade: "Grade",
    trendImproving: "Improving",
    trendStable: "Stable",
    trendDeclining: "Declining",
    lastScan: "Last Scan",
    openIssues: "Open Issues",
    runs30d: "Runs (30d)",
    nextRun: "Next Scan",

    // Run detail / comparison (Phase 6b)
    runDetail: "Run Detail",
    runTrigger: "Trigger",
    runDuration: "Duration",
    runCost: "Cost",
    runActions: "Actions",
    newIssues: "New Issues",
    resolvedIssues: "Resolved",
    persistentIssues: "Persistent",
    noPreviousRun: "First scan — no previous run to compare",

    // Dimensions
    dimensionsSection: "Analysis Dimensions",
    analyzingDimension: ({ dimension, index, total }: { dimension: string; index: number; total: number }) =>
        `${dimension} (${index}/${total})`,
    dimSecurity: "Security",
    dimSecurityNote: "Vulnerabilities, hardcoded secrets, injection risks",
    dimDependencies: "Dependencies",
    dimDependenciesNote: "Outdated packages, version conflicts, duplicates",
    dimArchitecture: "Architecture",
    dimArchitectureNote: "Code organization, conventions compliance",
    dimTechDebt: "Tech Debt",
    dimTechDebtNote: "TODO/FIXME, dead code, code duplication",
    dimCodeQuality: "Code Quality",
    dimCodeQualityNote: "Style, complexity, best practices",
    dimTestCoverage: "Test Coverage",
    dimTestCoverageNote: "Coverage gaps, test quality",
    dimDocumentation: "Documentation",
    dimDocumentationNote: "README, API docs, comment accuracy",
    dimPerformance: "Performance",
    dimPerformanceNote: "N+1 queries, missing indexes, memory leaks",
    dimUiUx: "UI/UX",
    dimUiUxNote: "Spacing, loading states, accessibility, theme usage",

    // Settings: Mode
    modeSection: "Analysis Mode",
    modeSuggest: "Suggest",
    modeSuggestDesc: "AI suggests actions, you approve manually",
    modeSemiAuto: "Semi-Auto",
    modeSemiAutoDesc:
      "Auto-approve low-risk fixes, manual approval for high-risk",
    modeAuto: "Auto",
    modeAutoDesc: "AI auto-fixes and creates issues/PRs",

    // Settings: Schedule
    scheduleSection: "Schedule",
    scheduleEnabled: "Enable Scheduled Scans",
    scheduleEvery6h: "Every 6 hours",
    scheduleEvery12h: "Every 12 hours",
    scheduleEvery24h: "Every 24 hours",
    scheduleEvery48h: "Every 48 hours",
    scheduleEveryWeek: "Weekly",

    // Settings: Push trigger
    pushTriggerSection: "Push Trigger",
    pushTriggerEnabled: "Scan on Push",
    pushTriggerDesc: "Run incremental analysis when code is pushed",

    // Settings: Fix strategy
    fixStrategySection: "Fix Strategy",
    fixStrategyDirect: "Direct Merge",
    fixStrategyDirectDesc: "Push fixes directly to main branch (with conflict resolution and test safety net)",
    fixStrategyPr: "Pull Request",
    fixStrategyPrDesc: "Create a PR for each fix (requires manual merge)",

    // Settings: Custom rules
    customRulesSection: "Custom Rules",
    customRulesDesc: "Add project-specific analysis rules",
    customRulesPlaceholder:
      "e.g. Check that all API endpoints have rate limiting",

    // Settings: Notifications
    notificationsSection: "Notifications",
    notifAnalysisComplete: "Analysis Complete",
    notifIssueCreated: "Issue Created",
    notifPRCreated: "PR Created",
    notifError: "Errors",

    // Phase 7: Batch operations
    approveAll: "Approve All",
    skipAll: "Skip All",
    viewAllActions: "View All Actions",
    approveAllConfirm: ({ count }: { count: number }) => `Approve all ${count} pending actions?`,
    skipAllConfirm: ({ count }: { count: number }) => `Skip all ${count} pending actions?`,
    approveAllSuccess: ({ count }: { count: number }) => `${count} actions approved`,
    skipAllSuccess: ({ count }: { count: number }) => `${count} actions skipped`,
    clearAll: "Clear All",
    clearAllConfirm: "This will permanently delete all supervisor actions for this project. Are you sure?",
    clearAllSuccess: ({ count }: { count: number }) => `${count} actions cleared`,

    // Phase 7: Action history
    actionHistory: "Action History",
    tabPending: "Pending",
    tabApproved: "Approved",
    tabFixing: "Fixing",
    tabDone: "Done",
    tabDismissed: "Dismissed",
    noActions: "No actions",
    loadMore: "Load More",

    // Session link
    viewSession: "View Session",
    viewPR: "View PR",
    retryFix: "Retry",

    // Phase 7: Report export
    exportReport: "Export Report",
    exportCopied: "Report copied to clipboard",

    // Phase 8: Health score trend
    healthScore: "Score",

    // Settings: Safety
    autoWarningTitle: "Enable Auto Mode?",
    autoWarningBody:
      "Auto mode will automatically apply fixes and create issues/PRs without manual approval. Use with caution.",
    autoWarningConfirm: "Enable",
    autoModeSafetyNote:
      "Auto mode is limited to low-risk fixes. High-risk changes still require approval.",
    safetyNote:
      "All changes are made in separate branches and require PR review.",
    dailyLimitNote: "Daily token limit applies to prevent runaway costs.",
    settingsSaved: "Settings saved",
    settingsSaveError: "Failed to save settings",
    recurring: "Recurring",
    skipIgnoreHint: "Skip: will resurface on next scan. Ignore: permanently suppressed.",
    restore: "Restore",
    delete: "Delete",
    deleteConfirm: "Delete Action",
    deleteConfirmBody: "Permanently delete this action? If the issue still exists, it will be detected again on the next scan.",
  },
  webhook: {
    eventHistory: "Webhook Events",
    noEvents: "No webhook events",
    loadMore: "Load More",
    issue: "Issue",
  },
  competitorResearch: {
    title: "Competitor Research",
    description: "AI-powered analysis of similar products and market positioning",
    startAnalysis: "Start Analysis",
    analyzing: "Analyzing competitors...",
    knownCompetitors: "Known Competitors",
    knownCompetitorsPlaceholder: "e.g. VS Code, Cursor, Windsurf (optional)",
    dimensionsSection: "Analysis Dimensions",
    dim_pricing: "Pricing Strategy",
    dim_pricing_note: "Price models, plans, free tier limits",
    dim_features: "Core Features",
    dim_features_note: "Feature matrix, differentiating capabilities",
    dim_devExperience: "Developer Experience",
    dim_devExperience_note: "Onboarding, docs quality, CLI design",
    dim_positioning: "Market Positioning",
    dim_positioning_note: "Target audience, brand differentiation",
    dim_techStack: "Tech Architecture",
    dim_techStack_note: "Tech stack, extensibility, performance",
    dim_community: "Community & Ecosystem",
    dim_community_note: "GitHub stars, plugins, community activity",
    dim_funding: "Funding & Business",
    dim_funding_note: "Funding rounds, valuation, business model",
    dim_userFeedback: "User Feedback",
    dim_userFeedback_note: "Reviews, pain points, satisfaction",
    additionalNotes: "Additional Notes",
    additionalNotesPlaceholder: "Any extra focus areas or specific questions (optional)",
    noReports: "No research reports yet",
    reportHistory: "Previous Reports",
    latestReport: "Latest Report",
    untitledReport: "Untitled Report",
    reportDetail: "Research Report",
    reportNotFound: "Report not found",
  },

  elicitation: {
    accept: "Accept",
    decline: "Decline",
    submit: "Submit",
  },

  stopFailure: {
    title: "Session Stopped Unexpectedly",
    lastMessage: "Last assistant message",
  },
} as const;

export type Translations = typeof en;

/**
 * Generic translation type that matches the structure of Translations
 * but allows different string values (for other languages)
 */
export type TranslationStructure = {
  readonly [K in keyof Translations]: {
    readonly [P in keyof Translations[K]]: Translations[K][P] extends string
      ? string
      : Translations[K][P] extends (...args: any[]) => string
        ? Translations[K][P]
        : Translations[K][P] extends object
          ? {
              readonly [Q in keyof Translations[K][P]]: Translations[K][P][Q] extends string
                ? string
                : Translations[K][P][Q] extends (...args: any[]) => string
                  ? Translations[K][P][Q]
                  : Translations[K][P][Q] extends object
                    ? {
                        readonly [R in keyof Translations[K][P][Q]]: Translations[K][P][Q][R] extends string
                          ? string
                          : Translations[K][P][Q][R];
                      }
                    : Translations[K][P][Q];
            }
          : Translations[K][P];
  };
};
