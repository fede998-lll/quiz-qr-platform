const APP = window.APP_CONFIG || {};
const SUPABASE_URL = APP.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = APP.SUPABASE_ANON_KEY || "";
const DEFAULT_APP_TITLE = "Quiz QR Classroom";
const APP_TITLE_STORAGE_KEY = "quizqr_app_title";
const DEBUG_LOG_STORAGE_KEY = "quizqr_debug_log_entries";
const HOST_VIEW_PREF_STORAGE_KEY = "quizqr_host_view_pref";
const DEBUG_LOG_MAX_ENTRIES = 600;
const PARTICIPANT_TOKEN_QUERY_KEY = "pt";

const avatars = [
  "icons/avatar/1.png",
  "icons/avatar/2.png",
  "icons/avatar/3.png",
  "icons/avatar/4.png",
  "icons/avatar/5.png",
  "icons/avatar/6.png",
  "icons/avatar/7.png",
  "icons/avatar/8.png",
  "icons/avatar/9.png"
];

const chartPalette = ["#0ca8a2", "#f38d38", "#ea4f7a", "#648fff", "#6fbf73"];

const ui = {
  appTitle: document.getElementById("appTitle"),
  hostView: document.getElementById("hostView"),
  studentView: document.getElementById("studentView"),
  setupMissing: document.getElementById("setupMissing"),
  statusBanner: document.getElementById("statusBanner")
};

let sbClient = null;
let hostPollTimer = null;
let hostCharts = [];
let tempIdCounter = 0;
let authStateSubscription = null;
let hostEntryRenderScheduled = false;
let hostEntryRenderInFlight = null;
let hostEntryRenderPending = false;
let authCallbackGraceUntil = 0;
let debugLogEntries = [];
const state = {
  mode: getModeFromUrl(),
  host: {
    appTitle: getStoredAppTitle(),
    auth: {
      session: null,
      user: null,
      email: "",
      teacher: false
    },
    currentSession: null,
    baseUrl: getInitialBaseUrl(),
    stage: "setup",
    resultsSource: "live",
    resultIndex: 0,
    questions: [],
    answers: [],
    participantCount: 0,
    completedCount: 0,
    settings: {
      templates: [],
      selectedTemplateId: null,
      draft: null,
      deleteDialogOpen: false
    }
  },
  student: {
    sessionCode: getSessionCodeFromUrl(),
    session: null,
    participantToken: getOrCreateParticipantToken(),
    nickname: "",
    avatar: avatars[0],
    questions: [],
    currentQuestion: 0,
    selectedOptionId: null,
    introCompleted: false,
    finished: false
  }
};

boot();

window.addEventListener("error", (evt) => {
  const where = evt && evt.filename ? ` (${evt.filename}:${evt.lineno || "?"})` : "";
  logDebug("error", "window_error", {
    message: evt?.message || "unknown",
    file: evt?.filename || "",
    line: evt?.lineno || 0,
    column: evt?.colno || 0
  });
  showStatus(`Runtime error: ${evt.message}${where}`, "warn");
});
window.addEventListener("unhandledrejection", (evt) => {
  const reason = evt?.reason && evt.reason.message ? evt.reason.message : String(evt?.reason || "unknown");
  logDebug("error", "unhandled_rejection", { reason });
  showStatus(`Unhandled promise error: ${reason}`, "warn");
});
window.addEventListener("resize", () => {
  scheduleTopChromeSync();
});

async function boot() {
  try {
    initDebugLog();
    ensureDebugLogDownloadBinding();
    if (isDebugLogButtonEnabled()) {
      ensureDebugLogButton();
    }
    normalizeLocationHashArtifacts();
    logDebug("info", "boot_start", {
      href: window.location.href,
      mode: state.mode
    });
    if (enforceCanonicalEntryUrl()) {
      logDebug("info", "boot_redirect_canonical", { href: window.location.href });
      return;
    }

    if (!ui.hostView || !ui.studentView || !ui.statusBanner || !ui.setupMissing) {
      throw new Error("Incomplete base DOM (hostView/studentView/statusBanner/setupMissing)");
    }

    applyAppTitle();

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      ui.setupMissing.classList.remove("hidden");
      showStatus("Missing Supabase config: complete config.js", "warn");
      return;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      showStatus("Supabase library not loaded. Check internet connection or blocked CDNs.", "warn");
      ui.setupMissing.classList.remove("hidden");
      return;
    }

    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (isSupabaseAuthCallbackUrl(new URL(window.location.href))) {
      authCallbackGraceUntil = Date.now() + 8000;
      logDebug("info", "auth_callback_detected", { grace_until_ms: authCallbackGraceUntil });
    }
    if (!authStateSubscription) {
      const sub = sbClient.auth.onAuthStateChange((event, session) => {
        state.host.auth.session = session || null;
        state.host.auth.user = session?.user || null;
        state.host.auth.email = session?.user?.email || "";
        if (session) {
          authCallbackGraceUntil = 0;
        }
        logDebug("info", "auth_state_change", {
          event,
          has_session: Boolean(session),
          email: session?.user?.email || ""
        });
        scheduleHostEntryRender();
      });
      authStateSubscription = sub?.data?.subscription || null;
    }
    await renderMode();
  } catch (err) {
    const msg = err && err.message ? err.message : "unknown error";
    showStatus(`App initialization error: ${msg}`, "warn");
  }
}

async function renderMode() {
  setHostLayoutEnabled(state.mode === "host");
  applyAppTitle();
  resetTopChromeStyles();
  ui.hostView.classList.add("hidden");
  ui.studentView.classList.add("hidden");

  if (state.mode === "host") {
    ui.hostView.classList.remove("hidden");
    await renderHostEntryView();
    return;
  }

  ui.studentView.classList.remove("hidden");
  await renderStudentView();
  scheduleTopChromeSync();
}

async function renderHostEntryView() {
  if (hostEntryRenderInFlight) {
    hostEntryRenderPending = true;
    return hostEntryRenderInFlight;
  }
  hostEntryRenderInFlight = (async () => {
    hostEntryRenderPending = false;
    renderHostAuthLoadingView();
    try {
      const hasAccess = await ensureHostTeacherAccess();
      if (!hasAccess) {
        return;
      }
      const restored = await tryRestoreHostViewFromPreference();
      if (restored) {
        return;
      }
      await renderHostView();
    } catch (err) {
      const msg = err && err.message ? err.message : "unknown error";
      showStatus(`Auth bootstrap error: ${msg}`, "warn");
      renderHostAuthErrorView(msg);
    }
  })();
  try {
    await hostEntryRenderInFlight;
  } finally {
    hostEntryRenderInFlight = null;
    if (hostEntryRenderPending && state.mode === "host") {
      scheduleHostEntryRender();
    }
  }
}

async function ensureHostTeacherAccess(refresh = true) {
  if (refresh) {
    await refreshHostAuthState();
  }
  if (!state.host.auth.session) {
    renderHostLoginView();
    return false;
  }
  if (!state.host.auth.teacher) {
    renderHostForbiddenView();
    return false;
  }
  return true;
}

async function refreshHostAuthState() {
  const prevSession = state.host.auth.session || null;
  const prevUser = state.host.auth.user || null;
  const prevEmail = state.host.auth.email || "";
  let { sessionData, sessionError, transientAborted } = await getSessionWithRetry();
  let session = sessionData?.session || null;

  if (!session && isInAuthCallbackGraceWindow()) {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await wait(250);
      const retry = await getSessionWithRetry();
      sessionData = retry.sessionData;
      sessionError = retry.sessionError;
      transientAborted = retry.transientAborted;
      session = sessionData?.session || null;
      logDebug("info", "auth_grace_retry", { attempt, has_session: Boolean(session) });
      if (session) {
        break;
      }
    }
  }

  let user = session?.user || null;
  let email = user?.email || "";

  if (!session && transientAborted && prevSession) {
    session = prevSession;
    user = prevUser;
    email = prevEmail;
  }

  if (sessionError && !transientAborted) {
    const msg = sessionError.message || String(sessionError);
    showStatus(`Auth session error: ${msg}`, "warn");
  }
  let teacher = false;

  if (session) {
    try {
      const { data: roleData, error: roleError } = await sbClient.rpc("is_teacher");
      if (roleError) {
        showStatus(`Auth role error: ${roleError.message}`, "warn");
      } else {
        teacher = Boolean(roleData);
      }
    } catch (err) {
      const msg = err && err.message ? err.message : "unknown";
      showStatus(`Auth role error: ${msg}`, "warn");
    }
  }

  state.host.auth.session = session;
  state.host.auth.user = user;
  state.host.auth.email = email;
  state.host.auth.teacher = teacher;
  logDebug("info", "auth_refresh_result", {
    has_session: Boolean(session),
    teacher,
    email
  });
}

function renderHostLoginView() {
  closeOpenSessionNavDialog();
  closeLogoutSessionDialog();
  closeDeleteTemplateDialog();
  setHostStageClass("setup");
  clearHostPolling();
  destroyCharts();
  ui.hostView.innerHTML = `
    <article class="card stack host-login-card">
      <h2>Sign in</h2>
      <p>Continue with your Google account.</p>
      <button id="teacherGoogleLoginBtn" class="primary">Continue with Google</button>
    </article>
  `;

  onById("teacherGoogleLoginBtn", "click", async () => {
    const redirectUrl = buildHostOAuthRedirectUrl();
    logDebug("info", "login_google_attempt", { redirect_to: redirectUrl.toString() });

    const { error } = await sbClient.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectUrl.toString(),
        queryParams: {
          prompt: "select_account"
        }
      }
    });
    if (error) {
      logDebug("warn", "login_google_error", { message: error.message || "unknown" });
      showStatus(`Google login error: ${error.message}`, "warn");
      return;
    }
    showStatus("Redirecting to Google login...", "info");
  });
}

function renderHostForbiddenView() {
  clearHostViewPreference("forbidden");
  closeOpenSessionNavDialog();
  closeLogoutSessionDialog();
  closeDeleteTemplateDialog();
  setHostStageClass("setup");
  clearHostPolling();
  destroyCharts();
  ui.hostView.innerHTML = `
    <article class="card stack">
      <h2>Access denied</h2>
      <p>Your account is not enabled for this area.</p>
      <p class="muted">Signed in as: <strong>${escapeHtml(state.host.auth.email || "unknown")}</strong></p>
      <button id="hostLogoutBtn" class="secondary">Logout</button>
    </article>
  `;

  onById("hostLogoutBtn", "click", async () => {
    await performHostLogout();
  });
}

