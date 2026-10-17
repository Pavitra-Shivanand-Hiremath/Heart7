import { useEffect, useRef, useState } from "react";
import Home from "./components/Home.jsx";
import Lobby from "./components/Lobby.jsx";
import GameTable from "./components/GameTable.jsx";
import PlayingCard from "./components/PlayingCard.jsx";

// Talk to whatever origin this page was loaded from by default (nginx
// proxies /ws/* through to the backend container — see frontend/nginx.conf),
// so this works unchanged on localhost, over LAN, or behind a Cloudflare
// Tunnel without any rebuild. Set VITE_WS_URL at build time only if you need
// to point at a different backend host.
const WS_BASE =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
const EMPTY_TABLE = { H: [], D: [], C: [], S: [] };
const SESSION_KEY = "heart7_session";

function saveSession(code, playerId) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ code, playerId }));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export default function App() {
  const [screen, setScreen] = useState("home"); // home | lobby | game
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const [playerId, setPlayerId] = useState(null);
  const [code, setCode] = useState("");
  const [hostId, setHostId] = useState(null);
  const [numDecks, setNumDecks] = useState(1);
  const [players, setPlayers] = useState([]);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [winnerId, setWinnerId] = useState(null);

  const [hand, setHand] = useState([]);
  const [selectedUid, setSelectedUid] = useState(null);
  const [table, setTable] = useState(EMPTY_TABLE);
  const [currentPlayerId, setCurrentPlayerId] = useState(null);
  const [lastAction, setLastAction] = useState(null);

  const wsRef = useRef(null);

  useEffect(() => () => wsRef.current?.close(), []);

  // On first load, try to resume a saved session (e.g. after a page
  // refresh) instead of dropping back to the Home screen.
  useEffect(() => {
    const saved = loadSession();
    if (!saved?.code || !saved?.playerId) return;
    setConnecting(true);
    const ws = new WebSocket(
      `${WS_BASE}/ws/reconnect/${saved.code}?player_id=${encodeURIComponent(saved.playerId)}`
    );
    attach(ws);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop any pending "tap again to play" selection whenever the hand
  // changes (a card was played, or we reconnected with a fresh hand) or
  // the turn moves on — a stale selection sitting around would be
  // confusing to come back to.
  useEffect(() => {
    setSelectedUid(null);
  }, [hand, currentPlayerId]);

  function resetRoomState() {
    setPlayerId(null);
    setCode("");
    setHostId(null);
    setNumDecks(1);
    setPlayers([]);
    setStarted(false);
    setFinished(false);
    setWinnerId(null);
    setHand([]);
    setTable(EMPTY_TABLE);
    setCurrentPlayerId(null);
    setLastAction(null);
  }

  function attach(ws) {
    wsRef.current = ws;
    ws.onopen = () => setConnecting(false);
    ws.onerror = () => setError("Connection error. Is the backend running?");
    ws.onclose = () => setConnecting(false);
    ws.onmessage = (evt) => handleMessage(JSON.parse(evt.data));
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case "joined":
        setPlayerId(msg.playerId);
        setCode(msg.code);
        setScreen("lobby");
        setError("");
        saveSession(msg.code, msg.playerId);
        break;
      case "room_state":
        setHostId(msg.hostId);
        setNumDecks(msg.numDecks);
        setPlayers(msg.players);
        setStarted(msg.started);
        setFinished(msg.finished);
        if (msg.started) setScreen("game");
        break;
      case "your_hand":
        setHand(msg.hand);
        break;
      case "game_state":
        setTable(msg.table);
        setCurrentPlayerId(msg.currentPlayerId);
        setPlayers(msg.players);
        setLastAction(msg.lastAction);
        setFinished(msg.finished);
        setWinnerId(msg.winnerId);
        break;
      case "error":
        setError(msg.message);
        if (msg.fatal) {
          clearSession();
          wsRef.current?.close();
          resetRoomState();
          setScreen("home");
        }
        break;
      default:
        break;
    }
  }

  function createRoom(name, decks) {
    setConnecting(true);
    setError("");
    const ws = new WebSocket(
      `${WS_BASE}/ws/create?name=${encodeURIComponent(name)}&decks=${decks}`
    );
    attach(ws);
  }

  function joinRoom(name, roomCode) {
    setConnecting(true);
    setError("");
    const ws = new WebSocket(
      `${WS_BASE}/ws/join/${roomCode}?name=${encodeURIComponent(name)}`
    );
    attach(ws);
  }

  function send(payload) {
    wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(payload));
  }

  const startGame = () => send({ type: "start_game" });
  const addBot = () => send({ type: "add_bot" });
  const removeBot = () => send({ type: "remove_bot" });
  const playCard = (card) => send({ type: "play_card", rank: card.rank, suit: card.suit });
  const passTurn = () => send({ type: "pass_turn" });

  // Tap once to select a card (so it's clear which one you're about to
  // play), tap the same card again to actually play it. Tapping a
  // different card just moves the selection instead of playing anything —
  // this is what avoids accidental plays from a stray tap.
  function handleCardTap(card) {
    if (selectedUid === card.uid) {
      playCard(card);
      setSelectedUid(null);
    } else {
      setSelectedUid(card.uid);
    }
  }

  function leaveRoom() {
    send({ type: "leave_room" });
    clearSession();
    wsRef.current?.close();
    resetRoomState();
    setError("");
    setScreen("home");
  }

  if (screen === "home") {
    return <Home onCreate={createRoom} onJoin={joinRoom} connecting={connecting} error={error} />;
  }

  if (screen === "lobby") {
    return (
      <Lobby
        code={code}
        players={players}
        isHost={playerId === hostId}
        numDecks={numDecks}
        onStart={startGame}
        onLeave={leaveRoom}
        onAddBot={addBot}
        onRemoveBot={removeBot}
        error={error}
      />
    );
  }

  const isMyTurn = currentPlayerId === playerId;
  const playableIds = new Set(
    (isMyTurn ? hand.filter((c) => isPlayable(c, table)) : []).map((c) => `${c.rank}-${c.suit}`)
  );
  const canPass = isMyTurn && playableIds.size === 0;
  const currentPlayer = players.find((p) => p.id === currentPlayerId);
  const winner = players.find((p) => p.id === winnerId);
  const selectedCard = hand.find((c) => c.uid === selectedUid);

  return (
    <div className="screen screen--game">
      <header className="gamebar">
        <div className="gamebar__room">Room {code}</div>
        <button type="button" className="btn btn--leave" onClick={leaveRoom}>
          Leave
        </button>
      </header>

      <ul className="players-row">
        {players.map((p) => (
          <li
            key={p.id}
            className={[
              "players-row__player",
              p.id === currentPlayerId ? "players-row__player--turn" : "",
              p.id === playerId ? "players-row__player--me" : "",
              p.left ? "players-row__player--left" : "",
            ].join(" ").trim()}
          >
            {p.isBot ? "🤖 " : ""}
            {p.name} {p.id === playerId ? "(you)" : ""}
            {p.left ? (
              <span className="gamebar__count-badge gamebar__count-badge--left">left</span>
            ) : (
              <span className="gamebar__count-badge" title="cards in hand">
                🂠 {p.handCount}
              </span>
            )}
          </li>
        ))}
      </ul>

      {finished ? (
        <div className="banner" />
      ) : (
        <div className="banner">
          {isMyTurn ? (
            <span className="banner__your-turn">🟢 Your turn</span>
          ) : currentPlayer ? (
            `Waiting on ${currentPlayer.name}…`
          ) : (
            ""
          )}
          {lastAction?.card && (
            <span className="banner__log">
              {lastAction.name} played {rankSuit(lastAction.card)}
            </span>
          )}
          {lastAction && !lastAction.card && (
            <span className="banner__log">{lastAction.name} passed</span>
          )}
        </div>
      )}

      {finished && (
        <div className="game-over">
          <div className="game-over__card">
            <div className="game-over__trophy">🎉</div>
            <div className="game-over__text">
              {winner ? (
                <>
                  <span className="game-over__name">{winner.name}</span> wins!
                </>
              ) : (
                "Game over"
              )}
            </div>
            <button type="button" className="btn btn--primary" onClick={leaveRoom}>
              Leave room
            </button>
          </div>
        </div>
      )}

      <GameTable table={table} lastPlayed={lastAction?.card} />

      {error && <p className="home__error home__error--floating">{error}</p>}

      {selectedCard && (
        <div className="handbar__hint">Tap {rankSuit(selectedCard)} again to play it</div>
      )}

      <footer className="handbar">
        <div className="handbar__cards">
          {HAND_SUIT_ORDER.map((suit) => {
            const cards = hand.filter((c) => c.suit === suit);
            if (cards.length === 0) return null;
            return (
              <div key={suit} className={`handbar__suit-row handbar__suit-row--${suit}`}>
                <span className="handbar__suit-label">{SUIT_SYMBOL[suit]}</span>
                <div className="handbar__suit-cards">
                  {cards.map((c) => {
                    // Playability is looked up by rank+suit (either copy of
                    // a duplicate card is equally playable), but the React
                    // key must be the card's own unique id — two copies of
                    // the same card share a rank+suit, and keying on that
                    // breaks rendering once a hand legitimately holds both
                    // (2-deck games).
                    const playable = playableIds.has(`${c.rank}-${c.suit}`);
                    return (
                      <PlayingCard
                        key={c.uid}
                        rank={c.rank}
                        suit={c.suit}
                        playable={playable}
                        faded={!playable}
                        selected={c.uid === selectedUid}
                        onClick={isMyTurn && playable ? () => handleCardTap(c) : undefined}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className={`btn btn--pass${canPass ? " btn--pass-urgent" : ""}`}
          disabled={!canPass}
          onClick={passTurn}
        >
          {canPass ? "No moves — Pass" : "Pass"}
        </button>
      </footer>
    </div>
  );
}

function isPlayable(card, table) {
  const heartsLaid = table.H || []; // [{rank, count}, ...]
  const heartsOpened = heartsLaid.some((entry) => entry.rank === 7 && entry.count > 0);

  if (!heartsOpened) {
    return card.rank === 7 && card.suit === "H";
  }
  if (card.rank === 7) return true;

  const laid = table[card.suit] || [];
  const counts = new Map(laid.map((entry) => [entry.rank, entry.count]));
  const neighbor = card.rank > 7 ? card.rank - 1 : card.rank + 1;
  return (counts.get(neighbor) || 0) > (counts.get(card.rank) || 0);
}

const RANK_LABEL = { 1: "A", 11: "J", 12: "Q", 13: "K" };
const SUIT_SYMBOL = { H: "♥", D: "♦", C: "♣", S: "♠" };
const HAND_SUIT_ORDER = ["H", "D", "C", "S"];
function rankSuit(card) {
  return `${RANK_LABEL[card.rank] || card.rank}${SUIT_SYMBOL[card.suit]}`;
}
