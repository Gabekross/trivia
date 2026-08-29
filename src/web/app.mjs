import { Role, SessionStatus } from "../core/types.mjs";

let activeTab = "operator";
let activeTheme = "confetti";
let displayEditMode = false;
let displayControlsActive = true;
let displayControlsTimer = null;
let displaySettings = { safeArea: 42, scale: 100, vertical: 0, brightness: 100 };
let sessionForm = { winnerMode: "RACE_TO_X", targetCorrect: 2, requiredStreak: 3, startingLives: 3, questionLimit: 3, advanceCount: 3 };
let sessionId = null;
let joinCode = null;
let shareOrigin = window.location.origin;
let currentPlayerId = null;
let eventStream = null;
let pollingTimer = null;
let isRendering = false;
let pendingRender = false;
const initialRoute = parseInitialRoute();

const app = document.querySelector("#app");

await bootstrap();

async function bootstrap() {
  activeTab = initialRoute.tab;
  let boot = null;
  if (initialRoute.sessionId) {
    boot = { sessionId: initialRoute.sessionId, joinCode: initialRoute.joinCode };
  } else if (initialRoute.joinCode) {
    boot = await api(`/api/join-codes/${encodeURIComponent(initialRoute.joinCode)}`);
  } else {
    boot = await api("/api/bootstrap");
  }
  sessionId = boot.sessionId;
  joinCode = boot.joinCode;
  currentPlayerId = getStoredPlayerId();
  shareOrigin = chooseShareOrigin(boot.origins);
  subscribe();
  await render();
}

function parseInitialRoute() {
  const path = window.location.pathname;
  const sessionMatch = path.match(/^\/trivia\/session\/([^/]+)$/);
  if (sessionMatch) return { tab: "player", joinCode: decodeURIComponent(sessionMatch[1]).toUpperCase() };
  const operatorMatch = path.match(/^\/trivia\/operator\/([^/]+)$/);
  if (operatorMatch) return { tab: "operator", sessionId: decodeURIComponent(operatorMatch[1]) };
  const displayMatch = path.match(/^\/trivia\/display\/([^/]+)$/);
  if (displayMatch) return { tab: "display", sessionId: decodeURIComponent(displayMatch[1]) };
  if (path === "/trivia") return { tab: "player" };
  return { tab: "operator" };
}

async function render(snapshotOverride = null) {
  if (isRendering) {
    pendingRender = true;
    return;
  }
  isRendering = true;
  try {
    const snapshot = snapshotOverride || await snapshotForActiveTab();
    joinCode = snapshot.session.joinCode;
    app.innerHTML = `
      <div class="shell theme-${activeTheme}">
        <header class="topbar">
          <div class="brand"><span class="brandMark">FT</span><span>Family Trivia Codex</span></div>
          <nav class="tabs" aria-label="Interfaces">
            ${tabButton("operator", "Operator")}
            ${tabButton("player", "Player")}
            ${tabButton("display", "Display")}
          </nav>
        </header>
        ${activeTab === "operator" ? operatorView(snapshot) : ""}
        ${activeTab === "player" ? playerView(snapshot) : ""}
        ${activeTab === "display" ? displayView(snapshot) : ""}
      </div>
    `;
    bindEvents();
  } finally {
    isRendering = false;
    if (pendingRender && !snapshotOverride) {
      pendingRender = false;
      await render();
    } else {
      pendingRender = false;
    }
  }
}

async function snapshotForActiveTab() {
  const role = activeTab === "player" ? Role.PLAYER : activeTab === "operator" ? Role.OPERATOR : Role.DISPLAY;
  const player = role === Role.PLAYER && currentPlayerId ? `&playerId=${encodeURIComponent(currentPlayerId)}` : "";
  return api(`/api/sessions/${sessionId}/snapshot?role=${role}${player}`);
}

function tabButton(id, label) {
  return `<button class="tab ${activeTab === id ? "active" : ""}" data-tab="${id}">${label}</button>`;
}

