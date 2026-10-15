import PlayingCard from "./PlayingCard.jsx";

const SUIT_ORDER = ["H", "D", "C", "S"];
const SUIT_SYMBOL = { H: "♥", D: "♦", C: "♣", S: "♠" };
const SUIT_NAME = { H: "Hearts", D: "Diamonds", C: "Clubs", S: "Spades" };
const ALL_RANKS = Array.from({ length: 13 }, (_, i) => i + 1);

export default function GameTable({ table, lastPlayed }) {
  return (
    <div className="table">
      {SUIT_ORDER.map((suit) => {
        const laid = new Map((table[suit] || []).map((entry) => [entry.rank, entry.count]));
        return (
          <div key={suit} className={`table__row table__row--${suit}`}>
            <div className="table__label">
              <span className="table__suit-symbol">{SUIT_SYMBOL[suit]}</span>
              <span className="table__suit-name">{SUIT_NAME[suit]}</span>
            </div>
            <div className="table__slots">
              {ALL_RANKS.map((rank) => {
                const count = laid.get(rank);
                if (!count) {
                  return (
                    <div key={rank} className="table__slot-empty">
                      {rank === 7 ? "7" : ""}
                    </div>
                  );
                }
                const isLast = lastPlayed && lastPlayed.rank === rank && lastPlayed.suit === suit;
                return (
                  <div key={rank} className="table__stack">
                    {count > 1 && <div className="table__stack-shadow" />}
                    <PlayingCard rank={rank} suit={suit} size="sm" highlight={isLast} />
                    {count > 1 && <span className="table__stack-badge">×{count}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
