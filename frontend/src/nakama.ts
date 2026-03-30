import { Client, Session } from "@heroiclabs/nakama-js";
import type { Socket, Match, MatchData } from "@heroiclabs/nakama-js";

const NAKAMA_HOST = import.meta.env.VITE_NAKAMA_HOST || "127.0.0.1";
const NAKAMA_PORT = import.meta.env.VITE_NAKAMA_PORT || "7350";
const NAKAMA_SSL = import.meta.env.VITE_NAKAMA_SSL === "true";
const NAKAMA_KEY = import.meta.env.VITE_NAKAMA_KEY || "defaultkey";

const OpCode = {
  MOVE: 1,
  STATE: 2,
  GAME_OVER: 3,
  TIMER_UPDATE: 4,
  OPPONENT_LEFT: 5,
  REJECTED: 6,
} as const;

export interface GameStateData {
  board: number[];
  players: { [key: string]: { mark: number; displayName: string } };
  playerOrder: string[];
  currentTurn: number;
  winner: number;
  gameOver: boolean;
  timedMode: boolean;
  turnDeadline: number;
  moveCount: number;
}

export interface LeaderboardEntry {
  userId: string;
  username: string;
  score: number;
  subscore: number;
  metadata: { wins: number; losses: number; draws: number; streak: number };
}

export type GameEventCallback = {
  onState?: (state: GameStateData) => void;
  onGameOver?: (state: GameStateData) => void;
  onTimerUpdate?: (remaining: number, currentTurn: number) => void;
  onOpponentLeft?: () => void;
  onError?: (error: string) => void;
  onMatchPresence?: (joins: any[], leaves: any[]) => void;
};

class NakamaClient {
  private client: Client;
  private session: Session | null = null;
  private socket: Socket | null = null;
  private currentMatchId: string | null = null;
  private callbacks: GameEventCallback = {};

  constructor() {
    this.client = new Client(NAKAMA_KEY, NAKAMA_HOST, NAKAMA_PORT, NAKAMA_SSL);
  }

  async authenticate(displayName: string): Promise<Session> {
    // Use device auth with a random ID for simplicity
    let deviceId = localStorage.getItem("deviceId");
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem("deviceId", deviceId);
    }

    this.session = await this.client.authenticateDevice(deviceId, true, displayName);

    // Update display name if changed
    if (displayName && this.session.username !== displayName) {
      await this.client.updateAccount(this.session, { display_name: displayName });
    }

    return this.session;
  }

  async connect(callbacks: GameEventCallback): Promise<void> {
    if (!this.session) throw new Error("Not authenticated");

    this.callbacks = callbacks;
    this.socket = this.client.createSocket(NAKAMA_SSL, false);

    // Connect with timeout
    const connectPromise = this.socket.connect(this.session, true);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Connection timed out. Is the server running?")), 8000)
    );
    await Promise.race([connectPromise, timeoutPromise]);

    this.socket.onmatchdata = (matchData: MatchData) => {
      let data: any;
      try {
        data = JSON.parse(new TextDecoder().decode(matchData.data as Uint8Array));
      } catch (e) {
        this.callbacks.onError?.("Failed to parse server message");
        return;
      }

      switch (matchData.op_code) {
        case OpCode.STATE:
          this.callbacks.onState?.(data as GameStateData);
          break;
        case OpCode.GAME_OVER:
          this.callbacks.onGameOver?.(data as GameStateData);
          break;
        case OpCode.TIMER_UPDATE:
          this.callbacks.onTimerUpdate?.(data.remaining, data.currentTurn);
          break;
        case OpCode.OPPONENT_LEFT:
          this.callbacks.onOpponentLeft?.();
          break;
        case OpCode.REJECTED:
          this.callbacks.onError?.(data.error);
          break;
      }
    };

    this.socket.onmatchpresence = (event) => {
      this.callbacks.onMatchPresence?.(event.joins || [], event.leaves || []);
    };

    this.socket.ondisconnect = () => {
      this.callbacks.onError?.("Connection lost. Please refresh and try again.");
      this.currentMatchId = null;
    };
  }

  async findMatch(timedMode: boolean = false): Promise<string> {
    if (!this.session) throw new Error("Not authenticated");

    const response = await this.client.rpc(this.session, "find_match", { timedMode });
    const data = typeof response.payload === 'string' ? JSON.parse(response.payload) : response.payload as Record<string, unknown>;
    const matchId = data.matchId;

    if (!this.socket) throw new Error("Not connected");

    const match: Match = await this.socket.joinMatch(matchId);
    this.currentMatchId = match.match_id;

    return match.match_id;
  }

  async sendMove(position: number): Promise<void> {
    if (!this.socket || !this.currentMatchId) throw new Error("Not in a match");

    const data = JSON.stringify({ position });
    await this.socket.sendMatchState(this.currentMatchId, OpCode.MOVE, data);
  }

  async leaveMatch(): Promise<void> {
    if (this.socket && this.currentMatchId) {
      await this.socket.leaveMatch(this.currentMatchId);
      this.currentMatchId = null;
    }
  }

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    if (!this.session) throw new Error("Not authenticated");

    const response = await this.client.rpc(this.session, "get_leaderboard", {});
    const data = typeof response.payload === 'string' ? JSON.parse(response.payload) : response.payload as Record<string, unknown>;
    return data.records || [];
  }

  getUserId(): string | null {
    return this.session?.user_id || null;
  }

  getUsername(): string | null {
    return this.session?.username || null;
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.disconnect(true);
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return this.socket !== null;
  }

  getMatchId(): string | null {
    return this.currentMatchId;
  }
}

// Singleton
export const nakamaClient = new NakamaClient();
export { OpCode };
