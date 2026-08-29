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
let realtimeClient = null;
let realtimeChannel = null;
let realtimeConnected = false;
let isRendering = false;
let pendingRender = false;
let actionInFlight = false;
const initialRoute = parseInitialRoute();
let landingJoinCode = initialRoute.joinCode || null;

const app = document.querySelector("#app");

document.addEventListener("focusout", () => {
  if (!pendingRender) return;
  setTimeout(() => {
    if (pendingRender && !hasEditableFocus() && !actionInFlight) render();
  }, 350);
});

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
  const joinMatch = path.match(/^\/trivia\/join\/([^/]+)$/);
  if (joinMatch) return { tab: "player", joinCode: decodeURIComponent(joinMatch[1]).trim().toUpperCase(), landing: true };
  const sessionMatch = path.match(/^\/trivia\/session\/([^/]+)$/);
  if (sessionMatch) return { tab: "player", joinCode: decodeURIComponent(sessionMatch[1]).trim().toUpperCase() };
  const operatorMatch = path.match(/^\/trivia\/operator\/([^/]+)$/);
  if (operatorMatch) return { tab: "operator", sessionId: decodeURIComponent(operatorMatch[1]) };
  const displayMatch = path.match(/^\/trivia\/display\/([^/]+)$/);
  if (displayMatch) return { tab: "display", sessionId: decodeURIComponent(displayMatch[1]) };
  if (path === "/trivia") return { tab: "player" };
  return { tab: "operator" };
}