function operatorView(snapshot) {
  return `
    <section class="operatorGrid">
      <aside class="controlRail stack">
        <div class="sectionHeader">
          <span class="eyebrow">Session Setup</span>
          <h1>Control Room</h1>
        </div>
        ${themePicker()}
        <label class="label">Game title<input id="title" value="${escapeHtml(snapshot.session.title)}"></label>
        <label class="label">Winner mode
          <select id="winnerMode">
            ${snapshot.session.ruleOptions.map((option) => `<option value="${option.type}" ${snapshot.session.winnerRule.type === option.type ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
        <div class="fieldGrid">
          <label class="label">Race target<input id="target" type="number" min="1" max="50" value="${sessionForm.targetCorrect}"></label>
          <label class="label">Required streak<input id="requiredStreak" type="number" min="1" max="20" value="${sessionForm.requiredStreak}"></label>
          <label class="label">Starting lives<input id="startingLives" type="number" min="1" max="10" value="${sessionForm.startingLives}"></label>
          <label class="label">Question limit<input id="questionLimit" type="number" min="1" max="25" value="${sessionForm.questionLimit}"></label>
          <label class="label">Advance count<input id="advanceCount" type="number" min="1" max="25" value="${sessionForm.advanceCount}"></label>
          <label class="label">Timer<input id="timer" type="number" min="0" max="120" value="${snapshot.session.configuration.timerSeconds}"></label>
          <label class="label">Max players<input id="maxPlayers" type="number" min="1" max="200" value="${snapshot.session.configuration.maxPlayers}"></label>
        </div>
        <button id="newSession" class="primaryBtn">Create Session</button>
        <div class="joinCard">
          <span class="eyebrow">Audience Join Code</span>
          <div class="codeBlock">${snapshot.session.joinCode}</div>
          <div class="joinMeta">${snapshot.session.playerCount} joined - ${ruleSummary(snapshot.session.winnerRule)}</div>
        </div>
        ${publicLinks(snapshot)}
      </aside>
      <section class="liveDesk stack">
        <div class="heroPanel">
          <div>
            <span class="status">${formatStatus(snapshot.session.status)}</span>
            <h2>${escapeHtml(snapshot.session.title)}</h2>
            <p>${operatorSubhead(snapshot)}</p>
          </div>
          <div class="statStrip">
            ${stat("Players", snapshot.session.playerCount)}
            ${stat("Answers", snapshot.answerCount)}
            ${stat("State", shortState(snapshot.session.status))}
          </div>
        </div>
        <div class="showStrip">
          ${cueCard("Now", currentCue(snapshot))}
          ${cueCard("Mode", ruleSummary(snapshot.session.winnerRule))}
          ${cueCard("Round", roundLabel(snapshot))}
        </div>
        ${questionPanel(snapshot, "operator")}
        <div class="commandBar">
          ${actionButton("START", "Start / Next", [SessionStatus.LOBBY, SessionStatus.LEADERBOARD, SessionStatus.PAUSED, SessionStatus.WINNER_FOUND].includes(snapshot.session.status), "primary")}
          ${actionButton("CLOSE_QUESTION", "Close", snapshot.session.status === SessionStatus.QUESTION_ACTIVE)}
          ${actionButton("REVEAL", "Reveal", snapshot.session.status === SessionStatus.QUESTION_ACTIVE || snapshot.session.status === SessionStatus.QUESTION_LOCKED)}
          ${actionButton("SHOW_LEADERBOARD", "Leaderboard", snapshot.session.status === SessionStatus.ANSWER_REVEAL)}
          ${actionButton("ACK_WINNER", "Pause", snapshot.session.status === SessionStatus.WINNER_FOUND)}
          ${actionButton("RESET", "Reset", snapshot.session.status !== SessionStatus.ENDED)}
          ${actionButton("END", "End", snapshot.session.status !== SessionStatus.ENDED, "danger")}
        </div>
        <div class="twoColumn">${leaderboard(snapshot)}${auditLog(snapshot)}</div>
      </section>
    </section>
  `;
}

function playerView(snapshot) {
  const question = snapshot.question;
  return `
    <section class="playerStage">
      <div class="phoneFrame">
        <div class="phoneTop">
          <span class="status">${formatStatus(snapshot.session.status)}</span>
          <strong>${escapeHtml(snapshot.session.title)}</strong>
        </div>
        ${!snapshot.player ? joinPanel(snapshot) : playerHud(snapshot)}
        <section class="phonePanel ${snapshot.player?.status === "WINNER" ? "winner" : ""}">
          ${snapshot.player?.status === "WINNER" ? winnerMoment("You won!", "The host has paused the room for your win.") : ""}
          ${snapshot.session.winner && snapshot.player?.status !== "WINNER" ? winnerMoment(`${winnerName(snapshot)} won`, "Stay connected. The host decides what happens next.") : ""}
          ${question ? playerQuestion(snapshot, question) : waitingPanel(snapshot)}
        </section>
        ${leaderboard(snapshot, "compact")}
      </div>
    </section>
  `;
}

function displayView(snapshot) {
  const question = snapshot.question;
  return `
    <section class="displayStage ${displayControlsActive ? "controlsActive" : "controlsIdle"}" style="${displayStyle()}">
      <div class="displayChrome projectorControls">
        <span class="displayStatus">${formatStatus(snapshot.session.status)}</span>
        <button class="displayEditBtn" id="displayEdit">${displayEditMode ? "Done" : "Edit Screen"}</button>
        <span>${snapshot.session.playerCount} Players</span>
      </div>
      <div class="displaySafeArea ${displayEditMode ? "editing" : ""}">
        ${snapshot.session.status === SessionStatus.LOBBY ? displayLobby(snapshot) : ""}
        ${question ? displayQuestion(snapshot, question) : ""}
        ${snapshot.session.winner ? `<div class="winnerBanner"><span>Winner</span><strong>${winnerName(snapshot)}</strong></div>` : ""}
      </div>
      <div class="displayFooter">${leaderboard(snapshot, "display")}</div>
      <div class="displayControlDock projectorControls">
        <button class="fullscreenBtn" id="fullscreenToggle">Full Screen</button>
      </div>
      ${displayEditMode ? displayEditor() : ""}
    </section>
  `;
}

function displayStyle() {
  return `--safe-area:${displaySettings.safeArea}px;--display-scale:${displaySettings.scale / 100};--display-y:${displaySettings.vertical}px;--display-brightness:${displaySettings.brightness}%;`;
}

function displayEditor() {
  return `
    <aside class="displayEditor">
      <div class="sectionHeader inline"><span class="eyebrow">Projector Fit</span><h2>Edit Screen</h2></div>
      ${rangeControl("safeArea", "Safe area", 0, 120, displaySettings.safeArea)}
      ${rangeControl("scale", "Scale", 82, 112, displaySettings.scale)}
      ${rangeControl("vertical", "Vertical position", -80, 80, displaySettings.vertical)}
      ${rangeControl("brightness", "Brightness", 72, 120, displaySettings.brightness)}
      <button class="secondaryBtn" id="resetDisplay">Reset Display</button>
    </aside>
  `;
}

function rangeControl(id, label, min, max, value) {
  return `<label class="label">${label}<input data-display-setting="${id}" type="range" min="${min}" max="${max}" value="${value}"><span class="rangeValue">${value}${id === "scale" || id === "brightness" ? "%" : "px"}</span></label>`;
}

function themePicker() {
  const themes = [["confetti", "Confetti"], ["studio", "Studio"], ["neon", "Neon"], ["carnival", "Carnival"]];
  return `<label class="label">Theme<div class="themePicker">${themes.map(([id, label]) => `<button class="themeSwatch ${activeTheme === id ? "active" : ""}" data-theme="${id}" title="${label}"><span></span>${label}</button>`).join("")}</div></label>`;
}

function joinPanel(snapshot) {
  return `
    <section class="joinPanel stack">
      <label class="label">Join code<input id="joinCode" value="${snapshot.session.joinCode}"></label>
      <label class="label">Display name<input id="displayName" value="" placeholder="Your name"></label>
      <button id="join" class="primaryBtn">Join Game</button>
    </section>
  `;
}

function publicLinks(snapshot) {
  const playerUrl = `${shareOrigin}/trivia/session/${snapshot.session.joinCode}`;
  const displayUrl = `${shareOrigin}/trivia/display/${snapshot.session.id}`;
  const operatorUrl = `${shareOrigin}/trivia/operator/${snapshot.session.id}`;
  return `
    <section class="linkPanel">
      <div class="sectionHeader inline"><span class="eyebrow">Share URLs</span><h2>Live Links</h2></div>
      ${linkRow("Player", playerUrl)}
      ${linkRow("Display", displayUrl)}
      ${linkRow("Operator", operatorUrl)}
    </section>
  `;
}

function linkRow(label, url) {
  return `<div class="linkRow"><a href="${url}" target="_blank" rel="noreferrer"><strong>${label}</strong><span>${escapeHtml(url)}</span></a><button class="copyLink" data-copy="${escapeHtml(url)}" title="Copy ${label} link">Copy</button></div>`;
}

function chooseShareOrigin(origins) {
  if (!origins) return window.location.origin;
  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") return origins.lan || origins.current;
  return origins.current || window.location.origin;
}

function playerStorageKey() {
  return `trivia.playerId.${sessionId}`;
}

function getStoredPlayerId() {
  if (!sessionId) return null;
  return sessionStorage.getItem(playerStorageKey());
}

function storePlayerId(playerId) {
  if (!sessionId || !playerId) return;
  sessionStorage.setItem(playerStorageKey(), playerId);
}

function clearStoredPlayerId() {
  if (!sessionId) return;
  sessionStorage.removeItem(playerStorageKey());
}

function playerHud(snapshot) {
  return `
    <section class="playerHud">
      <div><span class="eyebrow">Player</span><strong>${escapeHtml(snapshot.player.displayName)}</strong></div>
      <div class="miniStats">${stat("Correct", snapshot.player.correctCount)}${stat("Streak", snapshot.player.streak)}</div>
      <p class="ruleHud">${playerRuleHud(snapshot.player.progress)}</p>
    </section>
  `;
}

function questionPanel(snapshot, context = "operator") {
  if (!snapshot.question) {
    return `<div class="questionPanel emptyQuestion"><span class="eyebrow">Ready Room</span><h2>No active question</h2><p>Players can join now. Start the first question when the room feels ready.</p></div>`;
  }
  return `
    <div class="questionPanel">
      <div class="questionHeader"><span class="categoryPill">${escapeHtml(snapshot.question.category)}</span><span class="muted">${snapshot.question.difficulty}</span></div>
      <h2>${escapeHtml(snapshot.question.prompt)}</h2>
      <div class="choiceGrid ${context}">${snapshot.question.choices.map((choice) => `<div class="choiceTile ${choice.isCorrect ? "correct" : ""}"><span>${choice.label}</span><strong>${escapeHtml(choice.text)}</strong></div>`).join("")}</div>
      ${snapshot.question.explanation ? `<p class="explanation">${escapeHtml(snapshot.question.explanation)}</p>` : ""}
    </div>
  `;
}

function playerQuestion(snapshot, question) {
  const answered = Boolean(snapshot.player?.currentAnswer);
  if (snapshot.session.status !== SessionStatus.QUESTION_ACTIVE) return questionPanel(snapshot, "player");
  return `
    <div class="questionPanel playerQuestion">
      <div class="questionHeader"><span class="categoryPill">${escapeHtml(question.category)}</span><span class="muted">${answered ? "Locked" : "Tap one answer"}</span></div>
      <h1>${escapeHtml(question.prompt)}</h1>
      <div class="choiceGrid player">${question.choices.map((choice) => `<button class="choiceTile tapChoice ${snapshot.player?.currentAnswer?.choiceId === choice.id ? "selected" : ""}" data-choice="${choice.id}" ${!snapshot.player || answered ? "disabled" : ""}><span>${choice.label}</span><strong>${escapeHtml(choice.text)}</strong></button>`).join("")}</div>
      ${answered ? "<div class=\"lockedNote\">Answer locked. Watch the reveal.</div>" : ""}
    </div>
  `;
}

function displayLobby(snapshot) {
  return `<div class="displayHero"><span class="displayKicker">Live Game Code</span><h1>${escapeHtml(snapshot.session.title)}</h1><div class="heroCode">${snapshot.session.joinCode}</div><p>${snapshot.session.playerCount} players connected</p></div>`;
}

function displayQuestion(snapshot, question) {
  const meterWidth = snapshot.session.playerCount ? Math.min(100, Math.round((snapshot.answerCount / snapshot.session.playerCount) * 100)) : 0;
  return `
    <div class="displayQuestion">
      <div class="displayMeta"><span class="displayKicker">${escapeHtml(question.category)}</span><span>${roundLabel(snapshot)}</span></div>
      <h1>${escapeHtml(question.prompt)}</h1>
      <div class="displayChoices">${question.choices.map((choice) => `<div class="choiceTile ${choice.isCorrect ? "correct" : ""}"><span>${choice.label}</span><strong>${escapeHtml(choice.text)}</strong></div>`).join("")}</div>
      <div class="answerMeter"><span style="width:${meterWidth}%"></span></div>
      <strong>${snapshot.answerCount} answers received</strong>
    </div>
  `;
}

function waitingPanel(snapshot) {
  return `<div class="waitingPanel"><span class="eyebrow">Code ${snapshot.session.joinCode}</span><h1>Waiting for the host</h1><p>You are connected. The next question will appear here.</p></div>`;
}

function winnerMoment(title, detail) {
  return `<div class="winnerMoment"><span>Winner Moment</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></div>`;
}

function leaderboard(snapshot, mode = "normal") {
  const leaders = snapshot.leaderboard.slice(0, mode === "display" ? 5 : snapshot.leaderboard.length);
  return `
    <section class="leaderboardPanel ${mode}">
      <div class="sectionHeader inline"><span class="eyebrow">Leaderboard</span><h2>Top Scores</h2></div>
      <div class="leaderboard">${leaders.length ? leaders.map((item) => `<div class="leader"><strong>#${item.rank}</strong><span>${escapeHtml(item.displayName)}</span><b>${item.correctCount}</b></div>`).join("") : "<span class='muted'>No scores yet</span>"}</div>
    </section>
  `;
}

function auditLog(snapshot) {
  const state = `${snapshot.session.status} · ${snapshot.session.joinCode}`;
  return `
    <section class="eventPanel">
      <div class="sectionHeader inline"><span class="eyebrow">Recovery</span><h2>Server State</h2></div>
      <div class="eventList"><span><strong>${state}</strong><small>Persisted backend</small></span><span><strong>${ruleSummary(snapshot.session.winnerRule)}</strong><small>Rule config</small></span></div>
    </section>
  `;
}

function actionButton(action, label, enabled, tone = "") {
  const style = tone === "primary" ? "command primaryBtn" : tone === "danger" ? "command dangerBtn" : "command secondaryBtn";
  return `<button class="${style}" data-action="${action}" ${enabled ? "" : "disabled"}>${label}</button>`;
}

function stat(label, value) {
  return `<div class="stat"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function cueCard(label, value) {
  return `<div class="cueCard"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function currentCue(snapshot) {
  if (snapshot.session.winner) return `${winnerName(snapshot)} won`;
  if (snapshot.session.status === SessionStatus.LOBBY) return "Lobby open";
  if (snapshot.session.status === SessionStatus.QUESTION_ACTIVE) return "Question live";
  if (snapshot.session.status === SessionStatus.ANSWER_REVEAL) return "Reveal";
  if (snapshot.session.status === SessionStatus.LEADERBOARD) return "Scores";
  if (snapshot.session.status === SessionStatus.ENDED) return "Ended";
  return "Standby";
}

function roundLabel(snapshot) {
  if (!snapshot.question) return "Ready";
  return `${snapshot.question.difficulty} question`;
}

function operatorSubhead(snapshot) {
  if (snapshot.session.winner) return `${winnerName(snapshot)} triggered ${snapshot.session.winner.ruleType}. The session is protected until the host acts.`;
  if (snapshot.question) return `${snapshot.question.category} is live with ${snapshot.answerCount} accepted answers.`;
  return "Create a room, share the code, and run the show from one trusted backend.";
}

function shortState(status) {
  return status.replace("QUESTION_", "Q ").replace("WINNER_FOUND", "WIN");
}

function formatStatus(status) {
  return status.replaceAll("_", " ");
}

function winnerName(snapshot) {
  const player = snapshot.leaderboard.find((item) => item.id === snapshot.session.winner?.playerId);
  return escapeHtml(player?.displayName || "Winner");
}

function ruleSummary(rule) {
  if (rule.type === "HOT_STREAK") return `Hot streak ${rule.requiredStreak}`;
  if (rule.type === "THREE_LIVES") return `${rule.startingLives} lives`;
  if (rule.type === "LAST_PLAYER_STANDING") return "Last player standing";
  if (rule.type === "HIGHEST_SCORE") return `Highest score after ${rule.questionLimit}`;
  if (rule.type === "TOURNAMENT") return `Top ${rule.advanceCount} after ${rule.questionLimit}`;
  return `Race to ${rule.targetCorrect}`;
}

function playerRuleHud(progress) {
  if (!progress) return "";
  if (progress.ruleType === "HOT_STREAK") return `${progress.streak}/${progress.requiredStreak} streak`;
  if (progress.ruleType === "THREE_LIVES") return `${progress.lives}/${progress.startingLives} lives remaining`;
  if (progress.ruleType === "LAST_PLAYER_STANDING") return progress.status === "ACTIVE" ? "Still standing" : "Spectator mode";
  if (progress.ruleType === "HIGHEST_SCORE") return `${progress.points} points before final ranking`;
  if (progress.ruleType === "TOURNAMENT") return `${progress.points} points · Top ${progress.advanceCount} advance`;
  return `${progress.correctCount}/${progress.targetCorrect} correct`;
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeTab = button.dataset.tab;
      updateRoute();
      await render();
    });
  });
  document.querySelectorAll("[data-theme]").forEach((button) => {
    button.addEventListener("click", async () => {
      activeTheme = button.dataset.theme;
      await render();
    });
  });
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      await navigator.clipboard?.writeText(button.dataset.copy);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy";
      }, 1200);
    });
  });
  document.querySelector("#winnerMode")?.addEventListener("change", (event) => {
    sessionForm.winnerMode = event.target.value;
  });
  document.querySelector("#displayEdit")?.addEventListener("click", async () => {
    displayEditMode = !displayEditMode;
    showDisplayControls();
    await render();
  });
  document.querySelector(".displayStage")?.addEventListener("mousemove", showDisplayControls);
  document.querySelector(".displayStage")?.addEventListener("pointermove", showDisplayControls);
  document.querySelector("#fullscreenToggle")?.addEventListener("click", async () => {
    await toggleFullscreen();
    showDisplayControls();
  });
  document.querySelector("#resetDisplay")?.addEventListener("click", async () => {
    displaySettings = { safeArea: 42, scale: 100, vertical: 0, brightness: 100 };
    showDisplayControls();
    await render();
  });
  document.querySelectorAll("[data-display-setting]").forEach((input) => {
    input.addEventListener("input", async () => {
      displaySettings[input.dataset.displaySetting] = Number(input.value);
      showDisplayControls();
      await render();
    });
  });
  document.querySelector("#newSession")?.addEventListener("click", async () => {
    const button = document.querySelector("#newSession");
    setBusy(button, "Creating");
    sessionForm = readSessionForm();
    try {
      const created = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          title: document.querySelector("#title").value,
          winnerMode: sessionForm.winnerMode,
          targetCorrect: sessionForm.targetCorrect,
          requiredStreak: sessionForm.requiredStreak,
          startingLives: sessionForm.startingLives,
          questionLimit: sessionForm.questionLimit,
          advanceCount: sessionForm.advanceCount,
          timerSeconds: Number(document.querySelector("#timer").value),
          maxPlayers: Number(document.querySelector("#maxPlayers").value)
        })
      });
      sessionId = created.sessionId;
      joinCode = created.joinCode;
      currentPlayerId = null;
      clearStoredPlayerId();
      subscribe();
      updateRoute();
      await render(created.snapshot);
    } catch (error) {
      showToast(error.message);
      setBusy(button, "Create Session", false);
    }
  });
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const original = button.textContent;
      setBusy(button, "Working");
      try {
        const updated = await api(`/api/sessions/${sessionId}/operator`, { method: "POST", body: JSON.stringify({ action: button.dataset.action }) });
        await render(updated.snapshot);
      } catch (error) {
        showToast(error.message);
        setBusy(button, original, false);
      }
    });
  });
  document.querySelector("#join")?.addEventListener("click", async () => {
    const button = document.querySelector("#join");
    setBusy(button, "Joining");
    try {
      const joined = await api("/api/join", { method: "POST", body: JSON.stringify({ joinCode: document.querySelector("#joinCode").value, displayName: document.querySelector("#displayName").value }) });
      sessionId = joined.sessionId;
      currentPlayerId = joined.playerId;
      storePlayerId(currentPlayerId);
      subscribe();
      updateRoute();
      await render(joined.snapshot);
    } catch (error) {
      showToast(error.message);
      setBusy(button, "Join Game", false);
    }
  });
  document.querySelectorAll("[data-choice]").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelectorAll("[data-choice]").forEach((choice) => {
        choice.disabled = true;
        choice.classList.toggle("selected", choice === button);
      });
      try {
        const accepted = await api(`/api/sessions/${sessionId}/answers`, { method: "POST", body: JSON.stringify({ playerId: currentPlayerId, choiceId: button.dataset.choice, idempotencyKey: crypto.randomUUID() }) });
        await render(accepted.snapshot);
      } catch (error) {
        showToast(error.message);
        await render();
      }
    });
  });
}

function readSessionForm() {
  return {
    winnerMode: document.querySelector("#winnerMode").value,
    targetCorrect: Number(document.querySelector("#target").value),
    requiredStreak: Number(document.querySelector("#requiredStreak").value),
    startingLives: Number(document.querySelector("#startingLives").value),
    questionLimit: Number(document.querySelector("#questionLimit").value),
    advanceCount: Number(document.querySelector("#advanceCount").value)
  };
}

function subscribe() {
  eventStream?.close();
  clearInterval(pollingTimer);
  eventStream = new EventSource(`/api/sessions/${sessionId}/events`);
  eventStream.addEventListener("update", () => render());
  eventStream.addEventListener("error", () => {
    eventStream?.close();
    eventStream = null;
  });
  pollingTimer = setInterval(() => {
    if (document.visibilityState === "visible") render();
  }, 700);
}

function updateRoute() {
  if (!sessionId) return;
  const nextPath = activeTab === "display"
    ? `/trivia/display/${sessionId}`
    : activeTab === "player"
      ? `/trivia/session/${joinCode || ""}`
      : `/trivia/operator/${sessionId}`;
  window.history.replaceState({}, "", nextPath);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function setBusy(button, label, busy = true) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? label : label;
  button.classList.toggle("busy", busy);
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2800);
}

function showDisplayControls() {
  if (activeTab !== "display") return;
  displayControlsActive = true;
  applyDisplayControlsClass();
  clearTimeout(displayControlsTimer);
  displayControlsTimer = setTimeout(() => {
    displayControlsActive = false;
    applyDisplayControlsClass();
  }, 2200);
}

async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  await document.querySelector(".shell").requestFullscreen();
}

function applyDisplayControlsClass() {
  const display = document.querySelector(".displayStage");
  if (!display) return;
  display.classList.toggle("controlsActive", displayControlsActive);
  display.classList.toggle("controlsIdle", !displayControlsActive);
}

document.addEventListener("fullscreenchange", () => {
  document.body.classList.toggle("isFullscreen", Boolean(document.fullscreenElement));
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char]);
}
