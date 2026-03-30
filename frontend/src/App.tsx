import { useState, useCallback, useRef, useEffect } from 'react';
import { nakamaClient } from './nakama';
import type { GameStateData, LeaderboardEntry } from './nakama';

type Screen = 'login' | 'lobby' | 'searching' | 'game';

function App() {
  const [screen, setScreen] = useState<Screen>('login');
  const [nickname, setNickname] = useState('');
  const [timedMode, setTimedMode] = useState(false);
  const [gameState, setGameState] = useState<GameStateData | null>(null);
  const [gameOver, setGameOver] = useState<GameStateData | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState(false);
  const searchingRef = useRef(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userId = nakamaClient.getUserId();

  // Search timeout — if no opponent found in 30s, show a message
  useEffect(() => {
    if (screen === 'searching' || waitingForOpponent) {
      setSearchTimeout(false);
      searchTimerRef.current = setTimeout(() => setSearchTimeout(true), 30000);
    } else {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      setSearchTimeout(false);
    }
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [screen, waitingForOpponent]);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const records = await nakamaClient.getLeaderboard();
      setLeaderboard(records);
    } catch (e) {
      // ignore
    }
  }, []);

  const handleLogin = async () => {
    if (!nickname.trim()) return;
    try {
      setError('');
      await nakamaClient.authenticate(nickname.trim());
      await nakamaClient.connect({
        onState: (state) => {
          setGameState(state);
          setWaitingForOpponent(false);
          setScreen('game');
        },
        onGameOver: (state) => {
          setGameState(state);
          setGameOver(state);
        },
        onTimerUpdate: (remaining) => {
          setTimeRemaining(remaining);
        },
        onOpponentLeft: () => {
          setStatusMsg('Opponent left the match');
        },
        onError: (err) => {
          setError(err);
          setTimeout(() => setError(''), 3000);
        },
        onMatchPresence: (_joins, leaves) => {
          if (leaves.length > 0) {
            setStatusMsg('Opponent disconnected');
          }
        },
      });
      setScreen('lobby');
      fetchLeaderboard();
    } catch (e: any) {
      setError(e.message || 'Failed to connect');
    }
  };

  const handleFindMatch = async () => {
    if (searchingRef.current) return;
    searchingRef.current = true;
    setScreen('searching');
    setGameState(null);
    setGameOver(null);
    setTimeRemaining(null);
    setStatusMsg('');
    setError('');

    try {
      await nakamaClient.findMatch(timedMode);
      // If we join but game hasn't started yet (waiting for opponent)
      setWaitingForOpponent(true);
    } catch (e: any) {
      setError(e.message || 'Failed to find match');
      setScreen('lobby');
    } finally {
      searchingRef.current = false;
    }
  };

  const handleCellClick = async (position: number) => {
    if (!gameState || gameState.gameOver) return;
    if (gameState.board[position] !== 0) return;

    // Check if it's our turn
    const myIndex = gameState.playerOrder.indexOf(userId!);
    if (myIndex !== gameState.currentTurn) return;

    try {
      await nakamaClient.sendMove(position);
    } catch (e: any) {
      setError(e.message || 'Failed to send move');
    }
  };

  const handlePlayAgain = async () => {
    setGameOver(null);
    setGameState(null);
    setTimeRemaining(null);
    setStatusMsg('');
    await nakamaClient.leaveMatch();
    fetchLeaderboard();
    setScreen('lobby');
  };

  const handleBackToLobby = async () => {
    setGameOver(null);
    setGameState(null);
    setTimeRemaining(null);
    setStatusMsg('');
    setWaitingForOpponent(false);
    searchingRef.current = false;
    await nakamaClient.leaveMatch();
    fetchLeaderboard();
    setScreen('lobby');
  };

  // Determine game result from our perspective
  const getResult = () => {
    if (!gameOver || !userId) return null;
    const myMark = gameOver.players[userId]?.mark;
    if (gameOver.winner === 3) return 'draw';
    if (gameOver.winner === myMark) return 'win';
    return 'lose';
  };

  // Render mark
  const renderMark = (value: number) => {
    if (value === 1) return <span className="x">X</span>;
    if (value === 2) return <span className="o">O</span>;
    return null;
  };

  // Login screen
  if (screen === 'login') {
    return (
      <div className="screen login-screen">
        <h1>TIC TAC TOE</h1>
        <p>Multiplayer Real-Time</p>
        <div className="input-group">
          <input
            type="text"
            placeholder="Enter your nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            maxLength={20}
            autoFocus
          />
        </div>
        <button className="btn btn-primary" onClick={handleLogin} disabled={!nickname.trim()}>
          Play
        </button>
        {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}
      </div>
    );
  }

  // Lobby screen
  if (screen === 'lobby') {
    return (
      <div className="screen lobby-screen">
        <h2>Welcome, {nakamaClient.getUsername()}</h2>

        <div className="mode-selector">
          <div
            className={`mode-btn ${!timedMode ? 'selected' : ''}`}
            onClick={() => setTimedMode(false)}
          >
            <h3>Classic</h3>
            <p>No time limit</p>
          </div>
          <div
            className={`mode-btn ${timedMode ? 'selected' : ''}`}
            onClick={() => setTimedMode(true)}
          >
            <h3>Timed</h3>
            <p>30s per turn</p>
          </div>
        </div>

        <button className="btn btn-primary" onClick={handleFindMatch}>
          Find Match
        </button>

        {leaderboard.length > 0 && (
          <div className="leaderboard">
            <h3>Leaderboard</h3>
            {leaderboard.slice(0, 10).map((entry, i) => (
              <div key={entry.userId} className="leaderboard-row">
                <span className={`rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}`}>
                  {i + 1}
                </span>
                <span className="username">{entry.username}</span>
                <span className="stats">
                  {entry.metadata.wins}W/{entry.metadata.losses}L/{entry.metadata.draws}D
                </span>
                <span className="score">{entry.score}</span>
                {entry.metadata.streak > 1 && (
                  <span className="streak-badge">{entry.metadata.streak} streak</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Searching screen
  if (screen === 'searching' || waitingForOpponent) {
    return (
      <div className="screen searching">
        <div className="spinner" />
        <h2>Finding a match...</h2>
        <p>{searchTimeout ? 'No opponents found yet. Try again or wait...' : 'Waiting for an opponent'}</p>
        <button className="btn btn-secondary btn-small" onClick={handleBackToLobby}>
          Cancel
        </button>
      </div>
    );
  }

  // Game screen
  if (screen === 'game' && gameState) {
    const myIndex = gameState.playerOrder.indexOf(userId!);
    const opponentIndex = myIndex === 0 ? 1 : 0;
    const myInfo = gameState.players[gameState.playerOrder[myIndex]];
    const opponentInfo = gameState.players[gameState.playerOrder[opponentIndex]];
    const isMyTurn = gameState.currentTurn === myIndex && !gameState.gameOver;
    const currentMark = gameState.currentTurn === 0 ? 1 : 2;
    const result = getResult();

    return (
      <div className="screen game-screen">
        {/* Header with player info */}
        <div className="game-header">
          <div className={`player-info ${myInfo?.mark === 1 ? 'x-player' : 'o-player'} ${isMyTurn ? 'active' : ''}`}>
            <div className="name">{myInfo?.displayName || 'You'} <span className="mark">({myInfo?.mark === 1 ? 'X' : 'O'})</span></div>
            <div className="label">You</div>
          </div>

          <div className="turn-indicator">
            <div className="mark">{renderMark(currentMark)}</div>
            <div className="text">Turn</div>
          </div>

          <div className={`player-info ${opponentInfo?.mark === 1 ? 'x-player' : 'o-player'} ${!isMyTurn && !gameState.gameOver ? 'active' : ''}`}>
            <div className="name">{opponentInfo?.displayName || 'Opponent'} <span className="mark">({opponentInfo?.mark === 1 ? 'X' : 'O'})</span></div>
            <div className="label">Opponent</div>
          </div>
        </div>

        {/* Timer */}
        {gameState.timedMode && timeRemaining !== null && !gameState.gameOver && (
          <div className={`timer-bar ${timeRemaining <= 10 ? (timeRemaining <= 5 ? 'danger' : 'warning') : ''}`}>
            {timeRemaining}s remaining
          </div>
        )}

        {/* Board */}
        <div className="board">
          {gameState.board.map((cell, i) => (
            <div
              key={i}
              className={`cell ${cell !== 0 ? 'occupied' : ''} ${!isMyTurn || gameState.gameOver ? 'disabled' : ''}`}
              onClick={() => handleCellClick(i)}
            >
              {renderMark(cell)}
            </div>
          ))}
        </div>

        {/* Status */}
        {!gameState.gameOver && (
          <div className="status-msg">
            {isMyTurn ? 'Your turn!' : "Opponent's turn..."}
          </div>
        )}
        {statusMsg && <div className="status-msg">{statusMsg}</div>}
        {error && <div className="status-msg" style={{ color: 'var(--danger)' }}>{error}</div>}

        {/* Game Over Overlay */}
        {gameOver && (
          <div className="game-over-overlay">
            <div className="game-over-card">
              <div className={`result-icon ${result}`}>
                {result === 'win' ? (myInfo?.mark === 1 ? 'X' : 'O') : result === 'lose' ? (opponentInfo?.mark === 1 ? 'X' : 'O') : '='}
              </div>
              <div className="result-text">
                {result === 'win' ? 'You Won!' : result === 'lose' ? 'You Lost' : "It's a Draw"}
              </div>
              {result === 'win' && <div className="result-score">+100 pts</div>}
              <div className="game-over-actions">
                <button className="btn btn-primary" onClick={handlePlayAgain}>
                  Play Again
                </button>
                <button className="btn btn-secondary" onClick={handleBackToLobby}>
                  Lobby
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Fallback
  return (
    <div className="screen">
      <p>Loading...</p>
    </div>
  );
}

export default App;
