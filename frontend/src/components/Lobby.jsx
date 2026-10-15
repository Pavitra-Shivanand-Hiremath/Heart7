export default function Lobby({
  code,
  players,
  isHost,
  numDecks,
  onStart,
  onLeave,
  onAddBot,
  onRemoveBot,
  error,
}) {
  const botCount = players.filter((p) => p.isBot).length;
  const atCapacity = players.length >= 10;

  return (
    <div className="screen screen--center">
      <div className="lobby">
        <p className="lobby__eyebrow">Room code</p>
        <div className="lobby__code">{code}</div>
        <p className="lobby__hint">Share this code with the other players.</p>

        <div className="lobby__meta">
          {numDecks} {numDecks === 1 ? "deck" : "decks"} · {players.length} joined
        </div>

        <ul className="lobby__players">
          {players.map((p) => (
            <li key={p.id} className="lobby__player">
              {p.isBot && <span className="lobby__bot-icon">🤖</span>}
              {p.name}
            </li>
          ))}
        </ul>

        {isHost && (
          <div className="lobby__bot-controls">
            <span className="lobby__bot-label">Play against bots?</span>
            <div className="lobby__bot-buttons">
              <button
                type="button"
                className="btn btn--bot"
                onClick={onAddBot}
                disabled={atCapacity}
              >
                + Add bot
              </button>
              <button
                type="button"
                className="btn btn--bot btn--bot-remove"
                onClick={onRemoveBot}
                disabled={botCount === 0}
              >
                − Remove bot
              </button>
            </div>
          </div>
        )}

        {error && <p className="home__error">{error}</p>}

        {isHost ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={players.length < 2}
            onClick={onStart}
          >
            {players.length < 2 ? "Waiting for more players…" : "Start game"}
          </button>
        ) : (
          <p className="lobby__waiting">Waiting for the host to start the game…</p>
        )}

        <button type="button" className="btn btn--leave btn--leave-lobby" onClick={onLeave}>
          Leave room
        </button>
      </div>
    </div>
  );
}
