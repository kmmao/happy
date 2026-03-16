/**
 * Japanese translations for the Happy app
 * Values can be:
 * - String constants for static text
 * - Functions with typed object parameters for dynamic text
 */

import { TranslationStructure } from "../_default";

/**
 * Japanese plural helper function
 * Japanese doesn't have grammatical plurals, so this just returns the appropriate form
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

export const ja: TranslationStructure = {
  tabs: {
    // Tab navigation labels
    inbox: "受信トレイ",
    sessions: "ターミナル",
    project: "プロジェクト",
    openclaw: "OpenClaw",
    settings: "設定",
  },

  inbox: {
    // Inbox screen
    emptyTitle: "受信トレイは空です",
    emptyDescription: "友達と接続してセッションを共有しましょう",
    updates: "更新",
  },

  common: {
    // Simple string constants
    cancel: "キャンセル",
    authenticate: "認証",
    save: "保存",
    error: "エラー",
    success: "成功",
    ok: "OK",
    continue: "続行",
    back: "戻る",
    create: "作成",
    rename: "名前を変更",
    reset: "リセット",
    logout: "ログアウト",
    yes: "はい",
    no: "いいえ",
    discard: "破棄",
    version: "バージョン",
    copied: "コピーしました",
    copy: "コピー",
    submit: "送信",
    scanning: "スキャン中...",
    urlPlaceholder: "https://example.com",
    home: "ホーム",
    message: "メッセージ",
    files: "ファイル",
    fileViewer: "ファイルビューアー",
    loading: "読み込み中...",
    retry: "再試行",
    delete: "削除",
    optional: "任意",
    saveAs: "名前を付けて保存",
  },

  profile: {
    userProfile: "ユーザープロフィール",
    details: "詳細",
    firstName: "名",
    lastName: "姓",
    username: "ユーザー名",
    status: "ステータス",
  },

  profiles: {
    title: "プロファイル",
    subtitle: "セッション用の環境変数プロファイルを管理",
    noProfile: "プロファイルなし",
    noProfileDescription: "デフォルトの環境設定を使用",
    defaultModel: "デフォルトモデル",
    addProfile: "プロファイルを追加",
    profileName: "プロファイル名",
    enterName: "プロファイル名を入力",
    baseURL: "ベースURL",
    authToken: "認証トークン",
    enterToken: "認証トークンを入力",
    model: "モデル",
    setupInstructions: "セットアップ手順",
    viewSetupGuide: "公式セットアップガイドを表示",
    defaultSessionType: "デフォルトセッションタイプ",
    defaultPermissionMode: "デフォルト権限モード",
    permissionDefault: "デフォルト",
    permissionDefaultDesc: "権限の確認を求める",
    permissionAcceptEdits: "編集を承認",
    permissionAcceptEditsDesc: "編集を自動承認",
    permissionPlan: "プラン",
    permissionPlanDesc: "実行前にプランニング",
    permissionYolo: "Yolo",
    permissionYoloDesc: "すべての権限をスキップ",
    spawnInTmux: "Tmuxでセッションを起動",
    tmuxEnabledDesc:
      "セッションは新しいtmuxウィンドウで起動します。以下でセッション名と一時ディレクトリを設定してください。",
    tmuxDisabledDesc: "セッションは通常のシェルで起動します（tmux統合なし）",
    tmuxSession: "Tmuxセッション",
    tmuxSessionName: "Tmuxセッション名",
    enterTmuxSession: "tmuxセッション名を入力",
    tmuxSessionHint:
      '空欄にすると最初の既存tmuxセッションを使用します（存在しない場合は"happy"を作成）。名前を指定（例："my-work"）すると特定のセッションを使用します。',
    tmuxSessionPlaceholder: "空欄 = 最初の既存セッション",
    tmuxDisabledPlaceholder: "無効 - tmux未有効",
    tmuxTempDir: "Tmux一時ディレクトリ",
    enterTmuxTempDir: "一時ディレクトリのパスを入力",
    tmuxTempDirHint:
      "tmuxセッションファイルの一時ディレクトリ。空欄でシステムデフォルトを使用。",
    tmuxTempDirPlaceholder: "/tmp（任意）",
    tmuxUpdateEnvironment: "環境を自動更新",
    startupBashScript: "起動Bashスクリプト",
    startupScriptEnabledDesc:
      "各セッション起動前に実行。動的セットアップ、環境チェック、カスタム初期化に使用。",
    startupScriptDisabledDesc: "起動スクリプトなし - セッションを直接起動",
    startupScriptPlaceholder:
      "#!/bin/bash\necho '初期化中...'\n# スクリプトをここに記述",
    disabled: "無効",
    nameRequired: "プロファイル名は必須です",
    deleteConfirm: "プロファイル「{name}」を削除してもよろしいですか？",
    editProfile: "プロファイルを編集",
    addProfileTitle: "新しいプロファイルを追加",
    delete: {
      title: "プロファイルを削除",
      message: ({ name }: { name: string }) =>
        `「${name}」を削除してもよろしいですか？この操作は元に戻せません。`,
      confirm: "削除",
      cancel: "キャンセル",
    },
  },

  status: {
    connected: "接続済み",
    connecting: "接続中",
    disconnected: "切断済み",
    error: "エラー",
    online: "オンライン",
    offline: "オフライン",
    lastSeen: ({ time }: { time: string }) => `最終アクセス: ${time}`,
    permissionRequired: "権限が必要です",
    needsAttention: "あなたの返信を待っています",
    activeNow: "アクティブ",
    unknown: "不明",
  },

  time: {
    justNow: "たった今",
    minutesAgo: ({ count }: { count: number }) => `${count}分前`,
    hoursAgo: ({ count }: { count: number }) => `${count}時間前`,
  },

  connect: {
    restoreAccount: "アカウントを復元",
    enterSecretKey: "シークレットキーを入力してください",
    invalidSecretKey:
      "シークレットキーが無効です。確認して再試行してください。",
    enterUrlManually: "URLを手動で入力",
  },

  settings: {
    title: "設定",
    connectedAccounts: "接続済みアカウント",
    connectAccount: "アカウントを接続",
    github: "GitHub",
    machines: "マシン",
    features: "機能",
    social: "ソーシャル",
    account: "アカウント",
    accountSubtitle: "アカウントの詳細を管理",
    appearance: "外観",
    appearanceSubtitle: "アプリの見た目をカスタマイズ",
    voiceAssistant: "音声アシスタント",
    voiceAssistantSubtitle: "音声操作の設定",
    featuresTitle: "機能",
    featuresSubtitle: "アプリ機能の有効/無効を切り替え",
    developer: "開発者",
    developerTools: "開発者ツール",
    about: "このアプリについて",
    aboutFooter:
      "Happy CoderはCodexとClaude Codeのモバイルクライアントです。完全なエンドツーエンド暗号化を採用し、アカウントはデバイスにのみ保存されます。Anthropicとは提携していません。",
    whatsNew: "新機能",
    whatsNewSubtitle: "最新のアップデートと改善を確認",
    reportIssue: "問題を報告",
    privacyPolicy: "プライバシーポリシー",
    termsOfService: "利用規約",
    eula: "EULA",
    supportUs: "開発を支援",
    supportUsSubtitlePro: "ご支援ありがとうございます！",
    supportUsSubtitle: "プロジェクト開発を支援",
    scanQrCodeToAuthenticate: "QRコードをスキャンして認証",
    githubConnected: ({ login }: { login: string }) => `@${login}として接続中`,
    connectGithubAccount: "GitHubアカウントを接続",
    claudeAuthSuccess: "Claudeへの接続に成功しました",
    exchangingTokens: "トークンを交換中...",
    usage: "使用状況",
    usageSubtitle: "API使用量とコストを確認",
    profiles: "プロファイル",
    profilesSubtitle: "セッション用の環境変数プロファイルを管理",
    gitHosts: "Git ホスト",
    gitHostsSubtitle: "Git ホストプロバイダーの設定",

    // Dynamic settings messages
    accountConnected: ({ service }: { service: string }) =>
      `${service}アカウントが接続されました`,
    machineStatus: ({
      name,
      status,
    }: {
      name: string;
      status: "online" | "offline";
    }) => `${name}は${status === "online" ? "オンライン" : "オフライン"}です`,
    featureToggled: ({
      feature,
      enabled,
    }: {
      feature: string;
      enabled: boolean;
    }) => `${feature}を${enabled ? "有効" : "無効"}にしました`,
  },

  settingsAppearance: {
    // Appearance settings screen
    theme: "テーマ",
    themeDescription: "お好みの配色を選択",
    themeOptions: {
      adaptive: "自動",
      light: "ライト",
      dark: "ダーク",
    },
    themeDescriptions: {
      adaptive: "システム設定に合わせる",
      light: "常にライトテーマを使用",
      dark: "常にダークテーマを使用",
    },
    display: "表示",
    displayDescription: "レイアウトと間隔を調整",
    inlineToolCalls: "ツール呼び出しをインライン表示",
    inlineToolCallsDescription:
      "チャットにメインエージェントのツール呼び出しを表示",
    expandTodoLists: "Todoリストを展開",
    expandTodoListsDescription: "変更点だけでなくすべてのTodoを表示",
    expandToolDetails: "ツール詳細を展開",
    expandToolDetailsDescription: "サブエージェントのツールリストをデフォルトで展開",
    showLineNumbersInDiffs: "差分に行番号を表示",
    showLineNumbersInDiffsDescription: "コード差分に行番号を表示",
    showLineNumbersInToolViews: "ツールビューに行番号を表示",
    showLineNumbersInToolViewsDescription: "ツールビューの差分に行番号を表示",
    wrapLinesInDiffs: "差分で行を折り返し",
    wrapLinesInDiffsDescription:
      "差分表示で水平スクロールの代わりに長い行を折り返す",
    alwaysShowContextSize: "常にコンテキストサイズを表示",
    alwaysShowContextSizeDescription:
      "上限に近づいていなくてもコンテキスト使用量を表示",
    avatarStyle: "アバタースタイル",
    avatarStyleDescription: "セッションアバターの外観を選択",
    avatarOptions: {
      pixelated: "ピクセル",
      gradient: "グラデーション",
      brutalist: "ブルータリスト",
    },
    showFlavorIcons: "AIプロバイダーアイコンを表示",
    showFlavorIconsDescription:
      "セッションアバターにAIプロバイダーアイコンを表示",
    compactSessionView: "コンパクトセッション表示",
    compactSessionViewDescription:
      "アクティブなセッションをコンパクトなレイアウトで表示",
    collapsibleInput: "入力ボックスの折りたたみ",
    collapsibleInputDescription:
      "メッセージがあるセッションで入力ボックスを自動的に折りたたむ",
    realtimeSessionSort: "リアルタイムセッション並び替え",
    realtimeSessionSortDescription:
      "最近のアクティビティでセッションを並び替え（オフにすると作成日時順で安定表示）",
  },

  settingsFeatures: {
    // Features settings screen
    experiments: "実験的機能",
    experimentsDescription:
      "開発中の実験的機能を有効にします。これらの機能は不安定であったり、予告なく変更される場合があります。",
    experimentalFeatures: "実験的機能",
    experimentalFeaturesEnabled: "実験的機能が有効です",
    experimentalFeaturesDisabled: "安定版機能のみを使用",
    webFeatures: "Web機能",
    webFeaturesDescription: "Webバージョンでのみ利用可能な機能。",
    enterToSend: "Enterで送信",
    enterToSendEnabled: "Enterで送信（Shift+Enterで改行）",
    enterToSendDisabled: "Enterで改行",
    commandPalette: "コマンドパレット",
    commandPaletteEnabled: "⌘Kで開く",
    commandPaletteDisabled: "クイックコマンドアクセスは無効",
    markdownCopyV2: "Markdownコピー v2",
    markdownCopyV2Subtitle: "長押しでコピーモーダルを開く",
    hideInactiveSessions: "非アクティブセッションを非表示",
    hideInactiveSessionsSubtitle: "アクティブなチャットのみをリストに表示",
    enhancedSessionWizard: "拡張セッションウィザード",
    enhancedSessionWizardEnabled: "プロファイル優先セッションランチャーが有効",
    enhancedSessionWizardDisabled: "標準セッションランチャーを使用",
    showAgentActivity: "エージェント アクティビティ",
    showAgentActivityEnabled: "チャットでリアルタイムのエージェント活動を表示",
    showAgentActivityDisabled: "エージェント活動の詳細を非表示",
    sttCorrection: "音声認識の補正",
    sttCorrectionEnabled: "AIが音声認識のエラーを自動補正",
    sttCorrectionDisabled: "音声認識の結果をそのまま使用",
    showProjectTab: "プロジェクトタブ",
    showProjectTabSubtitle: "タブバーにプロジェクト（カンバン）タブを表示",
    webNotifications: "ブラウザ通知",
    webNotificationsEnabled: "タスク完了・承認要求時に通知",
    webNotificationsDisabled: "ブラウザ通知オフ",
    webNotificationsDenied:
      "ブラウザにブロックされました — サイト設定で有効にしてください",
    webNotificationsPersistent: "通知を固定",
    webNotificationsPersistentEnabled: "手動で閉じるまで通知を表示",
    webNotificationsPersistentDisabled: "5秒後に自動で閉じる",
  },

  errors: {
    networkError: "ネットワークエラーが発生しました",
    serverError: "サーバーエラーが発生しました",
    unknownError: "不明なエラーが発生しました",
    connectionTimeout: "接続がタイムアウトしました",
    authenticationFailed: "認証に失敗しました",
    permissionDenied: "権限がありません",
    fileNotFound: "ファイルが見つかりません",
    invalidFormat: "フォーマットが無効です",
    operationFailed: "操作に失敗しました",
    tryAgain: "再試行してください",
    contactSupport: "問題が続く場合はサポートにお問い合わせください",
    sessionNotFound: "セッションが見つかりません",
    voiceSessionFailed: "音声セッションの開始に失敗しました",
    voiceServiceUnavailable: "音声サービスは一時的に利用できません",
    oauthInitializationFailed: "OAuth フローの初期化に失敗しました",
    tokenStorageFailed: "認証トークンの保存に失敗しました",
    oauthStateMismatch: "セキュリティ検証に失敗しました。再試行してください",
    tokenExchangeFailed: "認可コードの交換に失敗しました",
    oauthAuthorizationDenied: "認可が拒否されました",
    webViewLoadFailed: "認証ページの読み込みに失敗しました",
    failedToLoadProfile: "ユーザープロフィールの読み込みに失敗しました",
    userNotFound: "ユーザーが見つかりません",
    sessionDeleted: "セッションは削除されました",
    sessionDeletedDescription: "このセッションは完全に削除されました",

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
    }) => `${field}は${min}から${max}の間である必要があります`,
    retryIn: ({ seconds }: { seconds: number }) => `${seconds}秒後に再試行`,
    errorWithCode: ({
      message,
      code,
    }: {
      message: string;
      code: number | string;
    }) => `${message} (エラー ${code})`,
    disconnectServiceFailed: ({ service }: { service: string }) =>
      `${service}の切断に失敗しました`,
    connectServiceFailed: ({ service }: { service: string }) =>
      `${service}の接続に失敗しました。再試行してください。`,
    failedToLoadFriends: "友達リストの読み込みに失敗しました",
    failedToAcceptRequest: "友達リクエストの承認に失敗しました",
    failedToRejectRequest: "友達リクエストの拒否に失敗しました",
    failedToRemoveFriend: "友達の削除に失敗しました",
    searchFailed: "検索に失敗しました。再試行してください。",
    failedToSendRequest: "友達リクエストの送信に失敗しました",
  },

  newSession: {
    // Used by new-session screen and launch flows
    title: "新しいセッションを開始",
    noMachinesFound:
      "マシンが見つかりません。まずコンピューターでHappyセッションを起動してください。",
    allMachinesOffline: "すべてのマシンがオフラインです",
    machineDetails: "マシンの詳細を表示 →",
    directoryDoesNotExist: "ディレクトリが見つかりません",
    createDirectoryConfirm: ({ directory }: { directory: string }) =>
      `ディレクトリ ${directory} は存在しません。作成しますか？`,
    sessionStarted: "セッションが開始されました",
    sessionStartedMessage: "セッションが正常に開始されました。",
    sessionSpawningFailed:
      "セッションの生成に失敗しました - セッションIDが返されませんでした。",
    startingSession: "セッションを開始中...",
    startNewSessionInFolder: "このフォルダで新しいセッション",
    failedToStart:
      "セッションの開始に失敗しました。ターゲットマシンでデーモンが実行中か確認してください。",
    sessionTimeout:
      "セッションの開始がタイムアウトしました。マシンが遅いか、デーモンが応答していない可能性があります。",
    notConnectedToServer:
      "サーバーに接続されていません。インターネット接続を確認してください。",
    noMachineSelected: "セッションを開始するマシンを選択してください",
    noPathSelected: "セッションを開始するディレクトリを選択してください",
    profileConfigEmpty: ({ name }: { name: string }) =>
      `プロファイル「${name}」に環境変数が設定されていません。プロファイルを編集して必要な環境変数を追加してください。`,
    sessionType: {
      title: "セッションタイプ",
      simple: "シンプル",
      worktree: "ワークツリー",
      comingSoon: "近日公開",
    },
    worktree: {
      creating: ({ name }: { name: string }) =>
        `ワークツリー '${name}' を作成中...`,
      notGitRepo: "ワークツリーにはGitリポジトリが必要です",
      failed: ({ error }: { error: string }) =>
        `ワークツリーの作成に失敗しました: ${error}`,
      success: "ワークツリーが正常に作成されました",
    },
    gitRepos: {
      title: "Git リポジトリ",
      showingCount: ({ showing, total }: { showing: number; total: number }) =>
        `${total} 件中 ${showing} 件を表示`,
    },
  },

  sessionHistory: {
    // Used by session history screen
    title: "セッション履歴",
    empty: "セッションが見つかりません",
    today: "今日",
    yesterday: "昨日",
    daysAgo: ({ count }: { count: number }) => `${count}日前`,
    viewAll: "すべてのセッションを表示",
  },

  session: {
    inputPlaceholder: "メッセージを入力...",
    startedByDaemon: "デーモン",
    sentImage: "画像を送信しました",
    sentImages: ({ count }: { count: number }) =>
      `${count}枚の画像を送信しました`,
    imageAttached: "画像が添付されました",
    imageLabel: ({ index }: { index: number }) => `画像 ${index}`,
    imageUploadFailed: ({ failed, total }: { failed: number; total: number }) =>
      `${total}枚中${failed}枚の画像のアップロードに失敗しました`,
    couldNotAttachFile: "このファイルを添付できませんでした",
    imageLoadFailed: "画像の読み込みに失敗しました",
    bookmarkOption: "ブックマーク",
    appendToInput: "入力欄で編集",
    messageQueued: "キュー中",
  },

  bookmark: {
    sourceAI: "AI",
    sourceUser: "自分",
  },

  commandPalette: {
    placeholder: "コマンドを入力または検索...",
  },

  server: {
    // Used by Server Configuration screen (app/(app)/server.tsx)
    serverConfiguration: "サーバー設定",
    enterServerUrl: "サーバーURLを入力してください",
    notValidHappyServer: "有効なHappy Serverではありません",
    changeServer: "サーバーを変更",
    continueWithServer: "このサーバーで続行しますか？",
    resetToDefault: "デフォルトにリセット",
    resetServerDefault: "サーバーをデフォルトにリセットしますか？",
    validating: "検証中...",
    validatingServer: "サーバーを検証中...",
    serverReturnedError: "サーバーがエラーを返しました",
    failedToConnectToServer: "サーバーへの接続に失敗しました",
    currentlyUsingCustomServer: "現在カスタムサーバーを使用中",
    customServerUrlLabel: "カスタムサーバーURL",
    advancedFeatureFooter:
      "これは高度な機能です。何をしているか理解している場合のみサーバーを変更してください。サーバー変更後は再度ログインが必要です。",
  },

  worktreeInfo: {
    title: "Worktree",
    branch: "ブランチ",
    parentBranch: "親ブランチ",
    status: "ステータス",
    errorLabel: "エラー",
    state: {
      creating: "作成中",
      active: "アクティブ",
      merging: "マージ中",
      merged: "マージ済み",
      cleaning: "クリーンアップ中",
      cleaned: "クリーンアップ済み",
      error: "エラー",
    },
    merge: {
      title: "マージ戦略",
      preview: "マージプレビュー",
      description: ({ parentBranch }: { parentBranch: string }) =>
        `${parentBranch} にどのようにマージしますか？`,
      action: "マージ",
      createPr: "Pull Request を作成",
      directMerge: "直接マージ",
      prSuccess: ({ url }: { url: string }) => `PR を作成しました: ${url}`,
      openPr: "PR を開く",
      keepBranch: "ブランチを保持",
      deleteBranch: "ブランチを削除",
      filesChanged: "ファイル変更",
      commits: ({ count }: { count: number }) => `コミット (${count})`,
      noCommits: "マージするコミットがありません",
      directSuccess: "マージが完了しました",
      directSuccessDeleteBranch: ({ branchName }: { branchName: string }) =>
        `マージが完了しました。ブランチ '${branchName}' を削除しますか？`,
      failed: ({ error }: { error: string }) =>
        `マージに失敗しました: ${error}`,
    },
    cleanup: {
      title: "Worktree を削除",
      action: "Worktree を削除",
      confirm: "この Worktree とそのブランチを削除しますか？",
      notMerged:
        "この Worktree はまだマージされていません。削除すると変更が失われる可能性があります。続行しますか？",
      remove: "削除",
      success: "Worktree を削除しました",
      successAndArchived: "Worktree を削除し、セッションをアーカイブしました",
      failed: ({ error }: { error: string }) =>
        `Worktree の削除に失敗しました: ${error}`,
    },
  },

  sessionInfo: {
    // Used by Session Info screen (app/(app)/session/[id]/info.tsx)
    killSession: "セッションを終了",
    killSessionConfirm: "このセッションを終了してもよろしいですか？",
    archiveSession: "セッションをアーカイブ",
    archiveSessionConfirm: "このセッションをアーカイブしてもよろしいですか？",
    happySessionIdCopied: "Happy Session IDがクリップボードにコピーされました",
    failedToCopySessionId: "Happy Session IDのコピーに失敗しました",
    happySessionId: "Happy Session ID",
    claudeCodeSessionId: "Claude Code Session ID",
    claudeCodeSessionIdCopied:
      "Claude Code Session IDがクリップボードにコピーされました",
    profile: "AIプロファイル",
    aiProvider: "AIプロバイダー",
    failedToCopyClaudeCodeSessionId:
      "Claude Code Session IDのコピーに失敗しました",
    metadataCopied: "メタデータがクリップボードにコピーされました",
    failedToCopyMetadata: "メタデータのコピーに失敗しました",
    failedToKillSession: "セッションの終了に失敗しました",
    failedToArchiveSession: "セッションのアーカイブに失敗しました",
    connectionStatus: "接続状態",
    created: "作成日時",
    lastUpdated: "最終更新",
    sequence: "シーケンス",
    quickActions: "クイックアクション",
    viewMachine: "マシンを表示",
    viewMachineSubtitle: "マシンの詳細とセッションを表示",
    killSessionSubtitle: "セッションを即座に終了",
    archiveSessionSubtitle: "このセッションをアーカイブして停止",
    metadata: "メタデータ",
    host: "ホスト",
    path: "パス",
    operatingSystem: "オペレーティングシステム",
    processId: "プロセスID",
    startedBy: "起動方法",
    startedByDaemon: "デーモン",
    startedByTerminal: "ターミナル",
    happyHome: "Happy Home",
    copyMetadata: "メタデータをコピー",
    agentState: "エージェント状態",
    controlledByUser: "ユーザーによる制御",
    pendingRequests: "保留中のリクエスト",
    activity: "アクティビティ",
    thinking: "思考中",
    thinkingSince: "思考開始時刻",
    cliVersion: "CLIバージョン",
    cliVersionOutdated: "CLIの更新が必要",
    cliVersionOutdatedMessage: ({
      currentVersion,
      requiredVersion,
    }: {
      currentVersion: string;
      requiredVersion: string;
    }) =>
      `バージョン ${currentVersion} がインストールされています。${requiredVersion} 以降に更新してください`,
    updateCliInstructions:
      "npm install -g happy-coder@latest を実行してください",
    resumeSession: "セッションを再開",
    resumeSessionSubtitle:
      "同じマシンで完全なコンテキストを使ってセッションを再開",
    deleteSession: "セッションを削除",
    deleteSessionSubtitle: "このセッションを完全に削除",
    deleteSessionConfirm: "セッションを完全に削除しますか？",
    deleteSessionWarning:
      "この操作は取り消せません。このセッションに関連するすべてのメッセージとデータが完全に削除されます。",
    deleteSessionWorktreeWarning: ({ branchName }: { branchName: string }) =>
      `このセッションにはマージされていない変更を含む worktree branch '${branchName}' があります。削除すると、branch とその変更もすべて完全に削除されます。`,
    deleteSessionWorktreePrWarning: ({ branchName }: { branchName: string }) =>
      `このセッションにはオープン中の PR がある worktree branch '${branchName}' があります。branch は PR のために保持されますが、セッションデータは完全に削除されます。`,
    failedToDeleteSession: "セッションの削除に失敗しました",
    sessionDeleted: "セッションが正常に削除されました",
    deleteAllArchivedSessions: "アーカイブ済みセッションをすべて削除",
    deleteAllArchivedWarning: ({ count }: { count: number }) =>
      `${count}件のアーカイブ済みセッションとすべてのメッセージを完全に削除します。この操作は取り消せません。`,
  },

  components: {
    emptyMainScreen: {
      // Used by EmptyMainScreen component
      readyToCode: "コーディングを始めますか？",
      installCli: "Happy CLIをインストール",
      runIt: "実行する",
      scanQrCode: "QRコードをスキャン",
      openCamera: "カメラを開く",
    },
  },

  agentInput: {
    permissionMode: {
      title: "権限モード",
      default: "デフォルト",
      acceptEdits: "編集を許可",
      plan: "プランモード",
      dontAsk: "確認しない",
      bypassPermissions: "Yoloモード",
      badgeAcceptAllEdits: "すべての編集を許可",
      badgeBypassAllPermissions: "すべての権限をバイパス",
      badgePlanMode: "プランモード",
      badgeDontAsk: "確認しない",
    },
    agent: {
      claude: "Claude",
      codex: "Codex",
      gemini: "Gemini",
    },
    model: {
      title: "モデル",
      configureInCli: "CLIの設定でモデルを構成",
    },
    codexPermissionMode: {
      title: "CODEX権限モード",
      default: "CLI設定",
      readOnly: "読み取り専用モード",
      safeYolo: "セーフYOLO",
      yolo: "YOLO",
      badgeReadOnly: "読み取り専用モード",
      badgeSafeYolo: "セーフYOLO",
      badgeYolo: "YOLO",
    },
    codexModel: {
      title: "CODEXモデル",
      gpt53Codex: "GPT-5.3 Codex",
      gpt53CodexSpark: "GPT-5.3 Codex Spark",
      gpt52Codex: "GPT-5.2 Codex",
      gpt51CodexMax: "GPT-5.1 Codex Max",
      gpt51Codex: "GPT-5.1 Codex",
      gpt5Codex: "GPT-5 Codex",
    },
    geminiPermissionMode: {
      title: "GEMINI権限モード",
      default: "デフォルト",
      readOnly: "読み取り専用",
      safeYolo: "安全YOLO",
      yolo: "YOLO",
      badgeReadOnly: "読み取り専用",
      badgeSafeYolo: "安全YOLO",
      badgeYolo: "YOLO",
    },
    context: {
      remaining: ({ percent }: { percent: number }) => `残り ${percent}%`,
      breakdownTitle: "トークン内訳",
      breakdownMessage:
        "↓ キャッシュ読み取り – 前回のコンテキストキャッシュから再利用されたトークン。コストを大幅削減。\n\nin 入力 – 今回のターンで送信された新しいトークン（メッセージ＋ツール結果）。\n\nout 出力 – 今回のターンでモデルが生成したトークン。\n\n↑ キャッシュ書き込み – 今回のターンでキャッシュに書き込まれたトークン。次のターンで再利用可能。",
    },
    suggestion: {
      fileLabel: "ファイル",
      folderLabel: "フォルダ",
    },
    effort: {
      title: "推論レベル",
      low: "低",
      lowDesc: "高速応答、推論少なめ",
      medium: "中",
      mediumDesc: "デフォルトの推論深度",
      high: "高",
      highDesc: "より深い推論",
      max: "最大",
      maxDesc: "拡張思考、最高品質",
    },
    thinking: {
      title: "思考モード",
      adaptive: "適応型",
      adaptiveDesc: "モデルが思考するか自動判断",
      enabled: "有効",
      enabledDesc: "常に推論過程を表示",
      disabled: "無効",
      disabledDesc: "拡張思考なし",
    },
    noMachinesAvailable: "マシンなし",
    continue: "続行 — Claudeがターン制限に達しました",
  },

  machineLauncher: {
    showLess: "折りたたむ",
    showAll: ({ count }: { count: number }) => `すべて表示 (${count}パス)`,
    enterCustomPath: "カスタムパスを入力",
    offlineUnableToSpawn: "オフラインのため新しいセッションを生成できません",
  },

  sidebar: {
    sessionsTitle: "Happy",
  },

  toolView: {
    input: "入力",
    output: "出力",
  },

  diff: {
    toolbar: {
      unified: "統合",
      split: "分割",
      expand: "展開",
      collapse: "折りたたむ",
      copyDiff: "コピー",
      copied: "コピー済み!",
    },
  },

  codeReview: {
    accept: "承認",
    reject: "拒否",
    accepted: "承認済み",
    rejected: "拒否済み",
    rejectConfirmTitle: "変更を拒否",
    rejectConfirmMessage: ({ filePath }: { filePath: string }) =>
      `Claude に ${filePath} の変更を元に戻すよう依頼しますか？`,
    rejectConfirm: "拒否して元に戻す",
  },

  tools: {
    fullView: {
      description: "説明",
      inputParams: "入力パラメータ",
      output: "出力",
      error: "エラー",
      completed: "ツールが正常に完了しました",
      noOutput: "出力がありません",
      running: "ツールを実行中...",
      rawJsonDevMode: "Raw JSON (開発モード)",
      simpleMode: "シンプル",
      developerMode: "開発者",
      simple: {
        readFile: ({ file }: { file: string }) =>
          `ファイル ${file} を読み取りました`,
        editFile: ({ file }: { file: string }) =>
          `ファイル ${file} を変更しました`,
        writeFile: ({ file }: { file: string }) =>
          `ファイル ${file} を作成しました`,
        runCommand: "コマンドを実行しました",
        searchCode: ({ pattern }: { pattern: string }) =>
          `"${pattern}" を検索しました`,
        findFiles: ({ pattern }: { pattern: string }) =>
          `"${pattern}" に一致するファイルを検索しました`,
        launchAgent: ({ type }: { type: string }) =>
          `${type} エージェントを起動しました`,
        webSearch: ({ query }: { query: string }) => `検索: ${query}`,
        fetchUrl: ({ host }: { host: string }) =>
          `${host} のコンテンツを取得しました`,
        updateTodos: ({ count }: { count: number }) =>
          `タスクリストを更新しました（${count} 件）`,
        mcpTool: ({ name }: { name: string }) =>
          `ツール ${name} を呼び出しました`,
        unknownTool: ({ name }: { name: string }) => `${name} を実行しました`,
        status: "ステータス",
        duration: "所要時間",
        fileName: "ファイル",
        command: "コマンド",
        pattern: "パターン",
        agent: "エージェント",
        query: "クエリ",
        url: "URL",
        description: "説明",
        linesAdded: ({ count }: { count: number }) => `+${count} 行追加`,
        linesRemoved: ({ count }: { count: number }) => `-${count} 行削除`,
        filesMatched: ({ count }: { count: number }) =>
          `${count} ファイルが一致`,
        succeeded: "正常に完了しました",
        failed: "失敗",
        running: "実行中...",
      },
    },
    taskView: {
      initializing: "エージェントを初期化中...",
      moreTools: ({ count }: { count: number }) => `+${count} 個のツール`,
      collapseTools: "折りたたむ",
      agentThinking: "思考中...",
      subagentRunning: ({ type }: { type: string }) => `${type} を実行中...`,
    },
    askUserQuestion: {
      submit: "回答を送信",
      multipleQuestions: ({ count }: { count: number }) => `${count}件の質問`,
      other: "その他",
      otherDescription: "自分の回答を入力",
      otherPlaceholder: "回答を入力...",
      recommended: "推奨",
    },
    multiEdit: {
      editNumber: ({ index, total }: { index: number; total: number }) =>
        `編集 ${index}/${total}`,
      replaceAll: "すべて置換",
    },
    contextMenu: {
      copyPath: "ファイルパスをコピー",
      copyCommand: "コマンドをコピー",
      copyOutput: "出力をコピー",
    },
    names: {
      task: "タスク",
      terminal: "ターミナル",
      searchFiles: "ファイル検索",
      search: "検索",
      searchContent: "コンテンツ検索",
      listFiles: "ファイル一覧",
      planProposal: "プラン提案",
      readFile: "ファイル読み取り",
      editFile: "ファイル編集",
      writeFile: "ファイル書き込み",
      fetchUrl: "URL取得",
      readNotebook: "ノートブック読み取り",
      editNotebook: "ノートブック編集",
      todoList: "Todoリスト",
      webSearch: "Web検索",
      reasoning: "推論",
      applyChanges: "ファイルを更新",
      viewDiff: "現在のファイル変更",
      question: "質問",
    },
    desc: {
      terminalCmd: ({ cmd }: { cmd: string }) => `ターミナル(cmd: ${cmd})`,
      searchPattern: ({ pattern }: { pattern: string }) =>
        `検索(pattern: ${pattern})`,
      searchPath: ({ basename }: { basename: string }) =>
        `検索(path: ${basename})`,
      fetchUrlHost: ({ host }: { host: string }) => `URL取得(url: ${host})`,
      editNotebookMode: ({ path, mode }: { path: string; mode: string }) =>
        `ノートブック編集(file: ${path}, mode: ${mode})`,
      todoListCount: ({ count }: { count: number }) =>
        `Todoリスト(count: ${count})`,
      webSearchQuery: ({ query }: { query: string }) =>
        `Web検索(query: ${query})`,
      grepPattern: ({ pattern }: { pattern: string }) =>
        `grep(pattern: ${pattern})`,
      multiEditEdits: ({ path, count }: { path: string; count: number }) =>
        `${path} (${count}件の編集)`,
      readingFile: ({ file }: { file: string }) => `${file}を読み取り中`,
      writingFile: ({ file }: { file: string }) => `${file}に書き込み中`,
      modifyingFile: ({ file }: { file: string }) => `${file}を変更中`,
      modifyingFiles: ({ count }: { count: number }) =>
        `${count}ファイルを変更中`,
      modifyingMultipleFiles: ({
        file,
        count,
      }: {
        file: string;
        count: number;
      }) => `${file} 他${count}件`,
      showingDiff: "変更を表示中",
    },
  },

  files: {
    searchPlaceholder: "ファイルを検索...",
    detachedHead: "detached HEAD",
    summary: ({ staged, unstaged }: { staged: number; unstaged: number }) =>
      `ステージ済み ${staged} • 未ステージ ${unstaged}`,
    notRepo: "Gitリポジトリではありません",
    notUnderGit: "このディレクトリはGitバージョン管理下にありません",
    searching: "ファイルを検索中...",
    noFilesFound: "ファイルが見つかりません",
    noFilesInProject: "プロジェクトにファイルがありません",
    tryDifferentTerm: "別の検索語を試してください",
    searchResults: ({ count }: { count: number }) => `検索結果 (${count})`,
    projectRoot: "プロジェクトルート",
    stagedChanges: ({ count }: { count: number }) =>
      `ステージ済みの変更 (${count})`,
    unstagedChanges: ({ count }: { count: number }) =>
      `未ステージの変更 (${count})`,
    // File viewer strings
    loadingFile: ({ fileName }: { fileName: string }) =>
      `${fileName}を読み込み中...`,
    binaryFile: "バイナリファイル",
    cannotDisplayBinary: "バイナリファイルの内容を表示できません",
    diff: "差分",
    file: "ファイル",
    fileEmpty: "ファイルは空です",
    noChanges: "表示する変更はありません",
    // Browse mode strings
    browseTab: "ブラウズ",
    changesTab: "変更",
    directory: "ディレクトリ",
    emptyDirectory: "このディレクトリは空です",
    submodule: "サブモジュール",
    submoduleNotInitialized: "未初期化",
    childReposSummary: ({ count }: { count: number }) =>
      `${count} 個の Git リポジトリ`,
  },

  changes: {
    summary: ({ files }) => `${files} ファイル変更`,
    noChanges: "このセッションではファイルの変更はありません",
    editCount: ({ count }) => `${count} 箇所の編集`,
  },

  settingsVoice: {
    // Voice settings screen
    languageTitle: "言語",
    languageDescription:
      "音声アシスタントの操作に使用する言語を選択します。この設定はすべてのデバイスで同期されます。",
    preferredLanguage: "優先言語",
    preferredLanguageSubtitle: "音声アシスタントの応答に使用する言語",
    language: {
      searchPlaceholder: "言語を検索...",
      title: "言語",
      footer: ({ count }: { count: number }) => `${count}言語が利用可能`,
      autoDetect: "自動検出",
    },
    // TTS provider settings
    ttsProviderTitle: "TTS プロバイダー",
    ttsProviderDescription:
      "無料の Edge TTS または自分の API キーで有料の ElevenLabs TTS を選択できます。",
    ttsProviderEdge: "Edge TTS（無料）",
    ttsProviderEdgeSubtitle: "Microsoft Edge TTS、無料で無制限",
    ttsProviderElevenLabs: "ElevenLabs（有料）",
    ttsProviderElevenLabsSubtitle: "高品質、自分の API キーが必要",
    elevenLabsApiKey: "API キー",
    elevenLabsApiKeyPlaceholder: "ElevenLabs API キーを入力",
    elevenLabsVoiceId: "Voice ID",
    elevenLabsVoiceIdPlaceholder: "デフォルト：Rachel",
    elevenLabsVoiceIdSubtitle: "空欄でデフォルト音声（Rachel）を使用",
  },

  voiceStatusBar: {
    connecting: "接続中...",
    connectionError: "接続エラー",
    listening: "聞いています...",
    processing: "処理中...",
    speaking: "再生中",
    voiceAssistantActive: "音声アシスタント有効",
    voiceAssistant: "音声アシスタント",
    tapToEnd: "タップして終了",
    permissionRequested: ({ toolName }: { toolName: string }) =>
      `${toolName} の権限リクエスト`,
    done: "完了。",
  },

  settingsAccount: {
    // Account settings screen
    accountInformation: "アカウント情報",
    status: "ステータス",
    statusActive: "アクティブ",
    statusNotAuthenticated: "未認証",
    anonymousId: "匿名ID",
    publicId: "公開ID",
    notAvailable: "利用不可",
    linkNewDevice: "新しいデバイスをリンク",
    linkNewDeviceSubtitle: "QRコードをスキャンしてデバイスをリンク",
    profile: "プロフィール",
    name: "名前",
    github: "GitHub",
    tapToDisconnect: "タップして切断",
    server: "サーバー",
    backup: "バックアップ",
    backupDescription:
      "シークレットキーはアカウントを復元する唯一の方法です。パスワードマネージャーなどの安全な場所に保存してください。",
    secretKey: "シークレットキー",
    tapToReveal: "タップして表示",
    tapToHide: "タップして非表示",
    secretKeyLabel: "シークレットキー (タップでコピー)",
    secretKeyCopied:
      "シークレットキーがクリップボードにコピーされました。安全な場所に保管してください！",
    secretKeyCopyFailed: "シークレットキーのコピーに失敗しました",
    privacy: "プライバシー",
    privacyDescription:
      "匿名の使用データを共有してアプリの改善にご協力ください。個人情報は収集されません。",
    analytics: "アナリティクス",
    analyticsDisabled: "データは共有されません",
    analyticsEnabled: "匿名の使用データが共有されます",
    dangerZone: "危険ゾーン",
    logout: "ログアウト",
    logoutSubtitle: "サインアウトしてローカルデータを消去",
    logoutConfirm:
      "ログアウトしてもよろしいですか？シークレットキーのバックアップを取っていることを確認してください！",
  },

  settingsLanguage: {
    // Language settings screen
    title: "言語",
    description:
      "アプリインターフェースの言語を選択します。この設定はすべてのデバイスで同期されます。",
    currentLanguage: "現在の言語",
    automatic: "自動",
    automaticSubtitle: "デバイス設定から検出",
    needsRestart: "言語が変更されました",
    needsRestartMessage:
      "新しい言語設定を適用するにはアプリの再起動が必要です。",
    restartNow: "今すぐ再起動",
  },

  connectButton: {
    authenticate: "ターミナルを認証",
    authenticateWithUrlPaste: "URLペーストでターミナルを認証",
    pasteAuthUrl: "ターミナルから認証URLを貼り付け",
  },

  updateBanner: {
    updateAvailable: "アップデートが利用可能",
    pressToApply: "タップしてアップデートを適用",
    whatsNew: "新機能",
    seeLatest: "最新のアップデートと改善を確認",
    nativeUpdateAvailable: "アプリのアップデートが利用可能",
    tapToUpdateAppStore: "タップしてApp Storeで更新",
    tapToUpdatePlayStore: "タップしてPlay Storeで更新",
  },

  changelog: {
    // Used by the changelog screen
    version: ({ version }: { version: string }) => `バージョン ${version}`,
    noEntriesAvailable: "変更履歴はありません。",
  },

  terminal: {
    // Used by terminal connection screens
    webBrowserRequired: "Webブラウザが必要です",
    webBrowserRequiredDescription:
      "ターミナル接続リンクはセキュリティ上の理由からWebブラウザでのみ開くことができます。QRコードスキャナーを使用するか、コンピューターでこのリンクを開いてください。",
    processingConnection: "接続を処理中...",
    invalidConnectionLink: "無効な接続リンク",
    invalidConnectionLinkDescription:
      "接続リンクが見つからないか無効です。URLを確認して再試行してください。",
    connectTerminal: "ターミナルを接続",
    terminalRequestDescription:
      "ターミナルがHappy Coderアカウントへの接続を要求しています。これにより、ターミナルは安全にメッセージを送受信できるようになります。",
    connectionDetails: "接続の詳細",
    publicKey: "公開鍵",
    encryption: "暗号化",
    endToEndEncrypted: "エンドツーエンド暗号化",
    acceptConnection: "接続を承認",
    connecting: "接続中...",
    reject: "拒否",
    security: "セキュリティ",
    securityFooter:
      "この接続リンクはブラウザ内で安全に処理され、サーバーには送信されませんでした。あなたのプライベートデータは安全に保たれ、メッセージを復号できるのはあなただけです。",
    securityFooterDevice:
      "この接続はデバイス上で安全に処理され、サーバーには送信されませんでした。あなたのプライベートデータは安全に保たれ、メッセージを復号できるのはあなただけです。",
    clientSideProcessing: "クライアントサイド処理",
    linkProcessedLocally: "リンクはブラウザ内でローカルに処理されました",
    linkProcessedOnDevice: "リンクはデバイス上でローカルに処理されました",
  },

  modals: {
    // Used across connect flows and settings
    authenticateTerminal: "ターミナルを認証",
    pasteUrlFromTerminal: "ターミナルから認証URLを貼り付けてください",
    deviceLinkedSuccessfully: "デバイスが正常にリンクされました",
    terminalConnectedSuccessfully: "ターミナルが正常に接続されました",
    invalidAuthUrl: "無効な認証URL",
    developerMode: "開発者モード",
    developerModeEnabled: "開発者モードが有効になりました",
    developerModeDisabled: "開発者モードが無効になりました",
    disconnectGithub: "GitHubを切断",
    disconnectGithubConfirm: "GitHubアカウントを切断してもよろしいですか？",
    disconnectService: ({ service }: { service: string }) => `${service}を切断`,
    disconnectServiceConfirm: ({ service }: { service: string }) =>
      `${service}をアカウントから切断してもよろしいですか？`,
    disconnect: "切断",
    failedToConnectTerminal: "ターミナルの接続に失敗しました",
    cameraPermissionsRequiredToConnectTerminal:
      "ターミナルの接続にはカメラの権限が必要です",
    failedToLinkDevice: "デバイスのリンクに失敗しました",
    cameraPermissionsRequiredToScanQr:
      "QRコードのスキャンにはカメラの権限が必要です",
  },

  navigation: {
    // Navigation titles and screen headers
    connectTerminal: "ターミナルを接続",
    linkNewDevice: "新しいデバイスをリンク",
    restoreWithSecretKey: "シークレットキーで復元",
    whatsNew: "新機能",
    friends: "友達",
  },

  welcome: {
    // Main welcome screen for unauthenticated users
    title: "CodexとClaude Codeのモバイルクライアント",
    subtitle:
      "エンドツーエンド暗号化され、アカウントはデバイスにのみ保存されます。",
    createAccount: "アカウントを作成",
    linkOrRestoreAccount: "アカウントをリンクまたは復元",
    loginWithMobileApp: "モバイルアプリでログイン",
    loginWithSecretKey: "シークレットキーでログイン",
  },

  review: {
    // Used by utils/requestReview.ts
    enjoyingApp: "アプリを気に入っていただけましたか？",
    feedbackPrompt: "ご意見をお聞かせください！",
    yesILoveIt: "はい、気に入りました！",
    notReally: "あまり...",
  },

  items: {
    // Used by Item component for copy toast
    copiedToClipboard: ({ label }: { label: string }) =>
      `${label}がクリップボードにコピーされました`,
  },

  machine: {
    launchNewSessionInDirectory: "ディレクトリで新しいセッションを起動",
    offlineUnableToSpawn: "マシンがオフラインのためランチャーは無効です",
    offlineHelp:
      "• コンピューターがオンラインであることを確認してください\n• `happy daemon status`を実行して診断してください\n• 最新のCLIバージョンを使用していますか？`npm install -g happy-coder@latest`でアップグレードしてください",
    daemon: "デーモン",
    status: "ステータス",
    stopDaemon: "デーモンを停止",
    lastKnownPid: "最後に確認されたPID",
    lastKnownHttpPort: "最後に確認されたHTTPポート",
    startedAt: "開始時刻",
    cliVersion: "CLIバージョン",
    daemonStateVersion: "デーモン状態バージョン",
    activeSessions: ({ count }: { count: number }) =>
      `アクティブセッション (${count})`,
    machineGroup: "マシン",
    host: "ホスト",
    machineId: "マシンID",
    username: "ユーザー名",
    homeDirectory: "ホームディレクトリ",
    platform: "プラットフォーム",
    architecture: "アーキテクチャ",
    lastSeen: "最終確認",
    never: "なし",
    metadataVersion: "メタデータバージョン",
    untitledSession: "無題のセッション",
    back: "戻る",
  },

  message: {
    switchedToMode: ({ mode }: { mode: string }) =>
      `${mode}モードに切り替えました`,
    unknownEvent: "不明なイベント",
    usageLimitUntil: ({ time }: { time: string }) => `${time}まで使用制限中`,
    usageLimitReached:
      "使用制限に達しました。しばらく待ってから再試行してください。",
    unknownTime: "不明な時間",
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
    turnCount: ({ count }: { count: number }) => `${count} ターン`,
    thinkingMarker: "思考中",
  },

  codex: {
    // Codex permission dialog buttons
    permissions: {
      yesForSession: "はい、このセッションでは確認しない",
      stopAndExplain: "停止して、何をすべきか説明",
    },
  },

  claude: {
    // Claude permission dialog buttons
    permissions: {
      yesAllowAllEdits: "はい、このセッション中のすべての編集を許可",
      yesForTool: "はい、このツールについては確認しない",
      noTellClaude: "いいえ、フィードバックを提供",
    },
  },

  plan: {
    approve: "プランを承認",
    approveAutoEdits: "承認して編集も自動承認",
    rejectWithFeedback: "フィードバック付きで拒否",
    rejectTitle: "なぜこのプランを拒否しますか？",
    rejectMessage: "フィードバックはClaudeのプラン改善に役立ちます",
    rejectPlaceholder: "変更すべき点を説明してください...",
  },

  textSelection: {
    // Text selection screen
    selectText: "テキスト範囲を選択",
    title: "テキストを選択",
    noTextProvided: "テキストが提供されていません",
    textNotFound: "テキストが見つからないか期限切れです",
    textCopied: "テキストがクリップボードにコピーされました",
    failedToCopy: "テキストのクリップボードへのコピーに失敗しました",
    noTextToCopy: "コピーできるテキストがありません",
  },

  markdown: {
    // Markdown copy functionality
    codeCopied: "コードをコピーしました",
    copyFailed: "コピーに失敗しました",
    mermaidCopied: "Mermaidソースコードをコピーしました",
    mermaidRenderFailed: "Mermaidダイアグラムのレンダリングに失敗しました",
  },

  artifacts: {
    // Artifacts feature
    title: "アーティファクト",
    countSingular: "1件のアーティファクト",
    countPlural: ({ count }: { count: number }) =>
      `${count}件のアーティファクト`,
    empty: "アーティファクトはまだありません",
    emptyDescription: "最初のアーティファクトを作成して始めましょう",
    new: "新規アーティファクト",
    edit: "アーティファクトを編集",
    delete: "削除",
    updateError: "アーティファクトの更新に失敗しました。再試行してください。",
    notFound: "アーティファクトが見つかりません",
    discardChanges: "変更を破棄しますか？",
    discardChangesDescription:
      "保存されていない変更があります。破棄してもよろしいですか？",
    deleteConfirm: "アーティファクトを削除しますか？",
    deleteConfirmDescription: "この操作は取り消せません",
    titleLabel: "タイトル",
    titlePlaceholder: "アーティファクトのタイトルを入力",
    bodyLabel: "コンテンツ",
    bodyPlaceholder: "ここにコンテンツを書いてください...",
    emptyFieldsError: "タイトルまたはコンテンツを入力してください",
    createError: "アーティファクトの作成に失敗しました。再試行してください。",
    save: "保存",
    saving: "保存中...",
    loading: "アーティファクトを読み込み中...",
    error: "アーティファクトの読み込みに失敗しました",
  },

  friends: {
    // Friends feature
    title: "友達",
    manageFriends: "友達とつながりを管理",
    searchTitle: "友達を探す",
    pendingRequests: "友達リクエスト",
    myFriends: "マイフレンド",
    noFriendsYet: "まだ友達がいません",
    findFriends: "友達を探す",
    remove: "削除",
    pendingRequest: "保留中",
    sentOn: ({ date }: { date: string }) => `送信日: ${date}`,
    accept: "承認",
    reject: "拒否",
    addFriend: "友達を追加",
    alreadyFriends: "既に友達です",
    requestPending: "リクエスト保留中",
    searchInstructions: "友達を検索するにはユーザー名を入力してください",
    searchPlaceholder: "ユーザー名を入力...",
    searching: "検索中...",
    userNotFound: "ユーザーが見つかりません",
    noUserFound: "そのユーザー名のユーザーが見つかりません",
    checkUsername: "ユーザー名を確認して再試行してください",
    howToFind: "友達を見つける方法",
    findInstructions:
      "ユーザー名で友達を検索します。友達リクエストを送信するには、両方のユーザーがGitHubを接続している必要があります。",
    requestSent: "友達リクエストが送信されました！",
    requestAccepted: "友達リクエストが承認されました！",
    requestRejected: "友達リクエストが拒否されました",
    friendRemoved: "友達が削除されました",
    confirmRemove: "友達を削除",
    confirmRemoveMessage: "この友達を削除してもよろしいですか？",
    cannotAddYourself: "自分自身に友達リクエストを送信することはできません",
    bothMustHaveGithub:
      "友達になるには、両方のユーザーがGitHubを接続している必要があります",
    status: {
      none: "未接続",
      requested: "リクエスト送信済み",
      pending: "リクエスト保留中",
      friend: "友達",
      rejected: "拒否済み",
    },
    acceptRequest: "リクエストを承認",
    removeFriend: "友達を削除",
    removeFriendConfirm: ({ name }: { name: string }) =>
      `${name}さんを友達から削除してもよろしいですか？`,
    requestSentDescription: ({ name }: { name: string }) =>
      `${name}さんに友達リクエストが送信されました`,
    requestFriendship: "友達リクエストを送信",
    cancelRequest: "友達リクエストをキャンセル",
    cancelRequestConfirm: ({ name }: { name: string }) =>
      `${name}さんへの友達リクエストをキャンセルしますか？`,
    denyRequest: "友達リクエストを拒否",
    nowFriendsWith: ({ name }: { name: string }) =>
      `${name}さんと友達になりました`,
  },

  usage: {
    // Usage panel strings
    today: "今日",
    last7Days: "過去7日間",
    last30Days: "過去30日間",
    totalTokens: "合計トークン",
    totalCost: "合計コスト",
    tokens: "トークン",
    cost: "コスト",
    usageOverTime: "使用量の推移",
    byModel: "モデル別",
    byTokenType: "トークンタイプ別",
    noData: "使用データがありません",
  },

  feed: {
    // Feed notifications for friend requests and acceptances
    friendRequestFrom: ({ name }: { name: string }) =>
      `${name}さんから友達リクエストが届きました`,
    friendRequestGeneric: "新しい友達リクエスト",
    friendAccepted: ({ name }: { name: string }) =>
      `${name}さんと友達になりました`,
    friendAcceptedGeneric: "友達リクエストが承認されました",
  },

  git: {
    title: "Git",
    tabChanges: "変更",
    tabHistory: "履歴",
    tabBranches: "ブランチ",
    tabStash: "スタッシュ",
    tabIssues: "Issues",
    tabPRs: "PR",
    historyEmpty: "コミットはまだありません",
    historyLoading: "コミットを読み込み中...",
    historyLoadMore: "さらに読み込み中...",
    historyNoMore: "すべてのコミットを読み込みました",
    commitFiles: ({ count }: { count: number }) => `${count}ファイル変更`,
    localBranches: "ローカルブランチ",
    remoteBranches: "リモートブランチ",
    currentBranch: "現在",
    noBranches: "ブランチが見つかりません",
    noUpstream: "アップストリームなし",
    createBranch: "ブランチを作成",
    enterBranchName: "ブランチ名を入力",
    branchNamePlaceholder: "feature/my-branch",
    switchBranchSuccess: ({ name }: { name: string }) =>
      `'${name}' に切り替えました`,
    createBranchSuccess: ({ name }: { name: string }) =>
      `ブランチ '${name}' を作成しました`,
    dirtyWorkingTree:
      "ブランチを切り替える前に変更をコミットまたはスタッシュしてください",
    branchSwitchFailed: "ブランチの切り替えに失敗しました",
    branchCreateFailed: "ブランチの作成に失敗しました",
    invalidBranchName: "無効なブランチ名",
    branchAlreadyExists: ({ name }: { name: string }) =>
      `ブランチ '${name}' はすでに存在します`,
    stashEmpty: "スタッシュされた変更はありません",
    stashFiles: ({ count }: { count: number }) => `${count}ファイル変更`,
    // Repo selector
    rootRepo: "ルート",
    // Remote operations
    fetch: "フェッチ",
    pull: "プル",
    push: "プッシュ",
    fetchSuccess: "リモートからフェッチしました",
    pullSuccess: "リモートからプルしました",
    pushSuccess: "リモートにプッシュしました",
    fetchFailed: "リモートからのフェッチに失敗しました",
    pullFailed: "リモートからのプルに失敗しました",
    pushFailed: "リモートへのプッシュに失敗しました",
    noUpstreamHint: "上流ブランチ未設定",
    upToDate: "最新の状態",
    stage: "ステージ",
    unstage: "ステージ解除",
    discard: "破棄",
    addToGitignore: ".gitignoreに追加",
    commit: "コミット",
    stageAll: "すべてステージ",
    unstageAll: "すべてステージ解除",
    discardAll: "すべて破棄",
    stageSuccess: "ファイルをステージしました",
    unstageSuccess: "ファイルのステージを解除しました",
    discardSuccess: "変更を破棄しました",
    gitignoreSuccess: ".gitignoreに追加しました",
    commitSuccess: "変更をコミットしました",
    stageFailed: "ファイルのステージに失敗しました",
    unstageFailed: "ステージ解除に失敗しました",
    discardFailed: "変更の破棄に失敗しました",
    gitignoreFailed: ".gitignoreへの追加に失敗しました",
    commitFailed: "コミットに失敗しました",
    discardConfirmTitle: "変更を破棄しますか？",
    discardConfirmMessage: ({ count }) =>
      `${count}件のファイルの変更が完全に元に戻されます。この操作は取り消せません。`,
    discardAllConfirmMessage:
      "未ステージの変更がすべて永久に失われます。この操作は取り消せません。",
    selectedCount: ({ count }) => `${count}件選択中`,
    commitMessagePlaceholder: "コミットメッセージを入力...",
    noStagedFiles: "コミットするステージ済みファイルがありません",
  },

  issues: {
    open: "オープン",
    closed: "クローズ",
    loading: "Issue を読み込み中...",
    noIssues: "Issue が見つかりません",
    noRepo: "GitHub/Gitea リポジトリが検出されません",
    noBody: "説明はありません",
    sendToChat: "チャットに送信",
    openInBrowser: "ブラウザで開く",
    closeIssue: "Issue をクローズ",
    reopenIssue: "Issue を再オープン",
    addComment: "コメントを追加",
    commentPlaceholder: "コメントを入力...",
    newIssue: "新規Issue",
    newIssueTitlePlaceholder: "Issueのタイトル...",
    newIssueBody: "説明（任意）",
    newIssueBodyPlaceholder: "問題を説明してください...",
    pageOf: ({ page }: { page: number }) => `${page} ページ`,
    launchSession: "セッションを開始",
    viewProcessingSession: "処理中のセッションを表示",
    processing: "処理中",
    launchFailed: ({ error }: { error: string }) =>
      `セッションの開始に失敗しました：${error}`,
    autoClosedComment: ({ branchName }: { branchName: string }) =>
      `このIssueはHappy Coderによって処理されました。ブランチ：${branchName}`,
    editIssue: "Issueを編集",
    editTitle: "Issueタイトルを編集",
    editTitlePlaceholder: "Issueタイトル...",
    editBody: "Issue本文を編集",
    editBodyPlaceholder: "Issueの詳細を記述...",
    sortBy: "並び替え",
    sortCreated: "作成日",
    sortUpdated: "更新日",
    sortComments: "コメント数",
    noOpenIssues: "未解決の課題はありません",
    noClosedIssues: "解決済みの課題はありません",
    tryClosedHint: "解決済みの課題を見てみましょう",
    createFirstIssue: "課題を作成",
    createIssueTitle: "課題を作成",
    labelSelect: "ラベル",
    noLabelsAvailable: "利用可能なラベルがありません",
    createButton: "作成",
    statusProcessing: "処理中",
    statusCompleted: "完了",
    statusFailed: "失敗",
    statusCancelled: "キャンセル済み",
    sectionMetadata: "メタデータ",
    sectionDescription: "説明",
    sectionWorktree: "ワークツリー",
    metaRepository: "リポジトリ",
    metaAuthor: "作成者",
    metaLabels: "ラベル",
    metaCreated: "作成日",
    metaBranch: "ブランチ",
    metaParentBranch: "親ブランチ",
    noDescriptionProvided: "説明はありません",
    sectionTask: "タスク指示",
    cannotArchiveProcessing:
      "このセッションはイシューを処理中です。完了するまでお待ちください。",
  },

  prs: {
    open: "オープン",
    closed: "クローズ",
    all: "すべて",
    draft: "下書き",
    loading: "PR を読み込み中...",
    noRepo: "GitHub/Gitea リポジトリが検出されません",
    noOpenPRs: "オープンな PR はありません",
    noClosedPRs: "クローズされた PR はありません",
    noPRs: "PR が見つかりません",
    tryClosedHint: "クローズされた PR を表示してみてください",
    sortBy: "並び替え",
    sortCreated: "作成日",
    sortUpdated: "更新日",
    ci_pending: "保留中",
    ci_success: "成功",
    ci_failure: "失敗",
    ci_error: "エラー",
    review_approved: "承認済み",
    review_changes_requested: "変更要求",
    review_commented: "レビュー済み",
    review_pending: "レビュー待ち",
    review_dismissed: "却下",
    merged: "マージ済み",
    noBody: "説明なし",
    viewChanges: "変更を表示",
    files: "ファイル",
    merge: "マージ",
    mergeCommit: "マージコミット",
    squashMerge: "スカッシュマージ",
    rebaseMerge: "リベースマージ",
    recommended: "推奨",
    chooseMergeMethod: "マージ方法を選択",
    approve: "承認",
    approved: "承認しました！",
    cannotApproveOwn: "自分のPRは承認できません",
    closePR: "PR を閉じる",
    addComment: "コメントを追加",
    commentPlaceholder: "コメントを入力...",
    openInBrowser: "ブラウザで開く",
    ciChecks: "CIチェック",
    reviews: "レビュー",
    comments: "コメント",
    noChecks: "CIチェックが見つかりません",
    noReviews: "レビューはまだありません",
    noComments: "コメントはまだありません",
    loadFailed: "データの読み込みに失敗しました",
    mergeHint: "今すぐコードをベースブランチにマージ",
    approveHint: "レビューのみ、マージしません",
  },

  gitHosts: {
    title: "Git ホスト",
    description:
      "どの Git ホストが GitHub API または Gitea API を使用するかを設定します。GitHub.com は自動的に検出されます。その他のホストはデフォルトで Gitea を使用します。",
    empty:
      "カスタムホストは設定されていません。GitHub.com は自動的に検出され、その他のホストはデフォルトで Gitea を使用します。",
    addHost: "ホストを追加",
    editHost: "ホストを編集",
    tabBasic: "基本情報",
    tabAutoIssue: "自動Issue",
    tabWebhooks: "Webhooks",
    hostLabel: "ホスト",
    providerLabel: "プロバイダー",
    tokenLabel: "API Token",
    tokenPlaceholder: "任意 — プライベートリポジトリには必須",
    tokenHint:
      "Giteaの 設定 → アプリケーション → アクセストークン で生成してください。必要なスコープ：issue、repository、admin:repo_hook。",
    tokenHintGitHub:
      "admin:repo_hook スコープの Personal Access Token。保存時に Webhook を自動作成します。",
    deleteTitle: "ホストを削除",
    deleteMessage: ({ host }: { host: string }) =>
      `"${host}" を設定済みホストから削除しますか？`,
    duplicateTitle: "重複するホスト",
    duplicateMessage: ({ host }: { host: string }) =>
      `"${host}" はすでに設定されています。`,
    autoIssueSectionTitle: "自動課題セッション",
    autoIssueDescription:
      "指定されたラベルの付いた課題を検出すると、Claude Code セッションを自動的に起動します。許可された作成者の課題のみがトリガーされます。",
    autoIssueLabel: "トリガーラベル",
    autoIssueLabelPlaceholder: "例: claude, auto-fix",
    autoIssueAllowedAuthors: "許可された作成者",
    autoIssueAllowedAuthorsPlaceholder: "ユーザー名1, ユーザー名2",
    webhookSectionTitle: "Webhook リポジトリ",
    webhookDescription:
      "Git ホストから Webhook イベントを受信し、ポーリングなしで自動的に Issue を処理します。以下に監視するリポジトリを追加してください。",
    webhookAddRepo: "Webhook リポジトリを追加",
    webhookRemoveRepo: "削除",
    webhookRepoUrl: "リポジトリ URL",
    webhookRepoUrlPlaceholder: "https://github.com/owner/repo",
    webhookMachineId: "対象マシン",
    webhookMachineIdPlaceholder: "マシンを選択",
    webhookRepoPath: "ローカルリポジトリパス",
    webhookRepoPathPlaceholder: "/path/to/repo",
    webhookSecretLabel: "Webhook Secret",
    webhookSecretCopied: "Secret をクリップボードにコピーしました",
    webhookUrlLabel: "Webhook URL",
    webhookUrlCopied: "URL をクリップボードにコピーしました",
    webhookUrlHint:
      "リポジトリの Webhook 設定にこの URL と Secret を設定してください。",
    webhookSyncSuccess: "Webhook ルートが同期されました",
    webhookSyncError: "Webhook ルートの同期に失敗しました",
    webhookNoMachines: "利用可能なマシンがありません",
    scanRepos: "リポジトリをスキャン",
    scanning: "スキャン中...",
    scanEmpty: "このマシンに git リポジトリが見つかりません",
    scanError: "スキャン失敗 — マシンがオンラインであることを確認してください",
    scanSearchPlaceholder: "リポジトリを検索...",
    webhookGuideTitle: ({ provider }: { provider: string }) =>
      `${provider} Webhook セットアップ`,
    guideStep1GitHub: "リポジトリ → Settings → Webhooks → Add webhook に移動",
    guideStep1Gitea:
      "リポジトリ → Settings → Webhooks → Add Webhook → Gitea に移動",
    guideStep2: "下に表示されている Webhook URL を貼り付け",
    guideStep3: "下に表示されている Webhook Secret を貼り付け",
    guideStep4: "Content type：「application/json」を選択",
    guideStep5: "Events：「Issues」のみを選択して保存",
    webhookTestSuccess: "サーバーに到達可能",
    webhookTestFail: ({ status }: { status: string }) =>
      `サーバーが HTTP ${status} を返しました`,
    webhookTestError:
      "サーバーに到達できません — ネットワークを確認してください",
    remoteWebhookSuccess: "リモートリポジトリに Webhook を作成しました",
    remoteWebhookFail: ({ error }: { error: string }) =>
      `リモート Webhook の作成に失敗: ${error}`,
    tokenRequiredForRemote:
      "リモートで Webhook を自動作成するには API トークンが必要です",
    webhookRepoSaved: "Webhook を保存しました",
    webhookFieldsRequired: "リポジトリURL、マシン、シークレットを入力してください",
    webhookSaveHostFirst: "先に Git Host の基本情報を保存してください",
    webhookRepoDeleted: "Webhook を削除しました",
    webhookDeleteConfirm: "この Webhook リポジトリを削除しサーバールートもクリアしますか？",
  },

  quickCommands: {
    searchPlaceholder: "コマンドを検索...",
    noResults: "コマンドが見つかりません",
    groups: {
      favorites: "お気に入り",
      root: "プロジェクトスクリプト",
      shell: "シェルコマンド",
    },
  },

  kanban: {
    emptyTitle: "タスクはまだありません",
    emptySubtitle: "最初のタスクを作成して作業を整理しましょう",
    newTask: "新規タスク",
    taskDetail: "タスク詳細",
    taskNotFound: "タスクが見つかりません",
    details: "詳細",
    titlePlaceholder: "タスクタイトル",
    titleRequired: "タイトルは必須です",
    descriptionPlaceholder: "説明（任意）",
    column: "ステータス",
    priorityLabel: "優先度",
    machine: "マシン",
    machineOnline: "オンライン",
    machineOffline: "オフライン",
    directory: "ディレクトリ",
    directoryHint: "セッションの作業ディレクトリ",
    sessionPromptLabel: "セッションプロンプト",
    sessionPromptPlaceholder: "このタスク開始時にClaudeへ送る指示...",
    sessionPromptHint:
      "このタスクからセッションを作成する際の事前入力プロンプト",
    linkedSessions: "リンクされたセッション",
    actionsLabel: "アクション",
    startSession: "セッション開始",
    noMachineSelected: "先にマシンを選択してください",
    machineNotOnline: "選択されたマシンはオフラインです",
    noDirectory: "作業ディレクトリを指定してください",
    spawnFailed: "セッションの開始に失敗しました",
    sessionNotFound: "セッションが見つかりません",
    sessionActive: "アクティブ",
    sessionInactive: "非アクティブ",
    deleteConfirmTitle: "タスクを削除",
    deleteConfirmMessage: "このタスクを削除してもよろしいですか？",
    actions: {
      moveTo: "移動先",
    },
    stats: {
      totalTasks: ({ count }: { count: number }) => `${count} タスク`,
      activeSessions: ({ count }: { count: number }) => `${count} アクティブ`,
    },
    columns: {
      backlog: "バックログ",
      todo: "ToDo",
      inProgress: "進行中",
      review: "レビュー",
      done: "完了",
    },
    columnEmpty: {
      backlog: {
        title: "バックログなし",
        subtitle: "計画待ちのタスクがここに表示されます",
      },
      todo: {
        title: "未着手のタスクなし",
        subtitle: "作業準備ができたタスクを追加してください",
      },
      inProgress: {
        title: "進行中のタスクなし",
        subtitle: "作業開始時にタスクをここに移動します",
      },
      review: {
        title: "レビュー待ちなし",
        subtitle: "レビュー待ちのタスクがここに表示されます",
      },
      done: {
        title: "完了タスクなし",
        subtitle: "完了したタスクがここに表示されます",
      },
    },
    priority: {
      low: "低",
      medium: "中",
      high: "高",
      urgent: "緊急",
    },
    templates: {
      pickTitle: "テンプレートを選択",
      useTemplate: "テンプレートを使用",
      manage: "テンプレート管理",
      title: "プロンプトテンプレート",
      newTemplate: "新規テンプレート",
      editing: "テンプレートを編集",
      namePlaceholder: "テンプレート名",
      contentPlaceholder:
        "テンプレート内容...\n{{title}}、{{description}}、{{directory}}、{{tags}} を変数として使用",
      deleteTitle: "テンプレートを削除",
      deleteMessage: "このテンプレートを削除してもよろしいですか？",
      builtInBadge: "組み込み",
      empty: "テンプレートはまだありません",
      builtIn: {
        coding: "コード開発",
        bugfix: "バグ修正",
        review: "コードレビュー",
      },
    },
  },

  projects: {
    notFound: "プロジェクトが見つかりません",
    emptyTitle: "プロジェクトなし",
    emptySubtitle: "CLIを接続するとプロジェクトがここに表示されます",
    allProjects: "すべてのプロジェクト",
    tabSessions: "セッション",
    tabGit: "Git",
    tabHealth: "ヘルス",
    tabResearch: "調査",
    noSessions: "セッションはまだありません",
    sessions: "セッション",
    noGitInfo: "git情報はありません",
    gitInfo: "Git情報",
    branch: "ブランチ",
    ahead: "先行",
    behind: "遅延",
    dirty: "未コミットの変更",
    branchAndRemote: "ブランチとリモート",
    upstreamBranch: "上流ブランチ",
    remoteUrl: "リモート",
    fileChanges: "ファイル変更",
    modifiedCount: "変更済み",
    untrackedCount: "未追跡",
    stagedCount: "ステージ済み",
    lineChanges: "行の変更",
    stagedLines: "ステージ済み",
    unstagedLines: "未ステージ",
    stash: "Stash",
    stashCount: "Stash エントリ",
    gitHost: "Git ホスト",
    addGitHost: "Git ホストを追加",
    noRemoteUrl: "リモートURLが検出されません",
    lastUpdated: "最終更新",
  },
  project: {
    segments: {
      ideas: "アイデア",
      board: "ボード",
      roadmap: "ロードマップ",
    },
  },

  ideation: {
    // アイデア管理
    emptyTitle: "アイデアはまだありません",
    emptySubtitle: "アイデアを記録し、最適なものをタスクに変換",
    newIdea: "新しいアイデア",
    ideaDetail: "アイデア詳細",
    ideaNotFound: "アイデアが見つかりません",
    details: "詳細",
    titlePlaceholder: "アイデアのタイトル",
    titleRequired: "タイトルは必須です",
    descriptionPlaceholder: "アイデアを説明してください...",
    categoryLabel: "カテゴリ",
    categories: {
      feature: "機能",
      improvement: "改善",
      bugfix: "バグ修正",
      refactor: "リファクタリング",
      documentation: "ドキュメント",
      other: "その他",
    },
    statusLabel: "ステータス",
    statuses: {
      draft: "下書き",
      active: "アクティブ",
      converted: "変換済み",
      dismissed: "却下済み",
    },
    priorityLabel: "優先度",
    convertToTask: "タスクに変換",
    convertConfirmTitle: "タスクに変換",
    convertConfirmMessage: "このアイデアから新しいカンバンタスクを作成します。",
    dismiss: "却下",
    dismissConfirmTitle: "アイデアを却下",
    dismissConfirmMessage: "このアイデアを却下してもよろしいですか？",
    deleteConfirmTitle: "アイデアを削除",
    deleteConfirmMessage: "このアイデアを削除してもよろしいですか？",
    converted: "タスクに変換しました",
    viewTask: "タスクを見る",
    actions: {
      changeStatus: "ステータスを変更",
    },
    stats: {
      totalIdeas: ({ count }: { count: number }) => `${count} 件のアイデア`,
      activeIdeas: ({ count }: { count: number }) => `${count} 件アクティブ`,
    },
    filter: {
      all: "すべて",
    },
  },

  roadmap: {
    emptyTitle: "マイルストーンはまだありません",
    emptySubtitle:
      "マイルストーンを作成してプロジェクトのロードマップを計画しましょう",
    newMilestone: "新規マイルストーン",
    milestoneDetail: "マイルストーン詳細",
    milestoneNotFound: "マイルストーンが見つかりません",
    newFeature: "新規機能",
    featureDetail: "機能詳細",
    featureNotFound: "機能が見つかりません",
    details: "詳細",
    titlePlaceholder: "タイトル",
    titleRequired: "タイトルは必須です",
    descriptionPlaceholder: "説明...",
    targetDate: "目標日",
    targetDateNone: "目標日なし",
    milestoneLabel: "マイルストーン",
    moscow: {
      mustHave: "必須",
      shouldHave: "推奨",
      couldHave: "あれば良い",
      wontHave: "今回は不要",
    },
    moscowLabel: "優先度 (MoSCoW)",
    featureStatuses: {
      planned: "計画済み",
      inProgress: "進行中",
      completed: "完了",
      cancelled: "キャンセル",
    },
    statusLabel: "ステータス",
    complexity: {
      trivial: "極めて簡単",
      simple: "簡単",
      moderate: "普通",
      complex: "複雑",
      veryComplex: "非常に複雑",
    },
    complexityLabel: "複雑さ",
    features: "機能",
    noFeatures: "このマイルストーンには機能がありません",
    milestoneOptions: "マイルストーンオプション",
    convertToTask: "タスクに変換",
    convertConfirmTitle: "タスクに変換",
    convertConfirmMessage: "この機能から新しいカンバンタスクを作成します。",
    viewTask: "タスクを表示",
    deleteMilestoneConfirmTitle: "マイルストーンを削除",
    deleteMilestoneConfirmMessage:
      "このマイルストーン配下のすべての機能も削除されます。よろしいですか？",
    deleteFeatureConfirmTitle: "機能を削除",
    deleteFeatureConfirmMessage: "この機能を削除してもよろしいですか？",
    progress: ({ completed, total }: { completed: number; total: number }) =>
      `${completed}/${total} 完了`,
    stats: {
      totalMilestones: ({ count }: { count: number }) =>
        `${count} 件のマイルストーン`,
      totalFeatures: ({ count }: { count: number }) => `${count} 件の機能`,
    },
  },

  webNotification: {
    taskComplete: "タスク完了",
    permissionRequest: "承認が必要",
  },

  openclaw: {
    title: "OpenClaw",
    connect: "接続",
    connecting: "接続中...",
    connected: "接続済み",
    disconnect: "切断",
    notConnected: "未接続",
    notConnectedDescription:
      "OpenClawゲートウェイに接続してチャットを開始してください。",
    connectToGateway: "ゲートウェイに接続",
    connectTitle: "OpenClawに接続",
    connectDescription:
      "OpenClawゲートウェイのURLを入力してください。ゲートウェイはローカルコンピュータ上で動作します。",
    connectionSettings: "接続設定",
    gatewayUrl: "ゲートウェイURL",
    token: "アクセストークン",
    tokenDescription: "OpenClaw CLIまたはコントロールUIから生成",
    tokenPlaceholder: "アクセストークンを入力",
    password: "パスワード",
    passwordOptional: "パスワード保護されたゲートウェイ用",
    passwordPlaceholder: "必要な場合はパスワードを入力",
    connectionFailed: "接続失敗",
    checkSettings: "接続設定を確認して再試行してください。",
    connectFooter:
      "接続はローカルゲートウェイへの直接接続です。データは外部サーバーを経由しません。",
    localConnection: "ローカル接続",
    localConnectionDescription: "すべての通信はゲートウェイと直接行われます。",
    viewSessions: "セッションを表示",
    connectedTo: "接続先",
    newChat: "新しいチャット",
    recentSessions: "最近のセッション",
    noSessions: "セッションがありません。新しいチャットを開始してください。",
    chat: "チャット",
    startConversation: "OpenClawとの会話を開始",
    messagePlaceholder: "メッセージを入力...",
    pairingRequired: "ペアリングが必要",
    pairingDescription:
      "このデバイスは接続前にOpenClawゲートウェイで承認される必要があります。これは初回のみの設定です。",
    pairingInstructions: "承認方法",
    pairingStep1Title: "OpenClawを開く",
    pairingStep1Description:
      "メニューバーまたはシステムトレイのOpenClawアイコンをクリック",
    pairingStep2Title: "ペアリングリクエストを探す",
    pairingStep2Description:
      "保留中のデバイスリストで「Happy」を探してください",
    pairingStep3Title: "デバイスを承認",
    pairingStep3Description: "「承認」をクリックしてこのデバイスの接続を許可",
    retryConnection: "再接続",
    deviceInfo: "デバイス情報",
    deviceId: "デバイスID",
    newSession: "新しいセッション",
    newSessionTitle: "新しい会話を始める",
    newSessionDescription:
      "下にメッセージを入力してOpenClawとチャットを始めましょう。",
    newSessionPlaceholder: "何について話したいですか？",
    tokenCommand: "トークン取得コマンド",
    tokenCommandHint: "ターミナルでこのコマンドを実行:",
    tokenCommandValue: "clawdbot dashboard --no-open",
    tokenCommandDescription:
      'トークン付きのURLが表示されます。"?token="の後の値をコピーしてください',
    thinking: "思考中",
    usingTools: "ツールを使用中",
    errorOccurred: "エラーが発生しました",
  },
  preview: {
    title: "プレビュー",
    detectingPorts: "開発サーバーを検出中...",
    noPorts: "開発サーバーが見つかりません",
    noPortsHint: "先に開発サーバーを起動してから検出をタップしてください",
    detect: "検出",
    refresh: "更新",
    capture: "キャプチャ",
    capturing: "スクリーンショットを撮影中...",
    urlPlaceholder: "http://localhost:3000",
    customUrl: "カスタム URL",
    screenshotFailed: "スクリーンショットの撮影に失敗しました",
    devServers: "開発サーバー",
    screenshotAt: ({ url }: { url: string }) => `${url} のスクリーンショット`,
    portItem: ({ port, process }: { port: number; process: string }) =>
      `ポート ${port} — ${process}`,
    setBaseline: "ベースラインに設定",
    clearBaseline: "ベースラインをクリア",
    baselineSet: "ベースラインを保存しました",
    compare: "比較",
    comparing: "ベースラインと比較中...",
    before: "変更前",
    after: "変更後",
    diff: "差分",
    noBaseline: "ベースラインが未設定",
    noBaselineHint:
      "先にスクリーンショットを撮り、ベースラインに設定してください",
    comparisonFailed: "比較に失敗しました",
    unavailableTitle: "agent-browser が見つかりません",
    unavailableHint:
      "プレビュー機能を使用するには、CLIマシンに agent-browser をインストールしてください。実行：npm install -g @anthropic-ai/agent-browser",
    emptyHint:
      "開発サーバーを選択するか、URLを入力してフロントエンドのスクリーンショットを撮影します。",
  },
  supervisor: {
    title: "ヘルスモニター",
    description: "AIによるコード分析で、プロジェクトの健全性を多角的に監視します。",
    notSynced: "プロジェクトがサーバーに同期されていません",
    scanNow: "今すぐスキャン",
    scanStarting: "開始中...",
    loading: "読み込み中...",
    alreadyRunning: "スキャンが進行中です",
    settings: "監視設定",
    status_pending: "保留中",
    status_running: "実行中",
    status_completed: "完了",
    status_failed: "失敗",
    status_cancelled: "キャンセル",
    statusWaitingCli: "CLI待機中...",
    statusAnalyzing: "AIがコードを分析中...",
    elapsed: ({ time }: { time: string }) => `経過: ${time}`,
    triggerManual: "手動スキャン",
    triggerScheduled: "スケジュール",
    triggerEvent: "イベント",
    triggerPush: "プッシュトリガー",
    severityCritical: "重大",
    severityHigh: "高",
    severityMedium: "中",
    severityLow: "低",
    pendingActions: ({ count }: { count: number }) => `保留中のアクション (${count})`,
    actionsCount: ({ count }: { count: number }) => `${count}件のアクション`,
    approve: "承認",
    skip: "スキップ",
    ignore: "無視",
    triggerFix: "修正",
    suggestedFix: "修正案",
    fixStatus: "修正状態",
    runHistory: "実行履歴",
    noRuns: "スキャン履歴はありません",
    moreRuns: ({ count }: { count: number }) => `他${count}件`,
    justNow: "たった今",
    minutesAgo: ({ count }: { count: number }) => `${count}分前`,
    hoursAgo: ({ count }: { count: number }) => `${count}時間前`,
    daysAgo: ({ count }: { count: number }) => `${count}日前`,
    costSection: "コスト（30日間）",
    costRunsCount: "実行回数",
    costTotalTokens: "総トークン数",
    costTotalUsd: "総コスト",
    costPeriod: ({ days }: { days: number }) => `過去${days}日間`,
    trendSection: "重要度トレンド",
    relatedProjects: "関連プロジェクト",
    summaryGrade: "評価",
    trendImproving: "改善中",
    trendStable: "安定",
    trendDeclining: "悪化中",
    lastScan: "最終スキャン",
    openIssues: "未解決の問題",
    runs30d: "実行回数（30日）",
    nextRun: "次回スキャン",
    runDetail: "実行詳細",
    runTrigger: "トリガー",
    runDuration: "所要時間",
    runCost: "コスト",
    newIssues: "新規の問題",
    resolvedIssues: "解決済み",
    persistentIssues: "継続中",
    noPreviousRun: "初回スキャン — 比較対象の履歴がありません",
    dimensionsSection: "分析の次元",
    analyzingDimension: ({ dimension, index, total }) => `${dimension} (${index}/${total})`,
    dimSecurity: "セキュリティ",
    dimSecurityNote: "脆弱性、ハードコードされた秘密鍵、インジェクションリスク",
    dimDependencies: "依存関係",
    dimDependenciesNote: "古いパッケージ、バージョン競合、重複依存",
    dimArchitecture: "アーキテクチャ",
    dimArchitectureNote: "コード構成、規約準拠",
    dimTechDebt: "技術的負債",
    dimTechDebtNote: "TODO/FIXME、デッドコード、コード重複",
    dimCodeQuality: "コード品質",
    dimCodeQualityNote: "スタイル、複雑性、ベストプラクティス",
    dimTestCoverage: "テストカバレッジ",
    dimTestCoverageNote: "カバレッジの差、テスト品質",
    dimDocumentation: "ドキュメント",
    dimDocumentationNote: "README、APIドキュメント、コメントの正確性",
    dimPerformance: "パフォーマンス",
    dimPerformanceNote: "N+1クエリ、インデックス不足、メモリリーク",
    modeSection: "分析モード",
    modeSuggest: "提案",
    modeSuggestDesc: "AIが提案し、手動で承認",
    modeSemiAuto: "半自動",
    modeSemiAutoDesc: "低リスクは自動修正、高リスクは手動承認",
    modeAuto: "自動",
    modeAutoDesc: "AIが自動修正してIssue/PRを作成",
    scheduleSection: "スケジュール",
    scheduleEnabled: "定期スキャンを有効化",
    scheduleEvery6h: "6時間ごと",
    scheduleEvery12h: "12時間ごと",
    scheduleEvery24h: "24時間ごと",
    scheduleEvery48h: "48時間ごと",
    scheduleEveryWeek: "毎週",
    pushTriggerSection: "プッシュトリガー",
    pushTriggerEnabled: "プッシュ時にスキャン",
    pushTriggerDesc: "コードプッシュ時に増分分析を実行",
    customRulesSection: "カスタムルール",
    customRulesDesc: "プロジェクト固有の分析ルールを追加",
    customRulesPlaceholder: "例: すべてのAPIエンドポイントにレート制限があるか確認",
    notificationsSection: "通知",
    notifAnalysisComplete: "分析完了",
    notifIssueCreated: "Issue作成完了",
    notifPRCreated: "PR作成完了",
    notifError: "エラー",
    approveAll: "すべて承認",
    skipAll: "すべてスキップ",
    viewAllActions: "すべてのアクションを表示",
    approveAllConfirm: ({ count }: { count: number }) => `保留中の ${count} 件すべてを承認しますか？`,
    skipAllConfirm: ({ count }: { count: number }) => `保留中の ${count} 件すべてをスキップしますか？`,
    approveAllSuccess: ({ count }: { count: number }) => `${count} 件を承認しました`,
    skipAllSuccess: ({ count }: { count: number }) => `${count} 件をスキップしました`,
    clearAll: "すべてクリア",
    clearAllConfirm: "このプロジェクトのすべてのSupervisor提案が永久に削除されます。続行しますか？",
    clearAllSuccess: ({ count }: { count: number }) => `${count}件の提案をクリアしました`,

    // Phase 7: Action history
    actionHistory: "アクション履歴",
    tabPending: "保留中",
    tabApproved: "承認済み",
    tabSkipped: "スキップ",
    tabIgnored: "無視",
    noActions: "アクションなし",
    loadMore: "もっと読み込む",
    viewSession: "セッションを表示",
    exportReport: "レポートをエクスポート",
    exportCopied: "レポートがクリップボードにコピーされました",
    healthScore: "スコア",
    autoWarningTitle: "自動モードを有効にしますか？",
    autoWarningBody: "自動モードでは手動承認なしで修正を適用しIssue/PRを作成します。注意してご使用ください。",
    autoWarningConfirm: "有効化",
    autoModeSafetyNote: "自動モードは低リスクの修正に限られます。高リスクの変更は引き続き承認が必要です。",
    safetyNote: "すべての変更は独立したブランチで行われ、PRレビューが必要です。",
    dailyLimitNote: "1日のトークン制限により、コストの暴走を防ぎます。",
    runActions: "アクション",
    settingsSaved: "設定を保存しました",
    settingsSaveError: "設定の保存に失敗しました",
    recurring: "繰り返し",
  },
  webhook: {
    eventHistory: "Webhookイベント",
    noEvents: "Webhookイベントはありません",
    loadMore: "もっと読み込む",
    issue: "Issue",
  },
  competitorResearch: {
    title: "競合調査",
    description: "AI による類似製品の分析と市場ポジショニング",
    startAnalysis: "分析開始",
    analyzing: "競合を分析中...",
    knownCompetitors: "既知の競合",
    knownCompetitorsPlaceholder: "例: VS Code、Cursor、Windsurf（任意）",
    dimensionsSection: "分析ディメンション",
    dim_pricing: "価格戦略",
    dim_pricing_note: "価格モデル、プラン比較、無料枠の制限",
    dim_features: "コア機能",
    dim_features_note: "機能マトリクス、差別化機能",
    dim_devExperience: "開発者体験",
    dim_devExperience_note: "導入のしやすさ、ドキュメント品質、CLI設計",
    dim_positioning: "市場ポジショニング",
    dim_positioning_note: "ターゲットユーザー、ブランド差別化",
    dim_techStack: "技術アーキテクチャ",
    dim_techStack_note: "技術スタック、拡張性、パフォーマンス",
    dim_community: "コミュニティ＆エコシステム",
    dim_community_note: "GitHub stars、プラグイン、コミュニティ活動",
    dim_funding: "資金調達＆ビジネス",
    dim_funding_note: "資金調達ラウンド、評価額、ビジネスモデル",
    dim_userFeedback: "ユーザーフィードバック",
    dim_userFeedback_note: "レビュー、課題、満足度",
    additionalNotes: "補足メモ",
    additionalNotesPlaceholder: "追加の関心事項や具体的な質問（任意）",
    noReports: "調査レポートはありません",
    reportHistory: "過去のレポート",
    latestReport: "最新レポート",
    untitledReport: "無題のレポート",
    reportDetail: "調査レポート",
    reportNotFound: "レポートが見つかりません",
  },
} as const;
