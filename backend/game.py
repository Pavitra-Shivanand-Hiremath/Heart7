"""
Core Heart7 (Sevens) game engine — no I/O, no networking, just rules.
Rank encoding: Ace=1, 2-10 as-is, Jack=11, Queen=12, King=13.
Suits: "H" (Hearts), "D" (Diamonds), "C" (Clubs), "S" (Spades).
"""
import itertools
import random
from dataclasses import dataclass, field

SUITS = ["H", "D", "C", "S"]
RANKS = list(range(1, 14))  # 1..13
RANK_LABELS = {1: "A", 11: "J", 12: "Q", 13: "K"}
SUIT_SYMBOLS = {"H": "♥", "D": "♦", "C": "♣", "S": "♠"}


def rank_label(rank: int) -> str:
    return RANK_LABELS.get(rank, str(rank))


def card_id(card: dict) -> str:
    return f"{card['rank']}-{card['suit']}"


def build_shuffled_deck(num_decks: int) -> list[dict]:
    num_decks = max(1, min(2, num_decks))  # defensive clamp — 2 decks max, always
    deck = []
    # Every physical card gets its own uid, even when another card shares
    # the same rank+suit (legitimate with 2 decks). Without this, two
    # identical-looking cards are indistinguishable to the frontend, which
    # breaks React's rendering when both end up in the same hand.
    uid_counter = itertools.count(1)
    for _ in range(num_decks):
        for s in SUITS:
            for r in RANKS:
                deck.append({"uid": next(uid_counter), "rank": r, "suit": s})
    random.shuffle(deck)
    assert len(deck) == len(SUITS) * len(RANKS) * num_decks, "deck size mismatch"
    return deck


def deal(deck: list[dict], player_ids: list[str]) -> dict[str, list[dict]]:
    """Deal every card out as evenly as possible, in round-robin order."""
    hands = {pid: [] for pid in player_ids}
    for i, card in enumerate(deck):
        pid = player_ids[i % len(player_ids)]
        hands[pid].append(card)
    return hands


@dataclass
class Table:
    # per suit: {rank: count} — count > 1 means duplicate copies (multiple decks)
    # have been played at that rank, which we still want to show on the table.
    counts: dict = field(default_factory=lambda: {s: {} for s in SUITS})

    def is_playable(self, card: dict) -> bool:
        """A card is playable if:
        - 7♥ hasn't been played yet: only 7♥ itself is playable — it must be
          the very first card down in the whole game, before any other suit
          can open.
        - Otherwise: a 7 of any suit is always playable (opening/extending a
          parallel build for that suit), or the card's immediate neighbor
          toward 7 has been played more times than it has. This makes each
          deck's copy of a suit behave like its own independent sequence:
          with 2 decks you can't drop the second 10 until the second 9 (and,
          transitively, the second 8 and second 7) are down.
        """
        r, s = card["rank"], card["suit"]
        hearts_opened = self.counts["H"].get(7, 0) > 0
        if not hearts_opened:
            return r == 7 and s == "H"
        if r == 7:
            return True
        counts = self.counts[s]
        neighbor = r - 1 if r > 7 else r + 1
        return counts.get(neighbor, 0) > counts.get(r, 0)

    def apply(self, card: dict) -> None:
        r, s = card["rank"], card["suit"]
        self.counts[s][r] = self.counts[s].get(r, 0) + 1

    def playable_cards(self, hand: list[dict]) -> list[dict]:
        return [c for c in hand if self.is_playable(c)]

    def to_public(self) -> dict:
        """suit -> sorted list of {rank, count} currently laid down (for rendering).
        count lets the client show duplicate cards (from multiple decks) stacked
        on the same slot instead of hiding the second copy."""
        out = {}
        for s in SUITS:
            out[s] = [
                {"rank": r, "count": c}
                for r, c in sorted(self.counts[s].items())
                if c > 0
            ]
        return out


def find_starting_player(hands: dict[str, list[dict]], player_order: list[str]) -> str:
    """Whoever holds a 7 of Hearts goes first (first such player in join order)."""
    for pid in player_order:
        if any(c["rank"] == 7 and c["suit"] == "H" for c in hands[pid]):
            return pid
    # Should never happen with a real deck, but fall back to first player.
    return player_order[0]