async function render(snapshotOverride = null) {
  if (!snapshotOverride && actionInFlight) {
    pendingRender = true;
    return;
  }
  if (!snapshotOverride && hasEditableFocus()) {
    pendingRender = true;
    return;
  }
  if (isRendering) {
    pendingRender = true;
    return;
  }
  isRendering = true;
  try {
    const snapshot = snapshotOverride || await snapshotForActiveTab();
    joinCode = snapshot.session.joinCode;
    document.body.classList.toggle("isPlayerRoute", activeTab === "player");
    app.innerHTML = `
      <div class="shell theme-${activeTheme} route-${activeTab}">
        ${activeTab === "player" ? "" : `
          <header class="topbar">
            <div class="brand"><span class="brandMark">FT</span><span>Family Trivia Codex</span></div>
            <nav class="tabs" aria-label="Interfaces">
              ${tabButton("operator", "Operator")}
              ${tabButton("player", "Player")}
              ${tabButton("display", "Display")}
            </nav>
          </header>
        `}
        ${activeTab === "operator" ? operatorView(snapshot) : ""}
        ${activeTab === "player" ? playerView(snapshot) : ""}
        ${activeTab === "display" ? displayView(snapshot) : ""}
      </div>
    `;
    bindEvents();
  } finally {
    isRendering = false;
    if (pendingRender && !snapshotOverride && !hasEditableFocus() && !actionInFlight) {
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
  if (snapshot.session.status === SessionStatus.ENDED && (snapshot.player || landingJoinCode)) return playerEndedView(snapshot);
  if (!snapshot.player) {
    return `
      <section class="playerStage">
        <div class="phoneFrame joinFrame">
          <div class="phoneTop">
            <span class="status">${formatStatus(snapshot.session.status)}</span>
            <strong>${landingJoinCode ? escapeHtml(snapshot.session.title) : "Family Trivia Codex"}</strong>
          </div>
          ${joinPanel(snapshot)}
        </div>
      </section>
    `;
  }
  return `
    <section class="playerStage">
      <div class="phoneFrame">
        <div class="phoneTop">
          <span class="status">${formatStatus(snapshot.session.status)}</span>
          <strong>${escapeHtml(snapshot.session.title)}</strong>
        </div>
        ${playerHud(snapshot)}
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
  const isKnownSession = Boolean(landingJoinCode && snapshot.session?.joinCode);
  const joinValue = isKnownSession ? snapshot.session.joinCode : "";
  return `
    <section class="joinLanding">
      <div class="joinIntro">
        <span class="eyebrow">${isKnownSession ? "Game Mode" : "Join Game"}</span>
        <h1>${isKnownSession ? escapeHtml(ruleLabel(snapshot.session.winnerRule)) : "Enter Code"}</h1>
        <p>${isKnownSession ? escapeHtml(ruleIntro(snapshot.session.winnerRule)) : "Type the code from the host screen to enter the room."}</p>
      </div>
      ${isKnownSession ? ruleCard(snapshot.session.winnerRule) : ""}
      <div class="joinPanel stack">
        <label class="label">Join code<input id="joinCode" value="${joinValue}" inputmode="text" autocomplete="off"></label>
        <label class="label">Name<input id="displayName" value="" placeholder="Your name" autocomplete="name"></label>
        <button id="join" class="primaryBtn">Join Game</button>
      </div>
    </section>
  `;
}

function publicLinks(snapshot) {
  const playerUrl = `${shareOrigin}/trivia/join/${snapshot.session.joinCode}`;
  const displayUrl = `${shareOrigin}/trivia/display/${snapshot.session.id}`;
  const operatorUrl = `${shareOrigin}/trivia/operator/${snapshot.session.id}`;
  return `
    <section class="linkPanel">
      <div class="sectionHeader inline"><span class="eyebrow">Share URLs</span><h2>Live Links</h2></div>
      <div class="qrCard">
        <img src="${qrUrl(playerUrl)}" alt="QR code for player join link">
        <div><strong>Scan To Join</strong><span>${snapshot.session.joinCode}</span></div>
      </div>
      ${linkRow("Player", playerUrl)}
      ${linkRow("Display", displayUrl)}
      ${linkRow("Operator", operatorUrl)}
    </section>
  `;
}

function qrUrl(url) {
  return `/api/qr?data=${encodeURIComponent(url)}`;
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
  try {
    return sessionStorage.getItem(playerStorageKey());
  } catch {
    return null;
  }
}

function storePlayerId(playerId) {
  if (!sessionId || !playerId) return;
  try {
    sessionStorage.setItem(playerStorageKey(), playerId);
  } catch {
    currentPlayerId = playerId;
  }
}

function clearStoredPlayerId() {
  if (!sessionId) return;
  try {
    sessionStorage.removeItem(playerStorageKey());
  } catch {
    currentPlayerId = null;
  }
}

function playerHud(snapshot) {
  return `
    <section class="playerHud">
      <strong class="playerName">${escapeHtml(snapshot.player.displayName)}</strong>
      <div class="miniStats">${stat("Correct", snapshot.player.correctCount)}${stat("Streak", snapshot.player.streak)}</div>
      <p class="ruleHud">${playerRuleHud(snapshot.player.progress)}</p>
    </section>
  `;
}

function playerEndedView(snapshot) {
  return `
    <section class="playerStage">
      <div class="phoneFrame gameEndedFrame">
        <div class="phoneTop">
          <span class="status">${formatStatus(snapshot.session.status)}</span>
          <strong>${escapeHtml(snapshot.session.title)}</strong>
        </div>
        <section class="gameEndedPanel">
          <span class="eyebrow">Game Complete</span>
          <h1>${endedTitle(snapshot)}</h1>
          <p>${endedMessage(snapshot)}</p>
          ${snapshot.session.winner ? `<div class="endedWinner"><span>Winner</span><strong>${winnerName(snapshot)}</strong></div>` : ""}
          <button id="exitPlayer" class="primaryBtn">Exit</button>
        </section>
      </div>
    </section>
  `;
}

function endedTitle(snapshot) {
  if (snapshot.player?.status === "WINNER") return "You won!";
  if (snapshot.session.winner) return `${winnerName(snapshot)} won`;
  return "Game ended";
}

function endedMessage(snapshot) {
  if (snapshot.player?.status === "WINNER") return "Nice work. The host ended the session, so this room is now closed.";
  if (snapshot.session.winner) return "The host ended the session. You can exit and join another game when you are ready.";
  return "The host ended the session. Exit to enter a new join code.";
}

function ruleCard(rule) {
  const steps = ruleSteps(rule);
  return `
    <section class="ruleCard">
      <strong>${escapeHtml(ruleSummary(rule))}</strong>
      <div class="ruleSteps">${steps.map((step) => `<span>${escapeHtml(step)}</span>`).join("")}</div>
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

function ruleLabel(rule) {
  if (rule.type === "HOT_STREAK") return "Hot Streak";
  if (rule.type === "THREE_LIVES") return "Three Lives";
  if (rule.type === "LAST_PLAYER_STANDING") return "Last Player Standing";
  if (rule.type === "HIGHEST_SCORE") return "Highest Score";
  if (rule.type === "TOURNAMENT") return "Tournament";
  return "Race to X";
}

function ruleIntro(rule) {
  if (rule.type === "HOT_STREAK") return `Get ${rule.requiredStreak} correct answers in a row before everyone else.`;
  if (rule.type === "THREE_LIVES") return `You start with ${rule.startingLives} lives. Wrong answers cost a life.`;
  if (rule.type === "LAST_PLAYER_STANDING") return "One wrong answer knocks you out. Stay alive longer than the room.";
  if (rule.type === "HIGHEST_SCORE") return `Score the most points across ${rule.questionLimit} questions.`;
  if (rule.type === "TOURNAMENT") return `Earn a top ${rule.advanceCount} spot after ${rule.questionLimit} questions.`;
  return `Be first to ${rule.targetCorrect} correct answers. Fast correct answers break ties.`;
}

function ruleSteps(rule) {
  if (rule.type === "HOT_STREAK") return ["Correct answers build your streak.", "A wrong answer resets the streak.", "First player to the streak target wins."];
  if (rule.type === "THREE_LIVES") return ["Everyone starts with lives.", "Wrong answers remove one life.", "Last active player wins."];
  if (rule.type === "LAST_PLAYER_STANDING") return ["Answer carefully.", "One wrong answer eliminates you.", "Last active player wins."];
  if (rule.type === "HIGHEST_SCORE") return ["Correct answers score points.", "Every player answers each round.", "Highest score at the limit wins."];
  if (rule.type === "TOURNAMENT") return ["Correct answers score points.", "Rankings decide who advances.", "Top players continue as finalists."];
  return ["Answer each question quickly.", "Correct answers move you toward the target.", "First to the target wins."];
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
    input.addEventListener("input", () => {
      displaySettings[input.dataset.displaySetting] = Number(input.value);
      showDisplayControls();
      applyDisplaySettings();
      const value = input.parentElement?.querySelector(".rangeValue");
      if (value) value.textContent = `${input.value}${input.dataset.displaySetting === "scale" || input.dataset.displaySetting === "brightness" ? "%" : "px"}`;
    });
  });
  document.querySelector("#newSession")?.addEventListener("click", async () => {
    const button = document.querySelector("#newSession");
    setBusy(button, "Creating");
    sessionForm = readSessionForm();
    actionInFlight = true;
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
    } finally {
      actionInFlight = false;
    }
  });
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const original = button.textContent;
      setBusy(button, "Working");
      actionInFlight = true;
      try {
        const updated = await api(`/api/sessions/${sessionId}/operator`, { method: "POST", body: JSON.stringify({ action: button.dataset.action }) });
        await render(updated.snapshot);
      } catch (error) {
        showToast(error.message);
        setBusy(button, original, false);
      } finally {
        actionInFlight = false;
      }
    });
  });
  document.querySelector("#join")?.addEventListener("click", async () => {
    const button = document.querySelector("#join");
    setBusy(button, "Joining");
    actionInFlight = true;
    try {
      const joined = await api("/api/join", { method: "POST", body: JSON.stringify({ joinCode: document.querySelector("#joinCode").value.trim(), displayName: document.querySelector("#displayName").value }) });
      sessionId = joined.sessionId;
      currentPlayerId = joined.playerId;
      landingJoinCode = null;
      storePlayerId(currentPlayerId);
      subscribe();
      updateRoute();
      await render(joined.snapshot);
    } catch (error) {
      showToast(error.message);
      setBusy(button, "Join Game", false);
    } finally {
      actionInFlight = false;
    }
  });
  document.querySelector("#exitPlayer")?.addEventListener("click", async () => {
    currentPlayerId = null;
    clearStoredPlayerId();
    activeTab = "player";
    landingJoinCode = null;
    window.history.replaceState({}, "", "/trivia");
    const boot = await api("/api/bootstrap");
    sessionId = boot.sessionId;
    joinCode = boot.joinCode;
    subscribe();
    await render();
  });
  document.querySelectorAll("[data-choice]").forEach((button) => {
    button.addEventListener("click", async () => {
      actionInFlight = true;
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
      } finally {
        actionInFlight = false;
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
  removeRealtimeChannel();
  clearInterval(pollingTimer);
  eventStream = new EventSource(`/api/sessions/${sessionId}/events`);
  eventStream.addEventListener("update", () => render());
  eventStream.addEventListener("error", () => {
    eventStream?.close();
    eventStream = null;
  });
  subscribeRealtime();
  pollingTimer = setInterval(() => {
    if (document.visibilityState === "visible") render();
  }, pollInterval());
}

async function subscribeRealtime() {
  realtimeConnected = false;
  if (!window.supabase) return;
  try {
    const config = await api("/api/client-config");
    if (!config.realtime || !config.supabaseUrl || !config.supabaseAnonKey) return;
    realtimeClient ||= window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    realtimeChannel = realtimeClient
      .channel(`game-updates-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "game_update_events",
          filter: `session_id=eq.${sessionId}`
        },
        () => render()
      )
      .subscribe((status) => {
        realtimeConnected = status === "SUBSCRIBED";
      });
  } catch {
    realtimeConnected = false;
  }
}

function removeRealtimeChannel() {
  if (!realtimeClient || !realtimeChannel) return;
  realtimeClient.removeChannel(realtimeChannel);
  realtimeChannel = null;
  realtimeConnected = false;
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

function hasEditableFocus() {
  const element = document.activeElement;
  if (!element) return false;
  return Boolean(element.closest("input, select, textarea, [contenteditable='true']"));
}

function pollInterval() {
  if (realtimeConnected) return 10000;
  if (activeTab === "display") return 900;
  if (activeTab === "player") return 1100;
  return 1800;
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

function applyDisplaySettings() {
  const display = document.querySelector(".displayStage");
  if (!display) return;
  display.style.setProperty("--safe-area", `${displaySettings.safeArea}px`);
  display.style.setProperty("--display-scale", displaySettings.scale / 100);
  display.style.setProperty("--display-y", `${displaySettings.vertical}px`);
  display.style.setProperty("--display-brightness", `${displaySettings.brightness}%`);
}

document.addEventListener("fullscreenchange", () => {
  document.body.classList.toggle("isFullscreen", Boolean(document.fullscreenElement));
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char]);
}
