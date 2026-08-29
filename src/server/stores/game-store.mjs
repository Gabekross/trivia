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
