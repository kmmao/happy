import type { TranslationStructure } from "../_default";

/**
 * Russian plural helper function
 * Russian has 3 plural forms: one, few, many
 * @param options - Object containing count and the three plural forms
 * @returns The appropriate form based on Russian plural rules
 */
function plural({
  count,
  one,
  few,
  many,
}: {
  count: number;
  one: string;
  few: string;
  many: string;
}): string {
  const n = Math.abs(count);
  const n10 = n % 10;
  const n100 = n % 100;

  // Rule: ends in 1 but not 11
  if (n10 === 1 && n100 !== 11) return one;

  // Rule: ends in 2-4 but not 12-14
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;

  // Rule: everything else (0, 5-9, 11-19, etc.)
  return many;
}

/**
 * Russian translations for the Happy app
 * Must match the exact structure of the English translations
 */
export const ru: TranslationStructure = {
  tabs: {
    // Tab navigation labels
    inbox: "Входящие",
    sessions: "Терминалы",
    project: "Проект",
    openclaw: "OpenClaw",
    settings: "Настройки",
  },

  inbox: {
    // Inbox screen
    emptyTitle: "Входящие пусты",
    emptyDescription: "Подключитесь к друзьям, чтобы начать делиться сессиями",
    updates: "Обновления",
  },

  common: {
    // Simple string constants
    cancel: "Отмена",
    authenticate: "Авторизация",
    save: "Сохранить",
    saveAs: "Сохранить как",
    error: "Ошибка",
    success: "Успешно",
    ok: "ОК",
    continue: "Продолжить",
    back: "Назад",
    create: "Создать",
    rename: "Переименовать",
    reset: "Сбросить",
    logout: "Выйти",
    yes: "Да",
    no: "Нет",
    discard: "Отменить",
    version: "Версия",
    copied: "Скопировано",
    copy: "Копировать",
    submit: "Отправить",
    scanning: "Сканирование...",
    urlPlaceholder: "https://example.com",
    home: "Главная",
    message: "Сообщение",
    files: "Файлы",
    fileViewer: "Просмотр файла",
    loading: "Загрузка...",
    retry: "Повторить",
    delete: "Удалить",
    optional: "необязательно",
  },

  connect: {
    restoreAccount: "Восстановить аккаунт",
    restoreWithSecretKey: "Восстановить с помощью секретного ключа",
    qrInstructions: "1. Откройте Happy на мобильном устройстве\n2. Перейдите в Настройки → Аккаунт\n3. Нажмите \"Привязать новое устройство\"\n4. Отсканируйте этот QR-код",
    enterSecretKey: "Пожалуйста, введите секретный ключ",
    invalidSecretKey: "Неверный секретный ключ. Проверьте и попробуйте снова.",
    enterUrlManually: "Ввести URL вручную",
  },

  settings: {
    title: "Настройки",
    connectedAccounts: "Подключенные аккаунты",
    connectAccount: "Подключить аккаунт",
    github: "GitHub",
    machines: "Машины",
    features: "Функции",
    social: "Социальное",
    account: "Аккаунт",
    accountSubtitle: "Управление учётной записью",
    appearance: "Внешний вид",
    appearanceSubtitle: "Настройка внешнего вида приложения",
    voiceAssistant: "Голосовой ассистент",
    voiceAssistantSubtitle: "Настройка предпочтений голосового взаимодействия",
    featuresTitle: "Возможности",
    featuresSubtitle: "Включить или отключить функции приложения",
    developer: "Разработчик",
    developerTools: "Инструменты разработчика",
    about: "О программе",
    aboutFooter:
      "Happy Coder — мобильное приложение для работы с Codex и Claude Code. Использует сквозное шифрование, все данные аккаунта хранятся только на вашем устройстве. Не связано с Anthropic.",
    whatsNew: "Что нового",
    whatsNewSubtitle: "Посмотреть последние обновления и улучшения",
    reportIssue: "Сообщить о проблеме",
    privacyPolicy: "Политика конфиденциальности",
    termsOfService: "Условия использования",
    eula: "EULA",
    supportUs: "Поддержите нас",
    supportUsSubtitlePro: "Спасибо за вашу поддержку!",
    supportUsSubtitle: "Поддержать разработку проекта",
    scanQrCodeToAuthenticate: "Отсканируйте QR-код для авторизации",
    githubConnected: ({ login }: { login: string }) =>
      `Подключен как @${login}`,
    connectGithubAccount: "Подключить аккаунт GitHub",
    claudeAuthSuccess: "Успешно подключено к Claude",
    exchangingTokens: "Обмен токенов...",
    connectTitle: ({ name }: { name: string }) => `Подключить ${name}`,
    connectTerminalInstruction: "Выполните следующую команду в терминале:",
    usage: "Использование",
    usageSubtitle: "Просмотр использования API и затрат",
    profiles: "Профили",
    profilesSubtitle: "Управление профилями переменных окружения для сессий",
    gitHosts: "Git-хосты",
    gitHostsSubtitle: "Настройка провайдеров Git-хостов",
    plugins: "Плагины",
    pluginsSubtitle: "Управление плагинами Claude Code",
    mcp: "MCP-серверы",
    mcpSubtitle: "Управление серверами Model Context Protocol",

    // Dynamic settings messages
    accountConnected: ({ service }: { service: string }) =>
      `Аккаунт ${service} подключен`,
    machineStatus: ({
      name,
      status,
    }: {
      name: string;
      status: "online" | "offline";
    }) => `${name} ${status === "online" ? "online" : "offline"}`,
    featureToggled: ({
      feature,
      enabled,
    }: {
      feature: string;
      enabled: boolean;
    }) => `${feature} ${enabled ? "включена" : "отключена"}`,
  },

  settingsAppearance: {
    // Appearance settings screen
    theme: "Тема",
    themeDescription: "Выберите предпочтительную цветовую схему",
    themeOptions: {
      adaptive: "Адаптивная",
      light: "Светлая",
      dark: "Тёмная",
    },
    themeDescriptions: {
      adaptive: "Следовать настройкам системы",
      light: "Всегда использовать светлую тему",
      dark: "Всегда использовать тёмную тему",
    },
    display: "Отображение",
    displayDescription: "Управление макетом и интервалами",
    inlineToolCalls: "Встроенные вызовы инструментов",
    inlineToolCallsDescription:
      "Показывать вызовы инструментов основного агента в чате",
    expandTodoLists: "Развернуть списки задач",
    expandTodoListsDescription: "Показывать все задачи вместо только изменений",
    expandToolDetails: "Развернуть детали инструментов",
    expandToolDetailsDescription:
      "Разворачивать список инструментов субагентов по умолчанию",
    showLineNumbersInDiffs: "Показывать номера строк в различиях",
    showLineNumbersInDiffsDescription:
      "Отображать номера строк в различиях кода",
    showLineNumbersInToolViews:
      "Показывать номера строк в представлениях инструментов",
    showLineNumbersInToolViewsDescription:
      "Отображать номера строк в различиях представлений инструментов",
    wrapLinesInDiffs: "Перенос строк в различиях",
    wrapLinesInDiffsDescription:
      "Переносить длинные строки вместо горизонтальной прокрутки в представлениях различий",
    alwaysShowContextSize: "Всегда показывать размер контекста",
    alwaysShowContextSizeDescription:
      "Отображать использование контекста даже когда не близко к лимиту",
    avatarStyle: "Стиль аватара",
    avatarStyleDescription: "Выберите внешний вид аватара сессии",
    avatarOptions: {
      pixelated: "Пиксельная",
      gradient: "Градиентная",
      brutalist: "Бруталистская",
    },
    showFlavorIcons: "Показывать иконки провайдеров ИИ",
    showFlavorIconsDescription:
      "Отображать иконки провайдеров ИИ на аватарах сессий",
    compactSessionView: "Компактный вид сессий",
    compactSessionViewDescription:
      "Отображать активные сессии в более компактном виде",
    collapsibleInput: "Сворачиваемый ввод",
    collapsibleInputDescription:
      "Автоматически сворачивать поле ввода при наличии сообщений",
    realtimeSessionSort: "Сортировка сессий в реальном времени",
    realtimeSessionSortDescription:
      "Сортировать сессии по недавней активности (отключите для стабильного порядка по времени создания)",
  },

  settingsFeatures: {
    // Features settings screen
    experiments: "Эксперименты",
    experimentsDescription:
      "Включить экспериментальные функции, которые всё ещё разрабатываются. Эти функции могут быть нестабильными или изменяться без предупреждения.",
    experimentalFeatures: "Экспериментальные функции",
    experimentalFeaturesEnabled: "Экспериментальные функции включены",
    experimentalFeaturesDisabled: "Используются только стабильные функции",
    webFeatures: "Веб-функции",
    webFeaturesDescription:
      "Функции, доступные только в веб-версии приложения.",
    enterToSend: "Enter для отправки",
    enterToSendEnabled:
      "Нажмите Enter для отправки (Shift+Enter для новой строки)",
    enterToSendDisabled: "Enter вставляет новую строку",
    commandPalette: "Command Palette",
    commandPaletteEnabled: "Нажмите ⌘K для открытия",
    commandPaletteDisabled: "Быстрый доступ к командам отключён",
    markdownCopyV2: "Markdown Copy v2",
    markdownCopyV2Subtitle:
      "Долгое нажатие открывает модальное окно копирования",
    hideInactiveSessions: "Скрывать неактивные сессии",
    hideInactiveSessionsSubtitle: "Показывать в списке только активные чаты",
    enhancedSessionWizard: "Улучшенный мастер сессий",
    enhancedSessionWizardEnabled: "Лаунчер с профилем активен",
    enhancedSessionWizardDisabled: "Используется стандартный лаунчер",
    showAgentActivity: "Активность агента",
    showAgentActivityEnabled: "Показывать активность агента в чате",
    showAgentActivityDisabled: "Детали активности агента скрыты",
    sttCorrection: "Коррекция голосовой транскрипции",
    sttCorrectionEnabled: "ИИ исправляет ошибки распознавания речи",
    sttCorrectionDisabled:
      "Используется необработанный результат распознавания",
    showProjectTab: "Вкладка проекта",
    showProjectTabSubtitle:
      "Показывать вкладку проекта (канбан) в панели вкладок",
    webNotifications: "Уведомления браузера",
    webNotificationsEnabled:
      "Уведомлять о завершении задач и запросах разрешений",
    webNotificationsDisabled: "Уведомления браузера отключены",
    webNotificationsDenied:
      "Заблокировано браузером — включите в настройках сайта",
    webNotificationsPersistent: "Закрепить уведомления",
    webNotificationsPersistentEnabled: "Уведомления остаются до закрытия",
    webNotificationsPersistentDisabled: "Уведомления закрываются через 5 сек",
  },

  errors: {
    networkError: "Произошла ошибка сети",
    serverError: "Произошла ошибка сервера",
    unknownError: "Произошла неизвестная ошибка",
    connectionTimeout: "Время соединения истекло",
    authenticationFailed: "Ошибка авторизации",
    permissionDenied: "Доступ запрещен",
    fileNotFound: "Файл не найден",
    invalidFormat: "Неверный формат",
    operationFailed: "Операция не выполнена",
    tryAgain: "Пожалуйста, попробуйте снова",
    contactSupport: "Если проблема сохранится, обратитесь в поддержку",
    sessionNotFound: "Сессия не найдена",
    voiceSessionFailed: "Не удалось запустить голосовую сессию",
    voiceServiceUnavailable: "Голосовой сервис временно недоступен",
    oauthInitializationFailed: "Не удалось инициализировать процесс OAuth",
    tokenStorageFailed: "Не удалось сохранить токены аутентификации",
    oauthStateMismatch: "Ошибка проверки безопасности. Попробуйте снова",
    tokenExchangeFailed: "Не удалось обменять код авторизации",
    oauthAuthorizationDenied: "В авторизации отказано",
    webViewLoadFailed: "Не удалось загрузить страницу аутентификации",
    failedToLoadProfile: "Не удалось загрузить профиль пользователя",
    userNotFound: "Пользователь не найден",
    sessionDeleted: "Сессия была удалена",
    sessionDeletedDescription: "Эта сессия была окончательно удалена",

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
    }) => `${field} должно быть от ${min} до ${max}`,
    retryIn: ({ seconds }: { seconds: number }) =>
      `Повторить через ${seconds} ${plural({ count: seconds, one: "секунду", few: "секунды", many: "секунд" })}`,
    errorWithCode: ({
      message,
      code,
    }: {
      message: string;
      code: number | string;
    }) => `${message} (Ошибка ${code})`,
    disconnectServiceFailed: ({ service }: { service: string }) =>
      `Не удалось отключить ${service}`,
    connectServiceFailed: ({ service }: { service: string }) =>
      `Не удалось подключить ${service}. Пожалуйста, попробуйте снова.`,
    failedToLoadFriends: "Не удалось загрузить список друзей",
    failedToAcceptRequest: "Не удалось принять запрос в друзья",
    failedToRejectRequest: "Не удалось отклонить запрос в друзья",
    failedToRemoveFriend: "Не удалось удалить друга",
    searchFailed: "Поиск не удался. Пожалуйста, попробуйте снова.",
    failedToSendRequest: "Не удалось отправить запрос в друзья",
  },

  newSession: {
    // Used by new-session screen and launch flows
    title: "Начать новую сессию",
    promptPlaceholder: "Над чем вы хотите работать?",
    noMachinesFound:
      "Машины не найдены. Сначала запустите сессию Happy на вашем компьютере.",
    allMachinesOffline: "Все машины находятся offline",
    machineDetails: "Посмотреть детали машины →",
    directoryDoesNotExist: "Директория не найдена",
    createDirectoryConfirm: ({ directory }: { directory: string }) =>
      `Директория ${directory} не существует. Хотите создать её?`,
    sessionStarted: "Сессия запущена",
    sessionStartedMessage: "Сессия успешно запущена.",
    sessionSpawningFailed: "Ошибка создания сессии - ID сессии не получен.",
    failedToStart:
      "Не удалось запустить сессию. Убедитесь, что daemon запущен на целевой машине.",
    sessionTimeout:
      "Время запуска сессии истекло. Машина может работать медленно или daemon не отвечает.",
    notConnectedToServer:
      "Нет подключения к серверу. Проверьте интернет-соединение.",
    startingSession: "Запуск сессии...",
    startNewSessionInFolder: "Новая сессия здесь",
    noMachineSelected: "Пожалуйста, выберите машину для запуска сессии",
    noPathSelected: "Пожалуйста, выберите директорию для запуска сессии",
    profileConfigEmpty: ({ name }: { name: string }) =>
      `Профиль "${name}" не содержит переменных окружения. Отредактируйте профиль и добавьте необходимые переменные.`,
    sessionType: {
      title: "Тип сессии",
      simple: "Простая",
      worktree: "Worktree",
      comingSoon: "Скоро будет доступно",
    },
    worktree: {
      creating: ({ name }: { name: string }) =>
        `Создание worktree '${name}'...`,
      notGitRepo: "Worktree требует наличия git репозитория",
      failed: ({ error }: { error: string }) =>
        `Не удалось создать worktree: ${error}`,
      success: "Worktree успешно создан",
    },
    builtInProfile: "Встроенный профиль",
    gitRepos: {
      title: "Git репозитории",
      showingCount: ({ showing, total }: { showing: number; total: number }) =>
        `Показано ${showing} из ${total} репозиториев`,
    },
  },

  pickPath: {
    selectPath: "Выбрать путь",
    noMachineSelected: "Машина не выбрана",
    enterPath: "Ввести путь",
    enterPathPlaceholder: "Введите путь (напр. /home/user/projects)",
    recentPaths: "Недавние пути",
    suggestedPaths: "Предложенные пути",
  },

  sessionHistory: {
    // Used by session history screen
    title: "История сессий",
    empty: "Сессии не найдены",
    today: "Сегодня",
    yesterday: "Вчера",
    daysAgo: ({ count }: { count: number }) =>
      `${count} ${plural({ count, one: "день", few: "дня", many: "дней" })} назад`,
    viewAll: "Посмотреть все сессии",
  },

  server: {
    // Used by Server Configuration screen (app/(app)/server.tsx)
    serverConfiguration: "Настройка сервера",
    enterServerUrl: "Пожалуйста, введите URL сервера",
    notValidHappyServer: "Это не валидный сервер Happy",
    changeServer: "Изменить сервер",
    continueWithServer: "Продолжить с этим сервером?",
    resetToDefault: "Сбросить по умолчанию",
    resetServerDefault: "Сбросить сервер по умолчанию?",
    validating: "Проверка...",
    validatingServer: "Проверка сервера...",
    serverReturnedError: "Сервер вернул ошибку",
    failedToConnectToServer: "Не удалось подключиться к серверу",
    currentlyUsingCustomServer: "Сейчас используется пользовательский сервер",
    customServerUrlLabel: "URL пользовательского сервера",
    advancedFeatureFooter:
      "Это расширенная функция. Изменяйте сервер только если знаете, что делаете. Вам нужно будет выйти и войти снова после изменения серверов.",
  },

  worktreeInfo: {
    title: "Worktree",
    branch: "Ветка",
    parentBranch: "Родительская ветка",
    status: "Статус",
    errorLabel: "Ошибка",
    state: {
      creating: "Создание",
      active: "Активно",
      merging: "Слияние",
      merged: "Слито",
      cleaning: "Очистка",
      cleaned: "Очищено",
      error: "Ошибка",
    },
    merge: {
      title: "Стратегия слияния",
      preview: "Предпросмотр слияния",
      description: ({ parentBranch }: { parentBranch: string }) =>
        `Как вы хотите выполнить слияние в ${parentBranch}?`,
      action: "Слить",
      createPr: "Создать Pull Request",
      directMerge: "Прямое слияние",
      prSuccess: ({ url }: { url: string }) => `PR создан: ${url}`,
      openPr: "Открыть PR",
      keepBranch: "Сохранить ветку",
      deleteBranch: "Удалить ветку",
      filesChanged: "файл(ов) изменено",
      commits: ({ count }: { count: number }) => `Коммиты (${count})`,
      noCommits: "Нет коммитов для слияния",
      directSuccess: "Слияние выполнено успешно",
      directSuccessDeleteBranch: ({ branchName }: { branchName: string }) =>
        `Слияние выполнено успешно. Удалить ветку '${branchName}'?`,
      failed: ({ error }: { error: string }) => `Ошибка слияния: ${error}`,
    },
    cleanup: {
      title: "Удалить Worktree",
      action: "Удалить Worktree",
      confirm: "Удалить этот Worktree и его ветку?",
      notMerged:
        "Этот Worktree ещё не был слит. Удаление может привести к потере изменений. Продолжить?",
      remove: "Удалить",
      success: "Worktree удалён",
      successAndArchived: "Worktree удалён, сессия архивирована",
      failed: ({ error }: { error: string }) =>
        `Не удалось удалить Worktree: ${error}`,
    },
  },

  sessionInfo: {
    // Used by Session Info screen (app/(app)/session/[id]/info.tsx)
    tagBranch: "Ветка",
    tagMain: "Основная",
    killSession: "Завершить сессию",
    killSessionConfirm: "Вы уверены, что хотите завершить эту сессию?",
    archiveSession: "Архивировать сессию",
    archiveSessionConfirm: "Вы уверены, что хотите архивировать эту сессию?",
    happySessionIdCopied: "ID сессии Happy скопирован в буфер обмена",
    failedToCopySessionId: "Не удалось скопировать ID сессии Happy",
    happySessionId: "ID сессии Happy",
    claudeCodeSessionId: "ID сессии Claude Code",
    claudeCodeSessionIdCopied:
      "ID сессии Claude Code скопирован в буфер обмена",
    profile: "Профиль ИИ",
    aiProvider: "Поставщик ИИ",
    failedToCopyClaudeCodeSessionId:
      "Не удалось скопировать ID сессии Claude Code",
    metadataCopied: "Метаданные скопированы в буфер обмена",
    failedToCopyMetadata: "Не удалось скопировать метаданные",
    failedToKillSession: "Не удалось завершить сессию",
    failedToArchiveSession: "Не удалось архивировать сессию",
    connectionStatus: "Статус подключения",
    created: "Создано",
    lastUpdated: "Последнее обновление",
    sequence: "Последовательность",
    quickActions: "Быстрые действия",
    viewMachine: "Посмотреть машину",
    viewMachineSubtitle: "Посмотреть детали машины и сессии",
    killSessionSubtitle: "Немедленно завершить сессию",
    archiveSessionSubtitle: "Архивировать эту сессию и остановить её",
    metadata: "Метаданные",
    host: "Хост",
    path: "Путь",
    operatingSystem: "Операционная система",
    processId: "ID процесса",
    startedBy: "Запущено",
    startedByDaemon: "Демон",
    startedByTerminal: "Терминал",
    happyHome: "Домашний каталог Happy",
    copyMetadata: "Копировать метаданные",
    agentState: "Состояние агента",
    controlledByUser: "Управляется пользователем",
    pendingRequests: "Ожидающие запросы",
    activity: "Активность",
    thinking: "Думает",
    thinkingSince: "Думает с",
    cliVersion: "Версия CLI",
    cliVersionOutdated: "Требуется обновление CLI",
    cliVersionOutdatedMessage: ({
      currentVersion,
      requiredVersion,
    }: {
      currentVersion: string;
      requiredVersion: string;
    }) =>
      `Установлена версия ${currentVersion}. Обновите до ${requiredVersion} или новее`,
    updateCliInstructions:
      "Пожалуйста, выполните npm install -g happy-coder@latest",
    resumeSession: "Возобновить сессию",
    resumeSessionSubtitle:
      "Возобновить сессию с полным контекстом на той же машине",
    forkSession: "Разветвить сессию",
    forkSessionSubtitle: "Создать новую сессию, ответвлённую от этой точки с полным контекстом",
    forkSessionSuccess: "Сессия успешно разветвлена",
    forkSessionFailed: "Не удалось разветвить сессию",
    deleteSession: "Удалить сессию",
    deleteSessionSubtitle: "Удалить эту сессию навсегда",
    deleteSessionConfirm: "Удалить сессию навсегда?",
    deleteSessionWarning:
      "Это действие нельзя отменить. Все сообщения и данные, связанные с этой сессией, будут удалены навсегда.",
    deleteSessionWorktreeWarning: ({ branchName }: { branchName: string }) =>
      `Эта сессия содержит worktree branch '${branchName}' с незамерженными изменениями. При удалении branch и все его изменения также будут удалены безвозвратно.`,
    deleteSessionWorktreePrWarning: ({ branchName }: { branchName: string }) =>
      `Эта сессия содержит worktree branch '${branchName}' с открытым PR. Branch будет сохранён для PR, но данные сессии будут удалены навсегда.`,
    failedToDeleteSession: "Не удалось удалить сессию",
    restoreSession: "Восстановить",
    failedToRestoreSession: "Не удалось восстановить сессию",
    sessionDeleted: "Сессия успешно удалена",
    deleteAllArchivedSessions: "Удалить все архивные сессии",
    deleteAllArchivedWarning: ({ count }: { count: number }) =>
      `Это навсегда удалит ${count} архивных сессий и все их сообщения. Это действие нельзя отменить.`,
  },

  components: {
    emptyMainScreen: {
      // Used by EmptyMainScreen component
      readyToCode: "Готовы к программированию?",
      installCli: "Установите Happy CLI",
      runIt: "Запустите его",
      scanQrCode: "Отсканируйте QR-код",
      openCamera: "Открыть камеру",
    },
  },

  profile: {
    userProfile: "Профиль пользователя",
    details: "Детали",
    firstName: "Имя",
    lastName: "Фамилия",
    username: "Имя пользователя",
    status: "Статус",
  },

  status: {
    connected: "подключено",
    connecting: "подключение",
    disconnected: "отключено",
    error: "ошибка",
    online: "online",
    offline: "offline",
    lastSeen: ({ time }: { time: string }) => `в сети ${time}`,
    permissionRequired: "требуется разрешение",
    needsAttention: "ожидает вашего ответа",
    apiRetry: ({
      attempt,
      maxRetries,
    }: {
      attempt: number;
      maxRetries: number;
    }) => `повтор API (${attempt}/${maxRetries})…`,
    activeNow: "Активен сейчас",
    unknown: "неизвестно",
  },

  time: {
    justNow: "только что",
    minutesAgo: ({ count }: { count: number }) =>
      `${count} ${plural({ count, one: "минуту", few: "минуты", many: "минут" })} назад`,
    hoursAgo: ({ count }: { count: number }) =>
      `${count} ${plural({ count, one: "час", few: "часа", many: "часов" })} назад`,
  },

  session: {
    inputPlaceholder: "Введите сообщение...",
    startedByDaemon: "демон",
    sentImage: "Отправлено изображение",
    sentImages: ({ count }: { count: number }) =>
      `Отправлено ${count} изображений`,
    imageAttached: "Изображение прикреплено",
    imageLabel: ({ index }: { index: number }) => `Изображение ${index}`,
    imageUploadFailed: ({ failed, total }: { failed: number; total: number }) =>
      `${failed} из ${total} изображений не удалось загрузить`,
    couldNotAttachFile: "Не удалось прикрепить этот файл",
    imageLoadFailed: "Не удалось загрузить изображение",
    bookmarkOption: "Закладка",
    appendToInput: "Редактировать в поле ввода",
    messageQueued: "В очереди",
    cancelQueued: "Отменить",
    rewindTitle: "Откатить файлы",
    rewindConfirm: "Вернуть файлы к состоянию на момент этого сообщения?",
    rewindAction: "Откатить",
    rewindFiles: "файлов затронуто",
    rewindSuccess: "Файлы успешно откачены",
    rewindFailed: "Ошибка отката",
    rewindUnavailable: "Контрольные точки файлов недоступны для этой сессии",
    rewindUnknownError: "Произошла неизвестная ошибка",
    noMessages: "Сообщений пока нет",
    created: ({ time }: { time: string }) => `Создано ${time}`,
  },

  bookmark: {
    sourceAI: "AI",
    sourceUser: "Я",
  },

  commandPalette: {
    placeholder: "Введите команду или поиск...",
  },

  chatFooter: {
    permissionWarning: "Разрешения отображаются только в терминале. Сбросьте или отправьте сообщение для управления из приложения.",
  },

  agentInput: {
    permissionMode: {
      title: "РЕЖИМ РАЗРЕШЕНИЙ",
      default: "По умолчанию",
      acceptEdits: "Принимать правки",
      plan: "Режим планирования",
      dontAsk: "Не спрашивать",
      bypassPermissions: "YOLO режим",
      badgeAcceptAllEdits: "Принимать все правки",
      badgeBypassAllPermissions: "Обход всех разрешений",
      badgePlanMode: "Режим планирования",
      badgeDontAsk: "Не спрашивать",
    },
    agent: {
      claude: "Claude",
      codex: "Codex",
      gemini: "Gemini",
    },
    model: {
      title: "МОДЕЛЬ",
      configureInCli: "Настройте модели в настройках CLI",
    },
    codexPermissionMode: {
      title: "РЕЖИМ РАЗРЕШЕНИЙ CODEX",
      default: "Настройки CLI",
      readOnly: "Read Only Mode",
      safeYolo: "Safe YOLO",
      yolo: "YOLO",
      badgeReadOnly: "Только чтение",
      badgeSafeYolo: "Safe YOLO",
      badgeYolo: "YOLO",
    },
    codexModel: {
      title: "МОДЕЛЬ CODEX",
      gpt53Codex: "GPT-5.3 Codex",
      gpt53CodexSpark: "GPT-5.3 Codex Spark",
      gpt52Codex: "GPT-5.2 Codex",
      gpt51CodexMax: "GPT-5.1 Codex Max",
      gpt51Codex: "GPT-5.1 Codex",
      gpt5Codex: "GPT-5 Codex",
    },
    geminiPermissionMode: {
      title: "РЕЖИМ РАЗРЕШЕНИЙ",
      default: "По умолчанию",
      readOnly: "Только чтение",
      safeYolo: "Безопасный YOLO",
      yolo: "YOLO",
      badgeReadOnly: "Только чтение",
      badgeSafeYolo: "Безопасный YOLO",
      badgeYolo: "YOLO",
    },
    context: {
      remaining: ({ percent }: { percent: number }) => `Осталось ${percent}%`,
      breakdownTitle: "Разбивка токенов",
      breakdownMessage:
        "↓ Чтение кэша – токены, повторно используемые из кэша контекста. Значительно снижает стоимость.\n\nin Ввод – новые токены этого хода (ваше сообщение + результаты инструментов).\n\nout Вывод – токены, сгенерированные моделью в этом ходу.\n\n↑ Запись в кэш – токены, записанные в кэш в этом ходу. Доступны для повторного использования в следующем ходу.",
    },
    suggestion: {
      fileLabel: "ФАЙЛ",
      folderLabel: "ПАПКА",
    },
    effort: {
      title: "УРОВЕНЬ УСИЛИЙ",
      low: "Низкий",
      lowDesc: "Быстрые ответы, меньше рассуждений",
      medium: "Средний",
      mediumDesc: "Стандартная глубина рассуждений",
      high: "Высокий",
      highDesc: "Более глубокие рассуждения",
      max: "Максимальный",
      maxDesc: "Расширенное мышление, лучшее качество",
    },
    thinking: {
      title: "МЫШЛЕНИЕ",
      adaptive: "Адаптивное",
      adaptiveDesc: "Модель сама решает когда думать",
      enabled: "Включено",
      enabledDesc: "Всегда показывать рассуждения",
      disabled: "Выключено",
      disabledDesc: "Без расширенного мышления",
    },
    noMachinesAvailable: "Нет машин",
    continue: "Продолжить — Claude достиг лимита ходов",
  },

  machineLauncher: {
    showLess: "Показать меньше",
    showAll: ({ count }: { count: number }) =>
      `Показать все (${count} ${plural({ count, one: "путь", few: "пути", many: "путей" })})`,
    enterCustomPath: "Ввести свой путь",
    offlineUnableToSpawn: "Невозможно создать сессию, машина offline",
  },

  sidebar: {
    sessionsTitle: "Happy",
  },

  toolView: {
    input: "Входные данные",
    output: "Результат",
  },

  diff: {
    toolbar: {
      unified: "Единый",
      split: "Разделённый",
      expand: "Развернуть",
      collapse: "Свернуть",
      copyDiff: "Копировать",
      copied: "Скопировано!",
    },
  },

  codeReview: {
    accept: "Принять",
    reject: "Отклонить",
    accepted: "Принято",
    rejected: "Отклонено",
    rejectConfirmTitle: "Отклонить изменение",
    rejectConfirmMessage: ({ filePath }: { filePath: string }) =>
      `Попросить Claude отменить изменения в ${filePath}?`,
    rejectConfirm: "Отклонить и отменить",
  },

  tools: {
    fullView: {
      description: "Описание",
      inputParams: "Входные параметры",
      output: "Результат",
      error: "Ошибка",
      completed: "Инструмент выполнен успешно",
      noOutput: "Результат не получен",
      running: "Выполняется...",
      rawJsonDevMode: "Исходный JSON (режим разработчика)",
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
      initializing: "Инициализация агента...",
      moreTools: ({ count }: { count: number }) =>
        `+${count} ещё ${plural({ count, one: "инструмент", few: "инструмента", many: "инструментов" })}`,
      collapseTools: "Свернуть",
      agentThinking: "Думает...",
      subagentRunning: ({ type }: { type: string }) => `Запуск ${type}...`,
    },
    multiEdit: {
      editNumber: ({ index, total }: { index: number; total: number }) =>
        `Правка ${index} из ${total}`,
      replaceAll: "Заменить все",
    },
    contextMenu: {
      copyPath: "Копировать путь файла",
      copyCommand: "Копировать команду",
      copyOutput: "Копировать вывод",
    },
    names: {
      task: "Задача",
      terminal: "Терминал",
      searchFiles: "Поиск файлов",
      search: "Поиск",
      searchContent: "Поиск содержимого",
      listFiles: "Список файлов",
      planProposal: "Предложение плана",
      readFile: "Чтение файла",
      editFile: "Редактирование файла",
      writeFile: "Запись файла",
      fetchUrl: "Получение URL",
      readNotebook: "Чтение блокнота",
      editNotebook: "Редактирование блокнота",
      todoList: "Список задач",
      webSearch: "Веб-поиск",
      reasoning: "Рассуждение",
      applyChanges: "Обновить файл",
      viewDiff: "Текущие изменения файла",
      question: "Вопрос",
    },
    desc: {
      terminalCmd: ({ cmd }: { cmd: string }) => `Терминал(команда: ${cmd})`,
      searchPattern: ({ pattern }: { pattern: string }) =>
        `Поиск(шаблон: ${pattern})`,
      searchPath: ({ basename }: { basename: string }) =>
        `Поиск(путь: ${basename})`,
      fetchUrlHost: ({ host }: { host: string }) =>
        `Получение URL(адрес: ${host})`,
      editNotebookMode: ({ path, mode }: { path: string; mode: string }) =>
        `Редактирование блокнота(файл: ${path}, режим: ${mode})`,
      todoListCount: ({ count }: { count: number }) =>
        `Список задач(количество: ${count})`,
      webSearchQuery: ({ query }: { query: string }) =>
        `Веб-поиск(запрос: ${query})`,
      grepPattern: ({ pattern }: { pattern: string }) =>
        `grep(шаблон: ${pattern})`,
      multiEditEdits: ({ path, count }: { path: string; count: number }) =>
        `${path} (${count} ${plural({ count, one: "правка", few: "правки", many: "правок" })})`,
      readingFile: ({ file }: { file: string }) => `Чтение ${file}`,
      writingFile: ({ file }: { file: string }) => `Запись ${file}`,
      modifyingFile: ({ file }: { file: string }) => `Изменение ${file}`,
      modifyingFiles: ({ count }: { count: number }) =>
        `Изменение ${count} ${plural({ count, one: "файла", few: "файлов", many: "файлов" })}`,
      modifyingMultipleFiles: ({
        file,
        count,
      }: {
        file: string;
        count: number;
      }) => `${file} и ещё ${count}`,
      showingDiff: "Показ изменений",
    },
    askUserQuestion: {
      submit: "Отправить ответ",
      multipleQuestions: ({ count }: { count: number }) =>
        `${count} ${plural({ count, one: "вопрос", few: "вопроса", many: "вопросов" })}`,
      other: "Другое",
      otherDescription: "Введите свой ответ",
      otherPlaceholder: "Введите ваш ответ...",
      recommended: "Рекомендуется",
    },
    planFile: {
      refreshFromFile: "Обновить из файла",
    },
  },

  files: {
    searchPlaceholder: "Поиск файлов...",
    detachedHead: "отделённый HEAD",
    summary: ({ staged, unstaged }: { staged: number; unstaged: number }) =>
      `${staged} подготовлено • ${unstaged} не подготовлено`,
    notRepo: "Не является git-репозиторием",
    notUnderGit: "Эта папка не находится под управлением git",
    searching: "Поиск файлов...",
    noFilesFound: "Файлы не найдены",
    noFilesInProject: "Файлов в проекте нет",
    tryDifferentTerm: "Попробуйте другой поисковый запрос",
    searchResults: ({ count }: { count: number }) =>
      `Результаты поиска (${count})`,
    projectRoot: "Корень проекта",
    stagedChanges: ({ count }: { count: number }) =>
      `Подготовленные изменения (${count})`,
    unstagedChanges: ({ count }: { count: number }) =>
      `Неподготовленные изменения (${count})`,
    // File viewer strings
    loadingFile: ({ fileName }: { fileName: string }) =>
      `Загрузка ${fileName}...`,
    binaryFile: "Бинарный файл",
    cannotDisplayBinary: "Невозможно отобразить содержимое бинарного файла",
    diff: "Различия",
    file: "Файл",
    fileEmpty: "Файл пустой",
    noChanges: "Нет изменений для отображения",
    // Browse mode strings
    browseTab: "Обзор",
    changesTab: "Изменения",
    directory: "Каталог",
    emptyDirectory: "Этот каталог пуст",
    submodule: "Подмодуль",
    submoduleNotInitialized: "Не инициализирован",
    childReposSummary: ({ count }) =>
      `${count} Git ${count === 1 ? "репозиторий" : "репозиториев"}`,
  },

  changes: {
    summary: ({ files }) => `${files} файл(ов) изменено`,
    noChanges: "В этой сессии нет изменений файлов",
    editCount: ({ count }) => `${count} правок`,
  },

  settingsVoice: {
    // Voice settings screen
    languageTitle: "Язык",
    languageDescription:
      "Выберите предпочтительный язык для взаимодействия с голосовым помощником. Эта настройка синхронизируется на всех ваших устройствах.",
    preferredLanguage: "Предпочтительный язык",
    preferredLanguageSubtitle:
      "Язык, используемый для ответов голосового помощника",
    language: {
      searchPlaceholder: "Поиск языков...",
      title: "Языки",
      footer: ({ count }: { count: number }) =>
        `Доступно ${count} ${plural({ count, one: "язык", few: "языка", many: "языков" })}`,
      autoDetect: "Автоопределение",
    },
    // TTS provider settings
    ttsProviderTitle: "Провайдер TTS",
    ttsProviderDescription:
      "Выберите бесплатный Edge TTS или платный ElevenLabs TTS с вашим собственным API-ключом.",
    ttsProviderEdge: "Edge TTS (бесплатно)",
    ttsProviderEdgeSubtitle: "Microsoft Edge TTS, бесплатно и без ограничений",
    ttsProviderElevenLabs: "ElevenLabs (платно)",
    ttsProviderElevenLabsSubtitle: "Высокое качество, требуется ваш API-ключ",
    elevenLabsApiKey: "API-ключ",
    elevenLabsApiKeyPlaceholder: "Введите ваш API-ключ ElevenLabs",
    elevenLabsVoiceId: "Voice ID",
    elevenLabsVoiceIdPlaceholder: "По умолчанию: Rachel",
    elevenLabsVoiceIdSubtitle:
      "Оставьте пустым для голоса по умолчанию (Rachel)",
    elevenLabsConfig: "ElevenLabs",
  },

  voiceStatusBar: {
    connecting: "Подключение...",
    connectionError: "Ошибка подключения",
    listening: "Слушаю...",
    processing: "Обработка...",
    speaking: "Говорю",
    voiceAssistantActive: "Голосовой помощник активен",
    voiceAssistant: "Голосовой помощник",
    tapToEnd: "Нажмите для завершения",
    permissionRequested: ({ toolName }: { toolName: string }) =>
      `Запрошено разрешение для ${toolName}`,
    done: "Готово.",
  },

  settingsAccount: {
    // Account settings screen
    accountInformation: "Информация об аккаунте",
    status: "Статус",
    statusActive: "Активный",
    statusNotAuthenticated: "Не авторизован",
    anonymousId: "Анонимный ID",
    publicId: "Публичный ID",
    notAvailable: "Недоступно",
    linkNewDevice: "Привязать новое устройство",
    linkNewDeviceSubtitle: "Отсканируйте QR-код для привязки устройства",
    profile: "Профиль",
    name: "Имя",
    github: "GitHub",
    tapToDisconnect: "Нажмите для отключения",
    server: "Сервер",
    backup: "Резервная копия",
    backupDescription:
      "Ваш секретный ключ - единственный способ восстановить ваш аккаунт. Сохраните его в безопасном месте, например в менеджере паролей.",
    secretKey: "Секретный ключ",
    tapToReveal: "Нажмите для показа",
    tapToHide: "Нажмите для скрытия",
    secretKeyLabel: "СЕКРЕТНЫЙ КЛЮЧ (НАЖМИТЕ ДЛЯ КОПИРОВАНИЯ)",
    secretKeyCopied:
      "Секретный ключ скопирован в буфер обмена. Сохраните его в безопасном месте!",
    secretKeyCopyFailed: "Не удалось скопировать секретный ключ",
    privacy: "Конфиденциальность",
    privacyDescription:
      "Помогите улучшить приложение, поделившись анонимными данными об использовании. Никакая личная информация не собирается.",
    analytics: "Аналитика",
    analyticsDisabled: "Данные не передаются",
    analyticsEnabled: "Анонимные данные об использовании передаются",
    dangerZone: "Опасная зона",
    logout: "Выйти",
    logoutSubtitle: "Выйти из аккаунта и очистить локальные данные",
    logoutConfirm:
      "Вы уверены, что хотите выйти? Убедитесь, что вы сохранили резервную копию секретного ключа!",
  },

  connectButton: {
    authenticate: "Авторизация терминала",
    authenticateWithUrlPaste: "Авторизация терминала через URL",
    pasteAuthUrl: "Вставьте авторизационный URL из терминала",
  },

  updateBanner: {
    updateAvailable: "Доступно обновление",
    pressToApply: "Нажмите, чтобы применить обновление",
    whatsNew: "Что нового",
    seeLatest: "Посмотреть последние обновления и улучшения",
    nativeUpdateAvailable: "Доступно обновление приложения",
    tapToUpdateAppStore: "Нажмите для обновления в App Store",
    tapToUpdatePlayStore: "Нажмите для обновления в Play Store",
  },

  changelog: {
    // Used by the changelog screen
    version: ({ version }: { version: string }) => `Версия ${version}`,
    noEntriesAvailable: "Записи журнала изменений недоступны.",
  },

  terminal: {
    // Used by terminal connection screens
    webBrowserRequired: "Требуется веб-браузер",
    webBrowserRequiredDescription:
      "Ссылки подключения терминала можно открывать только в веб-браузере по соображениям безопасности. Используйте сканер QR-кодов или откройте эту ссылку на компьютере.",
    processingConnection: "Обработка подключения...",
    invalidConnectionLink: "Неверная ссылка подключения",
    invalidConnectionLinkDescription:
      "Ссылка подключения отсутствует или неверна. Проверьте URL и попробуйте снова.",
    connectTerminal: "Подключить терминал",
    terminalRequestDescription:
      "Терминал запрашивает подключение к вашему аккаунту Happy Coder. Это позволит терминалу безопасно отправлять и получать сообщения.",
    connectionDetails: "Детали подключения",
    publicKey: "Публичный ключ",
    encryption: "Шифрование",
    endToEndEncrypted: "Сквозное шифрование",
    acceptConnection: "Принять подключение",
    connecting: "Подключение...",
    reject: "Отклонить",
    security: "Безопасность",
    securityFooter:
      "Эта ссылка подключения была безопасно обработана в вашем браузере и никогда не отправлялась на сервер. Ваши личные данные останутся в безопасности, и только вы можете расшифровать сообщения.",
    securityFooterDevice:
      "Это подключение было безопасно обработано на вашем устройстве и никогда не отправлялось на сервер. Ваши личные данные останутся в безопасности, и только вы можете расшифровать сообщения.",
    clientSideProcessing: "Обработка на стороне клиента",
    linkProcessedLocally: "Ссылка обработана локально в браузере",
    linkProcessedOnDevice: "Ссылка обработана локально на устройстве",
  },

  modals: {
    // Used across connect flows and settings
    authenticateTerminal: "Авторизация терминала",
    pasteUrlFromTerminal: "Вставьте URL авторизации из вашего терминала",
    deviceLinkedSuccessfully: "Устройство успешно связано",
    terminalConnectedSuccessfully: "Терминал успешно подключен",
    invalidAuthUrl: "Неверный URL авторизации",
    developerMode: "Режим разработчика",
    developerModeEnabled: "Режим разработчика включен",
    developerModeDisabled: "Режим разработчика отключен",
    disconnectGithub: "Отключить GitHub",
    disconnectGithubConfirm: "Вы уверены, что хотите отключить аккаунт GitHub?",
    disconnectService: ({ service }: { service: string }) =>
      `Отключить ${service}`,
    disconnectServiceConfirm: ({ service }: { service: string }) =>
      `Вы уверены, что хотите отключить ${service} от вашего аккаунта?`,
    disconnect: "Отключить",
    failedToConnectTerminal: "Не удалось подключить терминал",
    cameraPermissionsRequiredToConnectTerminal:
      "Для подключения терминала требуется доступ к камере",
    failedToLinkDevice: "Не удалось связать устройство",
    cameraPermissionsRequiredToScanQr:
      "Для сканирования QR-кодов требуется доступ к камере",
  },

  navigation: {
    // Navigation titles and screen headers
    connectTerminal: "Подключить терминал",
    linkNewDevice: "Связать новое устройство",
    restoreWithSecretKey: "Восстановить секретным ключом",
    whatsNew: "Что нового",
    friends: "Друзья",
  },

  welcome: {
    // Main welcome screen for unauthenticated users
    title: "Мобильный клиент Codex и Claude Code",
    subtitle:
      "Сквозное шифрование, аккаунт хранится только на вашем устройстве.",
    createAccount: "Создать аккаунт",
    linkOrRestoreAccount: "Связать или восстановить аккаунт",
    loginWithMobileApp: "Войти через мобильное приложение",
    loginWithSecretKey: "Войти с помощью секретного ключа",
  },

  review: {
    // Used by utils/requestReview.ts
    enjoyingApp: "Нравится приложение?",
    feedbackPrompt: "Мы будем рады вашему отзыву!",
    yesILoveIt: "Да, мне нравится!",
    notReally: "Не совсем",
  },

  items: {
    // Used by Item component for copy toast
    copiedToClipboard: ({ label }: { label: string }) =>
      `${label} скопировано в буфер обмена`,
  },

  machine: {
    offlineUnableToSpawn: "Запуск отключен: машина offline",
    offlineHelp:
      "• Убедитесь, что компьютер online\n• Выполните `happy daemon status` для диагностики\n• Используете последнюю версию CLI? Обновите командой `npm install -g happy-coder@latest`",
    launchNewSessionInDirectory: "Запустить новую сессию в папке",
    daemon: "Daemon",
    status: "Статус",
    stopDaemon: "Остановить daemon",
    lastKnownPid: "Последний известный PID",
    lastKnownHttpPort: "Последний известный HTTP порт",
    startedAt: "Запущен в",
    cliVersion: "Версия CLI",
    daemonStateVersion: "Версия состояния daemon",
    activeSessions: ({ count }: { count: number }) =>
      `Активные сессии (${count})`,
    extensions: "Расширения",
    machineGroup: "Машина",
    host: "Хост",
    machineId: "ID машины",
    username: "Имя пользователя",
    homeDirectory: "Домашний каталог",
    platform: "Платформа",
    architecture: "Архитектура",
    lastSeen: "Последняя активность",
    never: "Никогда",
    metadataVersion: "Версия метаданных",
    untitledSession: "Безымянная сессия",
    back: "Назад",
    previousSessions: "Предыдущие сессии (до 5 последних)",
  },

  message: {
    switchedToMode: ({ mode }: { mode: string }) =>
      `Переключено в режим ${mode}`,
    unknownEvent: "Неизвестное событие",
    usageLimitUntil: ({ time }: { time: string }) =>
      `Лимит использования достигнут до ${time}`,
    usageLimitReached:
      "Лимит использования достигнут. Пожалуйста, подождите и попробуйте снова.",
    unknownTime: "неизвестное время",
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
      count === 1 ? `${count} ход` : `${count} ходов`,
    thinkingMarker: "Мышление",
  },

  codex: {
    // Codex permission dialog buttons
    permissions: {
      yesForSession: "Да, и не спрашивать для этой сессии",
      stopAndExplain: "Остановить и объяснить, что делать",
    },
  },

  claude: {
    // Claude permission dialog buttons
    permissions: {
      yesAllowAllEdits: "Да, разрешить все правки в этой сессии",
      yesForTool: "Да, больше не спрашивать для этого инструмента",
      noTellClaude: "Нет, дать обратную связь",
    },
  },

  plan: {
    approve: "Одобрить план",
    approveAutoEdits: "Одобрить и авто-одобрять правки",
    rejectWithFeedback: "Отклонить с отзывом",
    rejectTitle: "Почему вы отклоняете этот план?",
    rejectMessage: "Ваш отзыв поможет Claude улучшить план",
    rejectPlaceholder: "Опишите, что нужно изменить...",
  },

  settingsLanguage: {
    // Language settings screen
    title: "Язык",
    description:
      "Выберите предпочтительный язык интерфейса приложения. Настройки синхронизируются на всех ваших устройствах.",
    currentLanguage: "Текущий язык",
    automatic: "Автоматически",
    automaticSubtitle: "Определять по настройкам устройства",
    needsRestart: "Язык изменён",
    needsRestartMessage:
      "Приложение нужно перезапустить для применения новых языковых настроек.",
    restartNow: "Перезапустить",
  },

  textSelection: {
    // Text selection screen
    selectText: "Выделить диапазон текста",
    title: "Выделить текст",
    noTextProvided: "Текст не предоставлен",
    textNotFound: "Текст не найден или устарел",
    textCopied: "Текст скопирован в буфер обмена",
    failedToCopy: "Не удалось скопировать текст в буфер обмена",
    noTextToCopy: "Нет текста для копирования",
  },

  markdown: {
    // Markdown copy functionality
    codeCopied: "Код скопирован",
    copyFailed: "Ошибка копирования",
    mermaidCopied: "Исходный код Mermaid скопирован",
    mermaidRenderFailed: "Не удалось отобразить диаграмму mermaid",
  },

  artifacts: {
    // Artifacts feature
    title: "Артефакты",
    countSingular: "1 артефакт",
    countPlural: ({ count }: { count: number }) => {
      const n = Math.abs(count);
      const n10 = n % 10;
      const n100 = n % 100;

      if (n10 === 1 && n100 !== 11) {
        return `${count} артефакт`;
      }
      if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) {
        return `${count} артефакта`;
      }
      return `${count} артефактов`;
    },
    empty: "Артефактов пока нет",
    emptyDescription: "Создайте первый артефакт, чтобы начать",
    new: "Новый артефакт",
    edit: "Редактировать артефакт",
    delete: "Удалить",
    updateError:
      "Не удалось обновить артефакт. Пожалуйста, попробуйте еще раз.",
    notFound: "Артефакт не найден",
    discardChanges: "Отменить изменения?",
    discardChangesDescription:
      "У вас есть несохраненные изменения. Вы уверены, что хотите их отменить?",
    deleteConfirm: "Удалить артефакт?",
    deleteConfirmDescription: "Это действие нельзя отменить",
    titleLabel: "ЗАГОЛОВОК",
    titlePlaceholder: "Введите заголовок для вашего артефакта",
    bodyLabel: "СОДЕРЖИМОЕ",
    bodyPlaceholder: "Напишите ваш контент здесь...",
    emptyFieldsError: "Пожалуйста, введите заголовок или содержимое",
    createError: "Не удалось создать артефакт. Пожалуйста, попробуйте снова.",
    save: "Сохранить",
    saving: "Сохранение...",
    loading: "Загрузка артефактов...",
    error: "Не удалось загрузить артефакт",
    untitled: "Без названия",
  },

  friends: {
    // Friends feature
    title: "Друзья",
    manageFriends: "Управляйте своими друзьями и связями",
    searchTitle: "Найти друзей",
    pendingRequests: "Запросы в друзья",
    myFriends: "Мои друзья",
    noFriendsYet: "У вас пока нет друзей",
    findFriends: "Найти друзей",
    remove: "Удалить",
    pendingRequest: "Ожидается",
    sentOn: ({ date }: { date: string }) => `Отправлено ${date}`,
    accept: "Принять",
    reject: "Отклонить",
    addFriend: "Добавить в друзья",
    alreadyFriends: "Уже в друзьях",
    requestPending: "Запрос отправлен",
    searchInstructions: "Введите имя пользователя для поиска друзей",
    searchPlaceholder: "Введите имя пользователя...",
    searching: "Поиск...",
    userNotFound: "Пользователь не найден",
    noUserFound: "Пользователь с таким именем не найден",
    checkUsername: "Пожалуйста, проверьте имя пользователя и попробуйте снова",
    howToFind: "Как найти друзей",
    findInstructions:
      "Ищите друзей по имени пользователя. И вы, и ваш друг должны подключить GitHub для отправки запросов в друзья.",
    requestSent: "Запрос в друзья отправлен!",
    requestAccepted: "Запрос в друзья принят!",
    requestRejected: "Запрос в друзья отклонён",
    friendRemoved: "Друг удалён",
    confirmRemove: "Удалить из друзей",
    confirmRemoveMessage: "Вы уверены, что хотите удалить этого друга?",
    cannotAddYourself: "Вы не можете отправить запрос в друзья самому себе",
    bothMustHaveGithub:
      "Оба пользователя должны подключить GitHub, чтобы стать друзьями",
    status: {
      none: "Не подключен",
      requested: "Запрос отправлен",
      pending: "Запрос ожидается",
      friend: "Друзья",
      rejected: "Отклонено",
    },
    acceptRequest: "Принять запрос",
    removeFriend: "Удалить из друзей",
    removeFriendConfirm: ({ name }: { name: string }) =>
      `Вы уверены, что хотите удалить ${name} из друзей?`,
    requestSentDescription: ({ name }: { name: string }) =>
      `Ваш запрос в друзья отправлен пользователю ${name}`,
    requestFriendship: "Отправить запрос в друзья",
    cancelRequest: "Отменить запрос в друзья",
    cancelRequestConfirm: ({ name }: { name: string }) =>
      `Отменить ваш запрос в друзья к ${name}?`,
    denyRequest: "Отклонить запрос",
    nowFriendsWith: ({ name }: { name: string }) =>
      `Теперь вы друзья с ${name}`,
  },

  usage: {
    // Usage panel strings
    today: "Сегодня",
    last7Days: "Последние 7 дней",
    last30Days: "Последние 30 дней",
    totalTokens: "Всего токенов",
    totalCost: "Общая стоимость",
    tokens: "Токены",
    cost: "Стоимость",
    usageOverTime: "Использование во времени",
    byModel: "По модели",
    byTokenType: "По типу токенов",
    noData: "Данные об использовании недоступны",
  },

  feed: {
    // Feed notifications for friend requests and acceptances
    friendRequestFrom: ({ name }: { name: string }) =>
      `${name} отправил вам запрос в друзья`,
    friendRequestGeneric: "Новый запрос в друзья",
    friendAccepted: ({ name }: { name: string }) =>
      `Вы теперь друзья с ${name}`,
    friendAcceptedGeneric: "Запрос в друзья принят",
  },

  profiles: {
    // Profile management feature
    title: "Профили",
    subtitle: "Управление профилями переменных окружения для сессий",
    noProfile: "Без Профиля",
    noProfileDescription: "Использовать настройки окружения по умолчанию",
    defaultModel: "Модель по Умолчанию",
    addProfile: "Добавить Профиль",
    profileName: "Имя Профиля",
    enterName: "Введите имя профиля",
    baseURL: "Базовый URL",
    authToken: "Токен Аутентификации",
    enterToken: "Введите токен аутентификации",
    model: "Модель",
    setupInstructions: "Инструкция по настройке",
    viewSetupGuide: "Открыть официальное руководство",
    defaultSessionType: "Тип сессии по умолчанию",
    defaultPermissionMode: "Режим разрешений по умолчанию",
    permissionDefault: "По умолчанию",
    permissionDefaultDesc: "Запрашивать разрешения",
    permissionAcceptEdits: "Принимать правки",
    permissionAcceptEditsDesc: "Автоматически одобрять правки",
    permissionPlan: "Планирование",
    permissionPlanDesc: "Планировать перед выполнением",
    permissionYolo: "Yolo",
    permissionYoloDesc: "Пропускать все разрешения",
    spawnInTmux: "Запускать сессии в Tmux",
    tmuxEnabledDesc:
      "Сессии запускаются в новых окнах tmux. Настройте имя сессии и временный каталог ниже.",
    tmuxDisabledDesc:
      "Сессии запускаются в обычной оболочке (без интеграции с tmux)",
    tmuxSession: "Сессия Tmux",
    tmuxSessionName: "Имя сессии Tmux",
    enterTmuxSession: "Введите имя сессии tmux",
    tmuxSessionHint:
      'Оставьте пустым для использования первой существующей сессии tmux (или создания "happy"). Укажите имя (например, "my-work") для конкретной сессии.',
    tmuxSessionPlaceholder: "Пусто = первая существующая сессия",
    tmuxDisabledPlaceholder: "Отключено - tmux не включён",
    tmuxTempDir: "Временный каталог Tmux",
    enterTmuxTempDir: "Введите путь к временному каталогу",
    tmuxTempDirHint:
      "Временный каталог для файлов сессии tmux. Оставьте пустым для системного значения.",
    tmuxTempDirPlaceholder: "/tmp (необязательно)",
    tmuxUpdateEnvironment: "Обновлять окружение автоматически",
    startupBashScript: "Скрипт запуска Bash",
    startupScriptEnabledDesc:
      "Выполняется перед каждой сессией. Для динамической настройки, проверки окружения или инициализации.",
    startupScriptDisabledDesc:
      "Без скрипта запуска - сессии запускаются напрямую",
    startupScriptPlaceholder:
      "#!/bin/bash\necho 'Инициализация...'\n# Ваш скрипт здесь",
    disabled: "Отключено",
    nameRequired: "Имя профиля обязательно",
    deleteConfirm: 'Вы уверены, что хотите удалить профиль "{name}"?',
    editProfile: "Редактировать Профиль",
    addProfileTitle: "Добавить Новый Профиль",
    envCard: {
      copyFromRemote: "First try copying variable from remote machine:",
      selectMachine: "Select a machine to check if variable exists",
      defaultValue: "Default value:",
      sessionWillReceive: "Session will receive:",
      checkingRemote: "Checking remote machine...",
      valueNotFound: "Value not found",
      valueFound: "Value found:",
      secretHidden: "Secret value - not retrieved for security",
      differsFromDefault: "Overriding documented default:",
      differsFromDocumented: "Differs from documented value:",
      variablePlaceholder: "Variable name (e.g., Z_AI_MODEL)",
      hiddenForSecurity: "hidden for security",
      empty: "(empty)",
    },
    delete: {
      title: "Удалить Профиль",
      message: ({ name }: { name: string }) =>
        `Вы уверены, что хотите удалить "${name}"? Это действие нельзя отменить.`,
      confirm: "Удалить",
      cancel: "Отмена",
    },
  },

  git: {
    title: "Git",
    tabChanges: "Изменения",
    tabHistory: "История",
    tabBranches: "Ветки",
    tabStash: "Тайник",
    tabIssues: "Issues",
    tabPRs: "PR",
    historyEmpty: "Коммитов пока нет",
    historyLoadError: "Не удалось загрузить историю коммитов",
    historyRetry: "Повторить",
    historyLoading: "Загрузка коммитов...",
    historyLoadMore: "Загрузка...",
    historyNoMore: "Все коммиты загружены",
    commitFiles: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? "файл изменён" : "файлов изменено"}`,
    localBranches: "Локальные ветки",
    remoteBranches: "Удалённые ветки",
    currentBranch: "Текущая",
    noBranches: "Ветки не найдены",
    noUpstream: "Нет upstream",
    createBranch: "Создать ветку",
    enterBranchName: "Введите имя ветки",
    branchNamePlaceholder: "feature/my-branch",
    switchBranchSuccess: ({ name }: { name: string }) =>
      `Переключено на '${name}'`,
    createBranchSuccess: ({ name }: { name: string }) =>
      `Ветка '${name}' создана`,
    dirtyWorkingTree:
      "Пожалуйста, зафиксируйте или спрячьте изменения перед переключением веток",
    branchSwitchFailed: "Не удалось переключить ветку",
    branchCreateFailed: "Не удалось создать ветку",
    invalidBranchName: "Недопустимое имя ветки",
    branchAlreadyExists: ({ name }: { name: string }) =>
      `Ветка '${name}' уже существует`,
    stashEmpty: "Нет отложенных изменений",
    stashFiles: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? "файл изменён" : "файлов изменено"}`,
    // Repo selector
    rootRepo: "Корень",
    // Remote operations
    fetch: "Получить",
    pull: "Подтянуть",
    push: "Отправить",
    fetchSuccess: "Получено из удалённого репозитория",
    pullSuccess: "Подтянуто из удалённого репозитория",
    pushSuccess: "Отправлено в удалённый репозиторий",
    fetchFailed: "Не удалось получить из удалённого репозитория",
    pullFailed: "Не удалось подтянуть из удалённого репозитория",
    pushFailed: "Не удалось отправить в удалённый репозиторий",
    noUpstreamHint: "Верхний поток не настроен",
    upToDate: "Актуально",
    stage: "Индексировать",
    unstage: "Снять индексацию",
    discard: "Отменить",
    addToGitignore: "Добавить в .gitignore",
    commit: "Зафиксировать",
    stageAll: "Индексировать всё",
    unstageAll: "Снять всю индексацию",
    discardAll: "Отменить всё",
    stageSuccess: "Файлы проиндексированы",
    unstageSuccess: "Индексация снята",
    discardSuccess: "Изменения отменены",
    gitignoreSuccess: "Добавлено в .gitignore",
    commitSuccess: "Изменения зафиксированы",
    stageFailed: "Не удалось проиндексировать файлы",
    unstageFailed: "Не удалось снять индексацию",
    discardFailed: "Не удалось отменить изменения",
    gitignoreFailed: "Не удалось добавить в .gitignore",
    commitFailed: "Не удалось зафиксировать",
    discardConfirmTitle: "Отменить изменения?",
    discardConfirmMessage: ({ count }) =>
      `Изменения в ${count} ${count === 1 ? "файле" : "файлах"} будут безвозвратно отменены.`,
    discardAllConfirmMessage:
      "Все неиндексированные изменения будут безвозвратно потеряны.",
    selectedCount: ({ count }) => `Выбрано: ${count}`,
    commitMessagePlaceholder: "Введите сообщение коммита...",
    noStagedFiles: "Нет проиндексированных файлов для фиксации",
  },

  issues: {
    open: "Открытые",
    closed: "Закрытые",
    loading: "Загрузка issues...",
    noIssues: "Issues не найдены",
    noRepo: "Репозиторий GitHub/Gitea не обнаружен",
    noBody: "Описание отсутствует",
    sendToChat: "Отправить в чат",
    openInBrowser: "Открыть в браузере",
    closeIssue: "Закрыть issue",
    reopenIssue: "Переоткрыть issue",
    addComment: "Добавить комментарий",
    commentPlaceholder: "Введите комментарий...",
    newIssue: "Новый тикет",
    newIssueTitlePlaceholder: "Заголовок тикета...",
    newIssueBody: "Описание (необязательно)",
    newIssueBodyPlaceholder: "Опишите проблему...",
    pageOf: ({ page }: { page: number }) => `Страница ${page}`,
    launchSession: "Запустить сессию",
    viewProcessingSession: "Просмотреть сессию",
    processing: "В обработке",
    launchFailed: ({ error }: { error: string }) =>
      `Не удалось запустить сессию: ${error}`,
    autoClosedComment: ({ branchName }: { branchName: string }) =>
      `Эта задача обработана Happy Coder. Ветка: ${branchName}`,
    editIssue: "Редактировать задачу",
    editTitle: "Изменить заголовок задачи",
    editTitlePlaceholder: "Заголовок задачи...",
    editBody: "Изменить описание задачи",
    editBodyPlaceholder: "Описание задачи...",
    sortBy: "Сортировка",
    sortCreated: "По дате создания",
    sortUpdated: "По дате обновления",
    sortComments: "По комментариям",
    noOpenIssues: "Нет открытых задач",
    noClosedIssues: "Нет закрытых задач",
    tryClosedHint: "Попробуйте просмотреть закрытые задачи",
    createFirstIssue: "Создать задачу",
    createIssueTitle: "Создать задачу",
    labelSelect: "Метки",
    noLabelsAvailable: "Нет доступных меток",
    createButton: "Создать",
    statusProcessing: "В обработке",
    statusCompleted: "Завершено",
    statusFailed: "Ошибка",
    statusCancelled: "Отменено",
    sectionMetadata: "Метаданные",
    sectionDescription: "Описание",
    sectionWorktree: "Рабочее дерево",
    metaRepository: "Репозиторий",
    metaAuthor: "Автор",
    metaLabels: "Метки",
    metaCreated: "Создано",
    metaBranch: "Ветка",
    metaParentBranch: "Родительская ветка",
    noDescriptionProvided: "Описание не предоставлено",
    sectionTask: "Инструкции задачи",
    cannotArchiveProcessing:
      "Этот сеанс обрабатывает задачу. Дождитесь завершения.",
  },

  prs: {
    open: "Открытые",
    closed: "Закрытые",
    all: "Все",
    draft: "Черновик",
    loading: "Загрузка PR...",
    noRepo: "Репозиторий GitHub/Gitea не обнаружен",
    noOpenPRs: "Нет открытых PR",
    noClosedPRs: "Нет закрытых PR",
    noPRs: "PR не найдены",
    tryClosedHint: "Попробуйте посмотреть закрытые PR",
    sortBy: "Сортировка",
    sortCreated: "Дата создания",
    sortUpdated: "Дата обновления",
    ci_pending: "Ожидание",
    ci_success: "Успешно",
    ci_failure: "Ошибка",
    ci_error: "Ошибка",
    review_approved: "Одобрено",
    review_changes_requested: "Требуются изменения",
    review_commented: "Рецензировано",
    review_pending: "Ожидает рецензии",
    review_dismissed: "Отклонено",
    merged: "Слит",
    noBody: "Описание отсутствует",
    viewChanges: "Просмотр изменений",
    files: "файлов",
    merge: "Слить",
    mergeCommit: "Слияние коммитом",
    squashMerge: "Сжатое слияние",
    rebaseMerge: "Перебазирование",
    recommended: "Рекомендуется",
    chooseMergeMethod: "Выберите метод слияния",
    approve: "Одобрить",
    approved: "Одобрено!",
    cannotApproveOwn: "Нельзя одобрить свой PR",
    closePR: "Закрыть PR",
    addComment: "Добавить комментарий",
    commentPlaceholder: "Введите комментарий...",
    openInBrowser: "Открыть в браузере",
    ciChecks: "CI проверки",
    reviews: "Ревью",
    comments: "Комментарии",
    noChecks: "CI проверки не найдены",
    noReviews: "Ревью пока нет",
    noComments: "Комментариев пока нет",
    loadFailed: "Не удалось загрузить данные",
    mergeHint: "Объединить код в базовую ветку сейчас",
    approveHint: "Только проверка, без слияния",
  },

  settingsPlugins: {
    installed: "Установленные плагины",
    installedDescription: "Нажмите для деталей, долгое нажатие для удаления",
    noPlugins: "Плагины не настроены",
    actions: "Действия",
    addManual: "Добавить плагин",
    addManualDescription: "Введите путь к плагину на целевой машине",
    addTitle: "Добавить плагин",
    addDescription: "Введите абсолютный путь к каталогу плагина",
    addPlaceholder: "~/.claude/plugins/my-plugin",
    discover: "Обнаружить плагины",
    discoverDescription: "Сканировать машину на наличие плагинов",
    discoverTitle: "Обнаружить плагины",
    discoverNoSession: "Нет онлайн-машины для обнаружения плагинов",
    discoverEmpty: "Плагины не найдены",
    discoverAllAdded: "Все обнаруженные плагины уже добавлены",
    discoverFound: ({ count }: { count: number }) => `Найдено ${count} новых плагинов`,
    removeTitle: "Удалить плагин",
    removeConfirm: "Удалить этот плагин из списка?",
    pluginDetail: "Детали плагина",
    basicInfo: "Информация",
    version: "Версия",
    author: "Автор",
    description: "Описание",
    path: "Путь",
    license: "Лицензия",
    homepage: "Домашняя страница",
    contents: "Содержимое",
    commands: ({ count }: { count: number }) =>
      `Команды (${count})`,
    skills: ({ count }: { count: number }) =>
      `Навыки (${count})`,
    agents: ({ count }: { count: number }) =>
      `Агенты (${count})`,
    subPlugins: "Включённые плагины",
    marketplacesTitle: "Маркетплейс",
    refreshMetadata: "Обновить метаданные",
    refreshSuccess: "Метаданные обновлены",
    noDescription: "Нет описания",
    pluginNotFound: "Плагин не найден",
    unknown: "Неизвестно",
    noMachineOnline: "Нет онлайн-машин",
    pluginStats: ({ commands, skills, agents }: { commands: number; skills: number; agents: number }) => {
      const parts: string[] = [];
      if (commands > 0) parts.push(`${commands} cmd`);
      if (skills > 0) parts.push(`${skills} skill`);
      if (agents > 0) parts.push(`${agents} agent`);
      return parts.join(" · ");
    },
    availablePlugins: "Доступные плагины",
    searchPlugins: "Поиск плагинов...",
    install: "Установить",
    uninstall: "Удалить",
    enable: "Включить",
    disable: "Отключить",
    installing: "Установка...",
    uninstalling: "Удаление...",
    installSuccess: ({ name }: { name: string }) => `${name} установлен`,
    uninstallSuccess: ({ name }: { name: string }) => `${name} удалён`,
    enableSuccess: ({ name }: { name: string }) => `${name} включён`,
    disableSuccess: ({ name }: { name: string }) => `${name} отключён`,
    actionFailed: ({ error }: { error: string }) => `Ошибка: ${error}`,
    confirmUninstall: "Вы уверены, что хотите удалить этот плагин?",
    installs: ({ count }: { count: string }) => `${count} установок`,
    update: "Обновить плагин",
    updateSuccess: ({ name }: { name: string }) => `${name} обновлён`,
    updateMarketplace: "Обновить маркетплейс",
    updateMarketplaceSuccess: "Маркетплейс обновлён",
    marketplaceFooter: "Нажмите для обновления маркетплейса",
    addMarketplace: "Добавить маркетплейс",
    addMarketplaceHint: "Добавить маркетплейс из репозитория GitHub",
    addMarketplaceDescription: "Введите репозиторий GitHub (например, owner/repo)",
    addMarketplaceSuccess: "Маркетплейс добавлен",
    noResults: "Подходящие плагины не найдены",
    restartHint: "Изменения плагинов вступают в силу в новых сессиях. Существующие сессии необходимо перезапустить.",
  },

  settingsMcp: {
    title: "MCP-серверы",
    subtitle: "Управление серверами Model Context Protocol",
    servers: "Серверы",
    noServers: "MCP-серверы не настроены",
    connected: "Подключён",
    disconnected: "Отключён",
    error: "Ошибка",
    addServer: "Добавить MCP-сервер",
    addServerName: "Имя сервера",
    addServerNamePlaceholder: "my-server",
    addServerCommand: "Команда",
    addServerCommandPlaceholder: "npx -y @my/mcp-server",
    removeServer: "Удалить сервер",
    confirmRemove: ({ name }: { name: string }) =>
      `Удалить MCP-сервер «${name}»?`,
    removeSuccess: ({ name }: { name: string }) => `${name} удалён`,
    addSuccess: ({ name }: { name: string }) => `${name} добавлен`,
    actionFailed: ({ error }: { error: string }) => `Ошибка: ${error}`,
    refresh: "Обновить",
    refreshSuccess: "MCP-серверы обновлены",
    noMachineOnline: "Нет онлайн-машин",
    serverDetail: ({ name, command, status }: { name: string; command: string; status: string }) =>
      `Команда: ${command}\nСтатус: ${status}`,
    availableServers: "Доступные серверы",
    searchServers: "Поиск серверов...",
    install: "Установить",
    addServerCustom: "Ввести имя и команду вручную",
  },

  gitHosts: {
    title: "Git-хосты",
    description:
      "Настройте, какие Git-хосты используют GitHub API или Gitea API. GitHub.com определяется автоматически. Остальные хосты по умолчанию используют Gitea.",
    empty:
      "Нет настроенных хостов. GitHub.com определяется автоматически, остальные хосты используют Gitea.",
    addHost: "Добавить хост",
    editHost: "Редактировать хост",
    tabBasic: "Основное",
    tabAutoIssue: "Авто-задачи",
    tabWebhooks: "Webhooks",
    hostLabel: "Хост",
    providerLabel: "Провайдер",
    tokenLabel: "API Token",
    tokenPlaceholder: "Необязательно — требуется для приватных репозиториев",
    tokenHint:
      "Создайте в Настройки → Приложения → Токены доступа вашего Gitea. Необходимые разрешения: issue, repository, admin:repo_hook.",
    tokenHintGitHub:
      "Personal Access Token с правами admin:repo_hook. Автоматически создаёт Webhook при сохранении.",
    deleteTitle: "Удалить хост",
    deleteMessage: ({ host }: { host: string }) =>
      `Удалить "${host}" из настроенных хостов?`,
    duplicateTitle: "Дублирующий хост",
    duplicateMessage: ({ host }: { host: string }) => `"${host}" уже настроен.`,
    autoIssueSectionTitle: "Авто-сессия задач",
    autoIssueDescription:
      "Автоматически запускать сессию Claude Code при обнаружении задачи с указанной меткой. Триггер срабатывает только для задач, созданных разрешёнными авторами.",
    autoIssueLabel: "Метка-триггер",
    autoIssueLabelPlaceholder: "напр. claude, auto-fix",
    autoIssueAllowedAuthors: "Разрешённые авторы",
    autoIssueAllowedAuthorsPlaceholder: "имя1, имя2",
    webhookSectionTitle: "Webhook репозитории",
    webhookDescription:
      "Получайте события Webhook от Git-хоста для автоматической обработки задач без опроса. Добавьте репозитории для мониторинга ниже.",
    webhookAddRepo: "Добавить Webhook репо",
    webhookRemoveRepo: "Удалить",
    webhookRepoUrl: "URL репозитория",
    webhookRepoUrlPlaceholder: "https://github.com/owner/repo",
    webhookMachineId: "Целевая машина",
    webhookMachineIdPlaceholder: "Выберите машину",
    webhookRepoPath: "Локальный путь репозитория",
    webhookRepoPathPlaceholder: "/path/to/repo",
    webhookSecretLabel: "Webhook Secret",
    webhookSecretCopied: "Secret скопирован в буфер обмена",
    webhookUrlLabel: "Webhook URL",
    webhookUrlCopied: "URL скопирован в буфер обмена",
    webhookUrlHint:
      "Настройте этот URL и Secret в настройках Webhook вашего репозитория.",
    webhookSyncSuccess: "Webhook маршруты синхронизированы",
    webhookSyncError: "Ошибка синхронизации Webhook маршрутов",
    webhookNoMachines: "Нет доступных машин",
    scanRepos: "Сканировать репозитории",
    scanning: "Сканирование...",
    scanEmpty: "На этой машине не найдено git-репозиториев",
    scanError: "Сканирование не удалось — убедитесь, что машина онлайн",
    scanSearchPlaceholder: "Поиск репозиториев...",
    webhookGuideTitle: ({ provider }: { provider: string }) =>
      `Настройка ${provider} Webhook`,
    guideStep1GitHub:
      "Перейдите в репозиторий → Settings → Webhooks → Add webhook",
    guideStep1Gitea:
      "Перейдите в репозиторий → Settings → Webhooks → Add Webhook → Gitea",
    guideStep2: "Вставьте Webhook URL, показанный ниже",
    guideStep3: "Вставьте Webhook Secret, показанный ниже",
    guideStep4: 'Content type: выберите "application/json"',
    guideStep5: 'Events: выберите только "Issues", затем сохраните',
    webhookTestSuccess: "Сервер доступен",
    webhookTestFail: ({ status }: { status: string }) =>
      `Сервер вернул HTTP ${status}`,
    webhookTestError: "Не удаётся подключиться к серверу — проверьте сеть",
    remoteWebhookSuccess: "Webhook создан в удалённом репозитории",
    remoteWebhookFail: ({ error }: { error: string }) =>
      `Не удалось создать Webhook: ${error}`,
    tokenRequiredForRemote:
      "Для автоматического создания Webhook на удалённом сервере требуется API-токен",
    webhookRepoSaved: "Webhook сохранён",
    webhookFieldsRequired: "Заполните URL репозитория, машину и секрет",
    webhookSaveHostFirst: "Сначала сохраните Git Host",
    webhookRepoDeleted: "Webhook удалён",
    webhookDeleteConfirm: "Удалить этот Webhook и маршрут на сервере?",
  },

  quickCommands: {
    searchPlaceholder: "Поиск команд...",
    noCommandsFound: "Команды не найдены",
    favorites: "Избранное",
    allCommands: "Все команды",
    noResults: "Команды не найдены",
    groups: {
      favorites: "Избранное",
      root: "Скрипты проекта",
      shell: "Команды Shell",
    },
  },

  kanban: {
    emptyTitle: "Задач пока нет",
    emptySubtitle: "Создайте первую задачу для организации работы",
    newTask: "Новая задача",
    taskDetail: "Детали задачи",
    taskNotFound: "Задача не найдена",
    details: "Детали",
    titlePlaceholder: "Название задачи",
    titleRequired: "Название обязательно",
    descriptionPlaceholder: "Описание (необязательно)",
    column: "Статус",
    priorityLabel: "Приоритет",
    machine: "Машина",
    machineOnline: "Онлайн",
    machineOffline: "Офлайн",
    directory: "Директория",
    directoryHint: "Рабочая директория для сессии",
    sessionPromptLabel: "Промпт сессии",
    sessionPromptPlaceholder: "Инструкции для Claude при запуске задачи...",
    sessionPromptHint: "Предзаполненный промпт при создании сессии из задачи",
    linkedSessions: "Связанные сессии",
    actionsLabel: "Действия",
    startSession: "Начать сессию",
    noMachineSelected: "Сначала выберите машину",
    machineNotOnline: "Выбранная машина не в сети",
    noDirectory: "Укажите рабочую директорию",
    spawnFailed: "Не удалось запустить сессию",
    sessionNotFound: "Сессия не найдена",
    sessionActive: "Активна",
    sessionInactive: "Неактивна",
    deleteConfirmTitle: "Удалить задачу",
    deleteConfirmMessage: "Вы уверены, что хотите удалить эту задачу?",
    actions: {
      moveTo: "Переместить в",
    },
    stats: {
      totalTasks: ({ count }: { count: number }) => `${count} задач`,
      activeSessions: ({ count }: { count: number }) => `${count} активных`,
    },
    columns: {
      backlog: "Бэклог",
      todo: "К выполнению",
      inProgress: "В работе",
      review: "На проверке",
      done: "Готово",
    },
    columnEmpty: {
      backlog: {
        title: "Нет задач в очереди",
        subtitle: "Задачи, ожидающие планирования, появятся здесь",
      },
      todo: {
        title: "Нет задач к выполнению",
        subtitle: "Добавьте задачи, готовые к работе",
      },
      inProgress: {
        title: "Нет задач в работе",
        subtitle: "Переместите задачи сюда, когда начнёте работу",
      },
      review: {
        title: "Нет задач на проверке",
        subtitle: "Задачи на проверке появятся здесь",
      },
      done: {
        title: "Нет завершённых задач",
        subtitle: "Завершённые задачи будут показаны здесь",
      },
    },
    priority: {
      low: "Низкий",
      medium: "Средний",
      high: "Высокий",
      urgent: "Срочный",
    },
    templates: {
      pickTitle: "Выбрать шаблон",
      useTemplate: "Использовать шаблон",
      manage: "Управление шаблонами",
      title: "Шаблоны промптов",
      newTemplate: "Новый шаблон",
      editing: "Редактировать шаблон",
      namePlaceholder: "Название шаблона",
      contentPlaceholder:
        "Содержимое шаблона...\nИспользуйте {{title}}, {{description}}, {{directory}}, {{tags}} как переменные",
      deleteTitle: "Удалить шаблон",
      deleteMessage: "Вы уверены, что хотите удалить этот шаблон?",
      builtInBadge: "Встроенный",
      empty: "Шаблонов пока нет",
      builtIn: {
        coding: "Разработка кода",
        bugfix: "Исправление ошибок",
        review: "Обзор кода",
      },
    },
  },

  projects: {
    notFound: "Проект не найден",
    emptyTitle: "Нет проектов",
    emptySubtitle: "Подключите CLI или нажмите кнопку ниже, чтобы добавить проект",
    allProjects: "Все проекты",
    tabSessions: "Сессии",
    tabGit: "Git",
    tabHealth: "Здоровье",
    tabActions: "Действия",
    tabResearch: "Анализ",
    tabConfig: "Настройки",
    configEmpty: "Элементов настройки пока нет",
    configProjectInfo: "Информация о проекте",
    configPath: "Путь",
    configMachine: "Машина",
    configCreatedAt: "Создан",
    configAlias: "Псевдоним проекта",
    configAliasDescription: "Пользовательское отображаемое имя проекта",
    configAliasNotSet: "Не задано",
    configAliasPromptTitle: "Задать псевдоним",
    configAliasPromptMessage: "Введите пользовательское имя. Оставьте пустым для использования имени папки по умолчанию.",
    configDefaultModel: "Модель по умолчанию",
    configDefaultModelDescription: "Модель для новых сессий в этом проекте",
    configDefaultModelNotSet: "По умолчанию",
    configArchive: "Архивировать проект",
    configUnarchive: "Разархивировать проект",
    configArchiveConfirm: "Вы уверены, что хотите архивировать этот проект? Он будет скрыт из списка проектов.",
    configUnarchiveConfirm: "Вы уверены, что хотите разархивировать этот проект?",
    configSaved: "Настройки сохранены",
    configSaveFailed: "Не удалось сохранить настройки",
    noSessions: "Сессий пока нет",
    sessions: "Сессии",
    activeSessions: "Активные сессии",
    archivedSessions: "Архивные сессии",
    noGitInfo: "Информация о git недоступна",
    gitInfo: "Информация Git",
    branch: "Ветка",
    switchBranch: "Сменить ветку",
    ahead: "Впереди",
    behind: "Позади",
    dirty: "Незафиксированные изменения",
    branchAndRemote: "Ветка и удалённый",
    upstreamBranch: "Upstream",
    remoteUrl: "Удалённый",
    fileChanges: "Изменения файлов",
    modifiedCount: "Изменено",
    untrackedCount: "Неотслеживаемые",
    stagedCount: "Подготовлено",
    lineChanges: "Изменения строк",
    stagedLines: "Подготовлено",
    unstagedLines: "Не подготовлено",
    stash: "Stash",
    stashCount: "Записи Stash",
    gitHost: "Git хост",
    addGitHost: "Добавить Git хост",
    noRemoteUrl: "Удалённый URL не обнаружен",
    lastUpdated: "Последнее обновление",
    addProject: "Добавить проект",
    selectMachine: "Выберите машину",
    projectPath: "Путь к проекту",
    pathPlaceholder: "/path/to/your/project",
    noMachines: "Нет доступных машин. Сначала подключите CLI.",
    deleteProject: "Удалить проект",
    deleteConfirmTitle: "Удалить проект",
    deleteConfirmMessage: "Проект будет удалён из списка. Это действие нельзя отменить.",
    hasActiveSessions: "Невозможно удалить: у проекта есть активные сессии",
    create: "Создать",
    deleteArchivedSessions: "Удалить архивные сессии",
    deleteArchivedSessionsConfirm: ({ count }: { count: number }) =>
      `Вы уверены, что хотите навсегда удалить ${count} архивных сессий? Это действие нельзя отменить.`,
    deleteArchivedSessionsSuccess: ({ count }: { count: number }) =>
      `${count} архивных сессий удалено`,
    failedToDeleteArchivedSessions: "Не удалось удалить некоторые архивные сессии",
    deleteArchivedBranchSessions: "Удалить архивные сессии веток",
    deleteArchivedBranchSessionsConfirm: ({ count }: { count: number }) =>
      `Вы уверены, что хотите навсегда удалить ${count} архивных сессий веток? Это действие нельзя отменить.`,
    clearBranch: "Очистить ветки",
    clearAll: "Очистить все",
  },
  project: {
    segments: {
      board: "Доска",
    },
  },

  webNotification: {
    taskComplete: "Задача завершена",
    permissionRequest: "Требуется одобрение",
  },

  openclaw: {
    title: "OpenClaw",
    connect: "Подключить",
    connecting: "Подключение...",
    connected: "Подключено",
    disconnect: "Отключить",
    notConnected: "Не подключено",
    notConnectedDescription:
      "Подключитесь к шлюзу OpenClaw, чтобы начать общение.",
    connectToGateway: "Подключиться к шлюзу",
    connectTitle: "Подключение к OpenClaw",
    connectDescription:
      "Введите URL вашего шлюза OpenClaw. Шлюз работает локально на вашем компьютере.",
    connectionSettings: "Настройки подключения",
    gatewayUrl: "URL шлюза",
    token: "Токен доступа",
    tokenDescription: "Получите через CLI или панель управления OpenClaw",
    tokenPlaceholder: "Введите токен доступа к шлюзу",
    password: "Пароль",
    passwordOptional: "Для шлюзов, защищённых паролем",
    passwordPlaceholder: "Введите пароль, если требуется",
    connectionFailed: "Ошибка подключения",
    checkSettings: "Проверьте настройки подключения и попробуйте снова.",
    connectFooter:
      "Подключение напрямую к вашему локальному шлюзу. Данные не проходят через внешние серверы.",
    localConnection: "Локальное подключение",
    localConnectionDescription:
      "Вся коммуникация происходит напрямую с вашим шлюзом.",
    viewSessions: "Просмотр сессий",
    connectedTo: "Подключено к",
    newChat: "Новый чат",
    recentSessions: "Недавние сессии",
    noSessions: "Сессий пока нет. Начните новый чат.",
    chat: "Чат",
    startConversation: "Начните разговор с OpenClaw",
    messagePlaceholder: "Введите сообщение...",
    pairingRequired: "Требуется сопряжение",
    pairingDescription:
      "Это устройство должно быть одобрено для подключения к шлюзу.",
    pairingInstructions: "Как одобрить",
    pairingStep1Title: "Откройте OpenClaw",
    pairingStep1Description: "Нажмите на значок OpenClaw в строке меню",
    pairingStep2Title: "Найдите запрос на сопряжение",
    pairingStep2Description: 'Найдите "Happy" в списке ожидающих устройств',
    pairingStep3Title: "Одобрите устройство",
    pairingStep3Description:
      'Нажмите "Одобрить" для подключения этого устройства',
    retryConnection: "Повторить подключение",
    deviceInfo: "Информация об устройстве",
    deviceId: "ID устройства",
    newSession: "Новая сессия",
    newSessionTitle: "Начать новый разговор",
    newSessionDescription:
      "Введите сообщение ниже, чтобы начать общение с OpenClaw.",
    newSessionPlaceholder: "О чём вы хотите поговорить?",
    tokenCommand: "Команда для получения токена",
    tokenCommandHint: "Выполните эту команду в терминале:",
    tokenCommandValue: "clawdbot dashboard --no-open",
    tokenCommandDescription:
      'Это выведет URL с вашим токеном. Скопируйте значение после "?token="',
    thinking: "Думаю",
    usingTools: "Использую инструменты",
    errorOccurred: "Произошла ошибка",
  },
  preview: {
    title: "Предпросмотр",
    detectingPorts: "Обнаружение серверов разработки...",
    noPorts: "Серверы разработки не обнаружены",
    noPortsHint:
      "Сначала запустите сервер разработки, затем нажмите Обнаружить",
    detect: "Обнаружить",
    refresh: "Обновить",
    capture: "Снимок",
    capturing: "Создание снимка экрана...",
    urlPlaceholder: "http://localhost:3000",
    customUrl: "Свой URL",
    screenshotFailed: "Не удалось сделать снимок экрана",
    devServers: "Серверы разработки",
    screenshotAt: ({ url }: { url: string }) => `Снимок ${url}`,
    portItem: ({ port, process }: { port: number; process: string }) =>
      `Порт ${port} — ${process}`,
    setBaseline: "Установить как базовый",
    clearBaseline: "Очистить базовый",
    baselineSet: "Базовый снимок сохранён",
    compare: "Сравнить",
    comparing: "Сравнение с базовым снимком...",
    before: "До",
    after: "После",
    diff: "Различия",
    noBaseline: "Базовый снимок не задан",
    noBaselineHint: "Сначала сделайте снимок, затем установите его как базовый",
    comparisonFailed: "Сравнение не удалось",
    unavailableTitle: "agent-browser не найден",
    unavailableHint:
      "Установите agent-browser на машине CLI для использования предпросмотра. Выполните: npm install -g @anthropic-ai/agent-browser",
    emptyHint:
      "Выберите сервер разработки или введите URL для создания скриншота фронтенда.",
    otherPorts: ({ count }: { count: number }) =>
      `Ещё ${count} не-веб портов`,
    portsFoundCount: ({ count }: { count: number }) => `Найдено портов: ${count}`,
    phase: {
      "scanning-ports": "Сканирование портов...",
      "fallback-detection": "Альтернативное обнаружение...",
      "checking-docker": "Проверка Docker контейнеров...",
      "filtering-cwd": "Фильтрация по проекту...",
      "probing-http": "Проверка HTTP сервисов...",
      done: "Готово",
    },
  },

  backgroundTasks: {
    running: "Выполняется",
    completed: "Завершено",
    failed: "Ошибка",
    viewLog: "Просмотр логов",
    noOutput: "Нет вывода",
    close: "Закрыть",
    refresh: "Обновить",
    elapsed: ({ time }: { time: string }) => `${time}`,
    stop: "Остановить",
    stopConfirmTitle: "Остановить задачу",
    stopConfirmMessage: "Вы уверены, что хотите остановить эту фоновую задачу?",
    stopConfirmDetail: ({ name, port }: { name: string; port: string }) => `Остановить «${name}» на порту ${port}?`,
    stopConfirmDetailNoPort: ({ name }: { name: string }) => `Остановить «${name}»?`,
  },

  processManager: {
    title: "Фоновые процессы",
    viewAll: "Управление процессами",
    viewAllHint: "Просмотр и управление фоновыми сервисами",
    scanning: "Сканирование процессов...",
    count: ({ count }: { count: number }) => `${count} активных сервисов`,
    noProcesses: "Нет фоновых сервисов",
    noProcessesHint: "На этой машине нет запущенных веб-сервисов.",
    killAll: "Остановить все",
    killConfirmTitle: "Остановить сервис",
    killConfirmMessage: ({ port, process }: { port: number; process: string }) =>
      `Остановить ${process} на порту ${port}?`,
    killAllConfirmTitle: "Остановить все сервисы",
    killAllConfirmMessage: ({ count }: { count: number }) =>
      `Остановить все ${count} запущенных сервисов?`,
  },

  supervisor: {
    title: "Мониторинг здоровья",
    description: "AI-анализ кода, отслеживающий здоровье проекта по множеству измерений.",
    notSynced: "Проект ещё не синхронизирован с сервером",
    scanNow: "Сканировать",
    scanStarting: "Запуск...",
    loading: "Загрузка...",
    alreadyRunning: "Сканирование уже выполняется",
    settings: "Настройки мониторинга",
    status_pending: "Ожидание",
    status_running: "Выполняется",
    status_completed: "Завершено",
    status_failed: "Ошибка",
    status_cancelled: "Отменено",
    statusWaitingCli: "Ожидание CLI...",
    statusAnalyzing: "ИИ анализирует код...",
    elapsed: ({ time }: { time: string }) => `Прошло: ${time}`,
    triggerManual: "Ручное сканирование",
    triggerScheduled: "По расписанию",
    triggerEvent: "Событие",
    triggerPush: "Push-триггер",
    severityCritical: "Критический",
    severityHigh: "Высокий",
    severityMedium: "Средний",
    severityLow: "Низкий",
    pendingActions: ({ count }: { count: number }) => `Ожидающие действия (${count})`,
    actionsCount: ({ count }: { count: number }) => `${count} действий`,
    approve: "Одобрить",
    skip: "Пропустить",
    ignore: "Игнорировать",
    triggerFix: "Исправить",
    suggestedFix: "Предлагаемое исправление",
    fixStatus: "Статус исправления",
    runHistory: "История запусков",
    noRuns: "Сканирований ещё не было",
    moreRuns: ({ count }: { count: number }) => `Ещё ${count}`,
    showMoreRuns: ({ count }: { count: number }) => `Показать ещё ${count} запус${count === 1 ? "к" : "ков"}`,
    justNow: "Только что",
    minutesAgo: ({ count }: { count: number }) => `${count} мин назад`,
    hoursAgo: ({ count }: { count: number }) => `${count} ч назад`,
    daysAgo: ({ count }: { count: number }) => `${count} дн назад`,
    costSection: "Расходы",
    costRunsCount: "Запуски",
    costTotalTokens: "Всего токенов",
    costTotalUsd: "Общая стоимость",
    costPeriod: ({ days }: { days: number }) => `За ${days} дней`,
    trendSection: "Тренд серьёзности",
    relatedProjects: "Связанные проекты",
    summaryGrade: "Оценка",
    trendImproving: "Улучшается",
    trendStable: "Стабильно",
    trendDeclining: "Ухудшается",
    lastScan: "Последнее сканирование",
    openIssues: "Открытые проблемы",
    runs30d: "Запуски (30д)",
    nextRun: "Следующее сканирование",
    runDetail: "Детали запуска",
    runTrigger: "Триггер",
    runDuration: "Длительность",
    runCost: "Стоимость",
    newIssues: "Новые проблемы",
    resolvedIssues: "Решённые",
    persistentIssues: "Нерешённые",
    noPreviousRun: "Первое сканирование — нет данных для сравнения",
    dimensionsSection: "Измерения анализа",
    analyzingDimension: ({ dimension, index, total }) => `${dimension} (${index}/${total})`,
    dimSecurity: "Безопасность",
    dimSecurityNote: "Уязвимости, захардкоженные секреты, риски инъекций",
    dimDependencies: "Зависимости",
    dimDependenciesNote: "Устаревшие пакеты, конфликты версий, дубликаты",
    dimArchitecture: "Архитектура",
    dimArchitectureNote: "Организация кода, соответствие конвенциям",
    dimTechDebt: "Технический долг",
    dimTechDebtNote: "TODO/FIXME, мёртвый код, дублирование кода",
    dimCodeQuality: "Качество кода",
    dimCodeQualityNote: "Стиль, сложность, лучшие практики",
    dimTestCoverage: "Тестовое покрытие",
    dimTestCoverageNote: "Пробелы покрытия, качество тестов",
    dimDocumentation: "Документация",
    dimDocumentationNote: "README, документация API, точность комментариев",
    dimPerformance: "Производительность",
    dimPerformanceNote: "Запросы N+1, отсутствующие индексы, утечки памяти",
    dimUiUx: "UI/UX",
    dimUiUxNote: "Отступы, состояния загрузки, доступность, использование темы",
    dimResearch: "Исследование",
    modeSection: "Режим анализа",
    modeSuggest: "Предложения",
    modeSuggestDesc: "AI предлагает действия, вы одобряете вручную",
    modeSemiAuto: "Полуавтомат",
    modeSemiAutoDesc: "Автоисправление низкорисковых, ручное — для высокорисковых",
    modeAuto: "Авто",
    modeAutoDesc: "AI автоматически исправляет и создаёт Issue/PR",
    scheduleSection: "Расписание",
    scheduleEnabled: "Включить плановое сканирование",
    scheduleEvery6h: "Каждые 6 часов",
    scheduleEvery12h: "Каждые 12 часов",
    scheduleEvery24h: "Каждые 24 часа",
    scheduleEvery48h: "Каждые 48 часов",
    scheduleEveryWeek: "Еженедельно",
    pushTriggerSection: "Push-триггер",
    pushTriggerEnabled: "Сканировать при push",
    pushTriggerDesc: "Запуск инкрементального анализа при push кода",

    fixStrategySection: "Стратегия исправлений",
    fixStrategyDirect: "Прямое слияние",
    fixStrategyDirectDesc: "Отправлять исправления напрямую в основную ветку (с разрешением конфликтов и проверкой тестами)",
    fixStrategyPr: "Pull Request",
    fixStrategyPrDesc: "Создавать PR для каждого исправления (требуется ручное слияние)",
    customRulesSection: "Пользовательские правила",
    customRulesDesc: "Добавить правила анализа для проекта",
    customRulesPlaceholder: "Например: Проверить rate limiting на всех API-эндпоинтах",
    notificationsSection: "Уведомления",
    notifAnalysisComplete: "Анализ завершён",
    notifIssueCreated: "Issue создан",
    notifPRCreated: "PR создан",
    notifError: "Ошибки",
    approveAll: "Одобрить все",
    skipAll: "Пропустить все",
    viewAllActions: "Все действия",
    approveAllConfirm: ({ count }: { count: number }) => `Одобрить все ${count} ожидающих действий?`,
    skipAllConfirm: ({ count }: { count: number }) => `Пропустить все ${count} ожидающих действий?`,
    approveAllSuccess: ({ count }: { count: number }) => `${count} действий одобрено`,
    skipAllSuccess: ({ count }: { count: number }) => `${count} действий пропущено`,
    clearAll: "Очистить всё",
    clearAllConfirm: "Это навсегда удалит все рекомендации Supervisor для этого проекта. Вы уверены?",
    clearAllSuccess: ({ count }: { count: number }) => `${count} действий удалено`,

    // Phase 7: Action history
    actionHistory: "История действий",
    tabPending: "Ожидающие",
    tabApproved: "Одобренные",
    tabFixing: "Исправление",
    tabDone: "Готово",
    tabDismissed: "Отклонено",
    noActions: "Нет действий",
    loadMore: "Загрузить ещё",
    loadError: "Не удалось загрузить действия",
    viewSession: "Просмотр сессии",
    viewPR: "Открыть PR",
    retryFix: "Повторить",
    exportReport: "Экспорт отчёта",
    exportCopied: "Отчёт скопирован в буфер обмена",
    healthScore: "Оценка",
    autoWarningTitle: "Включить автоматический режим?",
    autoWarningBody: "Автоматический режим будет применять исправления и создавать Issue/PR без ручного одобрения. Используйте осторожно.",
    autoWarningConfirm: "Включить",
    autoModeSafetyNote: "Авто-режим ограничен низкорисковыми исправлениями. Высокорисковые изменения требуют одобрения.",
    safetyNote: "Все изменения делаются в отдельных ветках и требуют PR-ревью.",
    dailyLimitNote: "Дневной лимит токенов предотвращает неконтролируемые расходы.",
    runActions: "Действия",
    settingsSaved: "Настройки сохранены",
    settingsSaveError: "Не удалось сохранить настройки",
    autoApproveSeverities: "Автоодобрение по уровню:",
    reprocessTitle: "Применить новый режим?",
    reprocessBody: ({ count, mode }: { count: number; mode: string }) =>
      `У вас ${count} ожидающих действий. Применить правила ${mode} сейчас?`,
    reprocessConfirm: "Применить",
    reprocessSuccess: ({ approved, remaining }: { approved: number; remaining: number }) =>
      `${approved} автоодобрено${remaining > 0 ? `, ${remaining} ещё ожидает` : ""}`,
    concurrencySection: "Лимиты параллельности",
    maxAnalysisSessions: "Макс. сессий анализа",
    maxAnalysisSessionsNote: "Максимум одновременных сессий анализа/исследования",
    maxFixSessions: "Макс. сессий исправления",
    maxFixSessionsNote: "Максимум одновременных сессий исправления",
    analysisLimitsSection: "Лимиты анализа",
    maxFindings: "Максимум находок за запуск",
    maxFindingsNote: "0 = без ограничений. Ограничивает находки за сканирование",
    status_queued: "В очереди",
    recurring: "Повторяющееся",
    skipIgnoreHint: "Пропустить: появится при следующем сканировании. Игнорировать: навсегда скрыть.",
    restore: "Восстановить",
    delete: "Удалить",
    deleteConfirm: "Удалить действие",
    deleteConfirmBody: "Удалить это действие навсегда? Если проблема ещё существует, она будет обнаружена при следующем сканировании.",
    forceComplete: "Отметить выполненным",
    forceFail: "Отметить неудачным",
    forceCompleteConfirm: "Отметить как выполненное?",
    forceCompleteConfirmBody: "Используйте, когда исправление было применено, но статус не обновился автоматически.",
    forceFailConfirm: "Отметить как неудачное?",
    forceFailConfirmBody: "Используйте, когда fix session завершился аварийно или требует сброса.",
    forceResolveHint: "Застряли? Решите вручную:",

    // Loop mode
    loopMode: "Цикл",
    loopConfig: "Настройка цикла",
    loopConfigIterations: "Макс. итераций",
    loopConfigIterationsHint: "Сколько циклов анализ→исправление выполнить до остановки",
    loopConfigIterationsHintUnlimited: "Выполнять до обработки всех подходящих действий (0 = без ограничений)",
    loopConfigThreshold: "Порог автоодобрения",
    loopConfigThresholdHint: "Автоматически исправлять только действия с уверенностью ИИ выше этого уровня",
    loopConfigCostCap: "Лимит стоимости",
    loopConfigCostCapHint: "Остановить цикл, когда накопленная стоимость достигнет этой суммы",
    loopConfigSafety: "Цикл использует прямое слияние. Каждое исправление выполняется в изолированном рабочем дереве. Вы можете приостановить или остановить в любой момент.",
    loopConfigStart: "Запустить цикл",
    loopHistory: "История циклов",
    loopIteration: ({ current, max }: { current: number; max: number }) => `Итерация ${current}/${max}`,
    loopIterationUnlimited: ({ current }: { current: number }) => `Итерация ${current} (без ограничений)`,
    loopFound: "Найдено",
    loopFixed: "Исправлено",
    loopCost: "Стоимость",
    loopHealthDelta: "Здоровье",
    loopPause: "Пауза",
    loopResume: "Продолжить",
    loopStop: "Остановить",
    loopStopConfirm: "Остановить цикл?",
    loopStopConfirmBody: "Текущая итерация завершится, но новые итерации не будут запущены.",
    loopPhase_idle: "Ожидание",
    loopPhase_analyzing: "Анализ",
    loopPhase_fixing: "Исправление",
    loopPhase_deciding: "Принятие решения",
    loopStatus_running: "Цикл выполняется",
    loopStatus_paused: "Цикл приостановлен",
    loopStatus_completed: "Цикл завершён",
    loopStatus_failed: "Цикл не удался",
    loopStatus_stopped: "Цикл остановлен",
    loopExit_max_iterations: "Достигнуто максимальное число итераций",
    loopExit_cost_cap: "Достигнут лимит стоимости",
    loopExit_health_target: "Достигнута цель здоровья",
    loopExit_no_new_actions: "Больше нет проблем для исправления",
    loopExit_consecutive_failures: "Слишком много последовательных ошибок",
    loopExit_user_stopped: "Остановлено пользователем",
    loopExit_timeout: "Время истекло",
    loopDetailExitReason: "Причина завершения",
    loopDetailTimeline: "Хронология итераций",
    loopDetailActions: ({ count }: { count: number }) => `Действия (${count})`,
    loopDetailNoRuns: "Итераций пока нет",
    loopDetailNoActions: "Действий пока нет",
    loadRunError: "Не удалось загрузить данные запуска",
    loadLoopError: "Не удалось загрузить данные цикла",

    // Preflight sync dimensions
    dimPreflightStart: "Синхронизация кода...",
    dimPreflightCheck: "Проверка репозитория...",
    dimPreflightStash: "Сохранение изменений...",
    dimPreflightFetch: "Получение обновлений...",
    dimPreflightPull: "Загрузка обновлений...",
    dimPreflightResolve: "Разрешение конфликтов...",
    dimPreflightDeploy: "Развёртывание изменений...",
    dimPreflightDeployCli: "Выпуск CLI...",
    dimPreflightDeployServer: "Пересборка сервера...",

    // Теги срочности
    urgentTag: "Срочно",
    mustFixTag: "Обязательно",
    optionalTag: "Необязательно",

    // Сортировка и фильтрация
    sortBy: "Сортировка",
    sortSeverity: "Важность",
    sortCategory: "Категория",
    sortConfidence: "Уверенность",
    sortUrgency: "Срочность",
    filterUrgency: "Срочность",
    urgencyAll: "Все",
    urgencyUrgent: "Срочно",
    urgencyMustFix: "Обязательно",
    urgencyOptional: "Необязательно",
  },
  webhook: {
    eventHistory: "События Webhook",
    noEvents: "Нет событий Webhook",
    loadMore: "Загрузить ещё",
    issue: "Issue",
  },
  competitorResearch: {
    title: "Анализ конкурентов",
    description: "AI-анализ аналогичных продуктов и позиционирования на рынке",
    startAnalysis: "Начать анализ",
    analyzing: "Анализ конкурентов...",
    knownCompetitors: "Известные конкуренты",
    knownCompetitorsPlaceholder: "напр. VS Code, Cursor, Windsurf (необязательно)",
    dimensionsSection: "Направления анализа",
    dim_pricing: "Ценовая стратегия",
    dim_pricing_note: "Модели цен, тарифы, ограничения бесплатной версии",
    dim_features: "Основные функции",
    dim_features_note: "Матрица функций, уникальные возможности",
    dim_devExperience: "Опыт разработчика",
    dim_devExperience_note: "Простота начала работы, качество документации, дизайн CLI",
    dim_positioning: "Позиционирование на рынке",
    dim_positioning_note: "Целевая аудитория, дифференциация бренда",
    dim_techStack: "Техническая архитектура",
    dim_techStack_note: "Технологический стек, расширяемость, производительность",
    dim_community: "Сообщество и экосистема",
    dim_community_note: "GitHub stars, плагины, активность сообщества",
    dim_funding: "Финансирование и бизнес",
    dim_funding_note: "Раунды финансирования, оценка, бизнес-модель",
    dim_userFeedback: "Отзывы пользователей",
    dim_userFeedback_note: "Обзоры, болевые точки, удовлетворённость",
    additionalNotes: "Дополнительные заметки",
    additionalNotesPlaceholder: "Дополнительные направления или конкретные вопросы (необязательно)",
    customRules: "Пользовательские правила",
    customRulesPlaceholder: "Например: фокус только на open-source конкурентах, игнорировать корпоративные решения",
    syncSaving: "Сохранение…",
    syncSaved: "Сохранено",
    syncFailed: "Ошибка синхронизации",
    noReports: "Отчётов пока нет",
    reportHistory: "Предыдущие отчёты",
    latestReport: "Последний отчёт",
    untitledReport: "Без названия",
    reportDetail: "Отчёт об исследовании",
    reportNotFound: "Отчёт не найден",
  },

  elicitation: {
    accept: "Принять",
    decline: "Отклонить",
    submit: "Отправить",
  },
  stopFailure: {
    title: "Сессия неожиданно остановлена",
    lastMessage: "Последнее сообщение ассистента",
  },
} as const;

export type TranslationsRu = typeof ru;
