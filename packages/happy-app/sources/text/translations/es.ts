import type { TranslationStructure } from "../_default";

/**
 * Spanish plural helper function
 * Spanish has 2 plural forms: singular, plural
 * @param options - Object containing count, singular, and plural forms
 * @returns The appropriate form based on Spanish plural rules
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

/**
 * Spanish translations for the Happy app
 * Must match the exact structure of the English translations
 */
export const es: TranslationStructure = {
  tabs: {
    // Tab navigation labels
    inbox: "Bandeja",
    sessions: "Terminales",
    project: "Proyecto",
    openclaw: "OpenClaw",
    settings: "Configuración",
  },

  inbox: {
    // Inbox screen
    emptyTitle: "Bandeja vacía",
    emptyDescription: "Conéctate con amigos para empezar a compartir sesiones",
    updates: "Actualizaciones",
  },

  common: {
    // Simple string constants
    cancel: "Cancelar",
    authenticate: "Autenticar",
    save: "Guardar",
    saveAs: "Guardar como",
    error: "Error",
    success: "Éxito",
    ok: "OK",
    continue: "Continuar",
    back: "Atrás",
    create: "Crear",
    rename: "Renombrar",
    reset: "Restablecer",
    logout: "Cerrar sesión",
    yes: "Sí",
    no: "No",
    discard: "Descartar",
    version: "Versión",
    copied: "Copiado",
    copy: "Copiar",
    submit: "Enviar",
    scanning: "Escaneando...",
    urlPlaceholder: "https://ejemplo.com",
    home: "Inicio",
    message: "Mensaje",
    files: "Archivos",
    fileViewer: "Visor de archivos",
    loading: "Cargando...",
    retry: "Reintentar",
    delete: "Eliminar",
    optional: "opcional",
  },

  profile: {
    userProfile: "Perfil de usuario",
    details: "Detalles",
    firstName: "Nombre",
    lastName: "Apellido",
    username: "Nombre de usuario",
    status: "Estado",
  },

  status: {
    connected: "conectado",
    connecting: "conectando",
    disconnected: "desconectado",
    error: "error",
    online: "en línea",
    offline: "desconectado",
    lastSeen: ({ time }: { time: string }) => `visto por última vez ${time}`,
    permissionRequired: "permiso requerido",
    needsAttention: "esperando tu respuesta",
    activeNow: "Activo ahora",
    unknown: "desconocido",
  },

  time: {
    justNow: "ahora mismo",
    minutesAgo: ({ count }: { count: number }) =>
      `hace ${count} minuto${count !== 1 ? "s" : ""}`,
    hoursAgo: ({ count }: { count: number }) =>
      `hace ${count} hora${count !== 1 ? "s" : ""}`,
  },

  connect: {
    restoreAccount: "Restaurar cuenta",
    enterSecretKey: "Ingresa tu clave secreta",
    invalidSecretKey: "Clave secreta inválida. Verifica e intenta de nuevo.",
    enterUrlManually: "Ingresar URL manualmente",
  },

  settings: {
    title: "Configuración",
    connectedAccounts: "Cuentas conectadas",
    connectAccount: "Conectar cuenta",
    github: "GitHub",
    machines: "Máquinas",
    features: "Características",
    social: "Social",
    account: "Cuenta",
    accountSubtitle: "Gestiona los detalles de tu cuenta",
    appearance: "Apariencia",
    appearanceSubtitle: "Personaliza como se ve la app",
    voiceAssistant: "Asistente de voz",
    voiceAssistantSubtitle: "Configura las preferencias de voz",
    featuresTitle: "Características",
    featuresSubtitle: "Habilitar o deshabilitar funciones de la aplicación",
    developer: "Desarrollador",
    developerTools: "Herramientas de desarrollador",
    about: "Acerca de",
    aboutFooter:
      "Happy Coder es un cliente móvil para Codex y Claude Code. Todo está cifrado de extremo a extremo y tu cuenta se guarda solo en tu dispositivo. No está afiliado con Anthropic.",
    whatsNew: "Novedades",
    whatsNewSubtitle: "Ve las últimas actualizaciones y mejoras",
    reportIssue: "Reportar un problema",
    privacyPolicy: "Política de privacidad",
    termsOfService: "Términos de servicio",
    eula: "EULA",
    supportUs: "Apóyanos",
    supportUsSubtitlePro: "¡Gracias por su apoyo!",
    supportUsSubtitle: "Apoya el desarrollo del proyecto",
    scanQrCodeToAuthenticate: "Escanea el código QR para autenticarte",
    githubConnected: ({ login }: { login: string }) =>
      `Conectado como @${login}`,
    connectGithubAccount: "Conecta tu cuenta de GitHub",
    claudeAuthSuccess: "Conectado exitosamente con Claude",
    exchangingTokens: "Intercambiando tokens...",
    usage: "Uso",
    usageSubtitle: "Ver tu uso de API y costos",
    profiles: "Perfiles",
    profilesSubtitle:
      "Gestionar perfiles de variables de entorno para sesiones",
    gitHosts: "Hosts Git",
    gitHostsSubtitle: "Configurar proveedores de hosts Git",

    // Dynamic settings messages
    accountConnected: ({ service }: { service: string }) =>
      `Cuenta de ${service} conectada`,
    machineStatus: ({
      name,
      status,
    }: {
      name: string;
      status: "online" | "offline";
    }) => `${name} está ${status === "online" ? "en línea" : "desconectado"}`,
    featureToggled: ({
      feature,
      enabled,
    }: {
      feature: string;
      enabled: boolean;
    }) => `${feature} ${enabled ? "habilitada" : "deshabilitada"}`,
  },

  settingsAppearance: {
    // Appearance settings screen
    theme: "Tema",
    themeDescription: "Elige tu esquema de colores preferido",
    themeOptions: {
      adaptive: "Adaptativo",
      light: "Claro",
      dark: "Oscuro",
    },
    themeDescriptions: {
      adaptive: "Seguir configuración del sistema",
      light: "Usar siempre tema claro",
      dark: "Usar siempre tema oscuro",
    },
    display: "Pantalla",
    displayDescription: "Controla diseño y espaciado",
    inlineToolCalls: "Llamadas a herramientas en línea",
    inlineToolCallsDescription:
      "Mostrar llamadas a herramientas directamente en mensajes de chat",
    expandTodoLists: "Expandir listas de tareas",
    expandTodoListsDescription:
      "Mostrar todas las tareas en lugar de solo cambios",
    expandToolDetails: "Expandir detalles de herramientas",
    expandToolDetailsDescription:
      "Mostrar los detalles de llamadas a herramientas expandidos por defecto",
    showLineNumbersInDiffs: "Mostrar números de línea en diferencias",
    showLineNumbersInDiffsDescription:
      "Mostrar números de línea en diferencias de código",
    showLineNumbersInToolViews:
      "Mostrar números de línea en vistas de herramientas",
    showLineNumbersInToolViewsDescription:
      "Mostrar números de línea en diferencias de vistas de herramientas",
    wrapLinesInDiffs: "Ajustar líneas en diferencias",
    wrapLinesInDiffsDescription:
      "Ajustar líneas largas en lugar de desplazamiento horizontal en vistas de diferencias",
    alwaysShowContextSize: "Mostrar siempre tamaño del contexto",
    alwaysShowContextSizeDescription:
      "Mostrar uso del contexto incluso cuando no esté cerca del límite",
    avatarStyle: "Estilo de avatar",
    avatarStyleDescription: "Elige la apariencia del avatar de sesión",
    avatarOptions: {
      pixelated: "Pixelado",
      gradient: "Gradiente",
      brutalist: "Brutalista",
    },
    showFlavorIcons: "Mostrar íconos de proveedor de IA",
    showFlavorIconsDescription:
      "Mostrar íconos del proveedor de IA en los avatares de sesión",
    compactSessionView: "Vista compacta de sesiones",
    compactSessionViewDescription:
      "Mostrar sesiones activas en un diseño más compacto",
    collapsibleInput: "Entrada plegable",
    collapsibleInputDescription:
      "Colapsar automáticamente el cuadro de entrada cuando una sesión tiene mensajes",
    realtimeSessionSort: "Ordenación de sesiones en tiempo real",
    realtimeSessionSortDescription:
      "Ordenar sesiones por actividad reciente (desactivar para orden estable por fecha de creación)",
  },

  settingsFeatures: {
    // Features settings screen
    experiments: "Experimentos",
    experimentsDescription:
      "Habilitar características experimentales que aún están en desarrollo. Estas características pueden ser inestables o cambiar sin aviso.",
    experimentalFeatures: "Características experimentales",
    experimentalFeaturesEnabled: "Características experimentales habilitadas",
    experimentalFeaturesDisabled: "Usando solo características estables",
    webFeatures: "Características web",
    webFeaturesDescription:
      "Características disponibles solo en la versión web de la aplicación.",
    enterToSend: "Enter para enviar",
    enterToSendEnabled:
      "Presiona Enter para enviar (Shift+Enter para una nueva línea)",
    enterToSendDisabled: "Enter inserta una nueva línea",
    commandPalette: "Paleta de comandos",
    commandPaletteEnabled: "Presione ⌘K para abrir",
    commandPaletteDisabled: "Acceso rápido a comandos deshabilitado",
    markdownCopyV2: "Markdown Copy v2",
    markdownCopyV2Subtitle: "Pulsación larga abre modal de copiado",
    hideInactiveSessions: "Ocultar sesiones inactivas",
    hideInactiveSessionsSubtitle: "Muestra solo los chats activos en tu lista",
    enhancedSessionWizard: "Asistente de sesión mejorado",
    enhancedSessionWizardEnabled: "Lanzador de sesión con perfil activo",
    enhancedSessionWizardDisabled: "Usando el lanzador de sesión estándar",
    showAgentActivity: "Actividad del agente",
    showAgentActivityEnabled: "Mostrar actividad del agente en tiempo real",
    showAgentActivityDisabled: "Detalles de actividad del agente ocultos",
    sttCorrection: "Corrección de transcripción de voz",
    sttCorrectionEnabled: "IA corrige errores de reconocimiento de voz",
    sttCorrectionDisabled:
      "Usando resultado de reconocimiento de voz sin procesar",
    showProjectTab: "Pestaña de proyecto",
    showProjectTabSubtitle:
      "Mostrar la pestaña de proyecto (kanban) en la barra de pestañas",
    webNotifications: "Notificaciones del navegador",
    webNotificationsEnabled:
      "Notificar cuando se completen tareas o se necesite aprobación",
    webNotificationsDisabled: "Sin notificaciones del navegador",
    webNotificationsDenied:
      "Bloqueado por el navegador — habilitar en configuración del sitio",
    webNotificationsPersistent: "Fijar notificaciones",
    webNotificationsPersistentEnabled:
      "Las notificaciones permanecen hasta cerrarlas",
    webNotificationsPersistentDisabled:
      "Las notificaciones se cierran en 5 seg",
  },

  errors: {
    networkError: "Error de conexión",
    serverError: "Error del servidor",
    unknownError: "Error desconocido",
    connectionTimeout: "Se agotó el tiempo de conexión",
    authenticationFailed: "Falló la autenticación",
    permissionDenied: "Permiso denegado",
    fileNotFound: "Archivo no encontrado",
    invalidFormat: "Formato inválido",
    operationFailed: "Operación falló",
    tryAgain: "Intenta de nuevo",
    contactSupport: "Contacta soporte si el problema persiste",
    sessionNotFound: "Sesión no encontrada",
    voiceSessionFailed: "Falló al iniciar sesión de voz",
    voiceServiceUnavailable:
      "El servicio de voz no está disponible temporalmente",
    oauthInitializationFailed: "Falló al inicializar el flujo OAuth",
    tokenStorageFailed: "Falló al almacenar los tokens de autenticación",
    oauthStateMismatch: "Falló la validación de seguridad. Inténtalo de nuevo",
    tokenExchangeFailed: "Falló al intercambiar el código de autorización",
    oauthAuthorizationDenied: "La autorización fue denegada",
    webViewLoadFailed: "Falló al cargar la página de autenticación",
    failedToLoadProfile: "No se pudo cargar el perfil de usuario",
    userNotFound: "Usuario no encontrado",
    sessionDeleted: "La sesión ha sido eliminada",
    sessionDeletedDescription: "Esta sesión ha sido eliminada permanentemente",

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
    }) => `${field} debe estar entre ${min} y ${max}`,
    retryIn: ({ seconds }: { seconds: number }) =>
      `Intenta en ${seconds} ${seconds === 1 ? "segundo" : "segundos"}`,
    errorWithCode: ({
      message,
      code,
    }: {
      message: string;
      code: number | string;
    }) => `${message} (Error ${code})`,
    disconnectServiceFailed: ({ service }: { service: string }) =>
      `Falló al desconectar ${service}`,
    connectServiceFailed: ({ service }: { service: string }) =>
      `No se pudo conectar ${service}. Por favor, inténtalo de nuevo.`,
    failedToLoadFriends: "No se pudo cargar la lista de amigos",
    failedToAcceptRequest: "No se pudo aceptar la solicitud de amistad",
    failedToRejectRequest: "No se pudo rechazar la solicitud de amistad",
    failedToRemoveFriend: "No se pudo eliminar al amigo",
    searchFailed: "La búsqueda falló. Por favor, intenta de nuevo.",
    failedToSendRequest: "No se pudo enviar la solicitud de amistad",
  },

  newSession: {
    // Used by new-session screen and launch flows
    title: "Iniciar nueva sesión",
    noMachinesFound:
      "No se encontraron máquinas. Inicia una sesión de Happy en tu computadora primero.",
    allMachinesOffline: "Todas las máquinas están desconectadas",
    machineDetails: "Ver detalles de la máquina →",
    directoryDoesNotExist: "Directorio no encontrado",
    createDirectoryConfirm: ({ directory }: { directory: string }) =>
      `El directorio ${directory} no existe. ¿Deseas crearlo?`,
    sessionStarted: "Sesión iniciada",
    sessionStartedMessage: "La sesión se ha iniciado correctamente.",
    sessionSpawningFailed:
      "Falló la creación de sesión - no se devolvió ID de sesión.",
    failedToStart:
      "Falló al iniciar sesión. Asegúrate de que el daemon esté ejecutándose en la máquina objetivo.",
    sessionTimeout:
      "El inicio de sesión expiró. La máquina puede ser lenta o el daemon puede no estar respondiendo.",
    notConnectedToServer:
      "No conectado al servidor. Verifica tu conexión a internet.",
    startingSession: "Iniciando sesión...",
    startNewSessionInFolder: "Nueva sesión aquí",
    noMachineSelected:
      "Por favor, selecciona una máquina para iniciar la sesión",
    noPathSelected:
      "Por favor, selecciona un directorio para iniciar la sesión",
    profileConfigEmpty: ({ name }: { name: string }) =>
      `El perfil "${name}" no tiene variables de entorno configuradas. Edita el perfil y añade las variables necesarias.`,
    sessionType: {
      title: "Tipo de sesión",
      simple: "Simple",
      worktree: "Worktree",
      comingSoon: "Próximamente",
    },
    worktree: {
      creating: ({ name }: { name: string }) => `Creando worktree '${name}'...`,
      notGitRepo: "Los worktrees requieren un repositorio git",
      failed: ({ error }: { error: string }) =>
        `Error al crear worktree: ${error}`,
      success: "Worktree creado exitosamente",
    },
  },

  sessionHistory: {
    // Used by session history screen
    title: "Historial de sesiones",
    empty: "No se encontraron sesiones",
    today: "Hoy",
    yesterday: "Ayer",
    daysAgo: ({ count }: { count: number }) =>
      `hace ${count} ${count === 1 ? "día" : "días"}`,
    viewAll: "Ver todas las sesiones",
  },

  session: {
    inputPlaceholder: "Escriba un mensaje ...",
    startedByDaemon: "daemon",
    sentImage: "Imagen enviada",
    sentImages: ({ count }: { count: number }) => `${count} imágenes enviadas`,
    imageAttached: "Imagen adjunta",
    imageLabel: ({ index }: { index: number }) => `Imagen ${index}`,
    imageUploadFailed: ({ failed, total }: { failed: number; total: number }) =>
      `${failed} de ${total} imágenes no se pudieron subir`,
    couldNotAttachFile: "No se pudo adjuntar este archivo",
    imageLoadFailed: "Error al cargar la imagen",
    bookmarkOption: "Marcador",
    compactionSummaryTitle: "Resumen del contexto",
    compactionSummaryEmpty:
      "Aún no hay resumen de compresión. Aparecerá aquí después de que se comprima el contexto.",
    compactionSummaryDisconnected:
      "La sesión no está conectada. El resumen solo está disponible cuando el CLI está en línea.",
    messageQueued: "En cola",
  },

  bookmark: {
    sourceAI: "AI",
    sourceUser: "Yo",
  },

  commandPalette: {
    placeholder: "Escriba un comando o busque...",
  },

  server: {
    // Used by Server Configuration screen (app/(app)/server.tsx)
    serverConfiguration: "Configuración del servidor",
    enterServerUrl: "Ingresa una URL de servidor",
    notValidHappyServer: "No es un servidor Happy válido",
    changeServer: "Cambiar servidor",
    continueWithServer: "¿Continuar con este servidor?",
    resetToDefault: "Restablecer por defecto",
    resetServerDefault: "¿Restablecer servidor por defecto?",
    validating: "Validando...",
    validatingServer: "Validando servidor...",
    serverReturnedError: "El servidor devolvió un error",
    failedToConnectToServer: "Falló al conectar con el servidor",
    currentlyUsingCustomServer: "Actualmente usando servidor personalizado",
    customServerUrlLabel: "URL del servidor personalizado",
    advancedFeatureFooter:
      "Esta es una característica avanzada. Solo cambia el servidor si sabes lo que haces. Necesitarás cerrar sesión e iniciarla nuevamente después de cambiar servidores.",
  },

  worktreeInfo: {
    title: "Worktree",
    branch: "Rama",
    parentBranch: "Rama principal",
    status: "Estado",
    errorLabel: "Error",
    state: {
      creating: "Creando",
      active: "Activo",
      merging: "Fusionando",
      merged: "Fusionado",
      cleaning: "Limpiando",
      cleaned: "Limpiado",
      error: "Error",
    },
    merge: {
      title: "Estrategia de fusión",
      preview: "Vista previa de fusión",
      description: ({ parentBranch }: { parentBranch: string }) =>
        `¿Cómo quieres fusionar en ${parentBranch}?`,
      action: "Fusionar",
      createPr: "Crear Pull Request",
      directMerge: "Fusión directa",
      openPr: "Abrir PR",
      keepBranch: "Mantener rama",
      deleteBranch: "Eliminar rama",
      filesChanged: "archivo(s) cambiado(s)",
      commits: ({ count }: { count: number }) => `Commits (${count})`,
      noCommits: "No hay commits para fusionar",
      prSuccess: ({ url }: { url: string }) => `PR creado: ${url}`,
      directSuccess: "Fusionado con éxito",
      directSuccessDeleteBranch: ({ branchName }: { branchName: string }) =>
        `Fusionado con éxito. ¿Eliminar rama '${branchName}'?`,
      failed: ({ error }: { error: string }) => `Error al fusionar: ${error}`,
    },
    cleanup: {
      title: "Eliminar Worktree",
      action: "Eliminar Worktree",
      confirm: "¿Eliminar este Worktree y su rama?",
      notMerged:
        "Este Worktree aún no se ha fusionado. Eliminarlo puede causar pérdida de cambios. ¿Continuar?",
      remove: "Eliminar",
      success: "Worktree eliminado",
      successAndArchived: "Worktree eliminado y sesión archivada",
      failed: ({ error }: { error: string }) =>
        `Error al eliminar Worktree: ${error}`,
    },
  },

  sessionInfo: {
    // Used by Session Info screen (app/(app)/session/[id]/info.tsx)
    killSession: "Terminar sesión",
    killSessionConfirm: "¿Seguro que quieres terminar esta sesión?",
    archiveSession: "Archivar sesión",
    archiveSessionConfirm: "¿Seguro que quieres archivar esta sesión?",
    happySessionIdCopied: "ID de sesión de Happy copiado al portapapeles",
    failedToCopySessionId: "Falló al copiar ID de sesión de Happy",
    happySessionId: "ID de sesión de Happy",
    claudeCodeSessionId: "ID de sesión de Claude Code",
    claudeCodeSessionIdCopied:
      "ID de sesión de Claude Code copiado al portapapeles",
    profile: "Perfil de IA",
    aiProvider: "Proveedor de IA",
    failedToCopyClaudeCodeSessionId:
      "Falló al copiar ID de sesión de Claude Code",
    metadataCopied: "Metadatos copiados al portapapeles",
    failedToCopyMetadata: "Falló al copiar metadatos",
    failedToKillSession: "Falló al terminar sesión",
    failedToArchiveSession: "Falló al archivar sesión",
    connectionStatus: "Estado de conexión",
    created: "Creado",
    lastUpdated: "Última actualización",
    sequence: "Secuencia",
    quickActions: "Acciones rápidas",
    viewMachine: "Ver máquina",
    viewMachineSubtitle: "Ver detalles de máquina y sesiones",
    killSessionSubtitle: "Terminar inmediatamente la sesión",
    archiveSessionSubtitle: "Archivar esta sesión y detenerla",
    metadata: "Metadatos",
    host: "Host",
    path: "Ruta",
    operatingSystem: "Sistema operativo",
    processId: "ID del proceso",
    startedBy: "Iniciado por",
    startedByDaemon: "Demonio",
    startedByTerminal: "Terminal",
    happyHome: "Directorio de Happy",
    copyMetadata: "Copiar metadatos",
    agentState: "Estado del agente",
    controlledByUser: "Controlado por el usuario",
    pendingRequests: "Solicitudes pendientes",
    activity: "Actividad",
    thinking: "Pensando",
    thinkingSince: "Pensando desde",
    cliVersion: "Versión del CLI",
    cliVersionOutdated: "Actualización de CLI requerida",
    cliVersionOutdatedMessage: ({
      currentVersion,
      requiredVersion,
    }: {
      currentVersion: string;
      requiredVersion: string;
    }) =>
      `Versión ${currentVersion} instalada. Actualice a ${requiredVersion} o posterior`,
    updateCliInstructions:
      "Por favor ejecute npm install -g happy-coder@latest",
    resumeSession: "Reanudar sesión",
    resumeSessionSubtitle:
      "Reanudar esta sesión con el contexto completo en la misma máquina",
    deleteSession: "Eliminar sesión",
    deleteSessionSubtitle: "Eliminar permanentemente esta sesión",
    deleteSessionConfirm: "¿Eliminar sesión permanentemente?",
    deleteSessionWarning:
      "Esta acción no se puede deshacer. Todos los mensajes y datos asociados con esta sesión se eliminarán permanentemente.",
    deleteSessionWorktreeWarning: ({ branchName }: { branchName: string }) =>
      `Esta sesión tiene un worktree branch '${branchName}' con cambios sin fusionar. Al eliminarla, también se eliminará el branch y sus cambios de forma permanente.`,
    deleteSessionWorktreePrWarning: ({ branchName }: { branchName: string }) =>
      `Esta sesión tiene un worktree branch '${branchName}' con un PR abierto. El branch se conservará para el PR, pero los datos de la sesión se eliminarán permanentemente.`,
    failedToDeleteSession: "Error al eliminar la sesión",
    sessionDeleted: "Sesión eliminada exitosamente",
    deleteAllArchivedSessions: "Eliminar todas las sesiones archivadas",
    deleteAllArchivedWarning: ({ count }: { count: number }) =>
      `Esto eliminará permanentemente ${count} sesión(es) archivada(s) y todos sus mensajes. Esta acción no se puede deshacer.`,
  },

  components: {
    emptyMainScreen: {
      // Used by EmptyMainScreen component
      readyToCode: "¿Listo para programar?",
      installCli: "Instale el Happy CLI",
      runIt: "Ejecútelo",
      scanQrCode: "Escanee el código QR",
      openCamera: "Abrir cámara",
    },
  },

  agentInput: {
    permissionMode: {
      title: "MODO DE PERMISOS",
      default: "Por defecto",
      acceptEdits: "Aceptar ediciones",
      plan: "Modo de planificación",
      dontAsk: "No Preguntar",
      bypassPermissions: "Modo Yolo",
      badgeAcceptAllEdits: "Aceptar todas las ediciones",
      badgeBypassAllPermissions: "Omitir todos los permisos",
      badgePlanMode: "Modo de planificación",
      badgeDontAsk: "No Preguntar",
    },
    agent: {
      claude: "Claude",
      codex: "Codex",
      gemini: "Gemini",
    },
    model: {
      title: "MODELO",
      configureInCli: "Configurar modelos en la configuración del CLI",
    },
    codexPermissionMode: {
      title: "MODO DE PERMISOS CODEX",
      default: "Configuración del CLI",
      readOnly: "Read Only Mode",
      safeYolo: "Safe YOLO",
      yolo: "YOLO",
      badgeReadOnly: "Read Only Mode",
      badgeSafeYolo: "Safe YOLO",
      badgeYolo: "YOLO",
    },
    codexModel: {
      title: "MODELO CODEX",
      gpt53Codex: "GPT-5.3 Codex",
      gpt53CodexSpark: "GPT-5.3 Codex Spark",
      gpt52Codex: "GPT-5.2 Codex",
      gpt51CodexMax: "GPT-5.1 Codex Max",
      gpt51Codex: "GPT-5.1 Codex",
      gpt5Codex: "GPT-5 Codex",
    },
    geminiPermissionMode: {
      title: "MODO DE PERMISOS GEMINI",
      default: "Por defecto",
      readOnly: "Solo lectura",
      safeYolo: "YOLO seguro",
      yolo: "YOLO",
      badgeReadOnly: "Solo lectura",
      badgeSafeYolo: "YOLO seguro",
      badgeYolo: "YOLO",
    },
    context: {
      remaining: ({ percent }: { percent: number }) => `${percent}% restante`,
      breakdownTitle: "Desglose de tokens",
      breakdownMessage:
        "↓ Lectura de caché – Tokens reutilizados de la caché de contexto anterior. Reduce el costo significativamente.\n\nin Entrada – Nuevos tokens enviados en este turno (tu mensaje + resultados de herramientas).\n\nout Salida – Tokens generados por el modelo en este turno.\n\n↑ Escritura de caché – Tokens escritos en caché en este turno, reutilizables como lectura de caché en el siguiente.",
    },
    suggestion: {
      fileLabel: "ARCHIVO",
      folderLabel: "CARPETA",
    },
    effort: {
      title: "NIVEL DE ESFUERZO",
      low: "Bajo",
      lowDesc: "Respuestas rápidas, menos razonamiento",
      medium: "Medio",
      mediumDesc: "Profundidad de razonamiento por defecto",
      high: "Alto",
      highDesc: "Razonamiento más profundo",
      max: "Máximo",
      maxDesc: "Pensamiento extendido, mejor calidad",
    },
    thinking: {
      title: "PENSAMIENTO",
      adaptive: "Adaptativo",
      adaptiveDesc: "El modelo decide cuándo pensar",
      enabled: "Activado",
      enabledDesc: "Siempre muestra el razonamiento",
      disabled: "Desactivado",
      disabledDesc: "Sin pensamiento extendido",
    },
    noMachinesAvailable: "Sin máquinas",
    continue: "Continuar — Claude alcanzó el límite de turnos",
  },

  machineLauncher: {
    showLess: "Mostrar menos",
    showAll: ({ count }: { count: number }) => `Mostrar todos (${count} rutas)`,
    enterCustomPath: "Ingresar ruta personalizada",
    offlineUnableToSpawn: "No se puede crear nueva sesión, desconectado",
  },

  sidebar: {
    sessionsTitle: "Happy",
  },

  toolView: {
    input: "Entrada",
    output: "Salida",
  },

  diff: {
    toolbar: {
      unified: "Unificado",
      split: "Dividido",
      expand: "Expandir",
      collapse: "Contraer",
      copyDiff: "Copiar",
      copied: "Copiado!",
    },
  },

  codeReview: {
    accept: "Aceptar",
    reject: "Rechazar",
    accepted: "Aceptado",
    rejected: "Rechazado",
    rejectConfirmTitle: "Rechazar cambio",
    rejectConfirmMessage: ({ filePath }: { filePath: string }) =>
      `Pedir a Claude que revierta los cambios en ${filePath}?`,
    rejectConfirm: "Rechazar y revertir",
  },

  tools: {
    fullView: {
      description: "Descripción",
      inputParams: "Parámetros de entrada",
      output: "Salida",
      error: "Error",
      completed: "Herramienta completada exitosamente",
      noOutput: "No se produjo salida",
      running: "La herramienta está ejecutándose...",
      rawJsonDevMode: "JSON crudo (modo desarrollador)",
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
      initializing: "Inicializando agente...",
      moreTools: ({ count }: { count: number }) =>
        `+${count} más ${plural({ count, singular: "herramienta", plural: "herramientas" })}`,
      collapseTools: "Contraer",
      agentThinking: "Pensando...",
      subagentRunning: ({ type }: { type: string }) => `Ejecutando ${type}...`,
    },
    multiEdit: {
      editNumber: ({ index, total }: { index: number; total: number }) =>
        `Edición ${index} de ${total}`,
      replaceAll: "Reemplazar todo",
    },
    contextMenu: {
      copyPath: "Copiar ruta del archivo",
      copyCommand: "Copiar comando",
      copyOutput: "Copiar salida",
    },
    names: {
      task: "Tarea",
      terminal: "Terminal",
      searchFiles: "Buscar archivos",
      search: "Buscar",
      searchContent: "Buscar contenido",
      listFiles: "Listar archivos",
      planProposal: "Propuesta de plan",
      readFile: "Leer archivo",
      editFile: "Editar archivo",
      writeFile: "Escribir archivo",
      fetchUrl: "Obtener URL",
      readNotebook: "Leer cuaderno",
      editNotebook: "Editar cuaderno",
      todoList: "Lista de tareas",
      webSearch: "Búsqueda web",
      reasoning: "Razonamiento",
      applyChanges: "Actualizar archivo",
      viewDiff: "Cambios del archivo actual",
      question: "Pregunta",
    },
    desc: {
      terminalCmd: ({ cmd }: { cmd: string }) => `Terminal(cmd: ${cmd})`,
      searchPattern: ({ pattern }: { pattern: string }) =>
        `Buscar(patrón: ${pattern})`,
      searchPath: ({ basename }: { basename: string }) =>
        `Buscar(ruta: ${basename})`,
      fetchUrlHost: ({ host }: { host: string }) => `Obtener URL(url: ${host})`,
      editNotebookMode: ({ path, mode }: { path: string; mode: string }) =>
        `Editar cuaderno(archivo: ${path}, modo: ${mode})`,
      todoListCount: ({ count }: { count: number }) =>
        `Lista de tareas(cantidad: ${count})`,
      webSearchQuery: ({ query }: { query: string }) =>
        `Búsqueda web(consulta: ${query})`,
      grepPattern: ({ pattern }: { pattern: string }) =>
        `grep(patrón: ${pattern})`,
      multiEditEdits: ({ path, count }: { path: string; count: number }) =>
        `${path} (${count} ediciones)`,
      readingFile: ({ file }: { file: string }) => `Leyendo ${file}`,
      writingFile: ({ file }: { file: string }) => `Escribiendo ${file}`,
      modifyingFile: ({ file }: { file: string }) => `Modificando ${file}`,
      modifyingFiles: ({ count }: { count: number }) =>
        `Modificando ${count} archivos`,
      modifyingMultipleFiles: ({
        file,
        count,
      }: {
        file: string;
        count: number;
      }) => `${file} y ${count} más`,
      showingDiff: "Mostrando cambios",
    },
    askUserQuestion: {
      submit: "Enviar respuesta",
      multipleQuestions: ({ count }: { count: number }) =>
        `${count} ${plural({ count, singular: "pregunta", plural: "preguntas" })}`,
      other: "Otro",
      otherDescription: "Escribe tu propia respuesta",
      otherPlaceholder: "Escribe tu respuesta...",
      recommended: "Recomendado",
    },
  },

  files: {
    searchPlaceholder: "Buscar archivos...",
    detachedHead: "HEAD separado",
    summary: ({ staged, unstaged }: { staged: number; unstaged: number }) =>
      `${staged} preparados • ${unstaged} sin preparar`,
    notRepo: "No es un repositorio git",
    notUnderGit: "Este directorio no está bajo control de versiones git",
    searching: "Buscando archivos...",
    noFilesFound: "No se encontraron archivos",
    noFilesInProject: "No hay archivos en el proyecto",
    tryDifferentTerm: "Intente un término de búsqueda diferente",
    searchResults: ({ count }: { count: number }) =>
      `Resultados de búsqueda (${count})`,
    projectRoot: "Raíz del proyecto",
    stagedChanges: ({ count }: { count: number }) =>
      `Cambios preparados (${count})`,
    unstagedChanges: ({ count }: { count: number }) =>
      `Cambios sin preparar (${count})`,
    // File viewer strings
    loadingFile: ({ fileName }: { fileName: string }) =>
      `Cargando ${fileName}...`,
    binaryFile: "Archivo binario",
    cannotDisplayBinary: "No se puede mostrar el contenido del archivo binario",
    diff: "Diferencias",
    file: "Archivo",
    fileEmpty: "El archivo está vacío",
    noChanges: "No hay cambios que mostrar",
    // Browse mode strings
    browseTab: "Explorar",
    changesTab: "Cambios",
    directory: "Directorio",
    emptyDirectory: "Este directorio está vacío",
    submodule: "Submódulo",
    submoduleNotInitialized: "No inicializado",
    childReposSummary: ({ count }) =>
      `${count} ${count === 1 ? "repositorio" : "repositorios"} Git`,
  },

  settingsVoice: {
    // Voice settings screen
    languageTitle: "Idioma",
    languageDescription:
      "Elige tu idioma preferido para las interacciones con el asistente de voz. Esta configuración se sincroniza en todos tus dispositivos.",
    preferredLanguage: "Idioma preferido",
    preferredLanguageSubtitle:
      "Idioma usado para respuestas del asistente de voz",
    language: {
      searchPlaceholder: "Buscar idiomas...",
      title: "Idiomas",
      footer: ({ count }: { count: number }) =>
        `${count} ${plural({ count, singular: "idioma", plural: "idiomas" })} disponibles`,
      autoDetect: "Detectar automáticamente",
    },
    // TTS provider settings
    ttsProviderTitle: "Proveedor TTS",
    ttsProviderDescription:
      "Elige entre Edge TTS gratuito o ElevenLabs TTS de pago con tu propia clave API.",
    ttsProviderEdge: "Edge TTS (Gratis)",
    ttsProviderEdgeSubtitle: "Microsoft Edge TTS, gratis e ilimitado",
    ttsProviderElevenLabs: "ElevenLabs (De pago)",
    ttsProviderElevenLabsSubtitle: "Alta calidad, requiere tu propia clave API",
    elevenLabsApiKey: "Clave API",
    elevenLabsApiKeyPlaceholder: "Introduce tu clave API de ElevenLabs",
    elevenLabsVoiceId: "Voice ID",
    elevenLabsVoiceIdPlaceholder: "Predeterminado: Rachel",
    elevenLabsVoiceIdSubtitle: "Deja vacío para la voz predeterminada (Rachel)",
  },

  voiceStatusBar: {
    connecting: "Conectando...",
    connectionError: "Error de conexión",
    listening: "Escuchando...",
    processing: "Procesando...",
    speaking: "Hablando",
    voiceAssistantActive: "Asistente de voz activo",
    voiceAssistant: "Asistente de voz",
    tapToEnd: "Toca para finalizar",
    permissionRequested: ({ toolName }: { toolName: string }) =>
      `Permiso solicitado para ${toolName}`,
    done: "Listo.",
  },

  settingsAccount: {
    // Account settings screen
    accountInformation: "Información de la cuenta",
    status: "Estado",
    statusActive: "Activo",
    statusNotAuthenticated: "No autenticado",
    anonymousId: "ID anónimo",
    publicId: "ID público",
    notAvailable: "No disponible",
    linkNewDevice: "Vincular nuevo dispositivo",
    linkNewDeviceSubtitle: "Escanear código QR para vincular dispositivo",
    profile: "Perfil",
    name: "Nombre",
    github: "GitHub",
    tapToDisconnect: "Toque para desconectar",
    server: "Servidor",
    backup: "Copia de seguridad",
    backupDescription:
      "Tu clave secreta es la única forma de recuperar tu cuenta. Guárdala en un lugar seguro como un administrador de contraseñas.",
    secretKey: "Clave secreta",
    tapToReveal: "Toca para revelar",
    tapToHide: "Toca para ocultar",
    secretKeyLabel: "CLAVE SECRETA (TOCA PARA COPIAR)",
    secretKeyCopied:
      "Clave secreta copiada al portapapeles. ¡Guárdala en un lugar seguro!",
    secretKeyCopyFailed: "Falló al copiar la clave secreta",
    privacy: "Privacidad",
    privacyDescription:
      "Ayude a mejorar la aplicación compartiendo datos de uso anónimos. No se recopila información personal.",
    analytics: "Analíticas",
    analyticsDisabled: "No se comparten datos",
    analyticsEnabled: "Se comparten datos de uso anónimos",
    dangerZone: "Zona peligrosa",
    logout: "Cerrar sesión",
    logoutSubtitle: "Cerrar sesión y limpiar datos locales",
    logoutConfirm:
      "¿Seguro que quieres cerrar sesión? ¡Asegúrate de haber guardado tu clave secreta!",
  },

  settingsLanguage: {
    // Language settings screen
    title: "Idioma",
    description:
      "Elige tu idioma preferido para la interfaz de la aplicación. Esto se sincronizará en todos tus dispositivos.",
    currentLanguage: "Idioma actual",
    automatic: "Automático",
    automaticSubtitle: "Detectar desde configuración del dispositivo",
    needsRestart: "Idioma cambiado",
    needsRestartMessage:
      "La aplicación necesita reiniciarse para aplicar la nueva configuración de idioma.",
    restartNow: "Reiniciar ahora",
  },

  connectButton: {
    authenticate: "Autenticar terminal",
    authenticateWithUrlPaste: "Autenticar terminal con pegado de URL",
    pasteAuthUrl: "Pega la URL de autenticación de tu terminal",
  },

  updateBanner: {
    updateAvailable: "Actualización disponible",
    pressToApply: "Presione para aplicar la actualización",
    whatsNew: "Novedades",
    seeLatest: "Ver las últimas actualizaciones y mejoras",
    nativeUpdateAvailable: "Actualización de la aplicación disponible",
    tapToUpdateAppStore: "Toque para actualizar en App Store",
    tapToUpdatePlayStore: "Toque para actualizar en Play Store",
  },

  changelog: {
    // Used by the changelog screen
    version: ({ version }: { version: string }) => `Versión ${version}`,
    noEntriesAvailable: "No hay entradas de registro de cambios disponibles.",
  },

  terminal: {
    // Used by terminal connection screens
    webBrowserRequired: "Se requiere navegador web",
    webBrowserRequiredDescription:
      "Los enlaces de conexión de terminal solo pueden abrirse en un navegador web por razones de seguridad. Usa el escáner de código QR o abre este enlace en una computadora.",
    processingConnection: "Procesando conexión...",
    invalidConnectionLink: "Enlace de conexión inválido",
    invalidConnectionLinkDescription:
      "El enlace de conexión falta o es inválido. Verifica la URL e intenta nuevamente.",
    connectTerminal: "Conectar terminal",
    terminalRequestDescription:
      "Un terminal está solicitando conectarse a tu cuenta de Happy Coder. Esto permitirá al terminal enviar y recibir mensajes de forma segura.",
    connectionDetails: "Detalles de conexión",
    publicKey: "Clave pública",
    encryption: "Cifrado",
    endToEndEncrypted: "Cifrado de extremo a extremo",
    acceptConnection: "Aceptar conexión",
    connecting: "Conectando...",
    reject: "Rechazar",
    security: "Seguridad",
    securityFooter:
      "Este enlace de conexión fue procesado de forma segura en tu navegador y nunca fue enviado a ningún servidor. Tus datos privados permanecerán seguros y solo tú puedes descifrar los mensajes.",
    securityFooterDevice:
      "Esta conexión fue procesada de forma segura en tu dispositivo y nunca fue enviada a ningún servidor. Tus datos privados permanecerán seguros y solo tú puedes descifrar los mensajes.",
    clientSideProcessing: "Procesamiento del lado del cliente",
    linkProcessedLocally: "Enlace procesado localmente en el navegador",
    linkProcessedOnDevice: "Enlace procesado localmente en el dispositivo",
  },

  modals: {
    // Used across connect flows and settings
    authenticateTerminal: "Autenticar terminal",
    pasteUrlFromTerminal: "Pega la URL de autenticación de tu terminal",
    deviceLinkedSuccessfully: "Dispositivo vinculado exitosamente",
    terminalConnectedSuccessfully: "Terminal conectado exitosamente",
    invalidAuthUrl: "URL de autenticación inválida",
    developerMode: "Modo desarrollador",
    developerModeEnabled: "Modo desarrollador habilitado",
    developerModeDisabled: "Modo desarrollador deshabilitado",
    disconnectGithub: "Desconectar GitHub",
    disconnectGithubConfirm:
      "¿Seguro que quieres desconectar tu cuenta de GitHub?",
    disconnectService: ({ service }: { service: string }) =>
      `Desconectar ${service}`,
    disconnectServiceConfirm: ({ service }: { service: string }) =>
      `¿Seguro que quieres desconectar ${service} de tu cuenta?`,
    disconnect: "Desconectar",
    failedToConnectTerminal: "Falló al conectar terminal",
    cameraPermissionsRequiredToConnectTerminal:
      "Se requieren permisos de cámara para conectar terminal",
    failedToLinkDevice: "Falló al vincular dispositivo",
    cameraPermissionsRequiredToScanQr:
      "Se requieren permisos de cámara para escanear códigos QR",
  },

  navigation: {
    // Navigation titles and screen headers
    connectTerminal: "Conectar terminal",
    linkNewDevice: "Vincular nuevo dispositivo",
    restoreWithSecretKey: "Restaurar con clave secreta",
    whatsNew: "Novedades",
    friends: "Amigos",
  },

  welcome: {
    // Main welcome screen for unauthenticated users
    title: "Cliente móvil de Codex y Claude Code",
    subtitle:
      "Cifrado de extremo a extremo y tu cuenta se guarda solo en tu dispositivo.",
    createAccount: "Crear cuenta",
    linkOrRestoreAccount: "Vincular o restaurar cuenta",
    loginWithMobileApp: "Iniciar sesión con aplicación móvil",
    loginWithSecretKey: "Iniciar sesión con clave secreta",
  },

  review: {
    // Used by utils/requestReview.ts
    enjoyingApp: "¿Disfrutando la aplicación?",
    feedbackPrompt: "¡Nos encantaría escuchar tus comentarios!",
    yesILoveIt: "¡Sí, me encanta!",
    notReally: "No realmente",
  },

  items: {
    // Used by Item component for copy toast
    copiedToClipboard: ({ label }: { label: string }) =>
      `${label} copiado al portapapeles`,
  },

  machine: {
    offlineUnableToSpawn:
      "El lanzador está deshabilitado mientras la máquina está desconectada",
    offlineHelp:
      "• Asegúrate de que tu computadora esté en línea\n• Ejecuta `happy daemon status` para diagnosticar\n• ¿Estás usando la última versión del CLI? Actualiza con `npm install -g happy-coder@latest`",
    launchNewSessionInDirectory: "Iniciar nueva sesión en directorio",
    daemon: "Daemon",
    status: "Estado",
    stopDaemon: "Detener daemon",
    lastKnownPid: "Último PID conocido",
    lastKnownHttpPort: "Último puerto HTTP conocido",
    startedAt: "Iniciado en",
    cliVersion: "Versión del CLI",
    daemonStateVersion: "Versión del estado del daemon",
    activeSessions: ({ count }: { count: number }) =>
      `Sesiones activas (${count})`,
    machineGroup: "Máquina",
    host: "Host",
    machineId: "ID de máquina",
    username: "Nombre de usuario",
    homeDirectory: "Directorio principal",
    platform: "Plataforma",
    architecture: "Arquitectura",
    lastSeen: "Visto por última vez",
    never: "Nunca",
    metadataVersion: "Versión de metadatos",
    untitledSession: "Sesión sin título",
    back: "Atrás",
  },

  message: {
    switchedToMode: ({ mode }: { mode: string }) => `Cambiado al modo ${mode}`,
    unknownEvent: "Evento desconocido",
    usageLimitUntil: ({ time }: { time: string }) =>
      `Límite de uso alcanzado hasta ${time}`,
    usageLimitReached:
      "Límite de uso alcanzado. Por favor, espera e intenta de nuevo.",
    unknownTime: "tiempo desconocido",
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
      count === 1 ? `${count} turno` : `${count} turnos`,
    thinkingMarker: "Pensando",
  },

  codex: {
    // Codex permission dialog buttons
    permissions: {
      yesForSession: "Sí, y no preguntar por esta sesión",
      stopAndExplain: "Detener, y explicar qué hacer",
    },
  },

  claude: {
    // Claude permission dialog buttons
    permissions: {
      yesAllowAllEdits: "Sí, permitir todas las ediciones durante esta sesión",
      yesForTool: "Sí, no volver a preguntar para esta herramienta",
      noTellClaude: "No, proporcionar comentarios",
    },
  },

  plan: {
    approve: "Aprobar plan",
    approveAutoEdits: "Aprobar y auto-aprobar ediciones",
    rejectWithFeedback: "Rechazar con comentarios",
    rejectTitle: "¿Por qué rechazas este plan?",
    rejectMessage: "Tu retroalimentación ayuda a Claude a mejorar el plan",
    rejectPlaceholder: "Describe qué debería cambiar...",
  },

  textSelection: {
    // Text selection screen
    selectText: "Seleccionar rango de texto",
    title: "Seleccionar texto",
    noTextProvided: "No se proporcionó texto",
    textNotFound: "Texto no encontrado o expirado",
    textCopied: "Texto copiado al portapapeles",
    failedToCopy: "Error al copiar el texto al portapapeles",
    noTextToCopy: "No hay texto disponible para copiar",
  },

  markdown: {
    // Markdown copy functionality
    codeCopied: "Código copiado",
    copyFailed: "Error al copiar",
    mermaidCopied: "Código fuente de Mermaid copiado",
    mermaidRenderFailed: "Error al renderizar el diagrama mermaid",
  },

  artifacts: {
    // Artifacts feature
    title: "Artefactos",
    countSingular: "1 artefacto",
    countPlural: ({ count }: { count: number }) => `${count} artefactos`,
    empty: "No hay artefactos aún",
    emptyDescription: "Crea tu primer artefacto para comenzar",
    new: "Nuevo artefacto",
    edit: "Editar artefacto",
    delete: "Eliminar",
    updateError:
      "No se pudo actualizar el artefacto. Por favor, intenta de nuevo.",
    notFound: "Artefacto no encontrado",
    discardChanges: "¿Descartar cambios?",
    discardChangesDescription:
      "Tienes cambios sin guardar. ¿Estás seguro de que quieres descartarlos?",
    deleteConfirm: "¿Eliminar artefacto?",
    deleteConfirmDescription: "Esta acción no se puede deshacer",
    titleLabel: "TÍTULO",
    titlePlaceholder: "Ingresa un título para tu artefacto",
    bodyLabel: "CONTENIDO",
    bodyPlaceholder: "Escribe tu contenido aquí...",
    emptyFieldsError: "Por favor, ingresa un título o contenido",
    createError: "No se pudo crear el artefacto. Por favor, intenta de nuevo.",
    save: "Guardar",
    saving: "Guardando...",
    loading: "Cargando artefactos...",
    error: "Error al cargar el artefacto",
  },

  friends: {
    // Friends feature
    title: "Amigos",
    manageFriends: "Administra tus amigos y conexiones",
    searchTitle: "Buscar amigos",
    pendingRequests: "Solicitudes de amistad",
    myFriends: "Mis amigos",
    noFriendsYet: "Aún no tienes amigos",
    findFriends: "Buscar amigos",
    remove: "Eliminar",
    pendingRequest: "Pendiente",
    sentOn: ({ date }: { date: string }) => `Enviado el ${date}`,
    accept: "Aceptar",
    reject: "Rechazar",
    addFriend: "Agregar amigo",
    alreadyFriends: "Ya son amigos",
    requestPending: "Solicitud pendiente",
    searchInstructions: "Ingresa un nombre de usuario para buscar amigos",
    searchPlaceholder: "Ingresa nombre de usuario...",
    searching: "Buscando...",
    userNotFound: "Usuario no encontrado",
    noUserFound: "No se encontró ningún usuario con ese nombre",
    checkUsername:
      "Por favor, verifica el nombre de usuario e intenta de nuevo",
    howToFind: "Cómo encontrar amigos",
    findInstructions:
      "Busca amigos por su nombre de usuario. Tanto tú como tu amigo deben tener GitHub conectado para enviar solicitudes de amistad.",
    requestSent: "¡Solicitud de amistad enviada!",
    requestAccepted: "¡Solicitud de amistad aceptada!",
    requestRejected: "Solicitud de amistad rechazada",
    friendRemoved: "Amigo eliminado",
    confirmRemove: "Eliminar amigo",
    confirmRemoveMessage: "¿Estás seguro de que quieres eliminar a este amigo?",
    cannotAddYourself: "No puedes enviarte una solicitud de amistad a ti mismo",
    bothMustHaveGithub:
      "Ambos usuarios deben tener GitHub conectado para ser amigos",
    status: {
      none: "No conectado",
      requested: "Solicitud enviada",
      pending: "Solicitud pendiente",
      friend: "Amigos",
      rejected: "Rechazada",
    },
    acceptRequest: "Aceptar solicitud",
    removeFriend: "Eliminar de amigos",
    removeFriendConfirm: ({ name }: { name: string }) =>
      `¿Estás seguro de que quieres eliminar a ${name} de tus amigos?`,
    requestSentDescription: ({ name }: { name: string }) =>
      `Tu solicitud de amistad ha sido enviada a ${name}`,
    requestFriendship: "Solicitar amistad",
    cancelRequest: "Cancelar solicitud de amistad",
    cancelRequestConfirm: ({ name }: { name: string }) =>
      `¿Cancelar tu solicitud de amistad a ${name}?`,
    denyRequest: "Rechazar solicitud",
    nowFriendsWith: ({ name }: { name: string }) =>
      `Ahora eres amigo de ${name}`,
  },

  usage: {
    // Usage panel strings
    today: "Hoy",
    last7Days: "Últimos 7 días",
    last30Days: "Últimos 30 días",
    totalTokens: "Tokens totales",
    totalCost: "Costo total",
    tokens: "Tokens",
    cost: "Costo",
    usageOverTime: "Uso a lo largo del tiempo",
    byModel: "Por modelo",
    byTokenType: "Por tipo de token",
    noData: "No hay datos de uso disponibles",
  },

  feed: {
    // Feed notifications for friend requests and acceptances
    friendRequestFrom: ({ name }: { name: string }) =>
      `${name} te envió una solicitud de amistad`,
    friendRequestGeneric: "Nueva solicitud de amistad",
    friendAccepted: ({ name }: { name: string }) =>
      `Ahora eres amigo de ${name}`,
    friendAcceptedGeneric: "Solicitud de amistad aceptada",
  },

  profiles: {
    // Profile management feature
    title: "Perfiles",
    subtitle: "Gestionar perfiles de variables de entorno para sesiones",
    noProfile: "Sin Perfil",
    noProfileDescription: "Usar configuración de entorno predeterminada",
    defaultModel: "Modelo Predeterminado",
    addProfile: "Agregar Perfil",
    profileName: "Nombre del Perfil",
    enterName: "Ingrese el nombre del perfil",
    baseURL: "URL Base",
    authToken: "Token de Autenticación",
    enterToken: "Ingrese el token de autenticación",
    model: "Modelo",
    setupInstructions: "Instrucciones de configuración",
    viewSetupGuide: "Ver guía oficial de configuración",
    defaultSessionType: "Tipo de sesión predeterminado",
    defaultPermissionMode: "Modo de permisos predeterminado",
    permissionDefault: "Predeterminado",
    permissionDefaultDesc: "Solicitar permisos",
    permissionAcceptEdits: "Aceptar ediciones",
    permissionAcceptEditsDesc: "Aprobar ediciones automáticamente",
    permissionPlan: "Planificar",
    permissionPlanDesc: "Planificar antes de ejecutar",
    permissionYolo: "Yolo",
    permissionYoloDesc: "Omitir todos los permisos",
    spawnInTmux: "Iniciar sesiones en Tmux",
    tmuxEnabledDesc:
      "Las sesiones se inician en nuevas ventanas de tmux. Configure el nombre de sesión y directorio temporal a continuación.",
    tmuxDisabledDesc:
      "Las sesiones se inician en shell normal (sin integración tmux)",
    tmuxSession: "Sesión Tmux",
    tmuxSessionName: "Nombre de sesión Tmux",
    enterTmuxSession: "Ingrese el nombre de la sesión tmux",
    tmuxSessionHint:
      'Dejar vacío para usar la primera sesión tmux existente (o crear "happy" si no hay ninguna). Especifique un nombre (ej. "my-work") para una sesión específica.',
    tmuxSessionPlaceholder: "Vacío = primera sesión existente",
    tmuxDisabledPlaceholder: "Desactivado - tmux no habilitado",
    tmuxTempDir: "Directorio Temporal de Tmux",
    enterTmuxTempDir: "Ingrese la ruta del directorio temporal",
    tmuxTempDirHint:
      "Directorio temporal para archivos de sesión tmux. Dejar vacío para el valor predeterminado del sistema.",
    tmuxTempDirPlaceholder: "/tmp (opcional)",
    tmuxUpdateEnvironment: "Actualizar entorno automáticamente",
    startupBashScript: "Script de inicio Bash",
    startupScriptEnabledDesc:
      "Se ejecuta antes de cada sesión. Para configuración dinámica, verificación del entorno o inicialización personalizada.",
    startupScriptDisabledDesc:
      "Sin script de inicio - las sesiones se inician directamente",
    startupScriptPlaceholder:
      "#!/bin/bash\necho 'Inicializando...'\n# Tu script aquí",
    disabled: "Desactivado",
    nameRequired: "El nombre del perfil es requerido",
    deleteConfirm: '¿Estás seguro de que quieres eliminar el perfil "{name}"?',
    editProfile: "Editar Perfil",
    addProfileTitle: "Agregar Nuevo Perfil",
    delete: {
      title: "Eliminar Perfil",
      message: ({ name }: { name: string }) =>
        `¿Estás seguro de que quieres eliminar "${name}"? Esta acción no se puede deshacer.`,
      confirm: "Eliminar",
      cancel: "Cancelar",
    },
  },

  git: {
    title: "Git",
    tabChanges: "Cambios",
    tabHistory: "Historial",
    tabBranches: "Ramas",
    tabStash: "Stash",
    tabIssues: "Issues",
    historyEmpty: "Sin commits aún",
    historyLoading: "Cargando commits...",
    historyLoadMore: "Cargando más...",
    historyNoMore: "Todos los commits cargados",
    commitFiles: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? "archivo modificado" : "archivos modificados"}`,
    localBranches: "Ramas locales",
    remoteBranches: "Ramas remotas",
    currentBranch: "Actual",
    noBranches: "No se encontraron ramas",
    noUpstream: "Sin upstream",
    createBranch: "Crear rama",
    enterBranchName: "Introduce el nombre de la rama",
    branchNamePlaceholder: "feature/my-branch",
    switchBranchSuccess: ({ name }: { name: string }) => `Cambiado a '${name}'`,
    createBranchSuccess: ({ name }: { name: string }) =>
      `Rama '${name}' creada`,
    dirtyWorkingTree:
      "Por favor, confirma o guarda tus cambios antes de cambiar de rama",
    branchSwitchFailed: "Error al cambiar de rama",
    branchCreateFailed: "Error al crear la rama",
    invalidBranchName: "Nombre de rama no válido",
    branchAlreadyExists: ({ name }: { name: string }) =>
      `La rama '${name}' ya existe`,
    stashEmpty: "No hay cambios guardados",
    stashFiles: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? "archivo modificado" : "archivos modificados"}`,
    // Repo selector
    rootRepo: "Raíz",
    // Remote operations
    fetch: "Obtener",
    pull: "Integrar",
    push: "Enviar",
    fetchSuccess: "Obtenido del remoto",
    pullSuccess: "Integrado del remoto",
    pushSuccess: "Enviado al remoto",
    fetchFailed: "Error al obtener del remoto",
    pullFailed: "Error al integrar del remoto",
    pushFailed: "Error al enviar al remoto",
    noUpstreamHint: "Sin rama upstream",
    upToDate: "Actualizado",
    stage: "Preparar",
    unstage: "Deshacer preparación",
    discard: "Descartar",
    addToGitignore: "Añadir a .gitignore",
    commit: "Confirmar",
    stageAll: "Preparar todo",
    unstageAll: "Deshacer toda preparación",
    discardAll: "Descartar todo",
    stageSuccess: "Archivos preparados",
    unstageSuccess: "Preparación deshecha",
    discardSuccess: "Cambios descartados",
    gitignoreSuccess: "Añadido a .gitignore",
    commitSuccess: "Cambios confirmados",
    stageFailed: "Error al preparar archivos",
    unstageFailed: "Error al deshacer preparación",
    discardFailed: "Error al descartar cambios",
    gitignoreFailed: "Error al añadir a .gitignore",
    commitFailed: "Error al confirmar",
    discardConfirmTitle: "¿Descartar cambios?",
    discardConfirmMessage: ({ count }) =>
      `Los cambios en ${count} ${count === 1 ? "archivo" : "archivos"} se revertirán permanentemente. Esta acción no se puede deshacer.`,
    discardAllConfirmMessage:
      "Todos los cambios no preparados se perderán permanentemente. Esta acción no se puede deshacer.",
    selectedCount: ({ count }) => `${count} seleccionados`,
    commitMessagePlaceholder: "Ingresa el mensaje del commit...",
    noStagedFiles: "No hay archivos preparados para confirmar",
  },

  issues: {
    open: "Abiertas",
    closed: "Cerradas",
    loading: "Cargando issues...",
    noIssues: "No se encontraron issues",
    noRepo: "No se detectó repositorio GitHub/Gitea",
    noBody: "Sin descripción",
    sendToChat: "Enviar al chat",
    openInBrowser: "Abrir en navegador",
    closeIssue: "Cerrar issue",
    reopenIssue: "Reabrir issue",
    addComment: "Añadir comentario",
    commentPlaceholder: "Escribe tu comentario...",
    newIssue: "Nuevo issue",
    newIssueTitlePlaceholder: "Título del issue...",
    newIssueBody: "Descripción (opcional)",
    newIssueBodyPlaceholder: "Describe el problema...",
    pageOf: ({ page }: { page: number }) => `Página ${page}`,
    launchSession: "Iniciar sesión",
    viewProcessingSession: "Ver sesión en proceso",
    processing: "En proceso",
    launchFailed: ({ error }: { error: string }) =>
      `Error al iniciar sesión: ${error}`,
    autoClosedComment: ({ branchName }: { branchName: string }) =>
      `Este issue fue procesado por Happy Coder. Rama: ${branchName}`,
    editIssue: "Editar issue",
    editTitle: "Editar título del issue",
    editTitlePlaceholder: "Título del issue...",
    editBody: "Editar descripción del issue",
    editBodyPlaceholder: "Describe el issue...",
    sortBy: "Ordenar por",
    sortCreated: "Fecha de creación",
    sortUpdated: "Fecha de actualización",
    sortComments: "Comentarios",
    noOpenIssues: "No hay incidencias abiertas",
    noClosedIssues: "No hay incidencias cerradas",
    tryClosedHint: "Prueba a ver las incidencias cerradas",
    createFirstIssue: "Crear incidencia",
    createIssueTitle: "Crear incidencia",
    labelSelect: "Etiquetas",
    noLabelsAvailable: "No hay etiquetas disponibles",
    createButton: "Crear",
    statusProcessing: "Procesando",
    statusCompleted: "Completado",
    statusFailed: "Fallido",
    statusCancelled: "Cancelado",
    cannotArchiveProcessing:
      "Esta sesión está procesando un issue. Espera a que termine.",
  },

  gitHosts: {
    title: "Hosts Git",
    description:
      "Configura qué hosts Git usan GitHub API vs Gitea API. GitHub.com se detecta automáticamente. Otros hosts usan Gitea por defecto.",
    empty:
      "No hay hosts configurados. GitHub.com se detecta automáticamente, otros hosts usan Gitea por defecto.",
    addHost: "Agregar host",
    editHost: "Editar host",
    tabBasic: "Básico",
    tabAutoIssue: "Issue Automático",
    tabWebhooks: "Webhooks",
    hostLabel: "Host",
    providerLabel: "Proveedor",
    tokenLabel: "API Token",
    tokenPlaceholder: "Opcional — necesario para repos privados",
    tokenHint:
      "Genéralo en Configuración → Aplicaciones → Tokens de acceso de tu Gitea.",
    tokenHintGitHub:
      "Personal Access Token con permisos admin:repo_hook. Crea webhooks automáticamente al guardar.",
    deleteTitle: "Eliminar host",
    deleteMessage: ({ host }: { host: string }) =>
      `¿Eliminar "${host}" de los hosts configurados?`,
    duplicateTitle: "Host duplicado",
    duplicateMessage: ({ host }: { host: string }) =>
      `"${host}" ya está configurado.`,
    autoIssueSectionTitle: "Sesión automática de incidencias",
    autoIssueDescription:
      "Iniciar automáticamente una sesión de Claude Code al detectar una incidencia con una etiqueta específica. Solo se activará para incidencias creadas por autores permitidos.",
    autoIssueLabel: "Etiqueta de activación",
    autoIssueLabelPlaceholder: "ej. claude, auto-fix",
    autoIssueAllowedAuthors: "Autores permitidos",
    autoIssueAllowedAuthorsPlaceholder: "usuario1, usuario2",
    webhookSectionTitle: "Webhook Repos",
    webhookDescription:
      "Recibe eventos Webhook de tu host Git para procesar incidencias automáticamente sin sondeo. Agrega repos a monitorear abajo.",
    webhookAddRepo: "Agregar Webhook Repo",
    webhookRemoveRepo: "Eliminar",
    webhookRepoUrl: "URL del repositorio",
    webhookRepoUrlPlaceholder: "https://github.com/owner/repo",
    webhookMachineId: "Máquina destino",
    webhookMachineIdPlaceholder: "Seleccionar una máquina",
    webhookRepoPath: "Ruta local del repositorio",
    webhookRepoPathPlaceholder: "/path/to/repo",
    webhookSecretLabel: "Webhook Secret",
    webhookSecretCopied: "Secret copiado al portapapeles",
    webhookUrlLabel: "Webhook URL",
    webhookUrlCopied: "URL copiada al portapapeles",
    webhookUrlHint:
      "Configura esta URL y Secret en los ajustes de Webhook de tu repositorio.",
    webhookSyncSuccess: "Rutas webhook sincronizadas",
    webhookSyncError: "Error al sincronizar rutas webhook",
    webhookNoMachines: "No hay máquinas disponibles",
    scanRepos: "Escanear repos",
    scanning: "Escaneando...",
    scanEmpty: "No se encontraron repos git en esta máquina",
    scanError: "Error de escaneo — asegúrate de que la máquina esté en línea",
    scanSearchPlaceholder: "Buscar repos...",
    webhookGuideTitle: ({ provider }: { provider: string }) =>
      `Configuración de Webhook de ${provider}`,
    guideStep1GitHub: "Ve a tu repositorio → Settings → Webhooks → Add webhook",
    guideStep1Gitea:
      "Ve a tu repositorio → Settings → Webhooks → Add Webhook → Gitea",
    guideStep2: "Pega la Webhook URL que se muestra abajo",
    guideStep3: "Pega el Webhook Secret que se muestra abajo",
    guideStep4: 'Content type: selecciona "application/json"',
    guideStep5: 'Events: selecciona solo "Issues" y guarda',
    webhookTestSuccess: "El servidor es accesible",
    webhookTestFail: ({ status }: { status: string }) =>
      `El servidor devolvió HTTP ${status}`,
    webhookTestError: "No se puede conectar al servidor — verifica tu red",
    remoteWebhookSuccess: "Webhook creado en el repositorio remoto",
    remoteWebhookFail: ({ error }: { error: string }) =>
      `Error al crear webhook remoto: ${error}`,
    tokenRequiredForRemote:
      "Se requiere un token de API para crear webhooks automáticamente en el remoto",
  },

  quickCommands: {
    searchPlaceholder: "Buscar comandos...",
    noResults: "No se encontraron comandos",
    groups: {
      favorites: "Favoritos",
      root: "Scripts del proyecto",
      shell: "Comandos Shell",
    },
  },

  kanban: {
    emptyTitle: "Sin tareas aún",
    emptySubtitle: "Crea tu primera tarea para empezar a organizar tu trabajo",
    newTask: "Nueva tarea",
    taskDetail: "Detalle de tarea",
    taskNotFound: "Tarea no encontrada",
    details: "Detalles",
    titlePlaceholder: "Título de la tarea",
    titleRequired: "El título es obligatorio",
    descriptionPlaceholder: "Descripción (opcional)",
    column: "Estado",
    priorityLabel: "Prioridad",
    machine: "Máquina",
    machineOnline: "En línea",
    machineOffline: "Sin conexión",
    directory: "Directorio",
    directoryHint: "Directorio de trabajo para la sesión",
    sessionPromptLabel: "Prompt de sesión",
    sessionPromptPlaceholder:
      "Instrucciones para Claude al iniciar esta tarea...",
    sessionPromptHint: "Prompt prellenado al crear una sesión desde esta tarea",
    linkedSessions: "Sesiones vinculadas",
    actionsLabel: "Acciones",
    startSession: "Iniciar sesión",
    noMachineSelected: "Selecciona una máquina primero",
    machineNotOnline: "La máquina seleccionada no está en línea",
    noDirectory: "Especifica un directorio de trabajo",
    spawnFailed: "Error al iniciar la sesión",
    sessionNotFound: "Sesión no encontrada",
    sessionActive: "Activa",
    sessionInactive: "Inactiva",
    deleteConfirmTitle: "Eliminar tarea",
    deleteConfirmMessage: "¿Estás seguro de que quieres eliminar esta tarea?",
    actions: {
      moveTo: "Mover a",
    },
    stats: {
      totalTasks: ({ count }: { count: number }) => `${count} tareas`,
      activeSessions: ({ count }: { count: number }) => `${count} activas`,
    },
    columns: {
      backlog: "Pendientes",
      todo: "Por hacer",
      inProgress: "En progreso",
      review: "Revisión",
      done: "Hecho",
    },
    columnEmpty: {
      backlog: {
        title: "Sin pendientes",
        subtitle: "Las tareas por planificar aparecerán aquí",
      },
      todo: {
        title: "Nada por hacer",
        subtitle: "Agrega tareas listas para trabajar",
      },
      inProgress: {
        title: "Nada en progreso",
        subtitle: "Mueve tareas aquí cuando comiences a trabajar",
      },
      review: {
        title: "Nada en revisión",
        subtitle: "Las tareas en revisión aparecerán aquí",
      },
      done: {
        title: "Sin tareas completadas",
        subtitle: "Las tareas completadas se mostrarán aquí",
      },
    },
    priority: {
      low: "Baja",
      medium: "Media",
      high: "Alta",
      urgent: "Urgente",
    },
    templates: {
      pickTitle: "Elegir plantilla",
      useTemplate: "Usar plantilla",
      manage: "Gestionar plantillas",
      title: "Plantillas de prompt",
      newTemplate: "Nueva plantilla",
      editing: "Editar plantilla",
      namePlaceholder: "Nombre de la plantilla",
      contentPlaceholder:
        "Contenido de la plantilla...\nUsa {{title}}, {{description}}, {{directory}}, {{tags}} como variables",
      deleteTitle: "Eliminar plantilla",
      deleteMessage: "¿Estás seguro de que quieres eliminar esta plantilla?",
      builtInBadge: "Integrada",
      empty: "Aún no hay plantillas",
      builtIn: {
        coding: "Desarrollo de código",
        bugfix: "Corrección de errores",
        review: "Revisión de código",
      },
    },
  },

  project: {
    segments: {
      ideas: "Ideas",
      board: "Tablero",
      roadmap: "Hoja de ruta",
    },
  },

  ideation: {
    // Gestión de ideas
    emptyTitle: "Aún no hay ideas",
    emptySubtitle: "Captura tus ideas y convierte las mejores en tareas",
    newIdea: "Nueva idea",
    ideaDetail: "Detalle de la idea",
    ideaNotFound: "Idea no encontrada",
    details: "Detalles",
    titlePlaceholder: "Título de la idea",
    titleRequired: "El título es obligatorio",
    descriptionPlaceholder: "Describe tu idea...",
    categoryLabel: "Categoría",
    categories: {
      feature: "Función",
      improvement: "Mejora",
      bugfix: "Corrección",
      refactor: "Refactorización",
      documentation: "Documentación",
      other: "Otro",
    },
    statusLabel: "Estado",
    statuses: {
      draft: "Borrador",
      active: "Activo",
      converted: "Convertido",
      dismissed: "Descartado",
    },
    priorityLabel: "Prioridad",
    convertToTask: "Convertir en tarea",
    convertConfirmTitle: "Convertir en tarea",
    convertConfirmMessage:
      "Esto creará una nueva tarea kanban a partir de esta idea.",
    dismiss: "Descartar",
    dismissConfirmTitle: "Descartar idea",
    dismissConfirmMessage: "¿Estás seguro de que quieres descartar esta idea?",
    deleteConfirmTitle: "Eliminar idea",
    deleteConfirmMessage: "¿Estás seguro de que quieres eliminar esta idea?",
    converted: "Convertido en tarea",
    viewTask: "Ver tarea",
    actions: {
      changeStatus: "Cambiar estado",
    },
    stats: {
      totalIdeas: ({ count }: { count: number }) =>
        `${count} ${plural({ count, singular: "idea", plural: "ideas" })}`,
      activeIdeas: ({ count }: { count: number }) =>
        `${count} ${plural({ count, singular: "activo", plural: "activos" })}`,
    },
    filter: {
      all: "Todas",
    },
  },

  roadmap: {
    emptyTitle: "Aún no hay hitos",
    emptySubtitle: "Crea hitos para planificar la hoja de ruta de tu proyecto",
    newMilestone: "Nuevo hito",
    milestoneDetail: "Detalle del hito",
    milestoneNotFound: "Hito no encontrado",
    newFeature: "Nueva función",
    featureDetail: "Detalle de la función",
    featureNotFound: "Función no encontrada",
    details: "Detalles",
    titlePlaceholder: "Título",
    titleRequired: "El título es obligatorio",
    descriptionPlaceholder: "Descripción...",
    targetDate: "Fecha objetivo",
    targetDateNone: "Sin fecha objetivo",
    milestoneLabel: "Hito",
    moscow: {
      mustHave: "Imprescindible",
      shouldHave: "Debería tener",
      couldHave: "Podría tener",
      wontHave: "No tendrá",
    },
    moscowLabel: "Prioridad (MoSCoW)",
    featureStatuses: {
      planned: "Planificado",
      inProgress: "En progreso",
      completed: "Completado",
      cancelled: "Cancelado",
    },
    statusLabel: "Estado",
    complexity: {
      trivial: "Trivial",
      simple: "Simple",
      moderate: "Moderado",
      complex: "Complejo",
      veryComplex: "Muy complejo",
    },
    complexityLabel: "Complejidad",
    features: "Funciones",
    noFeatures: "No hay funciones en este hito",
    milestoneOptions: "Opciones del hito",
    convertToTask: "Convertir en tarea",
    convertConfirmTitle: "Convertir en tarea",
    convertConfirmMessage:
      "Se creará una nueva tarea de kanban a partir de esta función.",
    viewTask: "Ver tarea",
    deleteMilestoneConfirmTitle: "Eliminar hito",
    deleteMilestoneConfirmMessage:
      "También se eliminarán todas las funciones de este hito. ¿Estás seguro?",
    deleteFeatureConfirmTitle: "Eliminar función",
    deleteFeatureConfirmMessage:
      "¿Estás seguro de que quieres eliminar esta función?",
    progress: ({ completed, total }: { completed: number; total: number }) =>
      `${completed}/${total} completado`,
    stats: {
      totalMilestones: ({ count }: { count: number }) =>
        `${count} ${plural({ count, singular: "hito", plural: "hitos" })}`,
      totalFeatures: ({ count }: { count: number }) =>
        `${count} ${plural({ count, singular: "función", plural: "funciones" })}`,
    },
  },

  webNotification: {
    taskComplete: "Tarea completada",
    permissionRequest: "Aprobación necesaria",
  },

  openclaw: {
    title: "OpenClaw",
    connect: "Conectar",
    connecting: "Conectando...",
    connected: "Conectado",
    disconnect: "Desconectar",
    notConnected: "No conectado",
    notConnectedDescription:
      "Conéctate a tu puerta de enlace OpenClaw para comenzar a chatear.",
    connectToGateway: "Conectar a la puerta de enlace",
    connectTitle: "Conectar a OpenClaw",
    connectDescription:
      "Introduce la URL de tu puerta de enlace OpenClaw. La puerta de enlace se ejecuta localmente en tu computadora.",
    connectionSettings: "Configuración de conexión",
    gatewayUrl: "URL de la puerta de enlace",
    token: "Token de acceso",
    tokenDescription: "Generar desde CLI o panel de control de OpenClaw",
    tokenPlaceholder: "Introduce el token de acceso",
    password: "Contraseña",
    passwordOptional: "Para puertas de enlace protegidas con contraseña",
    passwordPlaceholder: "Introduce la contraseña si es necesario",
    connectionFailed: "Error de conexión",
    checkSettings: "Verifica la configuración de conexión e intenta de nuevo.",
    connectFooter:
      "Tu conexión es directa a tu puerta de enlace local. Los datos no pasan por servidores externos.",
    localConnection: "Conexión local",
    localConnectionDescription:
      "Toda la comunicación ocurre directamente con tu puerta de enlace.",
    viewSessions: "Ver sesiones",
    connectedTo: "Conectado a",
    newChat: "Nuevo chat",
    recentSessions: "Sesiones recientes",
    noSessions: "No hay sesiones todavía. Inicia un nuevo chat para comenzar.",
    chat: "Chat",
    startConversation: "Inicia una conversación con OpenClaw",
    messagePlaceholder: "Escribe un mensaje...",
    pairingRequired: "Emparejamiento requerido",
    pairingDescription:
      "Este dispositivo debe ser aprobado antes de conectarse a la puerta de enlace.",
    pairingInstructions: "Cómo aprobar",
    pairingStep1Title: "Abre OpenClaw",
    pairingStep1Description:
      "Haz clic en el icono de OpenClaw en la barra de menú",
    pairingStep2Title: "Encuentra la solicitud de emparejamiento",
    pairingStep2Description:
      'Busca "Happy" en la lista de dispositivos pendientes',
    pairingStep3Title: "Aprueba el dispositivo",
    pairingStep3Description: 'Haz clic en "Aprobar" para permitir la conexión',
    retryConnection: "Reintentar conexión",
    deviceInfo: "Información del dispositivo",
    deviceId: "ID del dispositivo",
    newSession: "Nueva sesión",
    newSessionTitle: "Iniciar una nueva conversación",
    newSessionDescription:
      "Escribe tu mensaje abajo para empezar a chatear con OpenClaw.",
    newSessionPlaceholder: "¿De qué te gustaría hablar?",
    tokenCommand: "Comando para obtener token",
    tokenCommandHint: "Ejecuta este comando en tu terminal:",
    tokenCommandValue: "clawdbot dashboard --no-open",
    tokenCommandDescription:
      'Esto mostrará una URL con tu token. Copia el valor después de "?token="',
    thinking: "Pensando",
    usingTools: "Usando herramientas",
    errorOccurred: "Se produjo un error",
  },
} as const;

export type TranslationsEs = typeof es;