async function performHostLogout() {
  closeOpenSessionNavDialog();
  closeLogoutSessionDialog();
  closeDeleteTemplateDialog();
  logDebug("info", "logout_start", { email: state.host.auth.email || "" });
  let signOutError = null;
  try {
    const { error } = await sbClient.auth.signOut();
    if (error) {
      signOutError = error;
    }
  } catch (err) {
    signOutError = err;
  }
  state.host.auth.session = null;
  state.host.auth.user = null;
  state.host.auth.email = "";
  state.host.auth.teacher = false;
  state.host.currentSession = null;
  clearHostViewPreference("logout");
  clearHostPolling();
  if (signOutError) {
    logDebug("warn", "logout_error", { message: signOutError.message || String(signOutError) });
    showStatus(`Logout warning: ${signOutError.message || signOutError}. Local cleanup applied.`, "warn");
  } else {
    logDebug("info", "logout_success", {});
    showStatus("Logged out", "info");
  }
  renderHostLoginView();
}

function renderHostToolbar(activeStage) {
  const isHome = activeStage === "setup";
  const isSettings = activeStage === "settings";
  const isPast = activeStage === "archives";

  return `
    <nav class="host-toolbar" aria-label="Main navigation">
      <button
        class="toolbar-btn icon-only ${isHome ? "active" : ""}"
        data-host-nav="home"
        title="Home"
        aria-label="Home"
      >
        <img src="icons/home.png" alt="" class="toolbar-icon" width="30" height="30" />
      </button>
      <button
        class="toolbar-btn icon-only toolbar-settings ${isSettings ? "active" : ""}"
        data-host-nav="settings"
        title="Settings"
        aria-label="Settings"
      >
        <img src="icons/settings.png" alt="" class="toolbar-icon" width="30" height="30" />
      </button>
      <button
        class="toolbar-btn toolbar-bottom ${isPast ? "active" : ""}"
        data-host-nav="past"
        title="Past Sessions"
      >
        Past Sessions
      </button>
      <button
        class="toolbar-btn"
        data-host-nav="logout"
        title="Logout"
      >
        Logout
      </button>
    </nav>
  `;
}

function bindHostToolbarEvents() {
  document.querySelectorAll("[data-host-nav]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const destination = btn.dataset.hostNav;
      if (destination === "logout") {
        if (isHostSessionOpen()) {
          await renderLogoutSessionDialog();
          return;
        }
        await navigateHostTo(destination);
        return;
      }
      if (isHostSessionOpen()) {
        await renderOpenSessionNavDialog(destination);
        return;
      }
      await navigateHostTo(destination);
    });
  });
}

async function navigateHostTo(destination) {
  if (destination === "home") {
    state.host.currentSession = null;
    await renderHostView();
    return;
  }
  if (destination === "past") {
    await renderHostPastSessionsView();
    return;
  }
  if (destination === "settings") {
    await renderHostSettingsView();
    return;
  }
  if (destination === "logout") {
    await performHostLogout();
  }
}

function isHostSessionOpen() {
  return Boolean(state.host.currentSession && state.host.currentSession.status === "open");
}

async function closeOpenSessionForNavigation() {
  const session = state.host.currentSession;
  if (!session) {
    return true;
  }

  const { error } = await sbClient
    .from("sessions")
    .update({ status: "closed" })
    .eq("id", session.id);

  if (error) {
    showStatus(`Error closing session: ${error.message}`, "warn");
    return false;
  }

  state.host.currentSession.status = "closed";
  showStatus(`Session ${session.code} closed`, "info");
  return true;
}

async function renderOpenSessionNavDialog(destination) {
  closeLogoutSessionDialog();
  closeOpenSessionNavDialog();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "openSessionNavModal";
  overlay.innerHTML = `
    <div class="modal-card">
      <h3>Open session in progress</h3>
      <p>You must close the current session before leaving this screen.</p>
      <div class="actions">
        <button id="confirmCloseForNavBtn" class="danger">Close session</button>
        <button id="cancelCloseForNavBtn" class="ghost">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  onById("cancelCloseForNavBtn", "click", () => {
    closeOpenSessionNavDialog();
  });

  onById("confirmCloseForNavBtn", "click", async () => {
    closeOpenSessionNavDialog();
    const ok = await closeOpenSessionForNavigation();
    if (!ok) {
      return;
    }
    state.host.currentSession = null;
    await navigateHostTo(destination);
  });
}

function closeOpenSessionNavDialog() {
  const existing = document.getElementById("openSessionNavModal");
  if (existing) {
    existing.remove();
  }
}

async function renderLogoutSessionDialog() {
  closeOpenSessionNavDialog();
  closeLogoutSessionDialog();

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "logoutSessionModal";
  overlay.innerHTML = `
    <div class="modal-card">
      <h3>Open session in progress</h3>
      <p>To logout safely, close the current session first.</p>
      <div class="actions">
        <button id="confirmCloseAndLogoutBtn" class="danger">Close session and logout</button>
        <button id="cancelCloseAndLogoutBtn" class="ghost">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  onById("cancelCloseAndLogoutBtn", "click", () => {
    closeLogoutSessionDialog();
  });

  onById("confirmCloseAndLogoutBtn", "click", async () => {
    const confirmBtn = document.getElementById("confirmCloseAndLogoutBtn");
    const cancelBtn = document.getElementById("cancelCloseAndLogoutBtn");
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.classList.add("disabled-btn");
      confirmBtn.textContent = "Closing session...";
    }
    if (cancelBtn) {
      cancelBtn.disabled = true;
      cancelBtn.classList.add("disabled-btn");
    }

    await closeOpenSessionForLogoutWithRetry();
    closeLogoutSessionDialog();
    await performHostLogout();
  });
}

function closeLogoutSessionDialog() {
  const existing = document.getElementById("logoutSessionModal");
  if (existing) {
    existing.remove();
  }
}

