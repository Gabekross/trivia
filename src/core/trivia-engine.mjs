import { questions as defaultQuestions } from "./seed-data.mjs";
import { configureWinnerRule, getRule, ruleOptions } from "./rules/index.mjs";
import { assertTransition } from "./state-machine.mjs";
import { PlayerStatus, Role, SessionStatus, makeId, nowIso, sanitizeDisplayName } from "./types.mjs";

function generateJoinCode(existingCodes) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 250; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!existingCodes.has(code)) return code;
  }
  throw new Error("Unable to allocate a unique join code");
}

function cloneQuestionForPlayer(question, reveal = false) {
  return {
    id: question.id,
    category: question.category,
    difficulty: question.difficulty,
    prompt: question.prompt,
    explanation: reveal ? question.explanation : undefined,
    choices: question.choices.map(({ id, label, text, isCorrect }) => ({
      id,
      label,
      text,
      isCorrect: reveal ? isCorrect : undefined
    }))
  };
}

function cloneQuestion(question) {
  return {
    id: question.id,
    categoryId: question.categoryId,
    category: question.category,
    difficulty: question.difficulty,
    prompt: question.prompt,
    explanation: question.explanation,
    active: question.active !== false,
    archived: Boolean(question.archived),
    validationStatus: question.validationStatus || "approved",
    source: question.source || "seed",
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    choices: question.choices.map((choice) => ({ ...choice }))
  };
}

function normalizeQuestion(input = {}, { existing = null, clock = Date } = {}) {
  const prompt = String(input.prompt ?? existing?.prompt ?? "").replace(/\s+/g, " ").trim();
  const category = String(input.category ?? existing?.category ?? "General Knowledge").replace(/\s+/g, " ").trim() || "General Knowledge";
  const difficulty = String(input.difficulty ?? existing?.difficulty ?? "medium").toLowerCase();
  const explanation = String(input.explanation ?? existing?.explanation ?? "").replace(/\s+/g, " ").trim();
  const choices = normalizeChoices(input.choices ?? existing?.choices ?? []);
  const correctCount = choices.filter((choice) => choice.isCorrect).length;
  if (prompt.length < 6) throw new Error("Question prompt is required.");
  if (choices.length < 2 || choices.length > 6) throw new Error("Questions require 2 to 6 answer choices.");
  if (correctCount !== 1) throw new Error("Questions require exactly one correct answer.");
  return {
    id: existing?.id || input.id || makeId("q"),
    categoryId: input.categoryId || existing?.categoryId || category.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "general",
    category,
    difficulty,
    prompt,
    explanation,
    active: input.active ?? existing?.active ?? true,
    archived: Boolean(input.archived ?? existing?.archived ?? false),
    validationStatus: input.validationStatus || existing?.validationStatus || "approved",
    source: input.source || existing?.source || "operator",
    createdAt: existing?.createdAt || nowIso(clock),
    updatedAt: nowIso(clock),
    choices
  };
}

function normalizeChoices(choices = []) {
  const labels = ["A", "B", "C", "D", "E", "F"];
  return choices
    .map((choice, index) => ({
      id: choice.id || makeId("choice"),
      label: labels[index] || String(index + 1),
      text: String(choice.text || "").replace(/\s+/g, " ").trim(),
      isCorrect: Boolean(choice.isCorrect)
    }))
    .filter((choice) => choice.text);
}

function defaultConfiguration(input = {}) {
  const questionSeconds = Number(input.questionSeconds ?? input.timerSeconds ?? 15);
  const winnerRule = configureWinnerRule(input.winnerRule || {
    type: input.winnerMode || "RACE_TO_X",
    targetCorrect: input.targetCorrect,
    requiredStreak: input.requiredStreak,
    startingLives: input.startingLives,
    questionLimit: input.questionLimit,
    advanceCount: input.advanceCount
  });
  return {
    title: input.title || "Family Trivia Night",
    maxPlayers: Number(input.maxPlayers || 200),
    timerSeconds: questionSeconds,
    questionSeconds,
    revealSeconds: Number(input.revealSeconds ?? 6),
    autoReveal: Boolean(input.autoReveal),
    autoAdvanceAfterReveal: Boolean(input.autoAdvanceAfterReveal),
    leaderboardCount: Number(input.leaderboardCount || 10),
    revealAnswer: input.revealAnswer ?? true,
    afterWinner: "PAUSE",
    winnerRule,
    categories: input.categories || ["cat_family", "cat_general", "cat_food"]
  };
}

export class TriviaEngine {
  constructor({ clock = Date, questionBank = defaultQuestions } = {}) {
    this.clock = clock;
    this.questionBank = questionBank.map((question) => normalizeQuestion(question, { clock: this.clock }));
    this.sessions = new Map();
    this.joinCodes = new Map();
  }

