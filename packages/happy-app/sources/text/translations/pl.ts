import type { TranslationStructure } from "../_default";

/**
 * Polish plural helper function
 * Polish has 3 plural forms: one, few, many
 * @param options - Object containing count and the three plural forms
 * @returns The appropriate form based on Polish plural rules
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

  // Rule: 1 (but not 11)
  if (n === 1) return one;

  // Rule: 2-4 but not 12-14
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;

  // Rule: everything else (0, 5-19, 11, 12-14, etc.)
  return many;
}

/**
 * Polish translations for the Happy app
 * Must match the exact structure of the English translations
 */
export const pl: TranslationStructure = {
  tabs: {
    // Tab navigation labels
    inbox: "Skrzynka",
    sessions: "Terminale",
    project: "Projekt",
    openclaw: "OpenClaw",
    settings: "Ustawienia",
  },

  inbox: {
    // Inbox screen
    emptyTitle: "Pusta skrzynka",
    emptyDescription: "Połącz się z przyjaciółmi, aby zacząć udostępniać sesje",
    updates: "Aktualizacje",
  },

  common: {
    // Simple string constants
    cancel: "Anuluj",
    authenticate: "Uwierzytelnij",
    save: "Zapisz",
    saveAs: "Zapisz jako",
    error: "Błąd",
    success: "Sukces",
    ok: "OK",
    continue: "Kontynuuj",
    back: "Wstecz",
    create: "Utwórz",
    rename: "Zmień nazwę",
    reset: "Resetuj",
    logout: "Wyloguj",
    yes: "Tak",
    no: "Nie",
    discard: "Odrzuć",
    version: "Wersja",
    copied: "Skopiowano",
    copy: "Kopiuj",
    submit: "Wyślij",
    scanning: "Skanowanie...",
    urlPlaceholder: "https://example.com",
    home: "Główna",
    message: "Wiadomość",
    files: "Pliki",
    fileViewer: "Przeglądarka plików",
    loading: "Ładowanie...",
    retry: "Ponów",
    delete: "Usuń",
    optional: "opcjonalnie",
  },

  profile: {
    userProfile: "Profil użytkownika",
    details: "Szczegóły",
    firstName: "Imię",
    lastName: "Nazwisko",
    username: "Nazwa użytkownika",
    status: "Status",
  },

  status: {
    connected: "połączono",
    connecting: "łączenie",
    disconnected: "rozłączono",
    error: "błąd",
    online: "online",
    offline: "offline",
    lastSeen: ({ time }: { time: string }) => `ostatnio widziano ${time}`,
    permissionRequired: "wymagane uprawnienie",
    needsAttention: "czeka na twoją odpowiedź",
    apiRetry: ({
      attempt,
      maxRetries,
    }: {
      attempt: number;
      maxRetries: number;
    }) => `ponowna próba API (${attempt}/${maxRetries})…`,
    activeNow: "Aktywny teraz",
    unknown: "nieznane",
  },

  time: {
    justNow: "teraz",
    minutesAgo: ({ count }: { count: number }) =>
      `${count} ${plural({ count, one: "minuta", few: "minuty", many: "minut" })} temu`,
    hoursAgo: ({ count }: { count: number }) =>
      `${count} ${plural({ count, one: "godzina", few: "godziny", many: "godzin" })} temu`,
  },

  connect: {
    restoreAccount: "Przywróć konto",
    restoreWithSecretKey: "Przywróć za pomocą klucza tajnego",
    qrInstructions: "1. Otwórz Happy na urządzeniu mobilnym\n2. Przejdź do Ustawienia → Konto\n3. Naciśnij \"Połącz nowe urządzenie\"\n4. Zeskanuj ten kod QR",
    enterSecretKey: "Proszę wprowadzić klucz tajny",
    invalidSecretKey: "Nieprawidłowy klucz tajny. Sprawdź i spróbuj ponownie.",
    enterUrlManually: "Wprowadź URL ręcznie",
  },

  settings: {
    title: "Ustawienia",
    connectedAccounts: "Połączone konta",
    connectAccount: "Połącz konto",
    github: "GitHub",
    machines: "Maszyny",
    features: "Funkcje",
    social: "Społeczność",
    account: "Konto",
    accountSubtitle: "Zarządzaj szczegółami konta",
    appearance: "Wygląd",
    appearanceSubtitle: "Dostosuj wygląd aplikacji",
    voiceAssistant: "Asystent głosowy",
    voiceAssistantSubtitle: "Konfiguruj preferencje interakcji głosowej",
    featuresTitle: "Funkcje",
    featuresSubtitle: "Włącz lub wyłącz funkcje aplikacji",
    developer: "Deweloper",
    developerTools: "Narzędzia deweloperskie",
    about: "O aplikacji",
    aboutFooter:
      "Happy Coder to mobilny klient Codex i Claude Code. Jest w pełni szyfrowany end-to-end, a Twoje konto jest przechowywane tylko na Twoim urządzeniu. Nie jest powiązany z Anthropic.",
    whatsNew: "Co nowego",
    whatsNewSubtitle: "Zobacz najnowsze aktualizacje i ulepszenia",
    reportIssue: "Zgłoś problem",
    privacyPolicy: "Polityka prywatności",
    termsOfService: "Warunki użytkowania",
    eula: "EULA",
    supportUs: "Wesprzyj nas",
    supportUsSubtitlePro: "Dziękujemy za wsparcie!",
    supportUsSubtitle: "Wesprzyj rozwój projektu",
    scanQrCodeToAuthenticate: "Zeskanuj kod QR, aby się uwierzytelnić",
    githubConnected: ({ login }: { login: string }) =>
      `Połączono jako @${login}`,
    connectGithubAccount: "Połącz konto GitHub",
    claudeAuthSuccess: "Pomyślnie połączono z Claude",
    exchangingTokens: "Wymiana tokenów...",
    connectTitle: ({ name }: { name: string }) => `Połącz ${name}`,
    connectTerminalInstruction: "Uruchom następujące polecenie w terminalu:",
    usage: "Użycie",
    usageSubtitle: "Zobacz użycie API i koszty",
    profiles: "Profile",
    profilesSubtitle: "Zarządzaj profilami zmiennych środowiskowych dla sesji",
    gitHosts: "Hosty Git",
    gitHostsSubtitle: "Konfiguracja dostawców hostów Git",

    // Dynamic settings messages
    accountConnected: ({ service }: { service: string }) =>
      `Konto ${service} połączone`,
    machineStatus: ({
      name,
      status,
    }: {
      name: string;
      status: "online" | "offline";
    }) => `${name} jest ${status === "online" ? "online" : "offline"}`,
    featureToggled: ({
      feature,
      enabled,
    }: {
      feature: string;
      enabled: boolean;
    }) => `${feature} ${enabled ? "włączona" : "wyłączona"}`,
  },

  settingsAppearance: {
    // Appearance settings screen
    theme: "Motyw",
    themeDescription: "Wybierz preferowaną kolorystykę",
    themeOptions: {
      adaptive: "Adaptacyjny",
      light: "Jasny",
      dark: "Ciemny",
    },
    themeDescriptions: {
      adaptive: "Dopasuj do ustawień systemu",
      light: "Zawsze używaj jasnego motywu",
      dark: "Zawsze używaj ciemnego motywu",
    },
    display: "Wyświetlanie",
    displayDescription: "Kontroluj układ i odstępy",
    inlineToolCalls: "Wbudowane wywołania narzędzi",
    inlineToolCallsDescription:
      "Wyświetlaj wywołania narzędzi głównego agenta w czacie",
    expandTodoLists: "Rozwiń listy zadań",
    expandTodoListsDescription: "Pokazuj wszystkie zadania zamiast tylko zmian",
    expandToolDetails: "Rozwiń szczegóły narzędzi",
    expandToolDetailsDescription:
      "Domyślnie rozwijaj listy narzędzi subagentów",
    showLineNumbersInDiffs: "Pokaż numery linii w różnicach",
    showLineNumbersInDiffsDescription:
      "Wyświetlaj numery linii w różnicach kodu",
    showLineNumbersInToolViews: "Pokaż numery linii w widokach narzędzi",
    showLineNumbersInToolViewsDescription:
      "Wyświetlaj numery linii w różnicach widoków narzędzi",
    wrapLinesInDiffs: "Zawijanie linii w różnicach",
    wrapLinesInDiffsDescription:
      "Zawijaj długie linie zamiast przewijania poziomego w widokach różnic",
    alwaysShowContextSize: "Zawsze pokazuj rozmiar kontekstu",
    alwaysShowContextSizeDescription:
      "Wyświetlaj użycie kontekstu nawet gdy nie jest blisko limitu",
    avatarStyle: "Styl awatara",
    avatarStyleDescription: "Wybierz wygląd awatara sesji",
    avatarOptions: {
      pixelated: "Pikselowy",
      gradient: "Gradientowy",
      brutalist: "Brutalistyczny",
    },
    showFlavorIcons: "Pokaż ikony dostawcy AI",
    showFlavorIconsDescription:
      "Wyświetlaj ikony dostawcy AI na awatarach sesji",
    compactSessionView: "Kompaktowy widok sesji",
    compactSessionViewDescription:
      "Pokazuj aktywne sesje w bardziej zwartym układzie",
    collapsibleInput: "Zwijane pole wprowadzania",
    collapsibleInputDescription:
      "Automatycznie zwijaj pole wprowadzania, gdy sesja ma wiadomości",
    realtimeSessionSort: "Sortowanie sesji w czasie rzeczywistym",
    realtimeSessionSortDescription:
      "Sortuj sesje według ostatniej aktywności (wyłącz, aby zachować stabilną kolejność wg daty utworzenia)",
  },

  settingsFeatures: {
    // Features settings screen
    experiments: "Eksperymenty",
    experimentsDescription:
      "Włącz eksperymentalne funkcje, które są nadal w rozwoju. Te funkcje mogą być niestabilne lub zmienić się bez ostrzeżenia.",
    experimentalFeatures: "Funkcje eksperymentalne",
    experimentalFeaturesEnabled: "Funkcje eksperymentalne włączone",
    experimentalFeaturesDisabled: "Używane tylko stabilne funkcje",
    webFeatures: "Funkcje webowe",
    webFeaturesDescription:
      "Funkcje dostępne tylko w wersji webowej aplikacji.",
    enterToSend: "Enter aby wysłać",
    enterToSendEnabled:
      "Naciśnij Enter, aby wysłać (Shift+Enter dla nowej linii)",
    enterToSendDisabled: "Enter wstawia nową linię",
    commandPalette: "Paleta poleceń",
    commandPaletteEnabled: "Naciśnij ⌘K, aby otworzyć",
    commandPaletteDisabled: "Szybki dostęp do poleceń wyłączony",
    markdownCopyV2: "Markdown Copy v2",
    markdownCopyV2Subtitle: "Długie naciśnięcie otwiera modal kopiowania",
    hideInactiveSessions: "Ukryj nieaktywne sesje",
    hideInactiveSessionsSubtitle: "Wyświetlaj tylko aktywne czaty na liście",
    enhancedSessionWizard: "Ulepszony kreator sesji",
    enhancedSessionWizardEnabled: "Aktywny launcher z profilem",
    enhancedSessionWizardDisabled: "Używanie standardowego launchera sesji",
    showAgentActivity: "Aktywność agenta",
    showAgentActivityEnabled: "Pokaż aktywność agenta w czasie rzeczywistym",
    showAgentActivityDisabled: "Szczegóły aktywności agenta ukryte",
    sttCorrection: "Korekta transkrypcji głosowej",
    sttCorrectionEnabled: "AI koryguje błędy rozpoznawania mowy",
    sttCorrectionDisabled: "Używanie surowego wyniku rozpoznawania mowy",
    showProjectTab: "Karta projektu",
    showProjectTabSubtitle: "Pokaż kartę projektu (kanban) na pasku kart",
    webNotifications: "Powiadomienia przeglądarki",
    webNotificationsEnabled:
      "Powiadamiaj o ukończeniu zadań i prośbach o zatwierdzenie",
    webNotificationsDisabled: "Brak powiadomień przeglądarki",
    webNotificationsDenied:
      "Zablokowane przez przeglądarkę — włącz w ustawieniach witryny",
    webNotificationsPersistent: "Przypnij powiadomienia",
    webNotificationsPersistentEnabled: "Powiadomienia widoczne do zamknięcia",
    webNotificationsPersistentDisabled: "Powiadomienia zamykają się po 5 sek",
  },

  errors: {
    networkError: "Wystąpił błąd sieci",
    serverError: "Wystąpił błąd serwera",
    unknownError: "Wystąpił nieznany błąd",
    connectionTimeout: "Przekroczono czas oczekiwania na połączenie",
    authenticationFailed: "Uwierzytelnienie nie powiodło się",
    permissionDenied: "Brak uprawnień",
    fileNotFound: "Plik nie został znaleziony",
    invalidFormat: "Nieprawidłowy format",
    operationFailed: "Operacja nie powiodła się",
    tryAgain: "Spróbuj ponownie",
    contactSupport:
      "Skontaktuj się z pomocą techniczną, jeśli problem będzie się powtarzał",
    sessionNotFound: "Sesja nie została znaleziona",
    voiceSessionFailed: "Nie udało się uruchomić sesji głosowej",
    voiceServiceUnavailable: "Usługa głosowa jest tymczasowo niedostępna",
    oauthInitializationFailed: "Nie udało się zainicjować przepływu OAuth",
    tokenStorageFailed: "Nie udało się zapisać tokenów uwierzytelniania",
    oauthStateMismatch:
      "Weryfikacja bezpieczeństwa nie powiodła się. Spróbuj ponownie",
    tokenExchangeFailed: "Nie udało się wymienić kodu autoryzacji",
    oauthAuthorizationDenied: "Autoryzacja została odrzucona",
    webViewLoadFailed: "Nie udało się załadować strony uwierzytelniania",
    failedToLoadProfile: "Nie udało się załadować profilu użytkownika",
    userNotFound: "Użytkownik nie został znaleziony",
    sessionDeleted: "Sesja została usunięta",
    sessionDeletedDescription: "Ta sesja została trwale usunięta",

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
    }) => `${field} musi być między ${min} a ${max}`,
    retryIn: ({ seconds }: { seconds: number }) =>
      `Ponów próbę za ${seconds} ${plural({ count: seconds, one: "sekundę", few: "sekundy", many: "sekund" })}`,
    errorWithCode: ({
      message,
      code,
    }: {
      message: string;
      code: number | string;
    }) => `${message} (Błąd ${code})`,
    disconnectServiceFailed: ({ service }: { service: string }) =>
      `Nie udało się rozłączyć ${service}`,
    connectServiceFailed: ({ service }: { service: string }) =>
      `Nie udało się połączyć z ${service}. Spróbuj ponownie.`,
    failedToLoadFriends: "Nie udało się załadować listy przyjaciół",
    failedToAcceptRequest:
      "Nie udało się zaakceptować zaproszenia do znajomych",
    failedToRejectRequest: "Nie udało się odrzucić zaproszenia do znajomych",
    failedToRemoveFriend: "Nie udało się usunąć przyjaciela",
    searchFailed: "Wyszukiwanie nie powiodło się. Spróbuj ponownie.",
    failedToSendRequest: "Nie udało się wysłać zaproszenia do znajomych",
  },

  newSession: {
    // Used by new-session screen and launch flows
    title: "Rozpocznij nową sesję",
    promptPlaceholder: "Nad czym chcesz pracować?",
    noMachinesFound:
      "Nie znaleziono maszyn. Najpierw uruchom sesję Happy na swoim komputerze.",
    allMachinesOffline: "Wszystkie maszyny są offline",
    machineDetails: "Zobacz szczegóły maszyny →",
    directoryDoesNotExist: "Katalog nie został znaleziony",
    createDirectoryConfirm: ({ directory }: { directory: string }) =>
      `Katalog ${directory} nie istnieje. Czy chcesz go utworzyć?`,
    sessionStarted: "Sesja rozpoczęta",
    sessionStartedMessage: "Sesja została pomyślnie rozpoczęta.",
    sessionSpawningFailed:
      "Tworzenie sesji nie powiodło się - nie zwrócono ID sesji.",
    failedToStart:
      "Nie udało się uruchomić sesji. Upewnij się, że daemon działa na docelowej maszynie.",
    sessionTimeout:
      "Przekroczono czas uruchamiania sesji. Maszyna może działać wolno lub daemon może nie odpowiadać.",
    notConnectedToServer:
      "Brak połączenia z serwerem. Sprawdź połączenie internetowe.",
    startingSession: "Rozpoczynanie sesji...",
    startNewSessionInFolder: "Nowa sesja tutaj",
    noMachineSelected: "Proszę wybrać maszynę do rozpoczęcia sesji",
    noPathSelected: "Proszę wybrać katalog do rozpoczęcia sesji",
    profileConfigEmpty: ({ name }: { name: string }) =>
      `Profil "${name}" nie ma skonfigurowanych zmiennych środowiskowych. Edytuj profil i dodaj wymagane zmienne.`,
    sessionType: {
      title: "Typ sesji",
      simple: "Prosta",
      worktree: "Worktree",
      comingSoon: "Wkrótce dostępne",
    },
    worktree: {
      creating: ({ name }: { name: string }) =>
        `Tworzenie worktree '${name}'...`,
      notGitRepo: "Worktree wymaga repozytorium git",
      failed: ({ error }: { error: string }) =>
        `Nie udało się utworzyć worktree: ${error}`,
      success: "Worktree został utworzony pomyślnie",
    },
    builtInProfile: "Profil wbudowany",
    gitRepos: {
      title: "Repozytoria Git",
      showingCount: ({ showing, total }: { showing: number; total: number }) =>
        `Wyświetlono ${showing} z ${total} repozytoriów`,
    },
  },

  pickPath: {
    selectPath: "Wybierz ścieżkę",
    noMachineSelected: "Nie wybrano maszyny",
    enterPath: "Wprowadź ścieżkę",
    enterPathPlaceholder: "Wprowadź ścieżkę (np. /home/user/projects)",
    recentPaths: "Ostatnie ścieżki",
    suggestedPaths: "Sugerowane ścieżki",
  },

  sessionHistory: {
    // Used by session history screen
    title: "Historia sesji",
    empty: "Nie znaleziono sesji",
    today: "Dzisiaj",
    yesterday: "Wczoraj",
    daysAgo: ({ count }: { count: number }) =>
      `${count} ${plural({ count, one: "dzień", few: "dni", many: "dni" })} temu`,
    viewAll: "Zobacz wszystkie sesje",
  },

  session: {
    inputPlaceholder: "Wpisz wiadomość...",
    startedByDaemon: "daemon",
    sentImage: "Wysłano obraz",
    sentImages: ({ count }: { count: number }) => `Wysłano ${count} obrazów`,
    imageAttached: "Obraz załączony",
    imageLabel: ({ index }: { index: number }) => `Obraz ${index}`,
    imageUploadFailed: ({ failed, total }: { failed: number; total: number }) =>
      `${failed} z ${total} obrazów nie udało się przesłać`,
    couldNotAttachFile: "Nie można załączyć tego pliku",
    imageLoadFailed: "Nie udało się załadować obrazu",
    bookmarkOption: "Zakładka",
    appendToInput: "Edytuj w polu wpisywania",
    messageQueued: "W kolejce",
    cancelQueued: "Anuluj",
    noMessages: "Brak wiadomości",
    created: ({ time }: { time: string }) => `Utworzono ${time}`,
  },

  bookmark: {
    sourceAI: "AI",
    sourceUser: "Ja",
  },

  commandPalette: {
    placeholder: "Wpisz polecenie lub wyszukaj...",
  },

  server: {
    // Used by Server Configuration screen (app/(app)/server.tsx)
    serverConfiguration: "Konfiguracja serwera",
    enterServerUrl: "Proszę wprowadzić URL serwera",
    notValidHappyServer: "To nie jest prawidłowy serwer Happy",
    changeServer: "Zmień serwer",
    continueWithServer: "Kontynuować z tym serwerem?",
    resetToDefault: "Resetuj do domyślnego",
    resetServerDefault: "Zresetować serwer do domyślnego?",
    validating: "Sprawdzanie...",
    validatingServer: "Sprawdzanie serwera...",
    serverReturnedError: "Serwer zwrócił błąd",
    failedToConnectToServer: "Nie udało się połączyć z serwerem",
    currentlyUsingCustomServer: "Aktualnie używany jest niestandardowy serwer",
    customServerUrlLabel: "URL niestandardowego serwera",
    advancedFeatureFooter:
      "To jest zaawansowana funkcja. Zmieniaj serwer tylko jeśli wiesz, co robisz. Po zmianie serwera będziesz musiał się wylogować i zalogować ponownie.",
  },

  worktreeInfo: {
    title: "Worktree",
    branch: "Gałąź",
    parentBranch: "Gałąź nadrzędna",
    status: "Status",
    errorLabel: "Błąd",
    state: {
      creating: "Tworzenie",
      active: "Aktywny",
      merging: "Scalanie",
      merged: "Scalono",
      cleaning: "Czyszczenie",
      cleaned: "Wyczyszczono",
      error: "Błąd",
    },
    merge: {
      title: "Strategia scalania",
      preview: "Podgląd scalania",
      description: ({ parentBranch }: { parentBranch: string }) =>
        `Jak chcesz scalić do ${parentBranch}?`,
      action: "Scal",
      createPr: "Utwórz Pull Request",
      directMerge: "Bezpośrednie scalanie",
      openPr: "Otwórz PR",
      keepBranch: "Zachowaj gałąź",
      deleteBranch: "Usuń gałąź",
      filesChanged: "zmieniony(ch) plik(ów)",
      commits: ({ count }: { count: number }) => `Commity (${count})`,
      noCommits: "Brak commitów do scalenia",
      prSuccess: ({ url }: { url: string }) => `PR utworzony: ${url}`,
      directSuccess: "Scalono pomyślnie",
      directSuccessDeleteBranch: ({ branchName }: { branchName: string }) =>
        `Scalono pomyślnie. Usunąć gałąź '${branchName}'?`,
      failed: ({ error }: { error: string }) =>
        `Scalanie nie powiodło się: ${error}`,
    },
    cleanup: {
      title: "Usuń Worktree",
      action: "Usuń Worktree",
      confirm: "Usunąć ten Worktree i jego gałąź?",
      notMerged:
        "Ten Worktree nie został jeszcze scalony. Usunięcie może spowodować utratę zmian. Kontynuować?",
      remove: "Usuń",
      success: "Worktree usunięty",
      successAndArchived: "Worktree usunięty i sesja zarchiwizowana",
      failed: ({ error }: { error: string }) =>
        `Nie udało się usunąć Worktree: ${error}`,
    },
  },

  sessionInfo: {
    // Used by Session Info screen (app/(app)/session/[id]/info.tsx)
    tagBranch: "Gałąź",
    tagMain: "Główna",
    killSession: "Zakończ sesję",
    killSessionConfirm: "Czy na pewno chcesz zakończyć tę sesję?",
    archiveSession: "Zarchiwizuj sesję",
    archiveSessionConfirm: "Czy na pewno chcesz zarchiwizować tę sesję?",
    happySessionIdCopied: "ID sesji Happy skopiowane do schowka",
    failedToCopySessionId: "Nie udało się skopiować ID sesji Happy",
    happySessionId: "ID sesji Happy",
    claudeCodeSessionId: "ID sesji Claude Code",
    claudeCodeSessionIdCopied: "ID sesji Claude Code skopiowane do schowka",
    profile: "Profil AI",
    aiProvider: "Dostawca AI",
    failedToCopyClaudeCodeSessionId:
      "Nie udało się skopiować ID sesji Claude Code",
    metadataCopied: "Metadane skopiowane do schowka",
    failedToCopyMetadata: "Nie udało się skopiować metadanych",
    failedToKillSession: "Nie udało się zakończyć sesji",
    failedToArchiveSession: "Nie udało się zarchiwizować sesji",
    connectionStatus: "Status połączenia",
    created: "Utworzono",
    lastUpdated: "Ostatnia aktualizacja",
    sequence: "Sekwencja",
    quickActions: "Szybkie akcje",
    viewMachine: "Zobacz maszynę",
    viewMachineSubtitle: "Zobacz szczegóły maszyny i sesje",
    killSessionSubtitle: "Natychmiastowo zakończ sesję",
    archiveSessionSubtitle: "Zarchiwizuj tę sesję i zatrzymaj ją",
    metadata: "Metadane",
    host: "Host",
    path: "Ścieżka",
    operatingSystem: "System operacyjny",
    processId: "ID procesu",
    startedBy: "Uruchomiono przez",
    startedByDaemon: "Daemon",
    startedByTerminal: "Terminal",
    happyHome: "Katalog domowy Happy",
    copyMetadata: "Kopiuj metadane",
    agentState: "Stan agenta",
    controlledByUser: "Kontrolowany przez użytkownika",
    pendingRequests: "Oczekujące żądania",
    activity: "Aktywność",
    thinking: "Myśli",
    thinkingSince: "Myśli od",
    cliVersion: "Wersja CLI",
    cliVersionOutdated: "Wymagana aktualizacja CLI",
    cliVersionOutdatedMessage: ({
      currentVersion,
      requiredVersion,
    }: {
      currentVersion: string;
      requiredVersion: string;
    }) =>
      `Zainstalowana wersja ${currentVersion}. Zaktualizuj do ${requiredVersion} lub nowszej`,
    updateCliInstructions: "Proszę uruchomić npm install -g happy-coder@latest",
    resumeSession: "Wznów sesję",
    resumeSessionSubtitle:
      "Wznów tę sesję z pełnym kontekstem na tej samej maszynie",
    forkSession: "Rozwidl sesję",
    forkSessionSubtitle: "Utwórz nową sesję rozgałęzioną od tego punktu z pełnym kontekstem",
    forkSessionSuccess: "Sesja rozwidlona pomyślnie",
    forkSessionFailed: "Nie udało się rozwidlić sesji",
    deleteSession: "Usuń sesję",
    deleteSessionSubtitle: "Trwale usuń tę sesję",
    deleteSessionConfirm: "Usunąć sesję na stałe?",
    deleteSessionWarning:
      "Ta operacja jest nieodwracalna. Wszystkie wiadomości i dane powiązane z tą sesją zostaną trwale usunięte.",
    deleteSessionWorktreeWarning: ({ branchName }: { branchName: string }) =>
      `Ta sesja zawiera worktree branch '${branchName}' z niezłączonymi zmianami. Usunięcie spowoduje również trwałe usunięcie brancha i wszystkich jego zmian.`,
    deleteSessionWorktreePrWarning: ({ branchName }: { branchName: string }) =>
      `Ta sesja zawiera worktree branch '${branchName}' z otwartym PR. Branch zostanie zachowany dla PR, ale dane sesji zostaną trwale usunięte.`,
    failedToDeleteSession: "Nie udało się usunąć sesji",
    restoreSession: "Przywróć",
    failedToRestoreSession: "Nie udało się przywrócić sesji",
    sessionDeleted: "Sesja została pomyślnie usunięta",
    deleteAllArchivedSessions: "Usuń wszystkie zarchiwizowane sesje",
    deleteAllArchivedWarning: ({ count }: { count: number }) =>
      `To trwale usunie ${count} zarchiwizowaną(ych) sesję(i) i wszystkie ich wiadomości. Tej operacji nie można cofnąć.`,
  },

  components: {
    emptyMainScreen: {
      // Used by EmptyMainScreen component
      readyToCode: "Gotowy do kodowania?",
      installCli: "Zainstaluj Happy CLI",
      runIt: "Uruchom je",
      scanQrCode: "Zeskanuj kod QR",
      openCamera: "Otwórz kamerę",
    },
  },

  chatFooter: {
    permissionWarning: "Uprawnienia wyświetlane tylko w terminalu. Zresetuj lub wyślij wiadomość, aby sterować z aplikacji.",
  },

  agentInput: {
    permissionMode: {
      title: "TRYB UPRAWNIEŃ",
      default: "Domyślny",
      acceptEdits: "Akceptuj edycje",
      plan: "Tryb planowania",
      dontAsk: "Nie pytaj",
      bypassPermissions: "Tryb YOLO",
      badgeAcceptAllEdits: "Akceptuj wszystkie edycje",
      badgeBypassAllPermissions: "Omiń wszystkie uprawnienia",
      badgePlanMode: "Tryb planowania",
      badgeDontAsk: "Nie pytaj",
    },
    agent: {
      claude: "Claude",
      codex: "Codex",
      gemini: "Gemini",
    },
    model: {
      title: "MODEL",
      configureInCli: "Skonfiguruj modele w ustawieniach CLI",
    },
    codexPermissionMode: {
      title: "TRYB UPRAWNIEŃ CODEX",
      default: "Ustawienia CLI",
      readOnly: "Read Only Mode",
      safeYolo: "Safe YOLO",
      yolo: "YOLO",
      badgeReadOnly: "Read Only Mode",
      badgeSafeYolo: "Safe YOLO",
      badgeYolo: "YOLO",
    },
    codexModel: {
      title: "MODEL CODEX",
      gpt53Codex: "GPT-5.3 Codex",
      gpt53CodexSpark: "GPT-5.3 Codex Spark",
      gpt52Codex: "GPT-5.2 Codex",
      gpt51CodexMax: "GPT-5.1 Codex Max",
      gpt51Codex: "GPT-5.1 Codex",
      gpt5Codex: "GPT-5 Codex",
    },
    geminiPermissionMode: {
      title: "TRYB UPRAWNIEŃ GEMINI",
      default: "Domyślny",
      readOnly: "Tylko do odczytu",
      safeYolo: "Bezpieczny YOLO",
      yolo: "YOLO",
      badgeReadOnly: "Tylko do odczytu",
      badgeSafeYolo: "Bezpieczny YOLO",
      badgeYolo: "YOLO",
    },
    context: {
      remaining: ({ percent }: { percent: number }) => `Pozostało ${percent}%`,
      breakdownTitle: "Podział tokenów",
      breakdownMessage:
        "↓ Odczyt cache – tokeny ponownie użyte z poprzedniego cache kontekstu. Znacznie redukuje koszty.\n\nin Wejście – nowe tokeny w tej turze (wiadomość + wyniki narzędzi).\n\nout Wyjście – tokeny wygenerowane przez model w tej turze.\n\n↑ Zapis do cache – tokeny zapisane do cache w tej turze, wielokrotnego użytku w następnej turze.",
    },
    suggestion: {
      fileLabel: "PLIK",
      folderLabel: "FOLDER",
    },
    effort: {
      title: "POZIOM WYSIŁKU",
      low: "Niski",
      lowDesc: "Szybkie odpowiedzi, mniej rozumowania",
      medium: "Średni",
      mediumDesc: "Domyślna głębokość rozumowania",
      high: "Wysoki",
      highDesc: "Głębsze rozumowanie",
      max: "Maksymalny",
      maxDesc: "Rozszerzone myślenie, najlepsza jakość",
    },
    thinking: {
      title: "MYŚLENIE",
      adaptive: "Adaptacyjne",
      adaptiveDesc: "Model decyduje kiedy myśleć",
      enabled: "Włączone",
      enabledDesc: "Zawsze pokazuj rozumowanie",
      disabled: "Wyłączone",
      disabledDesc: "Bez rozszerzonego myślenia",
    },
    noMachinesAvailable: "Brak maszyn",
    continue: "Kontynuuj — Claude osiągnął limit tur",
  },

  machineLauncher: {
    showLess: "Pokaż mniej",
    showAll: ({ count }: { count: number }) =>
      `Pokaż wszystkie (${count} ${plural({ count, one: "ścieżka", few: "ścieżki", many: "ścieżek" })})`,
    enterCustomPath: "Wprowadź niestandardową ścieżkę",
    offlineUnableToSpawn: "Nie można utworzyć nowej sesji, offline",
  },

  sidebar: {
    sessionsTitle: "Happy",
  },

  toolView: {
    input: "Wejście",
    output: "Wyjście",
  },

  diff: {
    toolbar: {
      unified: "Zunifikowany",
      split: "Podzielony",
      expand: "Rozwiń",
      collapse: "Zwiń",
      copyDiff: "Kopiuj",
      copied: "Skopiowano!",
    },
  },

  codeReview: {
    accept: "Akceptuj",
    reject: "Odrzuć",
    accepted: "Zaakceptowano",
    rejected: "Odrzucono",
    rejectConfirmTitle: "Odrzuć zmianę",
    rejectConfirmMessage: ({ filePath }: { filePath: string }) =>
      `Poprosić Claude o cofnięcie zmian w ${filePath}?`,
    rejectConfirm: "Odrzuć i cofnij",
  },

  tools: {
    fullView: {
      description: "Opis",
      inputParams: "Parametry wejściowe",
      output: "Wyjście",
      error: "Błąd",
      completed: "Narzędzie ukończone pomyślnie",
      noOutput: "Nie wygenerowano żadnego wyjścia",
      running: "Narzędzie działa...",
      rawJsonDevMode: "Surowy JSON (tryb deweloperski)",
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
      initializing: "Inicjalizacja agenta...",
      moreTools: ({ count }: { count: number }) =>
        `+${count} ${plural({ count, one: "więcej narzędzie", few: "więcej narzędzia", many: "więcej narzędzi" })}`,
      collapseTools: "Zwiń",
      agentThinking: "Myśli...",
      subagentRunning: ({ type }: { type: string }) =>
        `Uruchamianie ${type}...`,
    },
    multiEdit: {
      editNumber: ({ index, total }: { index: number; total: number }) =>
        `Edycja ${index} z ${total}`,
      replaceAll: "Zamień wszystkie",
    },
    contextMenu: {
      copyPath: "Kopiuj ścieżkę pliku",
      copyCommand: "Kopiuj polecenie",
      copyOutput: "Kopiuj wynik",
    },
    names: {
      task: "Zadanie",
      terminal: "Terminal",
      searchFiles: "Wyszukaj pliki",
      search: "Wyszukaj",
      searchContent: "Wyszukaj zawartość",
      listFiles: "Lista plików",
      planProposal: "Propozycja planu",
      readFile: "Czytaj plik",
      editFile: "Edytuj plik",
      writeFile: "Zapisz plik",
      fetchUrl: "Pobierz URL",
      readNotebook: "Czytaj notatnik",
      editNotebook: "Edytuj notatnik",
      todoList: "Lista zadań",
      webSearch: "Wyszukiwanie w sieci",
      reasoning: "Rozumowanie",
      applyChanges: "Zaktualizuj plik",
      viewDiff: "Bieżące zmiany pliku",
      question: "Pytanie",
    },
    desc: {
      terminalCmd: ({ cmd }: { cmd: string }) => `Terminal(cmd: ${cmd})`,
      searchPattern: ({ pattern }: { pattern: string }) =>
        `Wyszukaj(wzorzec: ${pattern})`,
      searchPath: ({ basename }: { basename: string }) =>
        `Wyszukaj(ścieżka: ${basename})`,
      fetchUrlHost: ({ host }: { host: string }) => `Pobierz URL(url: ${host})`,
      editNotebookMode: ({ path, mode }: { path: string; mode: string }) =>
        `Edytuj notatnik(plik: ${path}, tryb: ${mode})`,
      todoListCount: ({ count }: { count: number }) =>
        `Lista zadań(liczba: ${count})`,
      webSearchQuery: ({ query }: { query: string }) =>
        `Wyszukiwanie w sieci(zapytanie: ${query})`,
      grepPattern: ({ pattern }: { pattern: string }) =>
        `grep(wzorzec: ${pattern})`,
      multiEditEdits: ({ path, count }: { path: string; count: number }) =>
        `${path} (${count} ${plural({ count, one: "edycja", few: "edycje", many: "edycji" })})`,
      readingFile: ({ file }: { file: string }) => `Odczytywanie ${file}`,
      writingFile: ({ file }: { file: string }) => `Zapisywanie ${file}`,
      modifyingFile: ({ file }: { file: string }) => `Modyfikowanie ${file}`,
      modifyingFiles: ({ count }: { count: number }) =>
        `Modyfikowanie ${count} ${plural({ count, one: "pliku", few: "plików", many: "plików" })}`,
      modifyingMultipleFiles: ({
        file,
        count,
      }: {
        file: string;
        count: number;
      }) =>
        `${file} i ${count} ${plural({ count, one: "więcej", few: "więcej", many: "więcej" })}`,
      showingDiff: "Pokazywanie zmian",
    },
    askUserQuestion: {
      submit: "Wyślij odpowiedź",
      multipleQuestions: ({ count }: { count: number }) =>
        `${count} ${plural({ count, one: "pytanie", few: "pytania", many: "pytań" })}`,
      other: "Inne",
      otherDescription: "Wpisz własną odpowiedź",
      otherPlaceholder: "Wpisz swoją odpowiedź...",
      recommended: "Zalecane",
    },
    planFile: {
      refreshFromFile: "Odśwież z pliku",
    },
  },

  files: {
    searchPlaceholder: "Wyszukaj pliki...",
    detachedHead: "odłączony HEAD",
    summary: ({ staged, unstaged }: { staged: number; unstaged: number }) =>
      `${staged} przygotowanych • ${unstaged} nieprzygotowanych`,
    notRepo: "To nie jest repozytorium git",
    notUnderGit: "Ten katalog nie jest pod kontrolą wersji git",
    searching: "Wyszukiwanie plików...",
    noFilesFound: "Nie znaleziono plików",
    noFilesInProject: "Brak plików w projekcie",
    tryDifferentTerm: "Spróbuj innego terminu wyszukiwania",
    searchResults: ({ count }: { count: number }) =>
      `Wyniki wyszukiwania (${count})`,
    projectRoot: "Katalog główny projektu",
    stagedChanges: ({ count }: { count: number }) =>
      `Przygotowane zmiany (${count})`,
    unstagedChanges: ({ count }: { count: number }) =>
      `Nieprzygotowane zmiany (${count})`,
    // File viewer strings
    loadingFile: ({ fileName }: { fileName: string }) =>
      `Ładowanie ${fileName}...`,
    binaryFile: "Plik binarny",
    cannotDisplayBinary: "Nie można wyświetlić zawartości pliku binarnego",
    diff: "Różnice",
    file: "Plik",
    fileEmpty: "Plik jest pusty",
    noChanges: "Brak zmian do wyświetlenia",
    // Browse mode strings
    browseTab: "Przeglądaj",
    changesTab: "Zmiany",
    directory: "Katalog",
    emptyDirectory: "Ten katalog jest pusty",
    submodule: "Submoduł",
    submoduleNotInitialized: "Nie zainicjalizowany",
    childReposSummary: ({ count }) =>
      `${count} ${count === 1 ? "repozytorium" : "repozytoriów"} Git`,
  },

  changes: {
    summary: ({ files }) => `${files} zmienion${files === 1 ? "y plik" : "ych plików"}`,
    noChanges: "Brak zmian plików w tej sesji",
    editCount: ({ count }) => `${count} edycji`,
  },

  settingsVoice: {
    // Voice settings screen
    languageTitle: "Język",
    languageDescription:
      "Wybierz preferowany język dla interakcji z asystentem głosowym. To ustawienie synchronizuje się na wszystkich Twoich urządzeniach.",
    preferredLanguage: "Preferowany język",
    preferredLanguageSubtitle:
      "Język używany do odpowiedzi asystenta głosowego",
    language: {
      searchPlaceholder: "Wyszukaj języki...",
      title: "Języki",
      footer: ({ count }: { count: number }) =>
        `Dostępnych ${count} ${plural({ count, one: "język", few: "języki", many: "języków" })}`,
      autoDetect: "Automatyczne wykrywanie",
    },
    // TTS provider settings
    ttsProviderTitle: "Dostawca TTS",
    ttsProviderDescription:
      "Wybierz między darmowym Edge TTS a płatnym ElevenLabs TTS z własnym kluczem API.",
    ttsProviderEdge: "Edge TTS (Darmowy)",
    ttsProviderEdgeSubtitle: "Microsoft Edge TTS, darmowy i bez ograniczeń",
    ttsProviderElevenLabs: "ElevenLabs (Płatny)",
    ttsProviderElevenLabsSubtitle: "Wysoka jakość, wymaga własnego klucza API",
    elevenLabsApiKey: "Klucz API",
    elevenLabsApiKeyPlaceholder: "Wprowadź swój klucz API ElevenLabs",
    elevenLabsVoiceId: "Voice ID",
    elevenLabsVoiceIdPlaceholder: "Domyślny: Rachel",
    elevenLabsVoiceIdSubtitle: "Pozostaw puste dla domyślnego głosu (Rachel)",
  },

  voiceStatusBar: {
    connecting: "Łączenie...",
    connectionError: "Błąd połączenia",
    listening: "Słucham...",
    processing: "Przetwarzanie...",
    speaking: "Mówię",
    voiceAssistantActive: "Asystent głosowy aktywny",
    voiceAssistant: "Asystent głosowy",
    tapToEnd: "Dotknij, aby zakończyć",
    permissionRequested: ({ toolName }: { toolName: string }) =>
      `Prośba o uprawnienie dla ${toolName}`,
    done: "Gotowe.",
  },

  settingsAccount: {
    // Account settings screen
    accountInformation: "Informacje o koncie",
    status: "Status",
    statusActive: "Aktywny",
    statusNotAuthenticated: "Nie uwierzytelniony",
    anonymousId: "ID anonimowe",
    publicId: "ID publiczne",
    notAvailable: "Niedostępne",
    linkNewDevice: "Połącz nowe urządzenie",
    linkNewDeviceSubtitle: "Zeskanuj kod QR, aby połączyć urządzenie",
    profile: "Profil",
    name: "Nazwa",
    github: "GitHub",
    tapToDisconnect: "Dotknij, aby rozłączyć",
    server: "Serwer",
    backup: "Kopia zapasowa",
    backupDescription:
      "Twój klucz tajny to jedyny sposób na odzyskanie konta. Zapisz go w bezpiecznym miejscu, takim jak menedżer haseł.",
    secretKey: "Klucz tajny",
    tapToReveal: "Dotknij, aby pokazać",
    tapToHide: "Dotknij, aby ukryć",
    secretKeyLabel: "KLUCZ TAJNY (DOTKNIJ, ABY SKOPIOWAĆ)",
    secretKeyCopied:
      "Klucz tajny skopiowany do schowka. Przechowuj go w bezpiecznym miejscu!",
    secretKeyCopyFailed: "Nie udało się skopiować klucza tajnego",
    privacy: "Prywatność",
    privacyDescription:
      "Pomóż ulepszyć aplikację, udostępniając anonimowe dane o użytkowaniu. Nie zbieramy żadnych informacji osobistych.",
    analytics: "Analityka",
    analyticsDisabled: "Dane nie są udostępniane",
    analyticsEnabled: "Anonimowe dane o użytkowaniu są udostępniane",
    dangerZone: "Strefa niebezpieczna",
    logout: "Wyloguj",
    logoutSubtitle: "Wyloguj się i wyczyść dane lokalne",
    logoutConfirm:
      "Czy na pewno chcesz się wylogować? Upewnij się, że masz kopię zapasową klucza tajnego!",
  },

  settingsLanguage: {
    // Language settings screen
    title: "Język",
    description:
      "Wybierz preferowany język interfejsu aplikacji. To ustawienie zostanie zsynchronizowane na wszystkich Twoich urządzeniach.",
    currentLanguage: "Aktualny język",
    automatic: "Automatycznie",
    automaticSubtitle: "Wykrywaj na podstawie ustawień urządzenia",
    needsRestart: "Język zmieniony",
    needsRestartMessage:
      "Aplikacja musi zostać uruchomiona ponownie, aby zastosować nowe ustawienia języka.",
    restartNow: "Uruchom ponownie",
  },

  connectButton: {
    authenticate: "Uwierzytelnij terminal",
    authenticateWithUrlPaste: "Uwierzytelnij terminal poprzez wklejenie URL",
    pasteAuthUrl: "Wklej URL uwierzytelnienia z terminala",
  },

  updateBanner: {
    updateAvailable: "Dostępna aktualizacja",
    pressToApply: "Naciśnij, aby zastosować aktualizację",
    whatsNew: "Co nowego",
    seeLatest: "Zobacz najnowsze aktualizacje i ulepszenia",
    nativeUpdateAvailable: "Dostępna aktualizacja aplikacji",
    tapToUpdateAppStore: "Naciśnij, aby zaktualizować w App Store",
    tapToUpdatePlayStore: "Naciśnij, aby zaktualizować w Sklepie Play",
  },

  changelog: {
    // Used by the changelog screen
    version: ({ version }: { version: string }) => `Wersja ${version}`,
    noEntriesAvailable: "Brak dostępnych wpisów dziennika zmian.",
  },

  terminal: {
    // Used by terminal connection screens
    webBrowserRequired: "Wymagana przeglądarka internetowa",
    webBrowserRequiredDescription:
      "Linki połączenia terminala można otwierać tylko w przeglądarce internetowej ze względów bezpieczeństwa. Użyj skanera kodów QR lub otwórz ten link na komputerze.",
    processingConnection: "Przetwarzanie połączenia...",
    invalidConnectionLink: "Nieprawidłowy link połączenia",
    invalidConnectionLinkDescription:
      "Link połączenia jest nieprawidłowy lub go brakuje. Sprawdź URL i spróbuj ponownie.",
    connectTerminal: "Połącz terminal",
    terminalRequestDescription:
      "Terminal żąda połączenia z Twoim kontem Happy Coder. Pozwoli to terminalowi bezpiecznie wysyłać i odbierać wiadomości.",
    connectionDetails: "Szczegóły połączenia",
    publicKey: "Klucz publiczny",
    encryption: "Szyfrowanie",
    endToEndEncrypted: "Szyfrowanie end-to-end",
    acceptConnection: "Akceptuj połączenie",
    connecting: "Łączenie...",
    reject: "Odrzuć",
    security: "Bezpieczeństwo",
    securityFooter:
      "Ten link połączenia został bezpiecznie przetworzony w Twojej przeglądarce i nigdy nie został wysłany na żaden serwer. Twoje prywatne dane pozostaną bezpieczne i tylko Ty możesz odszyfrować wiadomości.",
    securityFooterDevice:
      "To połączenie zostało bezpiecznie przetworzone na Twoim urządzeniu i nigdy nie zostało wysłane na żaden serwer. Twoje prywatne dane pozostaną bezpieczne i tylko Ty możesz odszyfrować wiadomości.",
    clientSideProcessing: "Przetwarzanie po stronie klienta",
    linkProcessedLocally: "Link przetworzony lokalnie w przeglądarce",
    linkProcessedOnDevice: "Link przetworzony lokalnie na urządzeniu",
  },

  modals: {
    // Used across connect flows and settings
    authenticateTerminal: "Uwierzytelnij terminal",
    pasteUrlFromTerminal: "Wklej URL uwierzytelnienia z terminala",
    deviceLinkedSuccessfully: "Urządzenie połączone pomyślnie",
    terminalConnectedSuccessfully: "Terminal połączony pomyślnie",
    invalidAuthUrl: "Nieprawidłowy URL uwierzytelnienia",
    developerMode: "Tryb deweloperski",
    developerModeEnabled: "Tryb deweloperski włączony",
    developerModeDisabled: "Tryb deweloperski wyłączony",
    disconnectGithub: "Rozłącz GitHub",
    disconnectGithubConfirm:
      "Czy na pewno chcesz rozłączyć swoje konto GitHub?",
    disconnectService: ({ service }: { service: string }) =>
      `Rozłącz ${service}`,
    disconnectServiceConfirm: ({ service }: { service: string }) =>
      `Czy na pewno chcesz rozłączyć ${service} ze swojego konta?`,
    disconnect: "Rozłącz",
    failedToConnectTerminal: "Nie udało się połączyć terminala",
    cameraPermissionsRequiredToConnectTerminal:
      "Uprawnienia do kamery są wymagane do połączenia terminala",
    failedToLinkDevice: "Nie udało się połączyć urządzenia",
    cameraPermissionsRequiredToScanQr:
      "Uprawnienia do kamery są wymagane do skanowania kodów QR",
  },

  navigation: {
    // Navigation titles and screen headers
    connectTerminal: "Połącz terminal",
    linkNewDevice: "Połącz nowe urządzenie",
    restoreWithSecretKey: "Przywróć kluczem tajnym",
    whatsNew: "Co nowego",
    friends: "Przyjaciele",
  },

  welcome: {
    // Main welcome screen for unauthenticated users
    title: "Mobilny klient Codex i Claude Code",
    subtitle:
      "Szyfrowanie end-to-end, a Twoje konto jest przechowywane tylko na Twoim urządzeniu.",
    createAccount: "Utwórz konto",
    linkOrRestoreAccount: "Połącz lub przywróć konto",
    loginWithMobileApp: "Zaloguj się przez aplikację mobilną",
    loginWithSecretKey: "Zaloguj się kluczem tajnym",
  },

  review: {
    // Used by utils/requestReview.ts
    enjoyingApp: "Podoba Ci się aplikacja?",
    feedbackPrompt: "Chcielibyśmy usłyszeć Twoją opinię!",
    yesILoveIt: "Tak, uwielbiam ją!",
    notReally: "Nie bardzo",
  },

  items: {
    // Used by Item component for copy toast
    copiedToClipboard: ({ label }: { label: string }) =>
      `${label} skopiowano do schowka`,
  },

  machine: {
    offlineUnableToSpawn: "Launcher wyłączony, gdy maszyna jest offline",
    offlineHelp:
      "• Upewnij się, że komputer jest online\n• Uruchom `happy daemon status`, aby zdiagnozować\n• Czy używasz najnowszej wersji CLI? Zaktualizuj poleceniem `npm install -g happy-coder@latest`",
    launchNewSessionInDirectory: "Uruchom nową sesję w katalogu",
    daemon: "Daemon",
    status: "Status",
    stopDaemon: "Zatrzymaj daemon",
    lastKnownPid: "Ostatni znany PID",
    lastKnownHttpPort: "Ostatni znany port HTTP",
    startedAt: "Uruchomiony o",
    cliVersion: "Wersja CLI",
    daemonStateVersion: "Wersja stanu daemon",
    activeSessions: ({ count }: { count: number }) =>
      `Aktywne sesje (${count})`,
    machineGroup: "Maszyna",
    host: "Host",
    machineId: "ID maszyny",
    username: "Nazwa użytkownika",
    homeDirectory: "Katalog domowy",
    platform: "Platforma",
    architecture: "Architektura",
    lastSeen: "Ostatnio widziana",
    never: "Nigdy",
    metadataVersion: "Wersja metadanych",
    untitledSession: "Sesja bez nazwy",
    back: "Wstecz",
  },

  message: {
    switchedToMode: ({ mode }: { mode: string }) =>
      `Przełączono na tryb ${mode}`,
    unknownEvent: "Nieznane zdarzenie",
    usageLimitUntil: ({ time }: { time: string }) =>
      `Osiągnięto limit użycia do ${time}`,
    usageLimitReached:
      "Osiągnięto limit użycia. Proszę czekać i spróbować ponownie.",
    unknownTime: "nieznany czas",
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
      count === 1 ? `${count} tura` : `${count} tur`,
    thinkingMarker: "Myślenie",
  },

  codex: {
    // Codex permission dialog buttons
    permissions: {
      yesForSession: "Tak, i nie pytaj dla tej sesji",
      stopAndExplain: "Zatrzymaj i wyjaśnij, co zrobić",
    },
  },

  claude: {
    // Claude permission dialog buttons
    permissions: {
      yesAllowAllEdits: "Tak, zezwól na wszystkie edycje podczas tej sesji",
      yesForTool: "Tak, nie pytaj ponownie dla tego narzędzia",
      noTellClaude: "Nie, przekaż opinię",
    },
  },

  plan: {
    approve: "Zatwierdź plan",
    approveAutoEdits: "Zatwierdź i auto-zatwierdzaj edycje",
    rejectWithFeedback: "Odrzuć z opinią",
    rejectTitle: "Dlaczego odrzucasz ten plan?",
    rejectMessage: "Twoja opinia pomaga Claude ulepszyć plan",
    rejectPlaceholder: "Opisz co powinno się zmienić...",
  },

  textSelection: {
    // Text selection screen
    selectText: "Wybierz zakres tekstu",
    title: "Wybierz tekst",
    noTextProvided: "Nie podano tekstu",
    textNotFound: "Tekst nie został znaleziony lub wygasł",
    textCopied: "Tekst skopiowany do schowka",
    failedToCopy: "Nie udało się skopiować tekstu do schowka",
    noTextToCopy: "Brak tekstu do skopiowania",
  },

  markdown: {
    // Markdown copy functionality
    codeCopied: "Kod skopiowany",
    copyFailed: "Błąd kopiowania",
    mermaidCopied: "Kod źródłowy Mermaid skopiowany",
    mermaidRenderFailed: "Nie udało się wyświetlić diagramu mermaid",
  },

  artifacts: {
    // Artifacts feature
    title: "Artefakty",
    countSingular: "1 artefakt",
    countPlural: ({ count }: { count: number }) => {
      const n = Math.abs(count);
      const n10 = n % 10;
      const n100 = n % 100;

      // Polish plural rules: 1 (singular), 2-4 (few), 5+ (many)
      if (n === 1) {
        return `${count} artefakt`;
      }
      if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) {
        return `${count} artefakty`;
      }
      return `${count} artefaktów`;
    },
    empty: "Brak artefaktów",
    emptyDescription: "Utwórz pierwszy artefakt, aby rozpocząć",
    new: "Nowy artefakt",
    edit: "Edytuj artefakt",
    delete: "Usuń",
    updateError: "Nie udało się zaktualizować artefaktu. Spróbuj ponownie.",
    notFound: "Artefakt nie został znaleziony",
    discardChanges: "Odrzucić zmiany?",
    discardChangesDescription:
      "Masz niezapisane zmiany. Czy na pewno chcesz je odrzucić?",
    deleteConfirm: "Usunąć artefakt?",
    deleteConfirmDescription: "Tej operacji nie można cofnąć",
    titleLabel: "TYTUŁ",
    titlePlaceholder: "Wprowadź tytuł dla swojego artefaktu",
    bodyLabel: "TREŚĆ",
    bodyPlaceholder: "Napisz swoją treść tutaj...",
    emptyFieldsError: "Proszę wprowadzić tytuł lub treść",
    createError: "Nie udało się utworzyć artefaktu. Spróbuj ponownie.",
    save: "Zapisz",
    saving: "Zapisywanie...",
    loading: "Ładowanie artefaktów...",
    error: "Nie udało się załadować artefaktu",
    untitled: "Bez tytułu",
  },

  friends: {
    // Friends feature
    title: "Przyjaciele",
    manageFriends: "Zarządzaj swoimi przyjaciółmi i połączeniami",
    searchTitle: "Znajdź przyjaciół",
    pendingRequests: "Zaproszenia do znajomych",
    myFriends: "Moi przyjaciele",
    noFriendsYet: "Nie masz jeszcze żadnych przyjaciół",
    findFriends: "Znajdź przyjaciół",
    remove: "Usuń",
    pendingRequest: "Oczekujące",
    sentOn: ({ date }: { date: string }) => `Wysłano ${date}`,
    accept: "Akceptuj",
    reject: "Odrzuć",
    addFriend: "Dodaj do znajomych",
    alreadyFriends: "Już jesteście znajomymi",
    requestPending: "Zaproszenie oczekuje",
    searchInstructions: "Wprowadź nazwę użytkownika, aby znaleźć przyjaciół",
    searchPlaceholder: "Wprowadź nazwę użytkownika...",
    searching: "Szukanie...",
    userNotFound: "Nie znaleziono użytkownika",
    noUserFound: "Nie znaleziono użytkownika o tej nazwie",
    checkUsername: "Sprawdź nazwę użytkownika i spróbuj ponownie",
    howToFind: "Jak znaleźć przyjaciół",
    findInstructions:
      "Szukaj przyjaciół po nazwie użytkownika. Zarówno ty, jak i twój przyjaciel musicie mieć połączony GitHub, aby wysyłać zaproszenia do znajomych.",
    requestSent: "Zaproszenie do znajomych wysłane!",
    requestAccepted: "Zaproszenie do znajomych zaakceptowane!",
    requestRejected: "Zaproszenie do znajomych odrzucone",
    friendRemoved: "Przyjaciel usunięty",
    confirmRemove: "Usuń przyjaciela",
    confirmRemoveMessage: "Czy na pewno chcesz usunąć tego przyjaciela?",
    cannotAddYourself: "Nie możesz wysłać zaproszenia do siebie",
    bothMustHaveGithub:
      "Obaj użytkownicy muszą mieć połączony GitHub, aby zostać przyjaciółmi",
    status: {
      none: "Nie połączono",
      requested: "Zaproszenie wysłane",
      pending: "Zaproszenie oczekuje",
      friend: "Przyjaciele",
      rejected: "Odrzucone",
    },
    acceptRequest: "Zaakceptuj zaproszenie",
    removeFriend: "Usuń z przyjaciół",
    removeFriendConfirm: ({ name }: { name: string }) =>
      `Czy na pewno chcesz usunąć ${name} z przyjaciół?`,
    requestSentDescription: ({ name }: { name: string }) =>
      `Twoje zaproszenie do grona przyjaciół zostało wysłane do ${name}`,
    requestFriendship: "Wyślij zaproszenie do znajomych",
    cancelRequest: "Anuluj zaproszenie do znajomych",
    cancelRequestConfirm: ({ name }: { name: string }) =>
      `Anulować zaproszenie do znajomych wysłane do ${name}?`,
    denyRequest: "Odrzuć zaproszenie",
    nowFriendsWith: ({ name }: { name: string }) =>
      `Teraz jesteś w gronie znajomych z ${name}`,
  },

  usage: {
    // Usage panel strings
    today: "Dzisiaj",
    last7Days: "Ostatnie 7 dni",
    last30Days: "Ostatnie 30 dni",
    totalTokens: "Łącznie tokenów",
    totalCost: "Całkowity koszt",
    tokens: "Tokeny",
    cost: "Koszt",
    usageOverTime: "Użycie w czasie",
    byModel: "Według modelu",
    byTokenType: "Według typu tokenu",
    noData: "Brak danych o użyciu",
  },

  feed: {
    // Feed notifications for friend requests and acceptances
    friendRequestFrom: ({ name }: { name: string }) =>
      `${name} wysłał Ci zaproszenie do znajomych`,
    friendRequestGeneric: "Nowe zaproszenie do znajomych",
    friendAccepted: ({ name }: { name: string }) =>
      `Jesteś teraz znajomym z ${name}`,
    friendAcceptedGeneric: "Zaproszenie do znajomych zaakceptowane",
  },

  profiles: {
    // Profile management feature
    title: "Profile",
    subtitle: "Zarządzaj profilami zmiennych środowiskowych dla sesji",
    noProfile: "Brak Profilu",
    noProfileDescription: "Użyj domyślnych ustawień środowiska",
    defaultModel: "Domyślny Model",
    addProfile: "Dodaj Profil",
    profileName: "Nazwa Profilu",
    enterName: "Wprowadź nazwę profilu",
    baseURL: "Adres URL",
    authToken: "Token Autentykacji",
    enterToken: "Wprowadź token autentykacji",
    model: "Model",
    setupInstructions: "Instrukcje konfiguracji",
    viewSetupGuide: "Zobacz oficjalny przewodnik konfiguracji",
    defaultSessionType: "Domyślny typ sesji",
    defaultPermissionMode: "Domyślny tryb uprawnień",
    permissionDefault: "Domyślny",
    permissionDefaultDesc: "Pytaj o uprawnienia",
    permissionAcceptEdits: "Akceptuj edycje",
    permissionAcceptEditsDesc: "Automatycznie zatwierdzaj edycje",
    permissionPlan: "Plan",
    permissionPlanDesc: "Planuj przed wykonaniem",
    permissionYolo: "Yolo",
    permissionYoloDesc: "Pomiń wszystkie uprawnienia",
    spawnInTmux: "Uruchamiaj sesje w Tmux",
    tmuxEnabledDesc:
      "Sesje uruchamiane w nowych oknach tmux. Skonfiguruj nazwę sesji i katalog tymczasowy poniżej.",
    tmuxDisabledDesc:
      "Sesje uruchamiane w zwykłej powłoce (bez integracji z tmux)",
    tmuxSession: "Sesja Tmux",
    tmuxSessionName: "Nazwa sesji Tmux",
    enterTmuxSession: "Wprowadź nazwę sesji tmux",
    tmuxSessionHint:
      'Pozostaw puste, aby użyć pierwszej istniejącej sesji tmux (lub utworzyć "happy"). Podaj nazwę (np. "my-work") dla konkretnej sesji.',
    tmuxSessionPlaceholder: "Puste = pierwsza istniejąca sesja",
    tmuxDisabledPlaceholder: "Wyłączone - tmux nie jest włączony",
    tmuxTempDir: "Katalog tymczasowy Tmux",
    enterTmuxTempDir: "Wprowadź ścieżkę do katalogu tymczasowego",
    tmuxTempDirHint:
      "Katalog tymczasowy dla plików sesji tmux. Pozostaw puste dla wartości systemowej.",
    tmuxTempDirPlaceholder: "/tmp (opcjonalnie)",
    tmuxUpdateEnvironment: "Aktualizuj środowisko automatycznie",
    startupBashScript: "Skrypt startowy Bash",
    startupScriptEnabledDesc:
      "Wykonywany przed każdą sesją. Do dynamicznej konfiguracji, sprawdzania środowiska lub niestandardowej inicjalizacji.",
    startupScriptDisabledDesc:
      "Brak skryptu startowego - sesje uruchamiane bezpośrednio",
    startupScriptPlaceholder:
      "#!/bin/bash\necho 'Inicjalizacja...'\n# Twój skrypt tutaj",
    disabled: "Wyłączone",
    nameRequired: "Nazwa profilu jest wymagana",
    deleteConfirm: 'Czy na pewno chcesz usunąć profil "{name}"?',
    editProfile: "Edytuj Profil",
    addProfileTitle: "Dodaj Nowy Profil",
    delete: {
      title: "Usuń Profil",
      message: ({ name }: { name: string }) =>
        `Czy na pewno chcesz usunąć "${name}"? Tej czynności nie można cofnąć.`,
      confirm: "Usuń",
      cancel: "Anuluj",
    },
  },

  git: {
    title: "Git",
    tabChanges: "Zmiany",
    tabHistory: "Historia",
    tabBranches: "Gałęzie",
    tabStash: "Schowek",
    tabIssues: "Issues",
    tabPRs: "PR",
    historyEmpty: "Brak commitów",
    historyLoading: "Ładowanie commitów...",
    historyLoadMore: "Ładowanie...",
    historyNoMore: "Załadowano wszystkie commity",
    commitFiles: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? "plik zmieniony" : "plików zmienionych"}`,
    localBranches: "Lokalne gałęzie",
    remoteBranches: "Zdalne gałęzie",
    currentBranch: "Bieżąca",
    noBranches: "Nie znaleziono gałęzi",
    noUpstream: "Brak upstream",
    createBranch: "Utwórz gałąź",
    enterBranchName: "Wprowadź nazwę gałęzi",
    branchNamePlaceholder: "feature/my-branch",
    switchBranchSuccess: ({ name }: { name: string }) =>
      `Przełączono na '${name}'`,
    createBranchSuccess: ({ name }: { name: string }) =>
      `Gałąź '${name}' utworzona`,
    dirtyWorkingTree:
      "Proszę zatwierdzić lub schować zmiany przed przełączeniem gałęzi",
    branchSwitchFailed: "Nie udało się przełączyć gałęzi",
    branchCreateFailed: "Nie udało się utworzyć gałęzi",
    invalidBranchName: "Nieprawidłowa nazwa gałęzi",
    branchAlreadyExists: ({ name }: { name: string }) =>
      `Gałąź '${name}' już istnieje`,
    stashEmpty: "Brak odłożonych zmian",
    stashFiles: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? "plik zmieniony" : "plików zmienionych"}`,
    // Repo selector
    rootRepo: "Główne",
    // Remote operations
    fetch: "Pobierz",
    pull: "Ściągnij",
    push: "Wyślij",
    fetchSuccess: "Pobrano ze zdalnego repozytorium",
    pullSuccess: "Ściągnięto ze zdalnego repozytorium",
    pushSuccess: "Wysłano do zdalnego repozytorium",
    fetchFailed: "Nie udało się pobrać ze zdalnego repozytorium",
    pullFailed: "Nie udało się ściągnąć ze zdalnego repozytorium",
    pushFailed: "Nie udało się wysłać do zdalnego repozytorium",
    noUpstreamHint: "Brak gałęzi upstream",
    upToDate: "Aktualny",
    stage: "Dodaj do indeksu",
    unstage: "Usuń z indeksu",
    discard: "Odrzuć",
    addToGitignore: "Dodaj do .gitignore",
    commit: "Zatwierdź",
    stageAll: "Dodaj wszystko do indeksu",
    unstageAll: "Usuń wszystko z indeksu",
    discardAll: "Odrzuć wszystko",
    stageSuccess: "Pliki dodane do indeksu",
    unstageSuccess: "Pliki usunięte z indeksu",
    discardSuccess: "Zmiany odrzucone",
    gitignoreSuccess: "Dodano do .gitignore",
    commitSuccess: "Zmiany zatwierdzone",
    stageFailed: "Nie udało się dodać plików do indeksu",
    unstageFailed: "Nie udało się usunąć z indeksu",
    discardFailed: "Nie udało się odrzucić zmian",
    gitignoreFailed: "Nie udało się dodać do .gitignore",
    commitFailed: "Nie udało się zatwierdzić",
    discardConfirmTitle: "Odrzucić zmiany?",
    discardConfirmMessage: ({ count }) =>
      `Zmiany w ${count} ${count === 1 ? "pliku" : "plikach"} zostaną trwale cofnięte. Tej operacji nie można cofnąć.`,
    discardAllConfirmMessage:
      "Wszystkie niezindeksowane zmiany zostaną trwale utracone. Tej operacji nie można cofnąć.",
    selectedCount: ({ count }) => `Zaznaczono: ${count}`,
    commitMessagePlaceholder: "Wpisz opis commita...",
    noStagedFiles: "Brak zindeksowanych plików do zatwierdzenia",
  },

  issues: {
    open: "Otwarte",
    closed: "Zamknięte",
    loading: "Ładowanie issues...",
    noIssues: "Nie znaleziono issues",
    noRepo: "Nie wykryto repozytorium GitHub/Gitea",
    noBody: "Brak opisu",
    sendToChat: "Wyślij do czatu",
    openInBrowser: "Otwórz w przeglądarce",
    closeIssue: "Zamknij issue",
    reopenIssue: "Otwórz ponownie issue",
    addComment: "Dodaj komentarz",
    commentPlaceholder: "Wpisz komentarz...",
    newIssue: "Nowy problem",
    newIssueTitlePlaceholder: "Tytuł problemu...",
    newIssueBody: "Opis (opcjonalnie)",
    newIssueBodyPlaceholder: "Opisz problem...",
    pageOf: ({ page }: { page: number }) => `Strona ${page}`,
    launchSession: "Uruchom sesję",
    viewProcessingSession: "Zobacz sesję przetwarzania",
    processing: "Przetwarzanie",
    launchFailed: ({ error }: { error: string }) =>
      `Nie udało się uruchomić sesji: ${error}`,
    autoClosedComment: ({ branchName }: { branchName: string }) =>
      `Ten issue został obsłużony przez Happy Coder. Gałąź: ${branchName}`,
    editIssue: "Edytuj zgłoszenie",
    editTitle: "Edytuj tytuł zgłoszenia",
    editTitlePlaceholder: "Tytuł zgłoszenia...",
    editBody: "Edytuj opis zgłoszenia",
    editBodyPlaceholder: "Opisz zgłoszenie...",
    sortBy: "Sortuj według",
    sortCreated: "Daty utworzenia",
    sortUpdated: "Daty aktualizacji",
    sortComments: "Komentarzy",
    noOpenIssues: "Brak otwartych zgłoszeń",
    noClosedIssues: "Brak zamkniętych zgłoszeń",
    tryClosedHint: "Spróbuj wyświetlić zamknięte zgłoszenia",
    createFirstIssue: "Utwórz zgłoszenie",
    createIssueTitle: "Utwórz zgłoszenie",
    labelSelect: "Etykiety",
    noLabelsAvailable: "Brak dostępnych etykiet",
    createButton: "Utwórz",
    statusProcessing: "Przetwarzanie",
    statusCompleted: "Zakończono",
    statusFailed: "Niepowodzenie",
    statusCancelled: "Anulowano",
    sectionMetadata: "Metadane",
    sectionDescription: "Opis",
    sectionWorktree: "Drzewo robocze",
    metaRepository: "Repozytorium",
    metaAuthor: "Autor",
    metaLabels: "Etykiety",
    metaCreated: "Utworzono",
    metaBranch: "Gałąź",
    metaParentBranch: "Gałąź nadrzędna",
    noDescriptionProvided: "Brak opisu",
    sectionTask: "Instrukcje zadania",
    cannotArchiveProcessing:
      "Ta sesja przetwarza zgłoszenie. Poczekaj na zakończenie.",
  },

  prs: {
    open: "Otwarte",
    closed: "Zamknięte",
    all: "Wszystkie",
    draft: "Szkic",
    loading: "Ładowanie PR...",
    noRepo: "Nie wykryto repozytorium GitHub/Gitea",
    noOpenPRs: "Brak otwartych PR",
    noClosedPRs: "Brak zamkniętych PR",
    noPRs: "Nie znaleziono PR",
    tryClosedHint: "Spróbuj zobaczyć zamknięte PR",
    sortBy: "Sortuj według",
    sortCreated: "Data utworzenia",
    sortUpdated: "Data aktualizacji",
    ci_pending: "Oczekiwanie",
    ci_success: "Sukces",
    ci_failure: "Błąd",
    ci_error: "Błąd",
    review_approved: "Zatwierdzone",
    review_changes_requested: "Wymagane zmiany",
    review_commented: "Zrecenzowane",
    review_pending: "Oczekuje recenzji",
    review_dismissed: "Odrzucone",
    merged: "Scalony",
    noBody: "Brak opisu",
    viewChanges: "Zobacz zmiany",
    files: "plików",
    merge: "Scal",
    mergeCommit: "Scalenie zwykłe",
    squashMerge: "Scalenie ze spłaszczeniem",
    rebaseMerge: "Scalenie z rebase",
    recommended: "Zalecane",
    chooseMergeMethod: "Wybierz metodę scalania",
    approve: "Zatwierdź",
    approved: "Zatwierdzone!",
    cannotApproveOwn: "Nie można zatwierdzić własnego PR",
    closePR: "Zamknij PR",
    addComment: "Dodaj komentarz",
    commentPlaceholder: "Wpisz komentarz...",
    openInBrowser: "Otwórz w przeglądarce",
    ciChecks: "Kontrole CI",
    reviews: "Recenzje",
    comments: "Komentarze",
    noChecks: "Brak kontroli CI",
    noReviews: "Brak recenzji",
    noComments: "Brak komentarzy",
    loadFailed: "Nie udało się załadować danych",
    mergeHint: "Scal kod do gałęzi bazowej teraz",
    approveHint: "Tylko recenzja, nie scala",
  },

  gitHosts: {
    title: "Hosty Git",
    description:
      "Skonfiguruj, które hosty Git używają GitHub API, a które Gitea API. GitHub.com jest wykrywany automatycznie. Inne hosty domyślnie używają Gitea.",
    empty:
      "Brak skonfigurowanych hostów. GitHub.com jest wykrywany automatycznie, inne hosty domyślnie używają Gitea.",
    addHost: "Dodaj host",
    editHost: "Edytuj host",
    tabBasic: "Podstawowe",
    tabAutoIssue: "Auto-zadania",
    tabWebhooks: "Webhooks",
    hostLabel: "Host",
    providerLabel: "Dostawca",
    tokenLabel: "API Token",
    tokenPlaceholder: "Opcjonalnie — wymagane dla prywatnych repozytoriów",
    tokenHint:
      "Wygeneruj w Ustawienia → Aplikacje → Tokeny dostępu w Twojej instancji Gitea. Wymagane uprawnienia: issue, repository, admin:repo_hook.",
    tokenHintGitHub:
      "Personal Access Token z uprawnieniami admin:repo_hook. Automatycznie tworzy Webhook przy zapisywaniu.",
    deleteTitle: "Usuń host",
    deleteMessage: ({ host }: { host: string }) =>
      `Usunąć "${host}" z listy hostów?`,
    duplicateTitle: "Zduplikowany host",
    duplicateMessage: ({ host }: { host: string }) =>
      `"${host}" jest już skonfigurowany.`,
    autoIssueSectionTitle: "Automatyczna sesja zgłoszeń",
    autoIssueDescription:
      "Automatycznie uruchom sesję Claude Code po wykryciu zgłoszenia z określoną etykietą. Wyzwalane tylko dla zgłoszeń utworzonych przez dozwolonych autorów.",
    autoIssueLabel: "Etykieta wyzwalająca",
    autoIssueLabelPlaceholder: "np. claude, auto-fix",
    autoIssueAllowedAuthors: "Dozwoleni autorzy",
    autoIssueAllowedAuthorsPlaceholder: "nazwa1, nazwa2",
    webhookSectionTitle: "Webhook Repozytoria",
    webhookDescription:
      "Odbieraj zdarzenia Webhook z hosta Git, aby automatycznie przetwarzać zgłoszenia bez odpytywania. Dodaj repozytoria do monitorowania poniżej.",
    webhookAddRepo: "Dodaj Webhook Repo",
    webhookRemoveRepo: "Usuń",
    webhookRepoUrl: "URL repozytorium",
    webhookRepoUrlPlaceholder: "https://github.com/owner/repo",
    webhookMachineId: "Maszyna docelowa",
    webhookMachineIdPlaceholder: "Wybierz maszynę",
    webhookRepoPath: "Lokalna ścieżka repozytorium",
    webhookRepoPathPlaceholder: "/path/to/repo",
    webhookSecretLabel: "Webhook Secret",
    webhookSecretCopied: "Secret skopiowany do schowka",
    webhookUrlLabel: "Webhook URL",
    webhookUrlCopied: "URL skopiowany do schowka",
    webhookUrlHint:
      "Skonfiguruj ten URL i Secret w ustawieniach Webhook repozytorium.",
    webhookSyncSuccess: "Trasy webhook zsynchronizowane",
    webhookSyncError: "Błąd synchronizacji tras webhook",
    webhookNoMachines: "Brak dostępnych maszyn",
    scanRepos: "Skanuj repozytoria",
    scanning: "Skanowanie...",
    scanEmpty: "Nie znaleziono repozytoriów git na tej maszynie",
    scanError:
      "Skanowanie nie powiodło się — upewnij się, że maszyna jest online",
    scanSearchPlaceholder: "Szukaj repozytoriów...",
    webhookGuideTitle: ({ provider }: { provider: string }) =>
      `Konfiguracja Webhook ${provider}`,
    guideStep1GitHub:
      "Przejdź do repozytorium → Settings → Webhooks → Add webhook",
    guideStep1Gitea:
      "Przejdź do repozytorium → Settings → Webhooks → Add Webhook → Gitea",
    guideStep2: "Wklej Webhook URL wyświetlony poniżej",
    guideStep3: "Wklej Webhook Secret wyświetlony poniżej",
    guideStep4: 'Content type: wybierz "application/json"',
    guideStep5: 'Events: wybierz tylko "Issues", następnie zapisz',
    webhookTestSuccess: "Serwer jest osiągalny",
    webhookTestFail: ({ status }: { status: string }) =>
      `Serwer zwrócił HTTP ${status}`,
    webhookTestError: "Nie można połączyć się z serwerem — sprawdź sieć",
    remoteWebhookSuccess: "Webhook utworzony w zdalnym repozytorium",
    remoteWebhookFail: ({ error }: { error: string }) =>
      `Nie udało się utworzyć zdalnego Webhook: ${error}`,
    tokenRequiredForRemote:
      "Token API jest wymagany do automatycznego tworzenia webhooków na zdalnym serwerze",
    webhookRepoSaved: "Webhook zapisany",
    webhookFieldsRequired: "Wypełnij URL repozytorium, maszynę i sekret",
    webhookSaveHostFirst: "Najpierw zapisz Git Host",
    webhookRepoDeleted: "Webhook usunięty",
    webhookDeleteConfirm: "Usunąć ten Webhook i trasę serwera?",
  },

  quickCommands: {
    searchPlaceholder: "Szukaj poleceń...",
    noCommandsFound: "Nie znaleziono poleceń",
    favorites: "Ulubione",
    allCommands: "Wszystkie polecenia",
    noResults: "Nie znaleziono poleceń",
    groups: {
      favorites: "Ulubione",
      root: "Skrypty projektu",
      shell: "Polecenia Shell",
    },
  },

  kanban: {
    emptyTitle: "Brak zadań",
    emptySubtitle: "Utwórz pierwsze zadanie, aby zorganizować pracę",
    newTask: "Nowe zadanie",
    taskDetail: "Szczegóły zadania",
    taskNotFound: "Nie znaleziono zadania",
    details: "Szczegóły",
    titlePlaceholder: "Tytuł zadania",
    titleRequired: "Tytuł jest wymagany",
    descriptionPlaceholder: "Opis (opcjonalnie)",
    column: "Status",
    priorityLabel: "Priorytet",
    machine: "Maszyna",
    machineOnline: "Online",
    machineOffline: "Offline",
    directory: "Katalog",
    directoryHint: "Katalog roboczy dla sesji",
    sessionPromptLabel: "Prompt sesji",
    sessionPromptPlaceholder:
      "Instrukcje dla Claude przy uruchamianiu zadania...",
    sessionPromptHint:
      "Wstępnie wypełniony prompt przy tworzeniu sesji z zadania",
    linkedSessions: "Powiązane sesje",
    actionsLabel: "Akcje",
    startSession: "Rozpocznij sesję",
    noMachineSelected: "Najpierw wybierz maszynę",
    machineNotOnline: "Wybrana maszyna jest offline",
    noDirectory: "Podaj katalog roboczy",
    spawnFailed: "Nie udało się uruchomić sesji",
    sessionNotFound: "Nie znaleziono sesji",
    sessionActive: "Aktywna",
    sessionInactive: "Nieaktywna",
    deleteConfirmTitle: "Usuń zadanie",
    deleteConfirmMessage: "Czy na pewno chcesz usunąć to zadanie?",
    actions: {
      moveTo: "Przenieś do",
    },
    stats: {
      totalTasks: ({ count }: { count: number }) => `${count} zadań`,
      activeSessions: ({ count }: { count: number }) => `${count} aktywnych`,
    },
    columns: {
      backlog: "Backlog",
      todo: "Do zrobienia",
      inProgress: "W toku",
      review: "Przegląd",
      done: "Gotowe",
    },
    columnEmpty: {
      backlog: {
        title: "Brak zaległości",
        subtitle: "Zadania oczekujące na planowanie pojawią się tutaj",
      },
      todo: {
        title: "Nic do zrobienia",
        subtitle: "Dodaj zadania gotowe do pracy",
      },
      inProgress: {
        title: "Nic w toku",
        subtitle: "Przenieś zadania tutaj, gdy zaczniesz pracę",
      },
      review: {
        title: "Nic do przeglądu",
        subtitle: "Zadania oczekujące na przegląd pojawią się tutaj",
      },
      done: {
        title: "Brak ukończonych zadań",
        subtitle: "Ukończone zadania będą wyświetlane tutaj",
      },
    },
    priority: {
      low: "Niski",
      medium: "Średni",
      high: "Wysoki",
      urgent: "Pilny",
    },
    templates: {
      pickTitle: "Wybierz szablon",
      useTemplate: "Użyj szablonu",
      manage: "Zarządzaj szablonami",
      title: "Szablony promptów",
      newTemplate: "Nowy szablon",
      editing: "Edytuj szablon",
      namePlaceholder: "Nazwa szablonu",
      contentPlaceholder:
        "Treść szablonu...\nUżyj {{title}}, {{description}}, {{directory}}, {{tags}} jako zmiennych",
      deleteTitle: "Usuń szablon",
      deleteMessage: "Czy na pewno chcesz usunąć ten szablon?",
      builtInBadge: "Wbudowany",
      empty: "Brak szablonów",
      builtIn: {
        coding: "Rozwój kodu",
        bugfix: "Naprawa błędów",
        review: "Przegląd kodu",
      },
    },
  },

  projects: {
    notFound: "Projekt nie znaleziony",
    emptyTitle: "Brak projektów",
    emptySubtitle: "Połącz CLI lub naciśnij przycisk poniżej, aby dodać projekt",
    allProjects: "Wszystkie projekty",
    tabSessions: "Sesje",
    tabGit: "Git",
    tabHealth: "Zdrowie",
    tabActions: "Akcje",
    tabResearch: "Badania",
    tabConfig: "Konfiguracja",
    configEmpty: "Brak elementów konfiguracji",
    configProjectInfo: "Informacje o projekcie",
    configPath: "Ścieżka",
    configMachine: "Maszyna",
    configCreatedAt: "Utworzono",
    configAlias: "Alias projektu",
    configAliasDescription: "Niestandardowa nazwa wyświetlana projektu",
    configAliasNotSet: "Nie ustawiono",
    configAliasPromptTitle: "Ustaw alias",
    configAliasPromptMessage: "Wprowadź niestandardową nazwę. Pozostaw puste, aby użyć domyślnej nazwy folderu.",
    configDefaultModel: "Domyślny model",
    configDefaultModelDescription: "Model używany dla nowych sesji w tym projekcie",
    configDefaultModelNotSet: "Domyślny",
    configArchive: "Archiwizuj projekt",
    configUnarchive: "Przywróć z archiwum",
    configArchiveConfirm: "Czy na pewno chcesz zarchiwizować ten projekt? Zostanie ukryty z listy projektów.",
    configUnarchiveConfirm: "Czy na pewno chcesz przywrócić ten projekt z archiwum?",
    configSaved: "Konfiguracja zapisana",
    configSaveFailed: "Nie udało się zapisać konfiguracji",
    noSessions: "Brak sesji",
    sessions: "Sesje",
    activeSessions: "Aktywne sesje",
    archivedSessions: "Zarchiwizowane sesje",
    noGitInfo: "Brak informacji o git",
    gitInfo: "Informacje Git",
    branch: "Gałąź",
    switchBranch: "Zmień gałąź",
    ahead: "Przed",
    behind: "Za",
    dirty: "Niezatwierdzone zmiany",
    branchAndRemote: "Gałąź i zdalny",
    upstreamBranch: "Upstream",
    remoteUrl: "Zdalny",
    fileChanges: "Zmiany plików",
    modifiedCount: "Zmodyfikowane",
    untrackedCount: "Nieśledzone",
    stagedCount: "Przygotowane",
    lineChanges: "Zmiany linii",
    stagedLines: "Przygotowane",
    unstagedLines: "Nieprzygotowane",
    stash: "Stash",
    stashCount: "Wpisy Stash",
    gitHost: "Host Git",
    addGitHost: "Dodaj host Git",
    noRemoteUrl: "Nie wykryto zdalnego URL",
    lastUpdated: "Ostatnia aktualizacja",
    addProject: "Dodaj projekt",
    selectMachine: "Wybierz maszynę",
    projectPath: "Ścieżka projektu",
    pathPlaceholder: "/path/to/your/project",
    noMachines: "Brak dostępnych maszyn. Najpierw połącz CLI.",
    deleteProject: "Usuń projekt",
    deleteConfirmTitle: "Usuń projekt",
    deleteConfirmMessage: "Projekt zostanie usunięty z listy. Tej operacji nie można cofnąć.",
    hasActiveSessions: "Nie można usunąć: projekt ma aktywne sesje",
    create: "Utwórz",
    deleteArchivedSessions: "Usuń zarchiwizowane sesje",
    deleteArchivedSessionsConfirm: ({ count }: { count: number }) =>
      `Czy na pewno chcesz trwale usunąć ${count} zarchiwizowanych sesji? Tej operacji nie można cofnąć.`,
    deleteArchivedSessionsSuccess: ({ count }: { count: number }) =>
      `Usunięto ${count} zarchiwizowanych sesji`,
    failedToDeleteArchivedSessions: "Nie udało się usunąć niektórych zarchiwizowanych sesji",
  },
  project: {
    segments: {
      board: "Tablica",
    },
  },

  webNotification: {
    taskComplete: "Zadanie ukończone",
    permissionRequest: "Wymagane zatwierdzenie",
  },

  openclaw: {
    title: "OpenClaw",
    connect: "Połącz",
    connecting: "Łączenie...",
    connected: "Połączono",
    disconnect: "Rozłącz",
    notConnected: "Nie połączono",
    notConnectedDescription:
      "Połącz się z bramką OpenClaw, aby rozpocząć rozmowę.",
    connectToGateway: "Połącz z bramką",
    connectTitle: "Połącz z OpenClaw",
    connectDescription:
      "Wprowadź adres URL bramki OpenClaw. Bramka działa lokalnie na twoim komputerze.",
    connectionSettings: "Ustawienia połączenia",
    gatewayUrl: "Adres URL bramki",
    token: "Token dostępu",
    tokenDescription: "Wygeneruj przez CLI lub panel sterowania OpenClaw",
    tokenPlaceholder: "Wprowadź token dostępu do bramki",
    password: "Hasło",
    passwordOptional: "Dla bramek chronionych hasłem",
    passwordPlaceholder: "Wprowadź hasło, jeśli wymagane",
    connectionFailed: "Połączenie nie powiodło się",
    checkSettings: "Sprawdź ustawienia połączenia i spróbuj ponownie.",
    connectFooter:
      "Połączenie jest bezpośrednie z lokalną bramką. Dane nie przechodzą przez zewnętrzne serwery.",
    localConnection: "Połączenie lokalne",
    localConnectionDescription:
      "Cała komunikacja odbywa się bezpośrednio z twoją bramką.",
    viewSessions: "Zobacz sesje",
    connectedTo: "Połączono z",
    newChat: "Nowy czat",
    recentSessions: "Ostatnie sesje",
    noSessions: "Brak sesji. Rozpocznij nowy czat.",
    chat: "Czat",
    startConversation: "Rozpocznij rozmowę z OpenClaw",
    messagePlaceholder: "Wpisz wiadomość...",
    pairingRequired: "Wymagane parowanie",
    pairingDescription:
      "To urządzenie musi zostać zatwierdzone przed połączeniem z bramką.",
    pairingInstructions: "Jak zatwierdzić",
    pairingStep1Title: "Otwórz OpenClaw",
    pairingStep1Description: "Kliknij ikonę OpenClaw na pasku menu",
    pairingStep2Title: "Znajdź żądanie parowania",
    pairingStep2Description: 'Poszukaj "Happy" na liście oczekujących urządzeń',
    pairingStep3Title: "Zatwierdź urządzenie",
    pairingStep3Description: 'Kliknij "Zatwierdź" aby zezwolić na połączenie',
    retryConnection: "Ponów połączenie",
    deviceInfo: "Informacje o urządzeniu",
    deviceId: "ID urządzenia",
    newSession: "Nowa sesja",
    newSessionTitle: "Rozpocznij nową rozmowę",
    newSessionDescription:
      "Wpisz wiadomość poniżej, aby rozpocząć czat z OpenClaw.",
    newSessionPlaceholder: "O czym chcesz porozmawiać?",
    tokenCommand: "Polecenie do pobrania tokena",
    tokenCommandHint: "Uruchom to polecenie w terminalu:",
    tokenCommandValue: "clawdbot dashboard --no-open",
    tokenCommandDescription:
      'To wyświetli URL z twoim tokenem. Skopiuj wartość po "?token="',
    thinking: "Myślę",
    usingTools: "Używam narzędzi",
    errorOccurred: "Wystąpił błąd",
  },
  preview: {
    title: "Podgląd",
    detectingPorts: "Wykrywanie serwerów deweloperskich...",
    noPorts: "Nie wykryto serwerów deweloperskich",
    noPortsHint: "Najpierw uruchom serwer deweloperski, a potem dotknij Wykryj",
    detect: "Wykryj",
    refresh: "Odśwież",
    capture: "Zrzut",
    capturing: "Przechwytywanie zrzutu ekranu...",
    urlPlaceholder: "http://localhost:3000",
    customUrl: "Własny URL",
    screenshotFailed: "Nie udało się przechwycić zrzutu ekranu",
    devServers: "Serwery deweloperskie",
    screenshotAt: ({ url }: { url: string }) => `Zrzut ekranu ${url}`,
    portItem: ({ port, process }: { port: number; process: string }) =>
      `Port ${port} — ${process}`,
    setBaseline: "Ustaw jako bazowy",
    clearBaseline: "Wyczyść bazowy",
    baselineSet: "Zrzut bazowy zapisany",
    compare: "Porównaj",
    comparing: "Porównywanie z bazowym zrzutem...",
    before: "Przed",
    after: "Po",
    diff: "Różnice",
    noBaseline: "Brak zrzutu bazowego",
    noBaselineHint: "Najpierw zrób zrzut ekranu, a potem ustaw go jako bazowy",
    comparisonFailed: "Porównanie nie powiodło się",
    unavailableTitle: "Nie znaleziono agent-browser",
    unavailableHint:
      "Zainstaluj agent-browser na maszynie CLI, aby korzystać z podglądu. Uruchom: npm install -g @anthropic-ai/agent-browser",
    emptyHint:
      "Wybierz serwer deweloperski lub wprowadź URL, aby wykonać zrzut ekranu interfejsu.",
  },

  supervisor: {
    title: "Monitor zdrowia",
    description: "Analiza kodu AI monitorująca kondycję projektu w wielu wymiarach.",
    notSynced: "Projekt nie jest jeszcze zsynchronizowany z serwerem",
    scanNow: "Skanuj teraz",
    scanStarting: "Uruchamianie...",
    loading: "Ładowanie...",
    alreadyRunning: "Skanowanie jest już w toku",
    settings: "Ustawienia monitora",
    status_pending: "Oczekuje",
    status_running: "W toku",
    status_completed: "Zakończone",
    status_failed: "Błąd",
    status_cancelled: "Anulowane",
    statusWaitingCli: "Oczekiwanie na CLI...",
    statusAnalyzing: "AI analizuje kod...",
    elapsed: ({ time }: { time: string }) => `Upłynęło: ${time}`,
    triggerManual: "Ręczne skanowanie",
    triggerScheduled: "Zaplanowane",
    triggerEvent: "Zdarzenie",
    triggerPush: "Trigger push",
    severityCritical: "Krytyczny",
    severityHigh: "Wysoki",
    severityMedium: "Średni",
    severityLow: "Niski",
    pendingActions: ({ count }: { count: number }) => `Oczekujące akcje (${count})`,
    actionsCount: ({ count }: { count: number }) => `${count} akcji`,
    approve: "Zatwierdź",
    skip: "Pomiń",
    ignore: "Ignoruj",
    triggerFix: "Napraw",
    suggestedFix: "Sugerowana poprawka",
    fixStatus: "Status naprawy",
    runHistory: "Historia uruchomień",
    noRuns: "Brak skanowań",
    moreRuns: ({ count }: { count: number }) => `Jeszcze ${count}`,
    showMoreRuns: ({ count }: { count: number }) => `Pokaż ${count} więcej uruchomień`,
    justNow: "Przed chwilą",
    minutesAgo: ({ count }: { count: number }) => `${count} min temu`,
    hoursAgo: ({ count }: { count: number }) => `${count} godz. temu`,
    daysAgo: ({ count }: { count: number }) => `${count} dni temu`,
    costSection: "Koszty",
    costRunsCount: "Uruchomienia",
    costTotalTokens: "Łączne tokeny",
    costTotalUsd: "Łączny koszt",
    costPeriod: ({ days }: { days: number }) => `Ostatnie ${days} dni`,
    trendSection: "Trend ważności",
    relatedProjects: "Powiązane projekty",
    summaryGrade: "Ocena",
    trendImproving: "Poprawia się",
    trendStable: "Stabilny",
    trendDeclining: "Pogarsza się",
    lastScan: "Ostatnie skanowanie",
    openIssues: "Otwarte problemy",
    runs30d: "Uruchomienia (30d)",
    nextRun: "Następne skanowanie",
    runDetail: "Szczegóły uruchomienia",
    runTrigger: "Trigger",
    runDuration: "Czas trwania",
    runCost: "Koszt",
    newIssues: "Nowe problemy",
    resolvedIssues: "Rozwiązane",
    persistentIssues: "Nierozwiązane",
    noPreviousRun: "Pierwsze skanowanie — brak danych do porównania",
    dimensionsSection: "Wymiary analizy",
    analyzingDimension: ({ dimension, index, total }) => `${dimension} (${index}/${total})`,
    dimSecurity: "Bezpieczeństwo",
    dimSecurityNote: "Luki, zakodowane sekrety, ryzyko iniekcji",
    dimDependencies: "Zależności",
    dimDependenciesNote: "Przestarzałe pakiety, konflikty wersji, duplikaty",
    dimArchitecture: "Architektura",
    dimArchitectureNote: "Organizacja kodu, zgodność z konwencjami",
    dimTechDebt: "Dług techniczny",
    dimTechDebtNote: "TODO/FIXME, martwy kod, duplikacja kodu",
    dimCodeQuality: "Jakość kodu",
    dimCodeQualityNote: "Styl, złożoność, najlepsze praktyki",
    dimTestCoverage: "Pokrycie testami",
    dimTestCoverageNote: "Luki w pokryciu, jakość testów",
    dimDocumentation: "Dokumentacja",
    dimDocumentationNote: "README, dokumentacja API, dokładność komentarzy",
    dimPerformance: "Wydajność",
    dimPerformanceNote: "Zapytania N+1, brakujące indeksy, wycieki pamięci",
    dimUiUx: "UI/UX",
    dimUiUxNote: "Odstępy, stany ładowania, dostępność, użycie motywu",
    dimResearch: "Badania",
    modeSection: "Tryb analizy",
    modeSuggest: "Sugestie",
    modeSuggestDesc: "AI sugeruje akcje, zatwierdzasz ręcznie",
    modeSemiAuto: "Półautomatyczny",
    modeSemiAutoDesc: "Auto-naprawa niskiego ryzyka, ręczne zatwierdzanie wysokiego",
    modeAuto: "Automatyczny",
    modeAutoDesc: "AI auto-naprawia i tworzy Issue/PR",
    scheduleSection: "Harmonogram",
    scheduleEnabled: "Włącz planowane skanowania",
    scheduleEvery6h: "Co 6 godzin",
    scheduleEvery12h: "Co 12 godzin",
    scheduleEvery24h: "Co 24 godziny",
    scheduleEvery48h: "Co 48 godzin",
    scheduleEveryWeek: "Co tydzień",
    pushTriggerSection: "Push trigger",
    pushTriggerEnabled: "Skanuj przy push",
    pushTriggerDesc: "Uruchom analizę przyrostową przy push kodu",

    fixStrategySection: "Strategia napraw",
    fixStrategyDirect: "Bezpośrednie scalanie",
    fixStrategyDirectDesc: "Wyślij poprawki bezpośrednio do głównej gałęzi (z rozwiązywaniem konfliktów i siatką bezpieczeństwa testów)",
    fixStrategyPr: "Pull Request",
    fixStrategyPrDesc: "Utwórz PR dla każdej poprawki (wymaga ręcznego scalenia)",
    customRulesSection: "Niestandardowe reguły",
    customRulesDesc: "Dodaj reguły analizy specyficzne dla projektu",
    customRulesPlaceholder: "np. Sprawdź, czy wszystkie endpointy API mają rate limiting",
    notificationsSection: "Powiadomienia",
    notifAnalysisComplete: "Analiza zakończona",
    notifIssueCreated: "Issue utworzony",
    notifPRCreated: "PR utworzony",
    notifError: "Błędy",
    approveAll: "Zatwierdź wszystkie",
    skipAll: "Pomiń wszystkie",
    viewAllActions: "Zobacz wszystkie akcje",
    approveAllConfirm: ({ count }: { count: number }) => `Zatwierdzić wszystkie ${count} oczekujących akcji?`,
    skipAllConfirm: ({ count }: { count: number }) => `Pominąć wszystkie ${count} oczekujących akcji?`,
    approveAllSuccess: ({ count }: { count: number }) => `Zatwierdzono ${count} akcji`,
    skipAllSuccess: ({ count }: { count: number }) => `Pominięto ${count} akcji`,
    clearAll: "Wyczyść wszystko",
    clearAllConfirm: "To trwale usunie wszystkie akcje Supervisora dla tego projektu. Czy na pewno?",
    clearAllSuccess: ({ count }: { count: number }) => `${count} akcji usunięto`,

    // Phase 7: Action history
    actionHistory: "Historia akcji",
    tabPending: "Oczekujące",
    tabApproved: "Zatwierdzone",
    tabFixing: "Naprawianie",
    tabDone: "Gotowe",
    tabDismissed: "Odrzucone",
    noActions: "Brak akcji",
    loadMore: "Załaduj więcej",
    viewSession: "Zobacz sesję",
    viewPR: "Zobacz PR",
    retryFix: "Ponów",
    exportReport: "Eksportuj raport",
    exportCopied: "Raport skopiowany do schowka",
    healthScore: "Wynik",
    autoWarningTitle: "Włączyć tryb automatyczny?",
    autoWarningBody: "Tryb automatyczny będzie stosować poprawki i tworzyć Issue/PR bez ręcznego zatwierdzania. Używaj ostrożnie.",
    autoWarningConfirm: "Włącz",
    autoModeSafetyNote: "Tryb auto ograniczony do poprawek niskiego ryzyka. Zmiany wysokiego ryzyka wymagają zatwierdzenia.",
    safetyNote: "Wszystkie zmiany są dokonywane w oddzielnych gałęziach i wymagają przeglądu PR.",
    dailyLimitNote: "Dzienny limit tokenów zapobiega niekontrolowanym kosztom.",
    runActions: "Akcje",
    settingsSaved: "Ustawienia zapisane",
    settingsSaveError: "Nie udało się zapisać ustawień",
    autoApproveSeverities: "Automatyczne zatwierdzanie wg ważności:",
    reprocessTitle: "Zastosować nowy tryb?",
    reprocessBody: ({ count, mode }: { count: number; mode: string }) =>
      `Masz ${count} oczekujących akcji. Zastosować reguły ${mode} teraz?`,
    reprocessConfirm: "Zastosuj",
    reprocessSuccess: ({ approved, remaining }: { approved: number; remaining: number }) =>
      `${approved} automatycznie zatwierdzonych${remaining > 0 ? `, ${remaining} nadal oczekuje` : ""}`,
    concurrencySection: "Limity współbieżności",
    maxAnalysisSessions: "Maks. sesji analizy",
    maxAnalysisSessionsNote: "Maksymalna liczba jednoczesnych sesji analizy/badań",
    maxFixSessions: "Maks. sesji naprawczych",
    maxFixSessionsNote: "Maksymalna liczba jednoczesnych sesji naprawczych",
    status_queued: "W kolejce",
    recurring: "Powtarzające się",
    skipIgnoreHint: "Pomiń: pojawi się ponownie przy następnym skanowaniu. Ignoruj: trwale ukryte.",
    restore: "Przywróć",
    delete: "Usuń",
    deleteConfirm: "Usuń akcję",
    deleteConfirmBody: "Trwale usunąć tę akcję? Jeśli problem nadal istnieje, zostanie wykryty ponownie przy następnym skanowaniu.",

    // Loop mode
    loopMode: "Pętla",
    loopConfig: "Konfiguracja pętli",
    loopConfigIterations: "Maks. iteracji",
    loopConfigIterationsHint: "Ile cykli analiza→naprawa wykonać przed zatrzymaniem",
    loopConfigIterationsHintUnlimited: "Kontynuuj aż wszystkie kwalifikujące się akcje zostaną przetworzone (0 = bez limitu)",
    loopConfigThreshold: "Próg automatycznego zatwierdzania",
    loopConfigThresholdHint: "Automatycznie naprawiaj tylko akcje z pewnością AI powyżej tego poziomu",
    loopConfigCostCap: "Limit kosztów",
    loopConfigCostCapHint: "Zatrzymaj pętlę, gdy skumulowany koszt osiągnie tę kwotę",
    loopConfigSafety: "Pętla używa bezpośredniego scalania. Każda naprawa działa w izolowanym drzewie roboczym. Możesz wstrzymać lub zatrzymać w dowolnym momencie.",
    loopConfigStart: "Uruchom pętlę",
    loopHistory: "Historia pętli",
    loopIteration: ({ current, max }: { current: number; max: number }) => `Iteracja ${current}/${max}`,
    loopIterationUnlimited: ({ current }: { current: number }) => `Iteracja ${current} (bez limitu)`,
    loopFound: "Znaleziono",
    loopFixed: "Naprawiono",
    loopCost: "Koszt",
    loopHealthDelta: "Zdrowie",
    loopPause: "Wstrzymaj",
    loopResume: "Wznów",
    loopStop: "Zatrzymaj",
    loopStopConfirm: "Zatrzymać pętlę?",
    loopStopConfirmBody: "Bieżąca iteracja zostanie ukończona, ale nowe iteracje nie zostaną uruchomione.",
    loopPhase_idle: "Bezczynny",
    loopPhase_analyzing: "Analizowanie",
    loopPhase_fixing: "Naprawianie",
    loopPhase_deciding: "Podejmowanie decyzji",
    loopStatus_running: "Pętla w toku",
    loopStatus_paused: "Pętla wstrzymana",
    loopStatus_completed: "Pętla ukończona",
    loopStatus_failed: "Pętla nieudana",
    loopStatus_stopped: "Pętla zatrzymana",
    loopExit_max_iterations: "Osiągnięto maksymalną liczbę iteracji",
    loopExit_cost_cap: "Osiągnięto limit kosztów",
    loopExit_health_target: "Osiągnięto cel zdrowia",
    loopExit_no_new_actions: "Brak kolejnych problemów do naprawy",
    loopExit_consecutive_failures: "Zbyt wiele kolejnych niepowodzeń",
    loopExit_user_stopped: "Zatrzymano przez użytkownika",
    loopExit_timeout: "Przekroczono limit czasu",
    loopDetailExitReason: "Powód zakończenia",
    loopDetailTimeline: "Oś czasu iteracji",
    loopDetailActions: ({ count }: { count: number }) => `Akcje (${count})`,
    loopDetailNoRuns: "Brak iteracji",
    loopDetailNoActions: "Brak akcji",
    loadRunError: "Nie udało się załadować szczegółów uruchomienia",
    loadLoopError: "Nie udało się załadować szczegółów pętli",

    // Preflight sync dimensions
    dimPreflightStart: "Synchronizacja kodu...",
    dimPreflightCheck: "Sprawdzanie repozytorium...",
    dimPreflightStash: "Zapisywanie zmian...",
    dimPreflightFetch: "Pobieranie najnowszych...",
    dimPreflightPull: "Pobieranie aktualizacji...",
    dimPreflightResolve: "Rozwiązywanie konfliktów...",
    dimPreflightDeploy: "Wdrażanie zmian...",
    dimPreflightDeployCli: "Wydawanie CLI...",
    dimPreflightDeployServer: "Przebudowa serwera...",

    // Tagi pilności
    urgentTag: "Pilne",
    mustFixTag: "Do naprawy",
    optionalTag: "Opcjonalne",

    // Sortowanie i filtrowanie
    sortBy: "Sortuj",
    sortSeverity: "Priorytet",
    sortCategory: "Kategoria",
    sortConfidence: "Pewność",
    sortUrgency: "Pilność",
    filterUrgency: "Pilność",
    urgencyAll: "Wszystkie",
    urgencyUrgent: "Pilne",
    urgencyMustFix: "Do naprawy",
    urgencyOptional: "Opcjonalne",
  },
  webhook: {
    eventHistory: "Zdarzenia Webhook",
    noEvents: "Brak zdarzeń Webhook",
    loadMore: "Załaduj więcej",
    issue: "Issue",
  },
  competitorResearch: {
    title: "Analiza konkurencji",
    description: "Analiza podobnych produktów i pozycji rynkowej oparta na AI",
    startAnalysis: "Rozpocznij analizę",
    analyzing: "Analiza konkurencji...",
    knownCompetitors: "Znani konkurenci",
    knownCompetitorsPlaceholder: "np. VS Code, Cursor, Windsurf (opcjonalnie)",
    dimensionsSection: "Wymiary analizy",
    dim_pricing: "Strategia cenowa",
    dim_pricing_note: "Modele cenowe, plany, ograniczenia darmowej wersji",
    dim_features: "Główne funkcje",
    dim_features_note: "Matryca funkcji, wyróżniające możliwości",
    dim_devExperience: "Doświadczenie programisty",
    dim_devExperience_note: "Łatwość rozpoczęcia, jakość dokumentacji, design CLI",
    dim_positioning: "Pozycjonowanie rynkowe",
    dim_positioning_note: "Grupa docelowa, wyróżnienie marki",
    dim_techStack: "Architektura techniczna",
    dim_techStack_note: "Stos technologiczny, rozszerzalność, wydajność",
    dim_community: "Społeczność i ekosystem",
    dim_community_note: "GitHub stars, wtyczki, aktywność społeczności",
    dim_funding: "Finansowanie i biznes",
    dim_funding_note: "Rundy finansowania, wycena, model biznesowy",
    dim_userFeedback: "Opinie użytkowników",
    dim_userFeedback_note: "Recenzje, problemy, satysfakcja",
    additionalNotes: "Dodatkowe uwagi",
    additionalNotesPlaceholder: "Dodatkowe obszary zainteresowań lub konkretne pytania (opcjonalnie)",
    customRules: "Niestandardowe reguły",
    customRulesPlaceholder: "Np. skupiaj się tylko na konkurentach open-source, ignoruj rozwiązania korporacyjne",
    noReports: "Brak raportów",
    reportHistory: "Poprzednie raporty",
    latestReport: "Najnowszy raport",
    untitledReport: "Raport bez tytułu",
    reportDetail: "Raport z badań",
    reportNotFound: "Nie znaleziono raportu",
  },

  elicitation: {
    accept: "Zaakceptuj",
    decline: "Odrzuć",
    submit: "Wyślij",
  },
  stopFailure: {
    title: "Sesja niespodziewanie zatrzymana",
    lastMessage: "Ostatnia wiadomość asystenta",
  },
} as const;

export type TranslationsPl = typeof pl;