async function closeOpenSessionForLogoutWithRetry() {
  const session = state.host.currentSession;
  if (!session) {
    return true;
  }

  let attempt = 0;
  let waitMs = 700;
  while (true) {
    attempt += 1;
    const { error } = await sbClient
      .from("sessions")
      .update({ status: "closed" })
      .eq("id", session.id);

    if (!error) {
      state.host.currentSession.status = "closed";
      showStatus(`Session ${session.code} closed`, "info");
      return true;
    }

    showStatus(
      `Close session failed (attempt ${attempt}): ${error.message}. Retrying...`,
      "warn"
    );
    await wait(waitMs);
    waitMs = Math.min(waitMs + 500, 4000);
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function scheduleHostEntryRender() {
  if (state.mode !== "host") {
    return;
  }
  hostEntryRenderPending = true;
  if (hostEntryRenderScheduled || hostEntryRenderInFlight) {
    return;
  }
  hostEntryRenderScheduled = true;
  window.setTimeout(async () => {
    hostEntryRenderScheduled = false;
    if (state.mode !== "host") {
      hostEntryRenderPending = false;
      return;
    }
    if (!hostEntryRenderPending) {
      return;
    }
    await renderHostEntryView();
  }, 0);
}

async function getSessionWithRetry() {
  let sessionData = null;
  let sessionError = null;
  let abortedSeen = false;
  let attemptsDone = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    attemptsDone = attempt;
    try {
      const { data, error } = await sbClient.auth.getSession();
      sessionData = data || null;
      sessionError = error || null;
    } catch (err) {
      sessionError = err;
    }

    const msg = (sessionError && sessionError.message ? sessionError.message : "").toLowerCase();
    const aborted = msg.includes("aborted");
    if (aborted) {
      abortedSeen = true;
    }
    if (!sessionError || !aborted) {
      break;
    }
    await wait(200 * attempt);
  }
  if (sessionError) {
    logDebug("warn", "auth_get_session_error", {
      attempts: attemptsDone,
      message: sessionError.message || String(sessionError),
      transient_aborted: Boolean(sessionError && abortedSeen)
    });
  } else {
    logDebug("info", "auth_get_session_ok", {
      attempts: attemptsDone,
      has_session: Boolean(sessionData?.session)
    });
  }
  return {
    sessionData,
    sessionError,
    transientAborted: Boolean(sessionError && abortedSeen)
  };
}

function renderHostAuthLoadingView() {
  closeOpenSessionNavDialog();
  closeLogoutSessionDialog();
  closeDeleteTemplateDialog();
  setHostStageClass("setup");
  clearHostPolling();
  destroyCharts();
  ui.hostView.innerHTML = `
    <article class="card stack">
      <h2>Checking authentication</h2>
      <p>Please wait...</p>
    </article>
  `;
}

function renderHostAuthErrorView(errorMessage) {
  closeOpenSessionNavDialog();
  closeLogoutSessionDialog();
  closeDeleteTemplateDialog();
  setHostStageClass("setup");
  clearHostPolling();
  destroyCharts();
  ui.hostView.innerHTML = `
    <article class="card stack">
      <h2>Authentication check failed</h2>
      <p class="muted">${escapeHtml(errorMessage || "Unknown error")}</p>
      <div class="actions">
        <button id="retryHostEntryBtn" class="primary">Retry</button>
        <button id="goToLoginBtn" class="ghost">Go to login</button>
      </div>
    </article>
  `;
  onById("retryHostEntryBtn", "click", async () => {
    await renderHostEntryView();
  });
  onById("goToLoginBtn", "click", () => {
    renderHostLoginView();
  });
}

async function renderHostView() {
  if (!(await ensureHostTeacherAccess())) {
    return;
  }
  closeOpenSessionNavDialog();
  closeDeleteTemplateDialog();
  setHostStageClass("setup");
  clearHostPolling();
  destroyCharts();
  state.host.stage = "setup";
  state.host.resultsSource = "live";
  state.host.resultIndex = 0;
  state.host.questions = [];
  state.host.answers = [];
  state.host.participantCount = 0;
  state.host.completedCount = 0;
  state.host.settings.draft = null;
  state.host.settings.selectedTemplateId = null;
  persistHostViewPreference({ stage: "setup" });

  ui.hostView.innerHTML = `<article class="card"><p>Loading workspace...</p></article>`;

  const templates = await fetchQuizTemplates();
  state.host.settings.templates = templates;

  if (!templates.length) {
    ui.hostView.innerHTML = `
      <div class="host-screen">
        ${renderHostToolbar("setup")}
        <article class="card host-card host-setup-card">
          <h2>No template available</h2>
          <p>Create your first quiz block in Settings.</p>
          <div class="actions">
            <button id="openSettingsBtn" class="secondary">Open Settings</button>
          </div>
        </article>
      </div>
    `;
    bindHostToolbarEvents();
    scheduleTopChromeSync();
    onById("openSettingsBtn", "click", async () => {
      await renderHostSettingsView();
    });
    return;
  }

  ui.hostView.innerHTML = `
    <div class="host-screen">
      ${renderHostToolbar("setup")}
      <article class="card host-card host-setup-card">
        <h2>New Quiz Session</h2>
        <p>Select a block and start the QR session.</p>
        <div class="grid">
          <label for="templateSelect">Quiz Template</label>
          <select id="templateSelect">
            ${templates.map((t) => `<option value="${t.id}">${escapeHtml(t.title)}</option>`).join("")}
          </select>
        </div>
        <div class="actions">
          <button id="startSessionBtn" class="primary">Start Session</button>
        </div>
      </article>
    </div>
  `;
  bindHostToolbarEvents();
  scheduleTopChromeSync();

  onById("startSessionBtn", "click", async () => {
    const templateSelect = document.getElementById("templateSelect");
    const templateId = templateSelect.value;
    const templateTitle = templateSelect.options[templateSelect.selectedIndex]?.text || "";
    await startHostSession(templateId, templateTitle);
  });

}

async function renderHostSettingsView(templateId = null) {
  if (!(await ensureHostTeacherAccess())) {
    return;
  }
  closeOpenSessionNavDialog();
  setHostStageClass("settings");
  clearHostPolling();
  destroyCharts();
  state.host.stage = "settings";

  const templates = await fetchQuizTemplates();
  state.host.settings.templates = templates;
  state.host.settings.deleteDialogOpen = false;

  if (templateId) {
    state.host.settings.selectedTemplateId = templateId;
  } else if (!state.host.settings.selectedTemplateId && templates[0]) {
    state.host.settings.selectedTemplateId = templates[0].id;
  }
  persistHostViewPreference({
    stage: "settings",
    selected_template_id: state.host.settings.selectedTemplateId || null
  });

  if (!state.host.settings.draft) {
    if (state.host.settings.selectedTemplateId) {
      state.host.settings.draft = await buildTemplateDraftFromDb(state.host.settings.selectedTemplateId);
    } else {
      state.host.settings.draft = createEmptyTemplateDraft();
    }
  }

  const draft = state.host.settings.draft || createEmptyTemplateDraft();
  const templateListHtml = templates.map((tpl) => {
    const active = tpl.id === state.host.settings.selectedTemplateId ? "active" : "";
    return `<button class="template-item ${active}" data-template-id="${tpl.id}">${escapeHtml(tpl.title)}</button>`;
  }).join("");

  const questionsHtml = draft.questions.map((q, qIdx) => {
    const optionsHtml = q.options.map((opt, oIdx) => {
      return `
        <div class="option-edit-row">
          <input class="option-input" data-qidx="${qIdx}" data-oidx="${oIdx}" value="${escapeHtml(opt.label)}" placeholder="Option text" />
          <label class="check-inline">
            <input type="checkbox" class="option-correct" data-qidx="${qIdx}" data-oidx="${oIdx}" ${opt.is_correct ? "checked" : ""} />
            Correct
          </label>
          <button class="ghost mini-btn remove-option-btn" data-qidx="${qIdx}" data-oidx="${oIdx}">Remove</button>
        </div>
      `;
    }).join("");

    return `
      <article class="question-edit-card">
        <div class="question-head">
          <h3>Question ${qIdx + 1}</h3>
          <button class="ghost mini-btn remove-question-btn" data-qidx="${qIdx}">Remove question</button>
        </div>
        <input class="question-prompt-input" data-qidx="${qIdx}" value="${escapeHtml(q.prompt)}" placeholder="Question text" />
        <div class="question-options-list">
          ${optionsHtml}
        </div>
        <div class="actions">
          <button class="ghost mini-btn add-option-btn" data-qidx="${qIdx}">Add option</button>
        </div>
      </article>
    `;
  }).join("");

  ui.hostView.innerHTML = `
    <div class="host-screen">
      ${renderHostToolbar("settings")}
      <article class="card host-card host-settings-card">
        <section class="settings-identity">
          <div class="settings-identity-head">
            <h2>App Identity</h2>
            <p>Customize the title shown at the top of the app.</p>
          </div>
          <div class="settings-identity-form">
            <label for="appTitleInput">App title</label>
            <div class="settings-identity-inline">
              <input id="appTitleInput" value="${escapeHtml(state.host.appTitle)}" placeholder="${DEFAULT_APP_TITLE}" />
              <button id="saveAppTitleBtn" class="secondary mini-btn">Save app name</button>
            </div>
          </div>
        </section>
        <div class="settings-layout">
          <aside class="settings-sidebar">
            <div class="settings-sidebar-head">
              <h2>Quiz Settings</h2>
              <p>Manage reusable quiz blocks.</p>
            </div>
            <div class="template-list">${templateListHtml || "<p>No templates.</p>"}</div>
            <div class="actions settings-sidebar-actions">
              <button id="newTemplateBtn" class="secondary">New block</button>
            </div>
          </aside>
          <section class="settings-editor">
            <div class="settings-editor-scroll">
              <div class="grid">
                <label for="templateTitleInput">Block title</label>
                <input id="templateTitleInput" value="${escapeHtml(draft.title)}" placeholder="E.g. Block 1 - Biology" />
                <label for="templateDescInput">Description (optional)</label>
                <input id="templateDescInput" value="${escapeHtml(draft.description || "")}" placeholder="Short description" />
              </div>
              <div class="editor-head">
                <h3>Questions</h3>
                <button id="addQuestionBtn" class="ghost mini-btn">Add question</button>
              </div>
              <div class="questions-scroll">${questionsHtml}</div>
            </div>
            <div class="actions">
              <button id="saveTemplateBtn" class="primary">Save block</button>
              <button id="deleteTemplateBtn" class="danger ${draft.id ? "" : "hidden"}">Delete block</button>
            </div>
          </section>
        </div>
      </article>
    </div>
  `;

  bindHostToolbarEvents();
  scheduleTopChromeSync();
  bindHostSettingsEvents();
}

function bindHostSettingsEvents() {
  onById("saveAppTitleBtn", "click", () => {
    const nextTitle = normalizeAppTitle(document.getElementById("appTitleInput")?.value || "");
    state.host.appTitle = nextTitle;
    persistAppTitle(nextTitle);
    applyAppTitle();
    showStatus("App name saved", "info");
  });

  onById("newTemplateBtn", "click", async () => {
    state.host.settings.selectedTemplateId = null;
    state.host.settings.draft = createEmptyTemplateDraft();
    await renderHostSettingsView();
  });

  onById("addQuestionBtn", "click", async () => {
    state.host.settings.draft.questions.push(createEmptyQuestionDraft());
    await renderHostSettingsView();
  });

  onById("saveTemplateBtn", "click", async () => {
    await saveTemplateDraft();
  });

  onById("deleteTemplateBtn", "click", async () => {
    state.host.settings.deleteDialogOpen = true;
    await renderDeleteTemplateDialog();
  });

  const titleInput = document.getElementById("templateTitleInput");
  if (titleInput) {
    titleInput.addEventListener("input", (evt) => {
      state.host.settings.draft.title = evt.target.value;
    });
  }

  const descInput = document.getElementById("templateDescInput");
  if (descInput) {
    descInput.addEventListener("input", (evt) => {
      state.host.settings.draft.description = evt.target.value;
    });
  }

  document.querySelectorAll(".template-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const templateId = btn.dataset.templateId;
      state.host.settings.selectedTemplateId = templateId;
      state.host.settings.draft = await buildTemplateDraftFromDb(templateId);
      await renderHostSettingsView();
    });
  });

  document.querySelectorAll(".question-prompt-input").forEach((input) => {
    input.addEventListener("input", (evt) => {
      const qIdx = Number(evt.target.dataset.qidx);
      if (Number.isInteger(qIdx) && state.host.settings.draft.questions[qIdx]) {
        state.host.settings.draft.questions[qIdx].prompt = evt.target.value;
      }
    });
  });

  document.querySelectorAll(".option-input").forEach((input) => {
    input.addEventListener("input", (evt) => {
      const qIdx = Number(evt.target.dataset.qidx);
      const oIdx = Number(evt.target.dataset.oidx);
      const q = state.host.settings.draft.questions[qIdx];
      if (q && q.options[oIdx]) {
        q.options[oIdx].label = evt.target.value;
      }
    });
  });

  document.querySelectorAll(".option-correct").forEach((checkbox) => {
    checkbox.addEventListener("change", (evt) => {
      const qIdx = Number(evt.target.dataset.qidx);
      const oIdx = Number(evt.target.dataset.oidx);
      const q = state.host.settings.draft.questions[qIdx];
      if (q && q.options[oIdx]) {
        q.options[oIdx].is_correct = Boolean(evt.target.checked);
      }
    });
  });

  document.querySelectorAll(".remove-option-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const qIdx = Number(btn.dataset.qidx);
      const oIdx = Number(btn.dataset.oidx);
      const q = state.host.settings.draft.questions[qIdx];
      if (!q || q.options.length <= 2) {
        showStatus("Each question must have at least 2 options", "warn");
        return;
      }
      q.options.splice(oIdx, 1);
      await renderHostSettingsView();
    });
  });

  document.querySelectorAll(".add-option-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const qIdx = Number(btn.dataset.qidx);
      const q = state.host.settings.draft.questions[qIdx];
      if (!q) {
        return;
      }
      q.options.push(createEmptyOptionDraft());
      await renderHostSettingsView();
    });
  });

  document.querySelectorAll(".remove-question-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const qIdx = Number(btn.dataset.qidx);
      if (state.host.settings.draft.questions.length <= 1) {
        showStatus("The block must contain at least 1 question", "warn");
        return;
      }
      state.host.settings.draft.questions.splice(qIdx, 1);
      await renderHostSettingsView();
    });
  });
}