  exportState() {
    return {
      questionBank: this.questionBank.map(cloneQuestion),
      sessions: [...this.sessions.values()].map((session) => ({
        ...session,
        players: [...session.players.values()],
        answers: [...session.answers.values()],
        idempotencyKeys: [],
        auditLog: session.auditLog,
        winners: session.winners
      }))
    };
  }

  importState(state = {}) {
    this.sessions.clear();
    this.joinCodes.clear();
    if (state.questionBank?.length) {
      this.questionBank = state.questionBank.map((question) => normalizeQuestion(question, { clock: this.clock }));
    }
    for (const saved of state.sessions || []) {
      const session = {
        ...saved,
        configurationSnapshot: defaultConfiguration(saved.configurationSnapshot),
        questionIds: saved.questionIds || this.activeQuestionBank().map((question) => question.id),
        players: new Map((saved.players || []).map((player) => [player.id, player])),
        answers: new Map((saved.answers || []).map((answer) => [`${answer.questionId}:${answer.playerId}`, answer])),
        idempotencyKeys: new Map(),
        winners: saved.winners || [],
        auditLog: saved.auditLog || []
      };
      this.sessions.set(session.id, session);
      this.joinCodes.set(session.joinCode, session.id);
    }
  }

  createSession(config = {}) {
    const joinCode = generateJoinCode(this.joinCodes);
    const session = {
      id: makeId("ses"),
      joinCode,
      status: SessionStatus.LOBBY,
      configurationSnapshot: defaultConfiguration(config),
      questionIds: this.activeQuestionBank().map((question) => question.id),
      currentQuestionIndex: -1,
      currentQuestionId: null,
      questionActivatedAt: null,
      players: new Map(),
      answers: new Map(),
      idempotencyKeys: new Map(),
      winners: [],
      createdAt: nowIso(this.clock),
      updatedAt: nowIso(this.clock),
      auditLog: []
    };
    this.sessions.set(session.id, session);
    this.joinCodes.set(joinCode, session.id);
    return session;
  }

  findSessionByJoinCode(joinCode) {
    const sessionId = this.joinCodes.get(String(joinCode || "").trim().toUpperCase());
    return sessionId ? this.sessions.get(sessionId) : null;
  }

  requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    return session;
  }

  listQuestions({ includeArchived = false } = {}) {
    return this.questionBank
      .filter((question) => includeArchived || !question.archived)
      .map(cloneQuestion);
  }

  addQuestion(input = {}) {
    const question = normalizeQuestion(input, { clock: this.clock });
    this.questionBank.push(question);
    return cloneQuestion(question);
  }

  updateQuestion(questionId, input = {}) {
    const index = this.questionBank.findIndex((question) => question.id === questionId);
    if (index === -1) throw new Error("Question not found");
    const question = normalizeQuestion({ ...input, id: questionId }, { existing: this.questionBank[index], clock: this.clock });
    this.questionBank[index] = question;
    return cloneQuestion(question);
  }

  archiveQuestion(questionId) {
    const index = this.questionBank.findIndex((question) => question.id === questionId);
    if (index === -1) throw new Error("Question not found");
    this.questionBank[index] = normalizeQuestion({ active: false, archived: true }, { existing: this.questionBank[index], clock: this.clock });
    return cloneQuestion(this.questionBank[index]);
  }

  activeQuestionBank() {
    return this.questionBank.filter((question) => question.active !== false && !question.archived);
  }

  questionForSession(session, questionId) {
    return this.questionBank.find((item) => item.id === questionId) || null;
  }

  questionsForSession(session) {
    const questionIds = session.questionIds?.length ? session.questionIds : this.activeQuestionBank().map((question) => question.id);
    return questionIds.map((id) => this.questionForSession(session, id)).filter(Boolean);
  }

  joinSession(joinCode, displayName) {
    const session = this.findSessionByJoinCode(joinCode);
    if (!session) throw new Error("Join code not found");
    if (session.status !== SessionStatus.LOBBY) throw new Error("This session is no longer accepting new players");
    if (session.players.size >= session.configurationSnapshot.maxPlayers) throw new Error("Session is full");

    const baseName = sanitizeDisplayName(displayName);
    const existing = new Set([...session.players.values()].map((player) => player.displayName));
    let finalName = baseName;
    let suffix = 2;
    while (existing.has(finalName)) {
      finalName = `${baseName} ${suffix}`;
      suffix += 1;
    }

    const player = {
      id: makeId("ply"),
      displayName: finalName,
      status: PlayerStatus.ACTIVE,
      correctCount: 0,
      incorrectCount: 0,
      streak: 0,
      lives: 3,
      points: 0,
      joinOrder: session.players.size + 1,
      joinedAt: nowIso(this.clock)
    };
    getRule(session.configurationSnapshot.winnerRule.type).initializePlayer?.(player, session.configurationSnapshot.winnerRule);
    session.players.set(player.id, player);
    this.touch(session, "PLAYER_JOINED", { playerId: player.id });
    return player;
  }

  operatorAction(sessionId, action) {
    const session = this.requireSession(sessionId);
    const actionName = typeof action === "string" ? action : action.type;
    switch (actionName) {
      case "START":
      case "NEXT_QUESTION":
        return this.activateNextQuestion(session);
      case "CLOSE_QUESTION":
        return this.transition(session, SessionStatus.QUESTION_LOCKED, "QUESTION_CLOSED");
      case "REVEAL":
        return this.transition(session, SessionStatus.ANSWER_REVEAL, "ANSWER_REVEALED");
      case "SHOW_LEADERBOARD":
        return this.transition(session, SessionStatus.LEADERBOARD, "LEADERBOARD_SHOWN");
      case "ACK_WINNER":
      case "PAUSE":
        return this.transition(session, SessionStatus.PAUSED, "SESSION_PAUSED");
      case "RESUME":
        return this.activateNextQuestion(session);
      case "RESET":
        return this.resetSession(session);
      case "END":
        return this.transition(session, SessionStatus.ENDED, "SESSION_ENDED");
      default:
        throw new Error(`Unknown operator action: ${actionName}`);
    }
  }

  activateNextQuestion(session) {
    const nextIndex = session.currentQuestionIndex + 1;
    const sessionQuestions = this.questionsForSession(session);
    if (nextIndex >= sessionQuestions.length) return this.transition(session, SessionStatus.ENDED, "QUESTION_BANK_EXHAUSTED");
    assertTransition(session.status, SessionStatus.QUESTION_ACTIVE);
    session.currentQuestionIndex = nextIndex;
    session.currentQuestionId = sessionQuestions[nextIndex].id;
    session.questionActivatedAt = nowIso(this.clock);
    return this.touch(Object.assign(session, { status: SessionStatus.QUESTION_ACTIVE }), "QUESTION_ACTIVATED", {
      questionId: session.currentQuestionId
    });
  }

  advanceTimers(sessionId) {
    const session = this.requireSession(sessionId);
    const config = session.configurationSnapshot;
    const now = new Date(nowIso(this.clock)).getTime();
    if (session.status === SessionStatus.QUESTION_ACTIVE && config.autoReveal) {
      const started = new Date(session.questionActivatedAt || session.updatedAt).getTime();
      if (secondsElapsed(started, now) >= Math.max(1, Number(config.questionSeconds || config.timerSeconds || 15))) {
        return this.transition(session, SessionStatus.ANSWER_REVEAL, "QUESTION_AUTO_REVEALED");
      }
    }
    if (session.status === SessionStatus.ANSWER_REVEAL && config.autoAdvanceAfterReveal) {
      const revealedAt = new Date(session.updatedAt).getTime();
      if (secondsElapsed(revealedAt, now) >= Math.max(1, Number(config.revealSeconds || 6))) {
        return this.activateNextQuestion(session);
      }
    }
    return null;
  }

  submitAnswer({ sessionId, playerId, choiceId, idempotencyKey }) {
    const session = this.requireSession(sessionId);
    if (session.status !== SessionStatus.QUESTION_ACTIVE) throw new Error("Question is not accepting answers");
    const player = session.players.get(playerId);
    if (!player || player.status !== PlayerStatus.ACTIVE) throw new Error("Player is not active in this session");
    const key = `${session.currentQuestionId}:${playerId}`;
    if (session.answers.has(key)) return session.answers.get(key);
    if (idempotencyKey && session.idempotencyKeys.has(idempotencyKey)) return session.idempotencyKeys.get(idempotencyKey);

    const question = this.questionForSession(session, session.currentQuestionId);
    const choice = question.choices.find((item) => item.id === choiceId);
    if (!choice) throw new Error("Choice not found for active question");

    const acceptedAt = nowIso(this.clock);
    const responseMs = Math.max(0, new Date(acceptedAt).getTime() - new Date(session.questionActivatedAt).getTime());
    const answer = {
      sessionId,
      questionId: session.currentQuestionId,
      playerId,
      choiceId,
      acceptedAt,
      responseMs,
      isCorrect: Boolean(choice.isCorrect)
    };
    session.answers.set(key, answer);
    if (idempotencyKey) session.idempotencyKeys.set(idempotencyKey, answer);

    const answeredPlayerIds = [player.id];
    const rule = getRule(session.configurationSnapshot.winnerRule.type);
    rule.applyAnswer({ session, player, answer, config: session.configurationSnapshot.winnerRule });
    this.touch(session, "ANSWER_ACCEPTED", { playerId, questionId: session.currentQuestionId });
    const winner = rule.evaluate({ session, questionId: session.currentQuestionId, answeredPlayerIds });
    if (winner) this.recordWinner(session, winner);
    return answer;
  }

  recordWinner(session, winner) {
    if (session.winners.length > 0) return session.winners[0];
    const player = session.players.get(winner.playerId);
    player.status = PlayerStatus.WINNER;
    const winnerRecord = { id: makeId("win"), ...winner, createdAt: nowIso(this.clock) };
    session.winners.push(winnerRecord);
    session.status = SessionStatus.WINNER_FOUND;
    this.touch(session, "WINNER_FOUND", winnerRecord);
    return winnerRecord;
  }

  transition(session, status, eventType) {
    assertTransition(session.status, status);
    session.status = status;
    return this.touch(session, eventType, {});
  }

  resetSession(session) {
    assertTransition(session.status, SessionStatus.LOBBY);
    for (const player of session.players.values()) {
      player.status = PlayerStatus.ACTIVE;
      player.correctCount = 0;
      player.incorrectCount = 0;
      player.streak = 0;
      player.points = 0;
    }
    session.currentQuestionIndex = -1;
    session.currentQuestionId = null;
    session.questionActivatedAt = null;
    session.answers.clear();
    session.idempotencyKeys.clear();
    session.winners = [];
    session.status = SessionStatus.LOBBY;
    return this.touch(session, "SESSION_RESET", {});
  }

  touch(session, eventType, payload) {
    session.updatedAt = nowIso(this.clock);
    session.auditLog.push({ eventType, payload, at: session.updatedAt });
    return session;
  }

  snapshot(sessionId, role, playerId = null) {
    const session = this.requireSession(sessionId);
    const currentQuestion = this.questionForSession(session, session.currentQuestionId);
    const reveal = session.status === SessionStatus.ANSWER_REVEAL || session.status === SessionStatus.LEADERBOARD || session.status === SessionStatus.WINNER_FOUND || session.status === SessionStatus.PAUSED || role === Role.OPERATOR;
    const player = playerId ? session.players.get(playerId) : null;
    const playerAnswer = player && currentQuestion ? session.answers.get(`${currentQuestion.id}:${player.id}`) : null;
    const leaderboard = [...session.players.values()]
      .sort((a, b) => b.correctCount - a.correctCount || b.points - a.points || a.joinOrder - b.joinOrder)
      .slice(0, session.configurationSnapshot.leaderboardCount)
      .map((item, index) => ({ rank: index + 1, id: item.id, displayName: item.displayName, correctCount: item.correctCount, points: item.points, status: item.status }));

    return {
      session: {
        id: session.id,
        joinCode: session.joinCode,
        status: session.status,
        title: session.configurationSnapshot.title,
        playerCount: session.players.size,
        winner: session.winners[0] || null,
        winnerRule: session.configurationSnapshot.winnerRule,
        questionCount: session.questionIds?.length || this.activeQuestionBank().length,
        configuration: {
          maxPlayers: session.configurationSnapshot.maxPlayers,
          timerSeconds: session.configurationSnapshot.timerSeconds,
          questionSeconds: session.configurationSnapshot.questionSeconds,
          revealSeconds: session.configurationSnapshot.revealSeconds,
          autoReveal: session.configurationSnapshot.autoReveal,
          autoAdvanceAfterReveal: session.configurationSnapshot.autoAdvanceAfterReveal,
          leaderboardCount: session.configurationSnapshot.leaderboardCount,
          categories: session.configurationSnapshot.categories
        },
        ruleOptions: role === Role.OPERATOR ? ruleOptions() : undefined,
        allowedRole: role
      },
      question: currentQuestion ? cloneQuestionForPlayer(currentQuestion, reveal) : null,
      answerCount: currentQuestion ? [...session.answers.values()].filter((answer) => answer.questionId === currentQuestion.id).length : 0,
      leaderboard: role === Role.PLAYER ? leaderboard.slice(0, 5) : leaderboard,
      player: player
        ? {
            id: player.id,
            displayName: player.displayName,
            status: player.status,
            correctCount: player.correctCount,
            incorrectCount: player.incorrectCount,
            streak: player.streak,
            lives: player.lives,
            points: player.points,
            currentAnswer: playerAnswer
              ? { choiceId: playerAnswer.choiceId, isCorrect: reveal ? playerAnswer.isCorrect : undefined, acceptedAt: playerAnswer.acceptedAt }
              : null,
            progress: getRule(session.configurationSnapshot.winnerRule.type).progress(player, session.configurationSnapshot.winnerRule)
          }
        : null
    };
  }
}

function secondsElapsed(startedAt, now) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return 0;
  return Math.floor((now - startedAt) / 1000);
}
