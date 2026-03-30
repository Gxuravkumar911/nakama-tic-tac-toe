// Nakama server-authoritative Tic-Tac-Toe game logic

const moduleName = "tic_tac_toe";
const tickRate = 5;
const maxPlayers = 2;
const turnTimeoutSec = 30;

// Op codes for client-server communication
const OpCode = {
  MOVE: 1,
  STATE: 2,
  GAME_OVER: 3,
  TIMER_UPDATE: 4,
  OPPONENT_LEFT: 5,
  REJECTED: 6,
} as const;

// Game state interface
interface GameState {
  board: number[];           // 0=empty, 1=player1(X), 2=player2(O)
  players: { [userId: string]: PlayerInfo };
  playerOrder: string[];     // [player1UserId, player2UserId]
  currentTurn: number;       // index into playerOrder (0 or 1)
  winner: number;            // 0=none, 1=player1, 2=player2, 3=draw
  gameOver: boolean;
  timedMode: boolean;
  turnDeadline: number;      // unix timestamp ms
  moveCount: number;
  gameOverTick: number;      // tick when game ended (for grace period)
}

interface PlayerInfo {
  mark: number;  // 1=X, 2=O
  displayName: string;
}

interface MoveMessage {
  position: number;
}

const LEADERBOARD_ID = "tictactoe_global";

// Main entry point
function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
  logger.info("Tic-Tac-Toe module loaded");

  // Register the match handler
  initializer.registerMatch(moduleName, {
    matchInit,
    matchJoinAttempt,
    matchJoin,
    matchLeave,
    matchLoop,
    matchTerminate,
    matchSignal,
  });

  // Register RPC for matchmaking
  initializer.registerRpc("find_match", rpcFindMatch);
  initializer.registerRpc("get_leaderboard", rpcGetLeaderboard);

  // Create leaderboard
  nk.leaderboardCreate(LEADERBOARD_ID, true, nkruntime.SortOrder.DESCENDING, nkruntime.Operator.BEST, "0 0 * * 1");

  logger.info("Tic-Tac-Toe module initialized successfully");
}

// RPC: Find or create a match
function rpcFindMatch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  let timedMode = false;
  if (payload) {
    try {
      const data = JSON.parse(payload);
      timedMode = data.timedMode === true;
    } catch (e) {
      // ignore parse errors
    }
  }

  // Look for an existing match with an open slot
  const minPlayers = 0;
  const maxPlayersQuery = 1; // find matches that have less than 2 players
  const label = timedMode ? '{"open":true,"timed":true}' : '{"open":true,"timed":false}';
  const matches = nk.matchList(10, true, label, minPlayers, maxPlayersQuery, "");

  if (matches.length > 0) {
    // Join existing match
    return JSON.stringify({ matchId: matches[0].matchId });
  }

  // Create a new match
  const matchId = nk.matchCreate(moduleName, { timedMode });
  return JSON.stringify({ matchId });
}

// RPC: Get leaderboard
function rpcGetLeaderboard(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const records = nk.leaderboardRecordsList(LEADERBOARD_ID, [], 20, undefined, 0);
  const results = records.records?.map(r => ({
    userId: r.ownerId,
    username: r.username,
    score: r.score,
    subscore: r.subscore,
    metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : {},
  })) || [];
  return JSON.stringify({ records: results });
}

// Match handler: Initialize
function matchInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: string }): { state: nkruntime.MatchState; tickRate: number; label: string } {
  const timedMode = params.timedMode === "true" || params.timedMode === true as any;
  const state: GameState = {
    board: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    players: {},
    playerOrder: [],
    currentTurn: 0,
    winner: 0,
    gameOver: false,
    timedMode,
    turnDeadline: 0,
    moveCount: 0,
    gameOverTick: 0,
  };

  const label = JSON.stringify({ open: true, timed: timedMode });
  logger.info(`Match created. Timed mode: ${timedMode}`);

  return { state, tickRate, label };
}

// Match handler: Join attempt
function matchJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presence: nkruntime.Presence, metadata: { [key: string]: any }): { state: nkruntime.MatchState; accept: boolean; rejectMessage?: string } {
  const gameState = state as GameState;

  if (gameState.gameOver) {
    return { state: gameState, accept: false, rejectMessage: "Game is already over" };
  }

  if (gameState.playerOrder.length >= maxPlayers) {
    return { state: gameState, accept: false, rejectMessage: "Match is full" };
  }

  // Prevent duplicate joins
  if (gameState.players[presence.userId]) {
    return { state: gameState, accept: false, rejectMessage: "Already in match" };
  }

  return { state: gameState, accept: true };
}