async function renderDeleteTemplateDialog() {
  const draft = state.host.settings.draft;
  if (!draft || !state.host.settings.deleteDialogOpen) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "deleteTemplateModal";
  overlay.innerHTML = `
    <div class="modal-card">
      <h3>Confirm quiz block deletion</h3>
      <p>Selected block: <strong>${escapeHtml(draft.title || "Untitled")}</strong></p>
      <p class="modal-note">This action deletes only the template. Past sessions remain in history.</p>
      <div class="actions">
        <button id="confirmDeleteTemplateBtn" class="danger">Confirm</button>
        <button id="cancelDeleteTemplateBtn" class="ghost">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  onById("cancelDeleteTemplateBtn", "click", () => {
    closeDeleteTemplateDialog();
  });

  onById("confirmDeleteTemplateBtn", "click", async () => {
    closeDeleteTemplateDialog();
    await deleteSelectedTemplate();
  });
}

function closeDeleteTemplateDialog() {
  state.host.settings.deleteDialogOpen = false;
  const existing = document.getElementById("deleteTemplateModal");
  if (existing) {
    existing.remove();
  }
}

async function renderHostPastSessionsView() {
  if (!(await ensureHostTeacherAccess())) {
    return;
  }
  closeOpenSessionNavDialog();
  closeDeleteTemplateDialog();
  setHostStageClass("archives");
  clearHostPolling();
  destroyCharts();
  state.host.stage = "archives";
  persistHostViewPreference({ stage: "archives" });

  const rows = await fetchPastSessions();
  const listHtml = rows.length
    ? rows.map((row) => `
      <article class="archive-row">
        <div>
          <strong>${escapeHtml(row.code)}</strong>
          <p>${escapeHtml(row.quiz_templates?.title || row.template_title_snapshot || "Deleted template")}</p>
          <p>${formatDateTime(row.created_at)}</p>
        </div>
        <div class="actions">
          <button class="ghost open-past-result-btn" data-session-id="${row.id}" data-template-id="${row.quiz_template_id || ""}" data-code="${escapeHtml(row.code)}" data-status="${row.status}" data-title="${escapeHtml(row.quiz_templates?.title || row.template_title_snapshot || "Quiz Session")}">Open results</button>
          <button class="danger delete-session-btn" data-session-id="${row.id}">Delete</button>
        </div>
      </article>
    `).join("")
    : `<p>No closed sessions found.</p>`;

  ui.hostView.innerHTML = `
    <div class="host-screen">
      ${renderHostToolbar("archives")}
      <article class="card host-card host-archives-card">
        <div class="archive-head">
          <h2>Past Sessions</h2>
          <div class="actions">
            <button id="deleteAllPastBtn" class="danger">Delete all</button>
          </div>
        </div>
        <div class="archive-list">${listHtml}</div>
      </article>
    </div>
  `;

  bindHostToolbarEvents();
  scheduleTopChromeSync();

  onById("deleteAllPastBtn", "click", async () => {
    if (!window.confirm("Confirm deletion of all past sessions?")) {
      return;
    }
    await deleteAllPastSessions();
    await renderHostPastSessionsView();
  });

  document.querySelectorAll(".open-past-result-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.host.currentSession = {
        id: btn.dataset.sessionId,
        quiz_template_id: btn.dataset.templateId || null,
        code: btn.dataset.code,
        status: btn.dataset.status || "closed",
        template_title_snapshot: btn.dataset.title || "Quiz Session"
      };
      state.host.stage = "results";
      state.host.resultsSource = "past";
      state.host.resultIndex = 0;
      await loadHostSessionData(true);
      await renderHostResultsView();
    });
  });

  document.querySelectorAll(".delete-session-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("Confirm deletion of the selected session?")) {
        return;
      }
      await deletePastSessionById(btn.dataset.sessionId);
      await renderHostPastSessionsView();
    });
  });
}

function createEmptyTemplateDraft() {
  return {
    id: null,
    title: "",
    description: "",
    questions: [createEmptyQuestionDraft()]
  };
}

function createEmptyQuestionDraft() {
  return {
    local_id: nextTempId("q"),
    prompt: "",
    options: [createEmptyOptionDraft(), createEmptyOptionDraft()]
  };
}

function createEmptyOptionDraft() {
  return {
    local_id: nextTempId("o"),
    label: "",
    is_correct: false
  };
}

function nextTempId(prefix) {
  tempIdCounter += 1;
  return `${prefix}_${tempIdCounter}`;
}

async function buildTemplateDraftFromDb(templateId) {
  const template = state.host.settings.templates.find((t) => t.id === templateId);
  const questions = await fetchQuestionsForTemplate(templateId);
  return {
    id: templateId,
    title: template ? template.title : "",
    description: template ? (template.description || "") : "",
    questions: (questions || []).length
      ? questions.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          options: (q.options || []).map((o) => ({
            id: o.id,
            label: o.label,
            is_correct: Boolean(o.is_correct)
          }))
        }))
      : [createEmptyQuestionDraft()]
  };
}

async function saveTemplateDraft() {
  if (!(await ensureHostTeacherAccess())) {
    return;
  }
  const draft = state.host.settings.draft;
  const title = (draft.title || "").trim();
  if (!title) {
    showStatus("Enter a quiz block title", "warn");
    return;
  }

  const cleanQuestions = draft.questions
    .map((q) => ({
      prompt: (q.prompt || "").trim(),
      options: (q.options || []).map((o) => ({
        label: (o.label || "").trim(),
        is_correct: Boolean(o.is_correct)
      })).filter((o) => o.label.length > 0)
    }))
    .filter((q) => q.prompt.length > 0);

  if (!cleanQuestions.length) {
    showStatus("Enter at least one valid question", "warn");
    return;
  }

  for (const q of cleanQuestions) {
    if (q.options.length < 2) {
      showStatus("Each question must have at least 2 valid options", "warn");
      return;
    }
    if (!q.options.some((o) => o.is_correct)) {
      showStatus("Each question must have at least one correct answer", "warn");
      return;
    }
  }

  let templateId = draft.id;
  if (!templateId) {
    const { data, error } = await sbClient
      .from("quiz_templates")
      .insert({
        title,
        description: (draft.description || "").trim() || null
      })
      .select("id")
      .single();
    if (error) {
      showStatus(`Block creation error: ${error.message}`, "warn");
      return;
    }
    templateId = data.id;
  } else {
    const { error } = await sbClient
      .from("quiz_templates")
      .update({
        title,
        description: (draft.description || "").trim() || null
      })
      .eq("id", templateId);
    if (error) {
      showStatus(`Block update error: ${error.message}`, "warn");
      return;
    }
  }

  const { error: deleteQuestionsError } = await sbClient
    .from("questions")
    .delete()
    .eq("quiz_template_id", templateId);

  if (deleteQuestionsError) {
    showStatus(`Questions reset error: ${deleteQuestionsError.message}`, "warn");
    return;
  }

  for (let qIndex = 0; qIndex < cleanQuestions.length; qIndex += 1) {
    const q = cleanQuestions[qIndex];
    const { data: qData, error: qError } = await sbClient
      .from("questions")
      .insert({
        quiz_template_id: templateId,
        order_index: qIndex + 1,
        prompt: q.prompt
      })
      .select("id")
      .single();
    if (qError) {
      showStatus(`Error saving question ${qIndex + 1}: ${qError.message}`, "warn");
      return;
    }

    const optionsPayload = q.options.map((opt, oIndex) => ({
      question_id: qData.id,
      order_index: oIndex + 1,
      label: opt.label,
      is_correct: Boolean(opt.is_correct)
    }));

    const { error: optError } = await sbClient
      .from("question_options")
      .insert(optionsPayload);
    if (optError) {
      showStatus(`Error saving options for question ${qIndex + 1}: ${optError.message}`, "warn");
      return;
    }
  }

  state.host.settings.selectedTemplateId = templateId;
  state.host.settings.draft = null;
  showStatus("Quiz block saved", "info");
  await renderHostSettingsView(templateId);
}

async function deleteSelectedTemplate() {
  if (!(await ensureHostTeacherAccess())) {
    return;
  }
  const draft = state.host.settings.draft;
  if (!draft || !draft.id) {
    return;
  }

  const { count: sessionsCount, error: sessionsCountError } = await sbClient
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("quiz_template_id", draft.id);

  if (sessionsCountError) {
    showStatus(`Block check error: ${sessionsCountError.message}`, "warn");
    return;
  }

  if ((sessionsCount || 0) > 0) {
    // Preserve session history by detaching the template and saving title snapshot.
    const { error: detachSessionsError } = await sbClient
      .from("sessions")
      .update({
        quiz_template_id: null,
        template_title_snapshot: draft.title || null
      })
      .eq("quiz_template_id", draft.id);
    if (detachSessionsError) {
      showStatus(`Error detaching sessions: ${detachSessionsError.message}`, "warn");
      return;
    }
  }

  const { error } = await sbClient
    .from("quiz_templates")
    .delete()
    .eq("id", draft.id);

  if (error) {
    showStatus(`Block deletion error: ${error.message}`, "warn");
    return;
  }

  showStatus("Template deleted. Past sessions preserved in history.", "info");
  state.host.settings.selectedTemplateId = null;
  state.host.settings.draft = null;
  await renderHostSettingsView();
}

async function deletePastSessionById(sessionId) {
  if (!(await ensureHostTeacherAccess())) {
    return;
  }
  if (!sessionId) {
    return;
  }
  const { error: delAnswersError } = await sbClient
    .from("answers")
    .delete()
    .eq("session_id", sessionId);
  if (delAnswersError) {
    showStatus(`Error deleting session answers: ${delAnswersError.message}`, "warn");
    return;
  }

  const { error: delParticipantsError } = await sbClient
    .from("participants")
    .delete()
    .eq("session_id", sessionId);
  if (delParticipantsError) {
    showStatus(`Error deleting session participants: ${delParticipantsError.message}`, "warn");
    return;
  }

  const { error: delSessionError } = await sbClient
    .from("sessions")
    .delete()
    .eq("id", sessionId);
  if (delSessionError) {
    showStatus(`Session deletion error: ${delSessionError.message}`, "warn");
    return;
  }

  showStatus("Session deleted", "info");
}

async function deleteAllPastSessions() {
  if (!(await ensureHostTeacherAccess())) {
    return;
  }
  const { data: sessions, error: sessionsErr } = await sbClient
    .from("sessions")
    .select("id")
    .eq("status", "closed");
  if (sessionsErr) {
    showStatus(`Error reading past sessions: ${sessionsErr.message}`, "warn");
    return;
  }

  const ids = (sessions || []).map((s) => s.id);
  if (!ids.length) {
    showStatus("No past sessions to delete", "info");
    return;
  }

  const { error: delAnswersError } = await sbClient
    .from("answers")
    .delete()
    .in("session_id", ids);
  if (delAnswersError) {
    showStatus(`Error deleting answers: ${delAnswersError.message}`, "warn");
    return;
  }

  const { error: delParticipantsError } = await sbClient
    .from("participants")
    .delete()
    .in("session_id", ids);
  if (delParticipantsError) {
    showStatus(`Error deleting participants: ${delParticipantsError.message}`, "warn");
    return;
  }

  const { error: delSessionsError } = await sbClient
    .from("sessions")
    .delete()
    .in("id", ids);
  if (delSessionsError) {
    showStatus(`Error deleting sessions: ${delSessionsError.message}`, "warn");
    return;
  }

  showStatus("Past sessions deleted", "info");
}

async function startHostSession(templateId, templateTitle) {
  if (!(await ensureHostTeacherAccess())) {
    return;
  }
  let lastError = null;
  let data = null;

  for (let i = 0; i < 4; i += 1) {
    const code = generateSessionCode();
    const payload = {
      quiz_template_id: templateId,
      code,
      status: "open",
      template_title_snapshot: templateTitle || null
    };

    const result = await sbClient
      .from("sessions")
      .insert(payload)
      .select("id, code, status, quiz_template_id, template_title_snapshot, created_at")
      .single();

    if (!result.error) {
      data = result.data;
      break;
    }
    lastError = result.error;
  }

  if (!data) {
    showStatus(`Session creation error: ${lastError ? lastError.message : "unknown"}`, "warn");
    return;
  }

  state.host.currentSession = data;
  state.host.stage = "live";
  state.host.resultIndex = 0;
  await renderHostSessionLive();
  showStatus(`Session "${getSessionDisplayTitle(data)}" started`, "info");
}

async function renderHostSessionLive() {
  if (!(await ensureHostTeacherAccess())) {
    return;
  }
  closeOpenSessionNavDialog();
  closeDeleteTemplateDialog();
  setHostStageClass("live");
  const session = state.host.currentSession;
  if (!session) {
    return;
  }
  persistHostViewPreference({
    stage: "live",
    session_id: session.id,
    results_source: "live"
  });

  const link = buildStudentLink(session.code);
  const localHint = isLocalhostUrl(state.host.baseUrl)
    ? `<p style="margin-top:8px;color:#9a4f0f">You are using localhost: set your local IP (e.g. http://192.168.1.22:8089) so participants can open the link.</p>`
    : "";

  ui.hostView.innerHTML = `
    <div class="host-screen">
      ${renderHostToolbar("live")}
      <article class="card host-card host-live-card">
        <div class="live-head">
          <h2>${escapeHtml(getSessionDisplayTitle(session))}</h2>
          <p>Share the QR and monitor completion.</p>
        </div>
        ${localHint}
        <div class="live-main">
          <div class="live-qr-wrap">
            <div class="qr-box" id="qrTarget"></div>
          </div>
          <div id="kpiWrap" class="kpi-column"></div>
        </div>
        <div class="actions live-actions">
          <button id="toggleSettingsBtn" class="secondary">Link settings</button>
          <button id="showResultsBtn" class="primary">Show results</button>
          <button id="closeSessionBtn" class="danger">Close session</button>
        </div>
        <div id="linkSettingsPanel" class="link-settings hidden">
          <label for="baseUrlInput">Base URL for participants</label>
          <input id="baseUrlInput" value="${escapeHtml(state.host.baseUrl)}" />
          <div class="link-box">${escapeHtml(link)}</div>
          <div class="actions">
            <button id="applyBaseUrlBtn" class="ghost">Update URL</button>
            <button id="copyLinkBtn" class="secondary">Copy link</button>
          </div>
        </div>
      </article>
    </div>
  `;

  bindHostToolbarEvents();
  scheduleTopChromeSync();
  createQrCode("qrTarget", link);

  onById("toggleSettingsBtn", "click", () => {
    const panel = document.getElementById("linkSettingsPanel");
    if (!panel) {
      return;
    }
    panel.classList.toggle("hidden");
  });

  onById("applyBaseUrlBtn", "click", async () => {
    const next = document.getElementById("baseUrlInput").value.trim();
    if (!next) {
      showStatus("Enter a valid base URL", "warn");
      return;
    }
    state.host.baseUrl = stripTrailingSlash(next);
    await renderHostSessionLive();
  });

  onById("copyLinkBtn", "click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      showStatus("Link copied to clipboard", "info");
    } catch {
      showStatus("Automatic copy is not available on this browser/network", "warn");
    }
  });

  onById("showResultsBtn", "click", async () => {
    state.host.resultsSource = "live";
    await loadHostSessionData(true);
    state.host.stage = "results";
    state.host.resultIndex = 0;
    await renderHostResultsView();
  });

  onById("closeSessionBtn", "click", async () => {
    await closeHostSession();
  });

  await loadHostSessionData(false);
  hostPollTimer = window.setInterval(async () => {
    await loadHostSessionData(true);
  }, 2500);
}

