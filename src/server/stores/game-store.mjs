export class GameStore {
  async bootstrap() {
    throw new Error("GameStore.bootstrap is not implemented");
  }

  async createSession(config) {
    throw new Error("GameStore.createSession is not implemented");
  }

  async findSessionByJoinCode(joinCode) {
    throw new Error("GameStore.findSessionByJoinCode is not implemented");
  }

  async getSnapshot(sessionId, role, playerId = null) {
    throw new Error("GameStore.getSnapshot is not implemented");
  }

  async listQuestions() {
    throw new Error("GameStore.listQuestions is not implemented");
  }

  async saveQuestion(question) {
    throw new Error("GameStore.saveQuestion is not implemented");
  }

  async archiveQuestion(questionId) {
    throw new Error("GameStore.archiveQuestion is not implemented");
  }

  async advanceTimers(sessionId) {
    return { sessionId, advanced: false, eventType: null };
  }

  async joinSession(joinCode, displayName) {
    throw new Error("GameStore.joinSession is not implemented");
  }

  async operatorAction(sessionId, action) {
    throw new Error("GameStore.operatorAction is not implemented");
  }

  async submitAnswer({ sessionId, playerId, choiceId, idempotencyKey }) {
    throw new Error("GameStore.submitAnswer is not implemented");
  }

  async publishEvent(sessionId, eventType) {
    return { sessionId, eventType, published: false };
  }
}