// Match handler: Join
function matchJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presences: nkruntime.Presence[]): { state: nkruntime.MatchState } | null {
  const gameState = state as GameState;

  for (const presence of presences) {
    const playerNumber = gameState.playerOrder.length + 1; // 1 or 2
    const account = nk.accountGetId(presence.userId);
    const displayName = account.user.displayName || account.user.username || presence.userId.substring(0, 8);

    gameState.players[presence.userId] = {
      mark: playerNumber,
      displayName,
    };
    gameState.playerOrder.push(presence.userId);

    logger.info(`Player ${displayName} joined as Player ${playerNumber}`);
  }

  // If we now have 2 players, start the game
  if (gameState.playerOrder.length === maxPlayers) {
    const label = JSON.stringify({ open: false, timed: gameState.timedMode });
    dispatcher.matchLabelUpdate(label);

    if (gameState.timedMode) {
      gameState.turnDeadline = Date.now() + turnTimeoutSec * 1000;
    }

    // Broadcast initial state to all players
    const stateMessage = buildStateMessage(gameState);
    dispatcher.broadcastMessage(OpCode.STATE, stateMessage);
    logger.info("Game started!");
  }

  return { state: gameState };
}

// Match handler: Leave
function matchLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presences: nkruntime.Presence[]): { state: nkruntime.MatchState } | null {
  const gameState = state as GameState;

  for (const presence of presences) {
    logger.info(`Player ${presence.userId} left the match`);

    if (!gameState.gameOver && gameState.playerOrder.length === maxPlayers) {
      // Other player wins by forfeit
      const leavingPlayerIndex = gameState.playerOrder.indexOf(presence.userId);
      const winnerIndex = leavingPlayerIndex === 0 ? 1 : 0;
      const winnerId = gameState.playerOrder[winnerIndex];

      gameState.winner = gameState.players[winnerId].mark;
      gameState.gameOver = true;

      // Update leaderboard
      updateLeaderboard(nk, logger, gameState);

      // Notify remaining player
      const msg = JSON.stringify({ reason: "opponent_left" });
      dispatcher.broadcastMessage(OpCode.OPPONENT_LEFT, msg);
      dispatcher.broadcastMessage(OpCode.GAME_OVER, buildStateMessage(gameState));
    }
  }

  // If game is over and all players left, terminate
  const activePlayerIds = presences.map(p => p.userId);
  const allPlayersGone = gameState.playerOrder.every(id => !activePlayerIds.includes(id));
  if (gameState.gameOver && allPlayersGone) {
    return null;
  }

  return { state: gameState };
}

// Match handler: Game loop (runs every tick)
function matchLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, messages: nkruntime.MatchMessage[]): { state: nkruntime.MatchState } | null {
  const gameState = state as GameState;

  if (gameState.gameOver) {
    // Keep match alive for 10 seconds so clients can see result
    if (!gameState.gameOverTick) {
      gameState.gameOverTick = tick;
    }
    if (tick - gameState.gameOverTick > tickRate * 10) return null;
    return { state: gameState };
  }

  // Not enough players yet
  if (gameState.playerOrder.length < maxPlayers) {
    // Timeout if waiting too long (60 seconds)
    if (tick > tickRate * 60) {
      logger.info("Match timed out waiting for players");
      return null;
    }
    return { state: gameState };
  }

  // Check timer timeout
  if (gameState.timedMode && gameState.turnDeadline > 0) {
    if (Date.now() > gameState.turnDeadline) {
      // Current player forfeits due to timeout
      const loserIndex = gameState.currentTurn;
      const winnerIndex = loserIndex === 0 ? 1 : 0;
      const winnerId = gameState.playerOrder[winnerIndex];

      gameState.winner = gameState.players[winnerId].mark;
      gameState.gameOver = true;

      updateLeaderboard(nk, logger, gameState);

      dispatcher.broadcastMessage(OpCode.GAME_OVER, buildStateMessage(gameState));
      logger.info("Player timed out. Game over.");
      return { state: gameState };
    }

    // Broadcast timer updates every second (every tickRate ticks)
    if (tick % tickRate === 0) {
      const remaining = Math.max(0, Math.ceil((gameState.turnDeadline - Date.now()) / 1000));
      const timerMsg = JSON.stringify({ remaining, currentTurn: gameState.currentTurn });
      dispatcher.broadcastMessage(OpCode.TIMER_UPDATE, timerMsg);
    }
  }

  // Process messages (moves)
  for (const message of messages) {
    if (message.opCode !== OpCode.MOVE) continue;

    const senderId = message.sender.userId;
    const senderIndex = gameState.playerOrder.indexOf(senderId);

    // Validate it's this player's turn
    if (senderIndex !== gameState.currentTurn) {
      const reject = JSON.stringify({ error: "Not your turn" });
      dispatcher.broadcastMessage(OpCode.REJECTED, reject, [message.sender]);
      continue;
    }

    // Parse move
    let move: MoveMessage;
    try {
      move = JSON.parse(nk.binaryToString(message.data));
    } catch (e) {
      const reject = JSON.stringify({ error: "Invalid message format" });
      dispatcher.broadcastMessage(OpCode.REJECTED, reject, [message.sender]);
      continue;
    }

    // Validate position
    if (move.position < 0 || move.position > 8) {
      const reject = JSON.stringify({ error: "Invalid position" });
      dispatcher.broadcastMessage(OpCode.REJECTED, reject, [message.sender]);
      continue;
    }

    // Validate cell is empty
    if (gameState.board[move.position] !== 0) {
      const reject = JSON.stringify({ error: "Cell already occupied" });
      dispatcher.broadcastMessage(OpCode.REJECTED, reject, [message.sender]);
      continue;
    }

    // Apply move
    const playerMark = gameState.players[senderId].mark;
    gameState.board[move.position] = playerMark;
    gameState.moveCount++;

    logger.info(`Player ${senderId} placed mark at position ${move.position}`);

    // Check for win
    const winner = checkWinner(gameState.board);
    if (winner > 0) {
      gameState.winner = winner;
      gameState.gameOver = true;
      updateLeaderboard(nk, logger, gameState);
      dispatcher.broadcastMessage(OpCode.GAME_OVER, buildStateMessage(gameState));
      return { state: gameState };
    }

    // Check for draw
    if (gameState.moveCount >= 9) {
      gameState.winner = 3; // draw
      gameState.gameOver = true;
      updateLeaderboard(nk, logger, gameState);
      dispatcher.broadcastMessage(OpCode.GAME_OVER, buildStateMessage(gameState));
      return { state: gameState };
    }

    // Switch turn
    gameState.currentTurn = gameState.currentTurn === 0 ? 1 : 0;

    // Reset timer
    if (gameState.timedMode) {
      gameState.turnDeadline = Date.now() + turnTimeoutSec * 1000;
    }

    // Broadcast updated state
    dispatcher.broadcastMessage(OpCode.STATE, buildStateMessage(gameState));
  }

  return { state: gameState };
}