async function renderHostSessionClosedView() {
  if (!(await ensureHostTeacherAccess())) {
    return;
  }
  closeOpenSessionNavDialog();
  closeDeleteTemplateDialog();
  setHostStageClass("closed");
  const session = state.host.currentSession;
  if (!session) {
    return;
  }
  persistHostViewPreference({
    stage: "closed",
    session_id: session.id,
    results_source: "closed"
  });

  const link = buildStudentLink(session.code);
  ui.hostView.innerHTML = `
    <div class="host-screen">
      ${renderHostToolbar("closed")}
      <article class="card host-card host-live-card">
        <div class="live-head">
          <h2>${escapeHtml(getSessionDisplayTitle(session))}</h2>
          <p>Session closed. No new answers are accepted.</p>
        </div>
        <div class="live-qr-wrap qr-closed-state">
          <div class="qr-box" id="qrTarget"></div>
          <span class="closed-badge">CLOSED</span>
        </div>
        <div class="actions">
          <button id="showResultsBtn" class="primary">Show results</button>
          <button id="backHomeBtn" class="secondary">Back to quiz home</button>
        </div>
        <div class="hidden">${escapeHtml(link)}</div>
      </article>
    </div>
  `;

  bindHostToolbarEvents();
  scheduleTopChromeSync();
  createQrCode("qrTarget", link);

  onById("showResultsBtn", "click", async () => {
    state.host.resultsSource = "live";
    await loadHostSessionData(true);
    state.host.stage = "results";
    state.host.resultIndex = 0;
    await renderHostResultsView();
  });

  onById("backHomeBtn", "click", async () => {
    state.host.currentSession = null;
    await renderHostView();
  });
}

async function loadHostSessionData(silent) {
  if (!(await ensureHostTeacherAccess(false))) {
    return;
  }
  if (!state.host.currentSession) {
    return;
  }

  const sessionId = state.host.currentSession.id;

  const [{ data: participants }, { data: answers }, { data: qRows }, { data: sessionRow }] = await Promise.all([
    sbClient.from("participants").select("participant_token").eq("session_id", sessionId),
    sbClient.from("answers").select("question_id, option_id, participant_token").eq("session_id", sessionId),
    sbClient
      .from("questions")
      .select("id, prompt, order_index, question_options(id, label, is_correct, order_index)")
      .eq("quiz_template_id", state.host.currentSession.quiz_template_id)
      .order("order_index", { ascending: true }),
    sbClient
      .from("sessions")
      .select("status, template_title_snapshot")
      .eq("id", sessionId)
      .maybeSingle()
  ]);

  if (sessionRow && sessionRow.status) {
    state.host.currentSession.status = sessionRow.status;
    state.host.currentSession.template_title_snapshot = sessionRow.template_title_snapshot || state.host.currentSession.template_title_snapshot;
  }

  const questions = normalizeQuestions(qRows || []);
  const participantTokens = new Set((participants || []).map((p) => p.participant_token).filter(Boolean));
  const answersByParticipant = new Map();

  for (const a of answers || []) {
    if (a.participant_token) {
      participantTokens.add(a.participant_token);
    }
    if (!answersByParticipant.has(a.participant_token)) {
      answersByParticipant.set(a.participant_token, new Set());
    }
    answersByParticipant.get(a.participant_token).add(a.question_id);
  }

  const participantCount = participantTokens.size;

  let completed = 0;
  for (const set of answersByParticipant.values()) {
    if (set.size >= questions.length) {
      completed += 1;
    }
  }

  state.host.questions = questions;
  state.host.answers = answers || [];
  state.host.participantCount = participantCount;
  state.host.completedCount = completed;

  const kpiWrap = document.getElementById("kpiWrap");
  if (state.host.stage === "live" && kpiWrap) {
    kpiWrap.innerHTML = `
      <div class="kpi kpi-compact"><span>Connected</span><strong>${participantCount}</strong></div>
      <div class="kpi kpi-compact"><span>Completed</span><strong>${completed}</strong></div>
    `;
  }

  if (state.host.stage === "results") {
    renderHostResultsSlide();
  }

  if (state.host.stage === "live" && state.host.currentSession.status === "closed") {
    clearHostPolling();
    state.host.stage = "results";
    state.host.resultsSource = "closed";
    await renderHostResultsView();
    return;
  }

  if (!silent) {
    showStatus("Metrics updated", "info");
  }
}

async function renderHostResultsView() {
  if (!(await ensureHostTeacherAccess())) {
    return;
  }
  closeOpenSessionNavDialog();
  closeDeleteTemplateDialog();
  if (!state.host.currentSession) {
    return;
  }
  state.host.stage = "results";
  persistHostViewPreference({
    stage: "results",
    session_id: state.host.currentSession.id,
    results_source: state.host.resultsSource || "live"
  });

  const isPastSource = state.host.resultsSource === "past";
  const isClosedSource = state.host.resultsSource === "closed";
  const canCloseLiveSession = !isPastSource && !isClosedSource && state.host.currentSession?.status === "open";
  const actionsHtml = isPastSource
    ? `
      <button id="backToPastBtn" class="secondary">Back</button>
    `
    : isClosedSource
      ? ``
    : `
      <button id="backToLiveBtn" class="secondary">Back to QR</button>
      <button id="refreshResultsBtn" class="ghost">Refresh data</button>
      ${canCloseLiveSession ? '<button id="closeSessionFromResultsBtn" class="danger">Close session</button>' : ""}
    `;

  setHostStageClass("results");
  clearHostPolling();
  destroyCharts();
  ui.hostView.innerHTML = `
    <div class="host-screen">
      ${renderHostToolbar("results")}
      <article class="card host-card host-results-card results-shell">
        <div class="results-top">
          <div>
            <h2>Results - ${escapeHtml(getSessionDisplayTitle(state.host.currentSession))}</h2>
            <p>Question <span id="resultPosition">1</span> of <span id="resultTotal">1</span></p>
          </div>
          <div class="nav-row">
            <button id="prevResultBtn" class="ghost nav-btn">◀</button>
            <button id="nextResultBtn" class="ghost nav-btn">▶</button>
          </div>
        </div>
        <h3 id="resultPrompt" class="result-prompt"></h3>
        <div class="results-main">
          <div class="result-chart-zone">
            <canvas id="resultChart" height="240"></canvas>
          </div>
          <aside class="result-legend-box">
            <h4>Legend</h4>
            <div class="legend-scroll" id="resultLegend"></div>
          </aside>
        </div>
        <div class="actions">
          ${actionsHtml}
        </div>
      </article>
    </div>
  `;

  bindHostToolbarEvents();
  scheduleTopChromeSync();

  onById("prevResultBtn", "click", () => {
    if (state.host.resultIndex > 0) {
      state.host.resultIndex -= 1;
      renderHostResultsSlide();
    }
  });

  onById("nextResultBtn", "click", () => {
    if (state.host.resultIndex < state.host.questions.length - 1) {
      state.host.resultIndex += 1;
      renderHostResultsSlide();
    }
  });

  if (isPastSource) {
    onById("backToPastBtn", "click", async () => {
      await renderHostPastSessionsView();
    });
  } else {
    onById("backToLiveBtn", "click", async () => {
      if (state.host.currentSession && state.host.currentSession.status === "closed") {
        state.host.stage = "closed";
        await renderHostSessionClosedView();
        return;
      }
      state.host.stage = "live";
      await renderHostSessionLive();
    });

    onById("refreshResultsBtn", "click", async () => {
      await loadHostSessionData(false);
    });

    if (canCloseLiveSession) {
      onById("closeSessionFromResultsBtn", "click", async () => {
        await closeHostSession();
      });
    }
  }

  renderHostResultsSlide();
}

