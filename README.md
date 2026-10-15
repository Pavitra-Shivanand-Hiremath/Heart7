# Heart7

A real-time, room-code based multiplayer implementation of Heart7 (the "Sevens" / Fan-Tan card game).

## Rules implemented

- One or more standard 52-card decks are dealt out evenly to every player at the table.
- Each suit "opens" when its 7 is played, then grows outward: 6 & 8, then 5 & 9, then 4 & 10 ... down to Ace and up to King.
- With multiple decks, duplicate cards stack on the same slot (e.g. a second 7♥ just joins the first).
- Whoever holds 7♥ plays first.
- If you have a legal move, you must play it — you can only pass when nothing in your hand is playable.
- No draw pile, no penalty for passing. First player to empty their hand wins and the game ends immediately.

## Project layout

```
heart7/
  backend/    FastAPI + WebSockets game server (in-memory room state)
  frontend/   React (Vite) client
```

## Running it with Docker (recommended)

From the `heart7/` root:

```bash
docker compose up --build
```

This builds and starts two containers:
- **backend** — FastAPI/WebSocket server on `http://localhost:8000`
- **frontend** — production React build served by nginx on `http://localhost:3000`

Open `http://localhost:3000` and play. Stop with `Ctrl+C`, or `docker compose down` to tear the containers down.

**If you want other devices on your network (or a real deployment) to connect:** the frontend's WebSocket URL is baked into the static build at build time, since it's just a browser bundle, not a running server. Edit the `VITE_WS_URL` build arg in `docker-compose.yml` to point at your backend's actual reachable address (e.g. `ws://192.168.1.23:8000` on a LAN, or `wss://api.yourdomain.com` in production) and re-run `docker compose up --build`.

**Rebuilding after code changes:** `docker compose up --build` again — plain `docker compose up` reuses cached images and won't pick up edits.

## Running it locally without Docker

### 1. Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate   # optional but recommended
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The server exposes two WebSocket routes:
- `ws://localhost:8000/ws/create?name=Alice&decks=1` — creates a room, returns a 5-character room code.
- `ws://localhost:8000/ws/join/ABCDE?name=Bob` — joins an existing room by code.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`). By default the client talks to `ws://localhost:8000`; to point it at a different backend, set `VITE_WS_URL` (e.g. in a `.env` file: `VITE_WS_URL=wss://your-backend-host`).

### 3. Play

- One player creates a room, choosing how many decks to use, and shares the room code.
- Everyone else joins with that code.
- Once at least 2 players have joined, the host clicks **Start game**.
- On your turn, playable cards in your hand lift up and highlight gold — tap one to play it, or **Pass** if nothing is playable.

## Notes on the current implementation

- Room state lives in memory in the FastAPI process, so it resets on server restart and won't scale past a single backend instance as-is. For production you'd want to move room state into Redis (or similar) so it survives restarts and works across multiple backend instances.
- **Refresh-proof sessions**: the client stores `{roomCode, playerId}` in `localStorage` and automatically reconnects to the same seat on load via `/ws/reconnect/{code}`. Hand, table state, and turn all come back exactly as they were. This only works while the backend process itself is still running (room state is in memory) — if the server restarts, old sessions can no longer be resumed and the client falls back to the Home screen with an explanatory message.
- **Leaving a room**: the "Leave" button sends an explicit `leave_room` message.
  - In the lobby (game not started), leaving removes you from the room entirely; if you were the host, host privileges pass to the next player.
  - Mid-game, leaving marks your seat as permanently left (distinct from merely losing connection) and skips you in the turn order from then on. If leaving drops the room to one remaining player, that player is declared the winner automatically.
  - A dropped connection (closed tab, lost wifi) is *not* treated as leaving — that seat just waits for reconnection, including on its own turn.
- No persistence/accounts, by design, per your earlier answer — rooms are ephemeral and identified only by their code.
