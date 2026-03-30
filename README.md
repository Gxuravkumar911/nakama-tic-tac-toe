# Multiplayer Tic-Tac-Toe with Nakama

A production-ready, real-time multiplayer Tic-Tac-Toe game with server-authoritative architecture using [Nakama](https://heroiclabs.com/nakama/) as the game server backend.

## Live Demo

- **Game URL**: _[Please go through with the local deployment steps to run it]_
- **Nakama Server**: _[Same as above]_

## Architecture & Design Decisions

### Overview

```
┌──────────────┐     WebSocket      ┌──────────────┐     PostgreSQL    ┌──────────────┐
│  React App   │ ◄────────────────► │ Nakama Server│ ◄───────────────► │  PostgreSQL   │
│  (Frontend)  │    Real-time       │  (Game Logic) │   Persistence    │   Database    │
└──────────────┘                    └──────────────┘                    └──────────────┘
```

### Why This Architecture?

1. **Server-Authoritative**: All game logic runs on the Nakama server. The client is a "dumb terminal" — it only sends move requests (`{position: 0-8}`) and renders whatever state the server broadcasts. This prevents any client-side cheating or manipulation.

2. **Why Nakama?**: Instead of building a custom WebSocket server, auth system, matchmaking, and leaderboard from scratch (~2000+ lines of infrastructure code), Nakama provides all of this out of the box. Our game logic is just ~440 lines of TypeScript that plugs into Nakama's match handler lifecycle.

3. **Why React + Vite?**: Lightweight, fast HMR for development, and produces a small static bundle for deployment. No SSR needed — the game is entirely client-side with real-time WebSocket communication.

4. **Why Docker Compose?**: Nakama requires PostgreSQL. Docker Compose bundles both services with health checks, volume persistence, and one-command startup. Same setup works locally and in production.

### Server-Authoritative Design

The server validates **every** move before applying it:

```
Client sends: {position: 4}
        ↓
Server validates:
  1. Is it this player's turn?       → rejects if not
  2. Is the position valid (0-8)?    → rejects if out of bounds
  3. Is the cell empty?              → rejects if occupied
        ↓
Server applies move to board
        ↓
Server checks for win (8 lines) or draw (9 moves)
        ↓
Server broadcasts new state to BOTH players
```

Clients cannot modify the board directly. Any tampered messages are rejected with an error code.

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 19 + TypeScript + Vite | UI rendering, user interactions |
| **Transport** | WebSocket (Nakama JS SDK) | Real-time bidirectional communication |
| **Game Server** | Nakama 3.21.1 (TypeScript runtime) | Game logic, validation, matchmaking |
| **Database** | PostgreSQL 15 | User accounts, leaderboards, match metadata |
| **Infrastructure** | Docker Compose | Container orchestration |

### Key Features

| Feature | Description |
|---------|-------------|
| **Real-time multiplayer** | WebSocket-based instant state sync between players |
| **Automatic matchmaking** | Finds open games or creates new ones, filtered by game mode |
| **Classic & Timed modes** | Timed mode: 30s per turn with auto-forfeit on timeout |
| **Leaderboard** | Tracks W/L/D, win streaks, global rankings (weekly reset) |
| **Concurrent games** | Multiple isolated matches running simultaneously |
| **Disconnect handling** | Opponent wins by forfeit if a player leaves mid-game |

## Setup & Installation

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js](https://nodejs.org/) v18+ and npm

### 1. Clone the repository
```bash
git clone https://github.com/Gxuravkumar911/nakama-tic-tac-toe.git
cd nakama-tic-tac-toe
```

### 2. Build the Nakama server module
```bash
cd nakama
npm install
npm run build
cd ..
```

### 3. Start the Nakama server
```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on port `5432`
- **Nakama server** on ports `7350` (HTTP/WS API), `7351` (Admin Console), `7349` (gRPC)

Verify the server is running by visiting the Nakama Console at `http://localhost:7351` (default credentials: `admin` / `password`).

### 4. Start the frontend
```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

### 5. Environment Configuration

Frontend environment variables (in `frontend/.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_NAKAMA_HOST` | `127.0.0.1` | Nakama server host |
| `VITE_NAKAMA_PORT` | `7350` | Nakama HTTP API port |
| `VITE_NAKAMA_SSL` | `false` | Use SSL for connections |
| `VITE_NAKAMA_KEY` | `defaultkey` | Nakama server key |

## API / Server Configuration

### Nakama RPCs

| RPC | Payload | Description |
|-----|---------|-------------|
| `find_match` | `{ "timedMode": true/false }` | Find or create a match |
| `get_leaderboard` | `{}` | Get top 20 leaderboard entries |

### Match OpCodes (WebSocket)

| OpCode | Direction | Description |
|--------|-----------|-------------|
| `1` (MOVE) | Client → Server | Send a move `{ "position": 0-8 }` |
| `2` (STATE) | Server → Client | Broadcast full game state |
| `3` (GAME_OVER) | Server → Client | Game ended with winner/draw info |
| `4` (TIMER_UPDATE) | Server → Client | Timer countdown (timed mode only) |
| `5` (OPPONENT_LEFT) | Server → Client | Opponent disconnected |
| `6` (REJECTED) | Server → Client | Move rejected with error reason |

### Game State Schema (broadcast on OpCode 2 & 3)

```json
{
  "board": [0, 0, 1, 0, 2, 0, 0, 0, 0],
  "players": {
    "user-id-1": { "mark": 1, "displayName": "Alice" },
    "user-id-2": { "mark": 2, "displayName": "Bob" }
  },
  "playerOrder": ["user-id-1", "user-id-2"],
  "currentTurn": 1,
  "winner": 0,
  "gameOver": false,
  "timedMode": false,
  "moveCount": 2
}
```

### Board Positions
```
 0 | 1 | 2
-----------
 3 | 4 | 5
-----------
 6 | 7 | 8
```

### Leaderboard

- **ID**: `tictactoe_global`
- **Sort**: Descending by score
- **Score formula**: `wins * 100 + draws * 10`
- **Subscore**: Current win streak
- **Reset**: Weekly (every Monday at midnight UTC)
- **Metadata per player**: `{ wins, losses, draws, streak }`

## Deployment

### Option 1: Railway (Backend) + Vercel (Frontend)

#### Deploy Nakama Backend on Railway

1. Sign up at [railway.app](https://railway.app) with GitHub
2. Create a new project
3. **Add PostgreSQL**: Click "New" → "Database" → "PostgreSQL"
4. **Add Nakama service**: Click "New" → "Docker Image" → enter `registry.heroiclabs.com/heroiclabs/nakama:3.21.1`
5. Set environment variables:
   - Link the PostgreSQL connection string
   - Set `--runtime.js_entrypoint "build/index.js"`
6. Mount the `nakama/build/` and `nakama/local.yml` files
7. Expose port `7350`

#### Deploy Frontend on Vercel

```bash
cd frontend

# Create production env
echo 'VITE_NAKAMA_HOST=your-railway-nakama-url.railway.app' > .env.production
echo 'VITE_NAKAMA_PORT=443' >> .env.production
echo 'VITE_NAKAMA_SSL=true' >> .env.production
echo 'VITE_NAKAMA_KEY=defaultkey' >> .env.production

# Deploy
npx vercel --prod
```

Or connect the GitHub repo to Vercel dashboard:
1. Go to [vercel.com](https://vercel.com) → Import Project → select `nakama-tic-tac-toe`
2. Set root directory to `frontend`
3. Add the environment variables above
4. Deploy

### Option 2: Docker on a Cloud VM

```bash
# SSH into your server (e.g., DigitalOcean, AWS EC2, GCP)
ssh user@your-server

# Clone and build
git clone https://github.com/Gxuravkumar911/nakama-tic-tac-toe.git
cd nakama-tic-tac-toe
cd nakama && npm install && npm run build && cd ..

# Start services
docker compose up -d
```

**Production hardening:**
- Change PostgreSQL password in `docker-compose.yml`
- Set a custom Nakama server key: add `--socket.server_key your_key` to entrypoint
- Set up a reverse proxy (nginx/caddy) with SSL/TLS
- Configure firewall to expose only ports 443 and 7350

### Option 3: Frontend on Nginx (Static)

```bash
cd frontend
npm run build
scp -r dist/* user@server:/var/www/tictactoe/
```

Nginx config:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/tictactoe;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Testing Multiplayer

### Basic Test
1. Start the server: `docker compose up -d`
2. Start the frontend: `cd frontend && npm run dev`
3. Open **two browser tabs** at `http://localhost:5173`
4. Enter **different nicknames** in each tab
5. Select a game mode (Classic or Timed) and click "Find Match" in both
6. Play — moves appear in real-time in both tabs

### Disconnect Test
- Close one tab mid-game → the other player wins by forfeit
- Verify the "Opponent left" message appears

### Timed Mode Test
- Select "Timed" mode in both tabs
- Wait 30 seconds without making a move → auto-forfeit triggers

### Leaderboard Test
- Play several games → check lobby screen for updated W/L/D stats
- Verify win streaks are tracked correctly

### Concurrent Games Test
- Open **4+ browser tabs** with different nicknames
- Click "Find Match" in all → they pair up into separate isolated games
- Verify each game runs independently

## Project Structure

```
nakama-tic-tac-toe/
├── docker-compose.yml          # Nakama + PostgreSQL services
├── Dockerfile                  # Nakama production image
├── nakama/
│   ├── package.json
│   ├── tsconfig.json
│   ├── local.yml               # Nakama server config
│   ├── src/
│   │   └── index.ts            # Server-authoritative game logic (440 lines)
│   └── build/
│       └── index.js            # Compiled JS (loaded by Nakama runtime)
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── .env                    # Local environment config
│   ├── .env.example            # Environment template
│   ├── index.html
│   └── src/
│       ├── main.tsx            # React entry point
│       ├── App.tsx             # All game screens (login, lobby, game, game-over)
│       ├── nakama.ts           # Nakama client wrapper & WebSocket handler
│       └── styles.css          # Mobile-first responsive styles
└── README.md
```