// Match handler: Terminate
function matchTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, graceSeconds: number): { state: nkruntime.MatchState } | null {
  logger.info("Match terminated");
  return null;
}

// Match handler: Signal
function matchSignal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, data: string): { state: nkruntime.MatchState; data?: string } | null {
  return { state, data: "ok" };
}

// Check if there's a winner
function checkWinner(board: number[]): number {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
    [0, 4, 8], [2, 4, 6],             // diagonals
  ];

  for (const [a, b, c] of lines) {
    if (board[a] !== 0 && board[a] === board[b] && board[a] === board[c]) {
      return board[a]; // returns 1 or 2
    }
  }

  return 0;
}

// Build state message to send to clients
function buildStateMessage(state: GameState): string {
  const players: { [key: string]: { mark: number; displayName: string } } = {};
  for (const [userId, info] of Object.entries(state.players)) {
    players[userId] = { mark: info.mark, displayName: info.displayName };
  }

  return JSON.stringify({
    board: state.board,
    players,
    playerOrder: state.playerOrder,
    currentTurn: state.currentTurn,
    winner: state.winner,
    gameOver: state.gameOver,
    timedMode: state.timedMode,
    turnDeadline: state.turnDeadline,
    moveCount: state.moveCount,
  });
}

// Update leaderboard after game ends
function updateLeaderboard(nk: nkruntime.Nakama, logger: nkruntime.Logger, state: GameState) {
  try {
    for (let i = 0; i < state.playerOrder.length; i++) {
      const userId = state.playerOrder[i];
      const playerMark = state.players[userId].mark;
      const username = state.players[userId].displayName;

      // Read current stats
      let wins = 0, losses = 0, draws = 0, streak = 0;
      try {
        const records = nk.leaderboardRecordsList(LEADERBOARD_ID, [userId], 1, undefined, 0);
        if (records.records && records.records.length > 0) {
          const rawMeta = records.records[0].metadata;
          const meta = rawMeta ? (typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta) : {};
          wins = meta.wins || 0;
          losses = meta.losses || 0;
          draws = meta.draws || 0;
          streak = meta.streak || 0;
        }
      } catch (e) {
        // No existing record
      }

      if (state.winner === 3) {
        // Draw
        draws++;
        streak = 0;
      } else if (state.winner === playerMark) {
        // Win
        wins++;
        streak = Math.max(streak + 1, 1);
      } else {
        // Loss
        losses++;
        streak = 0;
      }

      const score = wins * 100 + draws * 10;
      const metadata: { [key: string]: any } = { wins, losses, draws, streak };

      nk.leaderboardRecordWrite(LEADERBOARD_ID, userId, username, score, streak, metadata);
      logger.info(`Updated leaderboard for ${username}: W${wins}/L${losses}/D${draws} streak:${streak}`);
    }
  } catch (e) {
    logger.error(`Error updating leaderboard: ${e}`);
  }
}
