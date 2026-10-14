import { useState } from "react";

export default function Home({ onCreate, onJoin, connecting, error }) {
  const [mode, setMode] = useState("create");
  const [name, setName] = useState("");
  const [decks, setDecks] = useState(1);
  const [code, setCode] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    if (mode === "create") {
      onCreate(name.trim(), Number(decks));
    } else {
      if (!code.trim()) return;
      onJoin(name.trim(), code.trim().toUpperCase());
    }
  }

  return (
    <div className="screen screen--center">
      <div className="home">
        <h1 className="home__title">
          Heart<span className="home__title-accent">7</span>
        </h1>
        <p className="home__tagline">First to empty your hand wins. Every suit starts from its 7.</p>

        <div className="home__tabs">
          <button
            type="button"
            className={mode === "create" ? "tab tab--active" : "tab"}
            onClick={() => setMode("create")}
          >
            New room
          </button>
          <button
            type="button"
            className={mode === "join" ? "tab tab--active" : "tab"}
            onClick={() => setMode("join")}
          >
            Join room
          </button>
        </div>

        <form className="home__form" onSubmit={submit}>
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} required />
          </label>

          {mode === "create" ? (
            <label className="field">
              <span>Number of decks</span>
              <input
                type="number"
                min={1}
                max={2}
                value={decks}
                onChange={(e) => {
                  const raw = Number(e.target.value);
                  const clamped = Number.isFinite(raw) ? Math.min(2, Math.max(1, raw)) : 1;
                  setDecks(clamped);
                }}
              />
              <small>1 deck suits up to ~7 players; use 2 decks for bigger groups.</small>
            </label>
          ) : (
            <label className="field">
              <span>Room code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={5}
                placeholder="ABCDE"
                required
              />
            </label>
          )}

          {error && <p className="home__error">{error}</p>}

          <button type="submit" className="btn btn--primary" disabled={connecting}>
            {connecting ? "Connecting…" : mode === "create" ? "Create room" : "Join room"}
          </button>
        </form>
      </div>
    </div>
  );
}
