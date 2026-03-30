# Multiplayer Tic-Tac-Toe with Nakama

A production-ready, real-time multiplayer Tic-Tac-Toe game with server-authoritative architecture using [Nakama](https://heroiclabs.com/nakama/) as the game server backend.

## Architecture & Design Decisions

### Overview

```
┌──────────────┐     WebSocket      ┌──────────────┐     PostgreSQL    ┌──────────────┐
│  React App   │ ◄────────────────► │ Nakama Server│ ◄───────────────► │  PostgreSQL   │
│  (Frontend)  │    Real-time       │  (Game Logic) │   Persistence    │   Database    │
└──────────────┘                    └──────────────┘                    └──────────────┘
```

### Server-Authoritative Design
- **All game logic runs on the Nakama server** — the client only sends move requests and renders state
- The server validates every move (turn order, cell availability, position bounds)
- Clients cannot manipulate game state; they receive broadcast updates after server validation
- Win/draw detection happens server-side only

### Tech Stack
- **Backend**: Nakama game server with TypeScript runtime
- **Frontend**: React + TypeScript + Vite (responsive, mobile-first)
- **Database**: PostgreSQL (managed by Nakama for accounts, leaderboards, match state)
- **Infrastructure**: Docker Compose for local dev; deployable to any cloud provider

### Key Features
- **Real-time multiplayer** via WebSocket connections
- **Automatic matchmaking** — finds open games or creates new ones
- **Classic & Timed modes** — timed mode adds 30s per turn with auto-forfeit
- **Leaderboard system** — tracks W/L/D, win streaks, and global rankings
- **Concurrent game support** — each match is isolated with its own state
- **Graceful disconnect handling** — opponent wins by forfeit if a player leaves

## Setup & Installation

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- [Node.js](https://nodejs.org/) v18+ and npm

### 1. Clone the repository
```bash
git clone <repo-url>
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
docker-compose up -d
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
| `get_leaderboard` | `""` | Get top 20 leaderboard entries |

### Match OpCodes (WebSocket)

| OpCode | Direction | Description |
|--------|-----------|-------------|
| `1` (MOVE) | Client → Server | Send a move `{ "position": 0-8 }` |
| `2` (STATE) | Server → Client | Broadcast game state update |
| `3` (GAME_OVER) | Server → Client | Game ended (win/lose/draw) |
| `4` (TIMER_UPDATE) | Server → Client | Timer countdown (timed mode) |
| `5` (OPPONENT_LEFT) | Server → Client | Opponent disconnected |
| `6` (REJECTED) | Server → Client | Move was rejected with reason |

### Board Positions
```
 0 | 1 | 2
-----------
 3 | 4 | 5
-----------
 6 | 7 | 8
```

## Deployment

### Cloud Deployment (Production)

#### 1. Deploy Nakama Server

**Using Docker on a cloud VM (e.g., AWS EC2, DigitalOcean Droplet, GCP Compute):**

```bash
# SSH into your server
ssh user@your-server

# Clone the repo
git clone <repo-url>
cd nakama-tic-tac-toe

# Build the server module
cd nakama && npm install && npm run build && cd ..

# Update docker-compose.yml:
# - Change postgres password to a secure value
# - Update the database.address accordingly

# Start in production
docker-compose up -d
```

**Important production changes:**
- Change the PostgreSQL password in `docker-compose.yml`
- Set a custom Nakama server key (add `--socket.server_key your_key` to the nakama entrypoint)
- Configure SSL/TLS with a reverse proxy (nginx/caddy)
- Set up proper firewall rules (expose only ports 7350 and 443)

#### 2. Deploy Frontend

**Using Vercel:**
```bash
cd frontend
npx vercel --prod
```

**Using Nginx (static hosting):**
```bash
cd frontend
npm run build
# Copy dist/ to your web server
scp -r dist/* user@server:/var/www/tictactoe/
```

Update the `.env` or `.env.production` with the production Nakama server URL:
```
VITE_NAKAMA_HOST=your-nakama-server.com
VITE_NAKAMA_PORT=7350
VITE_NAKAMA_SSL=true
VITE_NAKAMA_KEY=your_server_key
```

## Testing Multiplayer

1. **Start the server** with `docker-compose up`
2. **Open two browser tabs** (or two different browsers) at `http://localhost:5173`
3. **Enter different nicknames** in each tab
4. **Select a game mode** (Classic or Timed) and click "Find Match" in both tabs
5. **Play the game** — moves from one tab appear in real-time in the other
6. **Test disconnect** — close one tab mid-game; the other player should win by forfeit
7. **Check the leaderboard** — after games complete, stats appear on the lobby screen

### Testing Concurrent Games
- Open 4+ browser tabs with different nicknames
- Pair them up by clicking "Find Match" — each pair gets a separate isolated game

## Project Structure

```
nakama-tic-tac-toe/
├── docker-compose.yml          # Nakama + PostgreSQL services
├── nakama/
│   ├── package.json
│   ├── tsconfig.json
│   ├── local.yml               # Nakama server config
│   ├── src/
│   │   └── index.ts            # Server-authoritative game logic
│   └── build/
│       └── index.js            # Compiled JS (loaded by Nakama)
├── frontend/
│   ├── package.json
│   ├── .env                    # Environment config
│   ├── index.html
│   └── src/
│       ├── main.tsx            # Entry point
│       ├── App.tsx             # All game screens (login, lobby, game, game-over)
│       ├── nakama.ts           # Nakama client wrapper
│       └── styles.css          # Mobile-first responsive styles
└── README.md
```
