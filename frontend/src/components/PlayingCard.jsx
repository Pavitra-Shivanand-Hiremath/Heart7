const SUIT_SYMBOL = { H: "♥", D: "♦", C: "♣", S: "♠" };
const RANK_LABEL = { 1: "A", 11: "J", 12: "Q", 13: "K" };
const RED_SUITS = new Set(["H", "D"]);

export function rankLabel(rank) {
  return RANK_LABEL[rank] || String(rank);
}

export default function PlayingCard({
  rank,
  suit,
  playable,
  selected,
  faded,
  highlight,
  onClick,
  size = "md",
}) {
  const red = RED_SUITS.has(suit);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={[
        "pcard",
        `pcard--${size}`,
        red ? "pcard--red" : "pcard--black",
        playable ? "pcard--playable" : "",
        selected ? "pcard--selected" : "",
        faded ? "pcard--faded" : "",
        highlight ? "pcard--highlight" : "",
      ].join(" ").trim()}
    >
      {size === "sm" ? (
        <span className="pcard__mini">
          <span className="pcard__mini-rank">{rankLabel(rank)}</span>
          <span className="pcard__mini-suit">{SUIT_SYMBOL[suit]}</span>
        </span>
      ) : (
        <>
          <span className="pcard__corner pcard__corner--tl">
            {rankLabel(rank)}
            <br />
            {SUIT_SYMBOL[suit]}
          </span>
          <span className="pcard__pip">{SUIT_SYMBOL[suit]}</span>
          <span className="pcard__corner pcard__corner--br">
            {rankLabel(rank)}
            <br />
            {SUIT_SYMBOL[suit]}
          </span>
        </>
      )}
    </button>
  );
}
