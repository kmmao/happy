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
    usage: "Использование",
    usageSubtitle: "Просмотр использования API и затрат",
    profiles: "Профили",
    profilesSubtitle: "Управление профилями переменных окружения для сессий",
    gitHosts: "Git-хосты",
    gitHostsSubtitle: "Настройка провайдеров Git-хостов",

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
      "Отображать вызовы инструментов прямо в сообщениях чата",
    expandTodoLists: "Развернуть списки задач",
    expandTodoListsDescription: "Показывать все задачи вместо только изменений",
    expandToolDetails: "Развернуть детали инструментов",
    expandToolDetailsDescription:
      "Показывать развёрнутые детали вызовов инструментов по умолчанию",
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
    compactionSummaryTitle: "Резюме сжатия",
    compactionSummaryEmpty:
      "Резюме сжатия отсутствует. Оно появится здесь после сжатия контекста.",
    compactionSummaryDisconnected:
      "Сессия не подключена. Резюме доступно только когда CLI онлайн.",
    messageQueued: "В очереди",
  },

  bookmark: {
    sourceAI: "AI",
    sourceUser: "Я",
  },

  commandPalette: {
    placeholder: "Введите команду или поиск...",
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
    historyEmpty: "Коммитов пока нет",
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
    cannotArchiveProcessing:
      "Этот сеанс обрабатывает задачу. Дождитесь завершения.",
  },

  gitHosts: {
    title: "Git-хосты",
    description:
      "Настройте, какие Git-хосты используют GitHub API или Gitea API. GitHub.com определяется автоматически. Остальные хосты по умолчанию используют Gitea.",
    empty:
      "Нет настроенных хостов. GitHub.com определяется автоматически, остальные хосты используют Gitea.",
    addHost: "Добавить хост",
    editHost: "Редактировать хост",
    hostLabel: "Хост",
    providerLabel: "Провайдер",
    tokenLabel: "API Token",
    tokenPlaceholder: "Необязательно — требуется для приватных репозиториев",
    tokenHint:
      "Создайте в Настройки → Приложения → Токены доступа вашего Gitea.",
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
    webhookGuideTitle: "Настройка {{provider}} Webhook",
    guideStep1GitHub:
      "Перейдите в репозиторий → Settings → Webhooks → Add webhook",
    guideStep1Gitea:
      "Перейдите в репозиторий → Settings → Webhooks → Add Webhook → Gitea",
    guideStep2: "Вставьте Webhook URL, показанный ниже",
    guideStep3: "Вставьте Webhook Secret, показанный ниже",
    guideStep4: 'Content type: выберите "application/json"',
    guideStep5: 'Events: выберите только "Issues", затем сохраните',
    webhookTestSuccess: "Сервер доступен",
    webhookTestFail: "Сервер вернул HTTP {{status}}",
    webhookTestError: "Не удаётся подключиться к серверу — проверьте сеть",
    remoteWebhookSuccess: "Webhook создан в удалённом репозитории",
    remoteWebhookFail: "Не удалось создать Webhook: {{error}}",
  },

  quickCommands: {
    searchPlaceholder: "Поиск команд...",
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

  project: {
    segments: {
      ideas: "Идеи",
      board: "Доска",
      roadmap: "Дорожная карта",
    },
  },

  ideation: {
    // Управление идеями
    emptyTitle: "Идей пока нет",
    emptySubtitle: "Фиксируйте идеи и превращайте лучшие в задачи",
    newIdea: "Новая идея",
    ideaDetail: "Детали идеи",
    ideaNotFound: "Идея не найдена",
    details: "Детали",
    titlePlaceholder: "Название идеи",
    titleRequired: "Название обязательно",
    descriptionPlaceholder: "Опишите вашу идею...",
    categoryLabel: "Категория",
    categories: {
      feature: "Функция",
      improvement: "Улучшение",
      bugfix: "Исправление",
      refactor: "Рефакторинг",
      documentation: "Документация",
      other: "Другое",
    },
    statusLabel: "Статус",
    statuses: {
      draft: "Черновик",
      active: "Активная",
      converted: "Преобразована",
      dismissed: "Отклонена",
    },
    priorityLabel: "Приоритет",
    convertToTask: "Преобразовать в задачу",
    convertConfirmTitle: "Преобразовать в задачу",
    convertConfirmMessage:
      "Из этой идеи будет создана новая задача на канбан-доске.",
    dismiss: "Отклонить",
    dismissConfirmTitle: "Отклонить идею",
    dismissConfirmMessage: "Вы уверены, что хотите отклонить эту идею?",
    deleteConfirmTitle: "Удалить идею",
    deleteConfirmMessage: "Вы уверены, что хотите удалить эту идею?",
    converted: "Преобразовано в задачу",
    viewTask: "Просмотр задачи",
    actions: {
      changeStatus: "Изменить статус",
    },
    stats: {
      totalIdeas: ({ count }: { count: number }) =>
        `${count} ${plural({ count, one: "идея", few: "идеи", many: "идей" })}`,
      activeIdeas: ({ count }: { count: number }) =>
        `${count} ${plural({ count, one: "активная", few: "активные", many: "активных" })}`,
    },
    filter: {
      all: "Все",
    },
  },

  roadmap: {
    emptyTitle: "Вех пока нет",
    emptySubtitle: "Создайте вехи для планирования дорожной карты проекта",
    newMilestone: "Новая веха",
    milestoneDetail: "Детали вехи",
    milestoneNotFound: "Веха не найдена",
    newFeature: "Новая функция",
    featureDetail: "Детали функции",
    featureNotFound: "Функция не найдена",
    details: "Детали",
    titlePlaceholder: "Название",
    titleRequired: "Название обязательно",
    descriptionPlaceholder: "Описание...",
    targetDate: "Целевая дата",
    targetDateNone: "Нет целевой даты",
    milestoneLabel: "Веха",
    moscow: {
      mustHave: "Обязательно",
      shouldHave: "Желательно",
      couldHave: "Возможно",
      wontHave: "Не будет",
    },
    moscowLabel: "Приоритет (MoSCoW)",
    featureStatuses: {
      planned: "Запланировано",
      inProgress: "В работе",
      completed: "Завершено",
      cancelled: "Отменено",
    },
    statusLabel: "Статус",
    complexity: {
      trivial: "Тривиально",
      simple: "Просто",
      moderate: "Умеренно",
      complex: "Сложно",
      veryComplex: "Очень сложно",
    },
    complexityLabel: "Сложность",
    features: "Функции",
    noFeatures: "В этой вехе нет функций",
    milestoneOptions: "Настройки вехи",
    convertToTask: "Преобразовать в задачу",
    convertConfirmTitle: "Преобразовать в задачу",
    convertConfirmMessage:
      "Из этой функции будет создана новая задача на канбан-доске.",
    viewTask: "Просмотр задачи",
    deleteMilestoneConfirmTitle: "Удалить веху",
    deleteMilestoneConfirmMessage:
      "Все функции в этой вехе также будут удалены. Вы уверены?",
    deleteFeatureConfirmTitle: "Удалить функцию",
    deleteFeatureConfirmMessage: "Вы уверены, что хотите удалить эту функцию?",
    progress: ({ completed, total }: { completed: number; total: number }) =>
      `${completed}/${total} завершено`,
    stats: {
      totalMilestones: ({ count }: { count: number }) =>
        `${count} ${plural({ count, one: "веха", few: "вехи", many: "вех" })}`,
      totalFeatures: ({ count }: { count: number }) =>
        `${count} ${plural({ count, one: "функция", few: "функции", many: "функций" })}`,
    },
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
} as const;

export type TranslationsRu = typeof ru;