function renderHostResultsSlide() {
  const questions = state.host.questions || [];
  if (!questions.length) {
    const prompt = document.getElementById("resultPrompt");
    if (prompt) {
      prompt.textContent = "No questions found for this session.";
    }
    return;
  }

  const idx = Math.max(0, Math.min(state.host.resultIndex, questions.length - 1));
  state.host.resultIndex = idx;
  const question = questions[idx];
  const answers = state.host.answers || [];
  const counts = question.options.map((opt) =>
    answers.filter((a) => a.question_id === question.id && a.option_id === opt.id).length
  );

  const resultPosition = document.getElementById("resultPosition");
  const resultTotal = document.getElementById("resultTotal");
  const resultPrompt = document.getElementById("resultPrompt");
  const resultLegend = document.getElementById("resultLegend");
  const prevBtn = document.getElementById("prevResultBtn");
  const nextBtn = document.getElementById("nextResultBtn");

  if (resultPosition) resultPosition.textContent = String(idx + 1);
  if (resultTotal) resultTotal.textContent = String(questions.length);
  if (resultPrompt) resultPrompt.textContent = question.prompt;
  if (prevBtn) prevBtn.disabled = idx === 0;
  if (nextBtn) nextBtn.disabled = idx === questions.length - 1;

  if (resultLegend) {
    const total = counts.reduce((acc, n) => acc + n, 0);
    resultLegend.innerHTML = question.options
      .map((opt, i) => {
        const pct = total > 0 ? Math.round((counts[i] / total) * 100) : 0;
        const cls = opt.is_correct ? "result-row correct" : "result-row";
        const color = chartPalette[i % chartPalette.length];
        return `<div class="${cls}"><span class="legend-label"><i class="legend-swatch" style="background:${color}"></i>${escapeHtml(opt.label)}</span><span>${counts[i]} (${pct}%)</span></div>`;
      })
      .join("");
  }

  destroyCharts();
  const ctx = document.getElementById("resultChart");
  if (!ctx) {
    return;
  }

  const chart = new Chart(ctx, {
    type: "pie",
    data: {
      labels: question.options.map((o) => o.label),
      datasets: [{
        data: counts,
        backgroundColor: chartPalette,
        borderColor: "#ffffff",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: false
        }
      }
    }
  });

  hostCharts.push(chart);
}

async function closeHostSession() {
  if (!(await ensureHostTeacherAccess())) {
    return;
  }
  const session = state.host.currentSession;
  if (!session) {
    return;
  }

  const { error } = await sbClient
    .from("sessions")
    .update({ status: "closed" })
    .eq("id", session.id);

  if (error) {
    showStatus(`Error closing session: ${error.message}`, "warn");
    return;
  }

  clearHostPolling();
  state.host.currentSession.status = "closed";
  state.host.stage = "results";
  state.host.resultsSource = "closed";
  showStatus(`Session ${session.code} closed`, "info");
  await loadHostSessionData(true);
  await renderHostResultsView();
}

async function renderStudentView() {
  ui.studentView.innerHTML = "";
  syncStudentUrlParticipantToken();

  if (!state.student.sessionCode) {
    ui.studentView.innerHTML = `
      <article class="card stack">
        <h2>Join Session</h2>
        <p>Enter the session code you received.</p>
        <label for="sessionCodeInput">Session code</label>
        <input id="sessionCodeInput" maxlength="8" placeholder="E.g. AB12CD" />
        <button id="joinSessionBtn" class="primary">Join</button>
      </article>
    `;

    onById("joinSessionBtn", "click", () => {
      const code = document.getElementById("sessionCodeInput").value.trim().toUpperCase();
      if (!code) {
        showStatus("Enter a valid session code", "warn");
        return;
      }
      state.student.sessionCode = code;
      const url = new URL(window.location.href);
      url.searchParams.set("mode", "student");
      url.searchParams.set("session", code);
      url.searchParams.set(PARTICIPANT_TOKEN_QUERY_KEY, state.student.participantToken);
      window.history.replaceState({}, "", url);
      renderStudentView();
    });

    return;
  }

  ui.studentView.innerHTML = `<article class="card"><p>Loading session...</p></article>`;

  const session = await fetchSessionByCode(state.student.sessionCode);
  if (!session) {
    ui.studentView.innerHTML = `
      <article class="card">
        <h2>Session not found</h2>
        <p>Check the code or wait until the session is available.</p>
      </article>
    `;
    return;
  }

  if (session.status !== "open") {
    const sessionTitle = getStudentSessionTitle(session);
    ui.studentView.innerHTML = `
      <article class="card">
        <h2>Session closed</h2>
        <p>${escapeHtml(sessionTitle)} no longer accepts answers.</p>
      </article>
    `;
    return;
  }

  state.student.session = session;

  const questions = await fetchQuestionsForTemplate(session.quiz_template_id);
  state.student.questions = questions;

  const alreadyCompleted = await hasParticipantCompletedSession(
    session.id,
    state.student.participantToken,
    questions.length
  );
  if (alreadyCompleted) {
    state.student.introCompleted = true;
    state.student.finished = true;
    renderStudentDone();
    return;
  }

  if (!state.student.introCompleted) {
    renderStudentIntro();
    return;
  }

  if (state.student.finished) {
    renderStudentDone();
    return;
  }

  renderStudentQuestion();
}

function renderStudentIntro() {
  ui.studentView.innerHTML = `
    <article class="card stack">
      <h2>${escapeHtml(getStudentSessionTitle(state.student.session))}</h2>
      <p>Choose avatar and nickname (optional), then start the quiz.</p>

      <label for="nicknameInput">Nickname (optional)</label>
      <input id="nicknameInput" maxlength="24" placeholder="E.g. Galileo" value="${escapeHtml(state.student.nickname)}" />

      <div>
        <label>Avatar</label>
        <div class="avatar-grid" id="avatarGrid"></div>
      </div>

      <button id="startQuizBtn" class="primary">Start quiz</button>
    </article>
  `;

  const avatarGrid = document.getElementById("avatarGrid");
  avatarGrid.innerHTML = avatars.map((avatarPath, idx) => {
    const active = avatarPath === state.student.avatar ? "active" : "";
    const n = idx + 1;
    return `<button class="avatar-btn ${active}" data-avatar="${avatarPath}" aria-label="Avatar ${n}"><img src="${avatarPath}" alt="" class="avatar-img" width="32" height="32" /></button>`;
  }).join("");

  avatarGrid.querySelectorAll(".avatar-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.student.avatar = btn.dataset.avatar;
      renderStudentIntro();
    });
  });

  onById("startQuizBtn", "click", async () => {
    state.student.nickname = document.getElementById("nicknameInput").value.trim();
    const registered = await upsertParticipant();
    if (!registered) {
      return;
    }
    state.student.introCompleted = true;
    state.student.currentQuestion = 0;
    state.student.finished = false;
    await renderStudentView();
  });
}

function renderStudentQuestion() {
  const question = state.student.questions[state.student.currentQuestion];
  const total = state.student.questions.length;
  const progressPct = Math.round(((state.student.currentQuestion) / total) * 100);

  ui.studentView.innerHTML = `
    <article class="card stack">
      <div>
        <p>Question ${state.student.currentQuestion + 1} of ${total}</p>
        <div class="progress"><span style="width:${progressPct}%"></span></div>
      </div>

      <h2>${escapeHtml(question.prompt)}</h2>
      <div id="optionsWrap" class="options"></div>

      <button id="nextQuestionBtn" class="primary">Confirm and continue</button>
    </article>
  `;

  const optionsWrap = document.getElementById("optionsWrap");
  optionsWrap.innerHTML = question.options.map((opt) => {
    const selected = state.student.selectedOptionId === opt.id ? "selected" : "";
    return `<button class="option-btn ${selected}" data-id="${opt.id}">${escapeHtml(opt.label)}</button>`;
  }).join("");

  optionsWrap.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.student.selectedOptionId = btn.dataset.id;
      renderStudentQuestion();
    });
  });

  onById("nextQuestionBtn", "click", async () => {
    if (!state.student.selectedOptionId) {
      showStatus("Select an answer", "warn");
      return;
    }

    const ok = await submitAnswer(state.student.questions[state.student.currentQuestion].id, state.student.selectedOptionId);
    if (!ok) {
      return;
    }

    state.student.selectedOptionId = null;
    state.student.currentQuestion += 1;

    if (state.student.currentQuestion >= total) {
      state.student.finished = true;
    }

    await renderStudentView();
  });
}

function renderStudentDone() {
  ui.studentView.innerHTML = `
    <article class="card stack">
      <h2>Thank you!</h2>
      <p>You have completed the quiz. Your answers have been submitted successfully.</p>
    </article>
  `;
}

async function fetchQuizTemplates() {
  const { data, error } = await sbClient
    .from("quiz_templates")
    .select("id, title, description")
    .order("created_at", { ascending: true });

  if (error) {
    showStatus(`Error loading templates: ${error.message}`, "warn");
    return [];
  }

  return data || [];
}

async function fetchPastSessions() {
  const { data, error } = await sbClient
    .from("sessions")
    .select("id, code, status, created_at, quiz_template_id, template_title_snapshot, quiz_templates(title)")
    .eq("status", "closed")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    showStatus(`Error reading past sessions: ${error.message}`, "warn");
    return [];
  }
  return data || [];
}

function formatDateTime(raw) {
  if (!raw) {
    return "";
  }
  const d = new Date(raw);
  return `${d.toLocaleDateString("en-US")} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
}

async function fetchSessionByCode(code) {
  const { data, error } = await sbClient
    .from("sessions")
    .select("id, code, status, quiz_template_id, template_title_snapshot, quiz_templates(title)")
    .eq("code", code)
    .limit(1)
    .maybeSingle();

  if (error) {
    showStatus(`Session error: ${error.message}`, "warn");
    return null;
  }

  return data;
}

function getStudentSessionTitle(session) {
  if (session && session.quiz_templates && session.quiz_templates.title) {
    return session.quiz_templates.title;
  }
  if (session && session.template_title_snapshot) {
    return session.template_title_snapshot;
  }
  return "Quiz Session";
}

async function fetchQuestionsForTemplate(templateId) {
  const { data, error } = await sbClient
    .from("questions")
    .select("id, prompt, order_index, question_options(id, label, order_index, is_correct)")
    .eq("quiz_template_id", templateId)
    .order("order_index", { ascending: true });

  if (error) {
    showStatus(`Error loading questions: ${error.message}`, "warn");
    return [];
  }

  return normalizeQuestions(data || []);
}

async function hasParticipantCompletedSession(sessionId, participantToken, totalQuestions) {
  if (!sessionId || !participantToken || totalQuestions <= 0) {
    return false;
  }

  const { data, error } = await sbClient
    .from("answers")
    .select("question_id")
    .eq("session_id", sessionId)
    .eq("participant_token", participantToken);

  if (error) {
    showStatus(`Error checking completion status: ${error.message}`, "warn");
    return false;
  }

  const answeredQuestions = new Set((data || []).map((row) => row.question_id)).size;
  return answeredQuestions >= totalQuestions;
}

function normalizeQuestions(rows) {
  return rows.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    order_index: q.order_index,
    options: (q.question_options || []).sort((a, b) => a.order_index - b.order_index)
  }));
}

async function upsertParticipant() {
  if (!state.student.session || !state.student.session.id) {
    showStatus("Session is not available", "warn");
    return false;
  }

  const { data: freshSession, error: sessionError } = await sbClient
    .from("sessions")
    .select("status")
    .eq("id", state.student.session.id)
    .maybeSingle();

  if (sessionError) {
    showStatus(`Session check warning: ${sessionError.message}. Continuing...`, "warn");
  }

  if (freshSession && freshSession.status !== "open") {
    state.student.session.status = "closed";
    showStatus("Session closed, registration blocked", "warn");
    await renderStudentView();
    return false;
  }
  if (!freshSession && !sessionError) {
    showStatus("Session not found anymore", "warn");
    return false;
  }

  const payload = {
    session_id: state.student.session.id,
    participant_token: state.student.participantToken,
    nickname: state.student.nickname || null,
    avatar: state.student.avatar
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { error } = await sbClient
      .from("participants")
      .insert(payload);

    if (!error) {
      return true;
    }

    const duplicate = error.code === "23505" || (error.message || "").toLowerCase().includes("duplicate key");
    if (duplicate) {
      return true;
    }

    const msg = (error.message || "").toLowerCase();
    const rlsDenied = error.code === "42501" || msg.includes("row-level security");
    if (rlsDenied) {
      showStatus("Participant tracking is unavailable, but you can continue the quiz.", "warn");
      return true;
    }

    if (attempt < 2) {
      await wait(180);
      continue;
    }
    showStatus(`Participant tracking warning: ${error.message}. Continuing...`, "warn");
    return true;
  }
  return true;
}

async function submitAnswer(questionId, optionId) {
  if (!state.student.session || state.student.session.status !== "open") {
    showStatus("Session closed, submission blocked", "warn");
    await renderStudentView();
    return false;
  }

  const { data: freshSession } = await sbClient
    .from("sessions")
    .select("status")
    .eq("id", state.student.session.id)
    .maybeSingle();

  if (!freshSession || freshSession.status !== "open") {
    state.student.session.status = "closed";
    showStatus("Session closed, submission blocked", "warn");
    await renderStudentView();
    return false;
  }

  const payload = {
    session_id: state.student.session.id,
    participant_token: state.student.participantToken,
    question_id: questionId,
    option_id: optionId
  };

  const { error } = await sbClient
    .from("answers")
    .upsert(payload, { onConflict: "session_id,participant_token,question_id" });

  if (error) {
    showStatus(`Answer submission error: ${error.message}`, "warn");
    return false;
  }

  showStatus("Answer saved", "info");
  return true;
}

function createQrCode(targetId, text) {
  const target = document.getElementById(targetId);
  if (!target) {
    return;
  }
  target.innerHTML = "";
  // qrcodejs espone il costruttore globale QRCode
  new QRCode(target, {
    text,
    width: 160,
    height: 160,
    colorDark: "#1f2b45",
    colorLight: "#ffffff"
  });
}

function buildStudentLink(sessionCode) {
  const base = stripTrailingSlash(state.host.baseUrl || window.location.origin);
  const url = new URL(`${base}/`);
  url.searchParams.set("mode", "student");
  url.searchParams.set("session", sessionCode);
  return url.toString();
}

function buildHostOAuthRedirectUrl() {
  const redirectUrl = new URL(window.location.origin);
  redirectUrl.pathname = getCanonicalAppPathname();
  redirectUrl.searchParams.set("mode", "host");
  redirectUrl.searchParams.delete("session");
  redirectUrl.hash = "";
  return redirectUrl;
}

function getModeFromUrl() {
  const mode = new URLSearchParams(window.location.search).get("mode");
  return mode === "student" ? "student" : "host";
}

function getSessionCodeFromUrl() {
  const code = new URLSearchParams(window.location.search).get("session") || "";
  return code.trim().toUpperCase();
}

function getParticipantTokenFromUrl() {
  const raw = new URLSearchParams(window.location.search).get(PARTICIPANT_TOKEN_QUERY_KEY) || "";
  const token = raw.trim();
  return isValidParticipantToken(token) ? token : "";
}

function enforceCanonicalEntryUrl() {
  const current = new URL(window.location.href);
  if (isSupabaseAuthCallbackUrl(current)) {
    return false;
  }

  const target = new URL(window.location.href);
  target.pathname = getCanonicalAppPathname();
  target.hash = "";
  target.search = "";

  const requestedMode = current.searchParams.get("mode");
  const requestedSession = (current.searchParams.get("session") || "").trim().toUpperCase();
  const requestedParticipantToken = getParticipantTokenFromUrl();
  const isStudentRoute = requestedMode === "student" && isValidSessionCode(requestedSession);

  if (isStudentRoute) {
    target.searchParams.set("mode", "student");
    target.searchParams.set("session", requestedSession);
    if (requestedParticipantToken) {
      target.searchParams.set(PARTICIPANT_TOKEN_QUERY_KEY, requestedParticipantToken);
    }
  } else {
    target.searchParams.set("mode", "host");
  }

  if (current.pathname !== target.pathname || current.search !== target.search || current.hash !== target.hash) {
    window.location.replace(target.toString());
    return true;
  }
  return false;
}

function getCanonicalAppPathname() {
  if (APP.PUBLIC_BASE_URL) {
    try {
      const base = new URL(APP.PUBLIC_BASE_URL, window.location.origin);
      return normalizePathname(base.pathname);
    } catch {
      // fallback below
    }
  }
  return "/";
}

function normalizePathname(pathname) {
  const clean = String(pathname || "/").replace(/\/+$/, "");
  return clean || "/";
}

function isValidSessionCode(code) {
  return /^[A-Z0-9]{4,12}$/.test(String(code || "").trim().toUpperCase());
}

function isValidParticipantToken(token) {
  return /^[A-Za-z0-9_-]{16,128}$/.test(String(token || "").trim());
}

function isSupabaseAuthCallbackUrl(urlObj) {
  const search = urlObj.searchParams;
  if (
    search.has("code")
    || search.has("state")
    || search.has("error")
    || search.has("error_code")
    || search.has("error_description")
    || search.has("provider_token")
    || search.has("provider_refresh_token")
  ) {
    return true;
  }

  const hashParams = new URLSearchParams(String(urlObj.hash || "").replace(/^#+/, ""));
  return (
    hashParams.has("access_token")
    || hashParams.has("refresh_token")
    || hashParams.has("token_type")
    || hashParams.has("expires_in")
    || hashParams.has("type")
    || hashParams.has("error")
    || hashParams.has("error_code")
    || hashParams.has("error_description")
  );
}

function normalizeLocationHashArtifacts() {
  const current = new URL(window.location.href);
  const currentHash = String(current.hash || "");
  let normalizedHash = currentHash;

  if (currentHash === "#") {
    normalizedHash = "";
  } else if (/^##+/.test(currentHash)) {
    normalizedHash = `#${currentHash.replace(/^#+/, "")}`;
  }

  if (normalizedHash === currentHash) {
    return;
  }

  current.hash = normalizedHash;
  window.history.replaceState({}, "", current.toString());
  logDebug("info", "url_hash_normalized", { from: currentHash, to: normalizedHash || "(empty)" });
}

function isInAuthCallbackGraceWindow() {
  return authCallbackGraceUntil > 0 && Date.now() < authCallbackGraceUntil;
}

function getOrCreateParticipantToken() {
  const key = "quizqr_participant_token";
  const storage = getSafeStorage();
  const fromUrl = getParticipantTokenFromUrl();
  if (fromUrl) {
    if (storage) {
      storage.setItem(key, fromUrl);
    }
    return fromUrl;
  }

  const existing = storage ? storage.getItem(key) : null;
  if (isValidParticipantToken(existing || "")) {
    return existing;
  }
  const token = generateToken();
  if (storage) {
    storage.setItem(key, token);
  }
  return token;
}

function syncStudentUrlParticipantToken() {
  if (state.mode !== "student" || !state.student.sessionCode || !state.student.participantToken) {
    return;
  }
  const current = new URL(window.location.href);
  const currentToken = (current.searchParams.get(PARTICIPANT_TOKEN_QUERY_KEY) || "").trim();
  if (currentToken === state.student.participantToken) {
    return;
  }
  current.searchParams.set("mode", "student");
  current.searchParams.set("session", state.student.sessionCode);
  current.searchParams.set(PARTICIPANT_TOKEN_QUERY_KEY, state.student.participantToken);
  window.history.replaceState({}, "", current.toString());
}

function generateToken() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  if (window.crypto && typeof window.crypto.getRandomValues === "function") {
    const arr = new Uint8Array(16);
    window.crypto.getRandomValues(arr);
    arr[6] = (arr[6] & 0x0f) | 0x40;
    arr[8] = (arr[8] & 0x3f) | 0x80;
    const hex = [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `tok_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getSafeStorage() {
  try {
    const testKey = "__quizqr_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeHostViewStage(stage) {
  const allowed = new Set(["setup", "settings", "archives", "live", "results", "closed"]);
  const value = String(stage || "").trim().toLowerCase();
  return allowed.has(value) ? value : "";
}

function getStoredHostViewPreference() {
  const storage = getSafeStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(HOST_VIEW_PREF_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const stage = normalizeHostViewStage(parsed?.stage);
    if (!stage) {
      return null;
    }
    return {
      stage,
      session_id: typeof parsed?.session_id === "string" ? parsed.session_id : null,
      selected_template_id: typeof parsed?.selected_template_id === "string" ? parsed.selected_template_id : null,
      results_source: typeof parsed?.results_source === "string" ? parsed.results_source : null
    };
  } catch {
    return null;
  }
}

function persistHostViewPreference(next) {
  const storage = getSafeStorage();
  if (!storage) {
    return;
  }
  const stage = normalizeHostViewStage(next?.stage);
  if (!stage) {
    return;
  }
  const payload = {
    stage,
    session_id: typeof next?.session_id === "string" ? next.session_id : null,
    selected_template_id: typeof next?.selected_template_id === "string" ? next.selected_template_id : null,
    results_source: typeof next?.results_source === "string" ? next.results_source : null,
    ts: new Date().toISOString()
  };
  try {
    storage.setItem(HOST_VIEW_PREF_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // no-op: storage can be unavailable or full
  }
}

function clearHostViewPreference(reason = "") {
  const storage = getSafeStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(HOST_VIEW_PREF_STORAGE_KEY);
  } catch {
    // no-op
  }
  if (reason) {
    logDebug("info", "host_view_pref_cleared", { reason });
  }
}

async function fetchHostSessionForRestore(sessionId) {
  if (!sessionId) {
    return null;
  }
  const { data, error } = await sbClient
    .from("sessions")
    .select("id, code, status, quiz_template_id, template_title_snapshot, created_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) {
    logDebug("warn", "host_view_restore_session_error", {
      session_id: sessionId,
      message: error.message || "unknown"
    });
    return null;
  }
  return data || null;
}

async function tryRestoreHostViewFromPreference() {
  const pref = getStoredHostViewPreference();
  if (!pref) {
    return false;
  }

  logDebug("info", "host_view_restore_attempt", {
    stage: pref.stage,
    session_id: pref.session_id || ""
  });

  if (pref.stage === "setup") {
    await renderHostView();
    return true;
  }

  if (pref.stage === "settings") {
    await renderHostSettingsView(pref.selected_template_id || null);
    return true;
  }

  if (pref.stage === "archives") {
    await renderHostPastSessionsView();
    return true;
  }

  if (!pref.session_id) {
    clearHostViewPreference("missing_session_id");
    return false;
  }

  const session = await fetchHostSessionForRestore(pref.session_id);
  if (!session) {
    clearHostViewPreference("session_not_found");
    return false;
  }

  state.host.currentSession = session;
  state.host.resultIndex = 0;

  if (pref.stage === "live") {
    if (session.status === "open") {
      state.host.stage = "live";
      state.host.resultsSource = "live";
      await renderHostSessionLive();
      return true;
    }
    state.host.stage = "results";
    state.host.resultsSource = "closed";
    await loadHostSessionData(true);
    await renderHostResultsView();
    return true;
  }

  if (pref.stage === "closed") {
    if (session.status === "closed") {
      state.host.stage = "closed";
      await renderHostSessionClosedView();
      return true;
    }
    state.host.stage = "live";
    state.host.resultsSource = "live";
    await renderHostSessionLive();
    return true;
  }

  if (pref.stage === "results") {
    let source = pref.results_source || "live";
    if (!["live", "past", "closed"].includes(source)) {
      source = "live";
    }
    if (session.status === "open" && source !== "live") {
      source = "live";
    }
    if (session.status === "closed" && source === "live") {
      source = "closed";
    }
    state.host.stage = "results";
    state.host.resultsSource = source;
    await loadHostSessionData(true);
    await renderHostResultsView();
    return true;
  }

  clearHostViewPreference("unsupported_stage");
  return false;
}

function generateSessionCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function getInitialBaseUrl() {
  if (APP.PUBLIC_BASE_URL) {
    return stripTrailingSlash(APP.PUBLIC_BASE_URL);
  }
  return stripTrailingSlash(window.location.origin);
}

function isLocalhostUrl(value) {
  try {
    const u = new URL(value);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function clearHostPolling() {
  if (hostPollTimer) {
    window.clearInterval(hostPollTimer);
    hostPollTimer = null;
  }
}

function destroyCharts() {
  for (const chart of hostCharts) {
    chart.destroy();
  }
  hostCharts = [];
}

function countDistinct(values) {
  return new Set(values.filter(Boolean)).size;
}

function showStatus(message, type = "info") {
  logDebug(type === "warn" ? "warn" : "info", "status", { message });
  ui.statusBanner.textContent = message;
  ui.statusBanner.classList.remove("hidden", "status-info", "status-warn");
  ui.statusBanner.classList.add(type === "warn" ? "status-warn" : "status-info");
}

function initDebugLog() {
  if (!isDebugLogPersistenceEnabled()) {
    clearStoredDebugLog();
  }
  debugLogEntries = loadStoredDebugLog();
  logDebug("info", "debug_log_initialized", {
    existing_entries: debugLogEntries.length
  });
}

function ensureDebugLogDownloadBinding() {
  window.downloadQuizQrDebugLog = () => {
    downloadDebugLogFile();
  };
}

function ensureDebugLogButton() {
  if (document.getElementById("debugLogBtn")) {
    return;
  }
  const btn = document.createElement("button");
  btn.id = "debugLogBtn";
  btn.textContent = "Download log";
  btn.className = "ghost mini-btn";
  btn.style.position = "fixed";
  btn.style.right = "14px";
  btn.style.bottom = "14px";
  btn.style.zIndex = "40";
  btn.style.opacity = "0.86";
  btn.style.backdropFilter = "blur(4px)";
  btn.addEventListener("click", () => {
    downloadDebugLogFile();
  });
  document.body.appendChild(btn);
}

function isDebugLogButtonEnabled() {
  const raw = APP.ENABLE_DEBUG_LOG_BUTTON;
  if (raw === true) {
    return true;
  }
  const asText = String(raw || "").trim().toLowerCase();
  return asText === "1" || asText === "true" || asText === "yes" || asText === "on";
}

function isDebugLogPersistenceEnabled() {
  const raw = APP.ENABLE_DEBUG_LOG_PERSISTENCE;
  if (raw === true) {
    return true;
  }
  const asText = String(raw || "").trim().toLowerCase();
  return asText === "1" || asText === "true" || asText === "yes" || asText === "on";
}

function loadStoredDebugLog() {
  if (!isDebugLogPersistenceEnabled()) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(DEBUG_LOG_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistDebugLog() {
  if (!isDebugLogPersistenceEnabled()) {
    return;
  }
  try {
    window.localStorage.setItem(DEBUG_LOG_STORAGE_KEY, JSON.stringify(debugLogEntries));
  } catch {
    // no-op: storage can be unavailable or full
  }
}

function clearStoredDebugLog() {
  try {
    window.localStorage.removeItem(DEBUG_LOG_STORAGE_KEY);
  } catch {
    // no-op
  }
}

function logDebug(level, event, payload = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    mode: state?.mode || "unknown",
    href: window.location.href,
    payload: sanitizeLogPayload(payload)
  };
  debugLogEntries.push(entry);
  if (debugLogEntries.length > DEBUG_LOG_MAX_ENTRIES) {
    debugLogEntries = debugLogEntries.slice(-DEBUG_LOG_MAX_ENTRIES);
  }
  persistDebugLog();
}

function sanitizeLogPayload(payload) {
  try {
    return JSON.parse(JSON.stringify(payload || {}));
  } catch {
    return { note: "non-serializable payload" };
  }
}

function buildDebugLogText() {
  const lines = [];
  lines.push(`# QuizQR debug log`);
  lines.push(`# generated_at=${new Date().toISOString()}`);
  lines.push(`# entries=${debugLogEntries.length}`);
  lines.push("");
  for (const entry of debugLogEntries) {
    lines.push(JSON.stringify(entry));
  }
  return `${lines.join("\n")}\n`;
}

function downloadDebugLogFile() {
  const body = buildDebugLogText();
  const safeTs = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const filename = `quizqr-debug-${safeTs}.log`;
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
  logDebug("info", "debug_log_downloaded", { filename });
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function onById(id, eventName, handler) {
  const el = document.getElementById(id);
  if (!el) {
    logDebug("warn", "missing_dom_element", { id, event: eventName });
    console.warn(`[quizqr] element not found: #${id}`);
    return;
  }
  el.addEventListener(eventName, handler);
}

function setHostLayoutEnabled(enabled) {
  const body = document.body;
  const shell = document.querySelector(".app-shell");
  if (!body || !shell) {
    return;
  }
  body.classList.toggle("host-mode", enabled);
  shell.classList.toggle("host-fit", enabled);
}

function setHostStageClass(stage) {
  ui.hostView.classList.remove("host-setup", "host-live", "host-results", "host-settings", "host-closed", "host-archives");
  if (stage === "setup") {
    ui.hostView.classList.add("host-setup");
  }
  if (stage === "live") {
    ui.hostView.classList.add("host-live");
  }
  if (stage === "results") {
    ui.hostView.classList.add("host-results");
  }
  if (stage === "settings") {
    ui.hostView.classList.add("host-settings");
  }
  if (stage === "closed") {
    ui.hostView.classList.add("host-closed");
  }
  if (stage === "archives") {
    ui.hostView.classList.add("host-archives");
  }
}

function normalizeAppTitle(value) {
  const trimmed = String(value || "").trim();
  return trimmed || DEFAULT_APP_TITLE;
}

function getStoredAppTitle() {
  try {
    return normalizeAppTitle(window.localStorage.getItem(APP_TITLE_STORAGE_KEY));
  } catch {
    return DEFAULT_APP_TITLE;
  }
}

function persistAppTitle(value) {
  try {
    window.localStorage.setItem(APP_TITLE_STORAGE_KEY, normalizeAppTitle(value));
  } catch {
    // no-op: storage may be unavailable in strict/private browser modes
  }
}

function applyAppTitle() {
  const title = normalizeAppTitle(state.host.appTitle);
  state.host.appTitle = title;
  if (ui.appTitle) {
    ui.appTitle.textContent = title;
  }
  document.title = title;
}

function getSessionDisplayTitle(session) {
  if (session && session.template_title_snapshot) {
    return session.template_title_snapshot;
  }
  return "Quiz Session";
}

function resetTopChromeStyles() {
  const topbar = document.querySelector(".topbar");
  const statusBanner = ui.statusBanner;
  if (topbar) {
    topbar.style.paddingLeft = "";
    topbar.style.marginLeft = "";
    topbar.style.maxWidth = "";
  }
  if (statusBanner) {
    statusBanner.style.marginLeft = "";
    statusBanner.style.maxWidth = "";
  }
}

function scheduleTopChromeSync() {
  window.requestAnimationFrame(() => {
    syncTopChromeBounds();
    window.requestAnimationFrame(() => {
      syncTopChromeBounds();
    });
  });
}

function syncTopChromeBounds() {
  const topbar = document.querySelector(".topbar");
  const statusBanner = ui.statusBanner;
  const shell = document.querySelector(".app-shell");
  const hostToolbar = ui.hostView ? ui.hostView.querySelector(".host-toolbar") : null;
  const hostCard = ui.hostView ? ui.hostView.querySelector(".host-card") : null;

  if (!topbar || !statusBanner || !shell || state.mode !== "host" || !hostToolbar || !hostCard) {
    return;
  }

  const shellRect = shell.getBoundingClientRect();
  const toolbarRect = hostToolbar.getBoundingClientRect();
  const cardRect = hostCard.getBoundingClientRect();
  const leftOffset = Math.max(0, Math.round(toolbarRect.left - shellRect.left));
  const width = Math.max(0, Math.round(cardRect.right - toolbarRect.left));

  topbar.style.marginLeft = `${leftOffset}px`;
  topbar.style.maxWidth = `${width}px`;
  statusBanner.style.marginLeft = `${leftOffset}px`;
  statusBanner.style.maxWidth = `${width}px`;
}
