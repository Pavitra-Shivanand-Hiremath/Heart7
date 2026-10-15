import asyncio
import random
import string
import uuid
from dataclasses import dataclass, field

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

from game import build_shuffled_deck, deal, Table, find_starting_player, card_id

app = FastAPI(title="Heart7")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


MAX_PLAYERS = 10
BOT_MOVE_DELAY_SECONDS = 0.7  # small pause so bot turns feel natural rather than instant


@dataclass
class Player:
    id: str
    name: str
    ws: WebSocket | None = None
    hand: list = field(default_factory=list)
    connected: bool = True
    left: bool = False  # explicitly left (permanent) — distinct from a dropped connection
    is_bot: bool = False


@dataclass
class Room:
    code: str
    num_decks: int
    host_id: str
    players: dict[str, Player] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)
    started: bool = False
    finished: bool = False
    table: Table = field(default_factory=Table)
    current_turn: str | None = None
    winner_id: str | None = None


ROOMS: dict[str, Room] = {}


def generate_room_code() -> str:
    while True:
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
        if code not in ROOMS:
            return code


def public_players(room: Room) -> list[dict]:
    return [
        {
            "id": p.id,
            "name": p.name,
            "handCount": len(p.hand),
            "connected": p.connected,
            "left": p.left,
            "isBot": p.is_bot,
        }
        for p in (room.players[pid] for pid in room.order)
    ]


async def broadcast(room: Room, message: dict, exclude_id: str | None = None):
    for pid in room.order:
        player = room.players[pid]
        if pid == exclude_id or player.ws is None:
            continue
        try:
            await player.ws.send_json(message)
        except Exception:
            pass


async def send_room_state(room: Room):
    await broadcast(
        room,
        {
            "type": "room_state",
            "code": room.code,
            "hostId": room.host_id,
            "numDecks": room.num_decks,
            "started": room.started,
            "finished": room.finished,
            "players": public_players(room),
        },
    )


async def send_game_state(room: Room, last_action: dict | None = None):
    payload = {
        "type": "game_state",
        "table": room.table.to_public(),
        "currentPlayerId": room.current_turn,
        "players": public_players(room),
        "lastAction": last_action,
        "finished": room.finished,
        "winnerId": room.winner_id,
    }
    await broadcast(room, payload)


async def send_private_hand(room: Room, pid: str):
    player = room.players[pid]
    if player.ws is None:
        return
    hand_sorted = sorted(player.hand, key=lambda c: (c["suit"], c["rank"]))
    try:
        await player.ws.send_json({"type": "your_hand", "hand": hand_sorted})
    except Exception:
        pass


def advance_turn(room: Room):
    """Move to the next player, skipping anyone who has explicitly left
    (but NOT skipping merely-disconnected players — they can reconnect and
    resume on their own turn)."""
    n = len(room.order)
    idx = room.order.index(room.current_turn)
    for _ in range(n):
        idx = (idx + 1) % n
        candidate = room.order[idx]
        if not room.players[candidate].left:
            room.current_turn = candidate
            return


def choose_bot_card(room: Room, bot: Player) -> dict | None:
    """Simple, non-cheating strategy: play the first legal card found (hand
    is unsorted so this isn't biased toward any suit/rank), or None to pass.
    Good enough to be a real opponent without needing to be clever."""
    options = room.table.playable_cards(bot.hand)
    return options[0] if options else None


async def run_bot_turns(room: Room):
    """While it's a bot's turn, play for it automatically, pausing briefly
    between moves so it reads as a turn rather than an instant jump. Stops
    as soon as it's a human's turn, the game ends, or no bot is seated."""
    while room.started and not room.finished:
        current = room.players.get(room.current_turn)
        if current is None or not current.is_bot or current.left:
            return

        await asyncio.sleep(BOT_MOVE_DELAY_SECONDS)

        card = choose_bot_card(room, current)
        if card is not None:
            current.hand.remove(card)
            room.table.apply(card)
            last_action = {"playerId": current.id, "name": current.name, "action": "play", "card": card}
            if not current.hand:
                room.finished = True
                room.winner_id = current.id
                await send_game_state(room, last_action)
                return
            advance_turn(room)
        else:
            last_action = {"playerId": current.id, "name": current.name, "action": "pass", "card": None}
            advance_turn(room)

        await send_game_state(room, last_action)


@app.websocket("/ws/create")
async def ws_create(websocket: WebSocket, name: str = Query(...), decks: int = Query(1, ge=1, le=2)):
    await websocket.accept()
    room = Room(code=generate_room_code(), num_decks=max(1, min(2, decks)), host_id="")
    player = Player(id=str(uuid.uuid4()), name=name.strip()[:24] or "Player", ws=websocket)
    room.host_id = player.id
    room.players[player.id] = player
    room.order.append(player.id)
    ROOMS[room.code] = room

    await websocket.send_json({"type": "joined", "playerId": player.id, "code": room.code})
    await send_room_state(room)
    await run_player_loop(room, player)


@app.websocket("/ws/join/{code}")
async def ws_join(websocket: WebSocket, code: str, name: str = Query(...)):
    code = code.upper()
    await websocket.accept()
    room = ROOMS.get(code)
    if room is None:
        await websocket.send_json({"type": "error", "message": "Room not found."})
        await websocket.close()
        return
    if room.started:
        await websocket.send_json({"type": "error", "message": "Game already started."})
        await websocket.close()
        return

    player = Player(id=str(uuid.uuid4()), name=name.strip()[:24] or "Player", ws=websocket)
    room.players[player.id] = player
    room.order.append(player.id)

    await websocket.send_json({"type": "joined", "playerId": player.id, "code": room.code})
    await send_room_state(room)
    await run_player_loop(room, player)


@app.websocket("/ws/reconnect/{code}")
async def ws_reconnect(websocket: WebSocket, code: str, player_id: str = Query(...)):
    """Resume an existing seat after a page refresh or dropped connection.
    The client stores {code, playerId} locally and calls this instead of
    /ws/join whenever it has a saved session for this room."""
    code = code.upper()
    await websocket.accept()
    room = ROOMS.get(code)
    if room is None:
        await websocket.send_json({"type": "error", "message": "That room no longer exists.", "fatal": True})
        await websocket.close()
        return

    player = room.players.get(player_id)
    if player is None or player.left:
        await websocket.send_json(
            {"type": "error", "message": "Couldn't rejoin that room — your seat is no longer available.", "fatal": True}
        )
        await websocket.close()
        return

    player.ws = websocket
    player.connected = True

    await websocket.send_json({"type": "joined", "playerId": player.id, "code": room.code})
    await send_room_state(room)
    if room.started:
        await send_private_hand(room, player.id)
        await send_game_state(room)

    await run_player_loop(room, player)


def remove_from_lobby(room: Room, player: Player):
    if player.id in room.order:
        room.order.remove(player.id)
    room.players.pop(player.id, None)
    if room.order and room.host_id == player.id:
        room.host_id = room.order[0]


async def run_player_loop(room: Room, player: Player):
    try:
        while True:
            msg = await player.ws.receive_json()
            await handle_message(room, player, msg)
    except WebSocketDisconnect:
        if player.id not in room.players:
            return  # already fully removed via an explicit leave
        player.connected = False
        player.ws = None
        if not room.started:
            remove_from_lobby(room, player)
            if room.order:
                await send_room_state(room)
            else:
                ROOMS.pop(room.code, None)
        else:
            # Left intact so they can reconnect and resume — including on
            # their own turn, which nobody else can play for them anyway.
            await send_room_state(room)
            await send_game_state(room)


async def handle_message(room: Room, player: Player, msg: dict):
    mtype = msg.get("type")

    if mtype == "start_game":
        if player.id != room.host_id:
            await player.ws.send_json({"type": "error", "message": "Only the host can start the game."})
            return
        if room.started:
            return
        if len(room.order) < 2:
            await player.ws.send_json({"type": "error", "message": "Need at least 2 players."})
            return
        start_game(room)
        await send_room_state(room)
        for pid in room.order:
            await send_private_hand(room, pid)
        await send_game_state(room)
        await run_bot_turns(room)
        return

    if mtype == "play_card":
        await handle_play(room, player, msg)
        return

    if mtype == "pass_turn":
        await handle_pass(room, player)
        return

    if mtype == "leave_room":
        await handle_leave(room, player)
        return

    if mtype == "add_bot":
        await handle_add_bot(room, player)
        return

    if mtype == "remove_bot":
        await handle_remove_bot(room, player)
        return


async def handle_add_bot(room: Room, player: Player):
    if player.id != room.host_id:
        await player.ws.send_json({"type": "error", "message": "Only the host can add bots."})
        return
    if room.started:
        return
    if len(room.order) >= MAX_PLAYERS:
        await player.ws.send_json({"type": "error", "message": "Room is full."})
        return

    bot_number = sum(1 for pid in room.order if room.players[pid].is_bot) + 1
    bot = Player(id=str(uuid.uuid4()), name=f"Bot {bot_number}", is_bot=True, connected=True)
    room.players[bot.id] = bot
    room.order.append(bot.id)
    await send_room_state(room)


async def handle_remove_bot(room: Room, player: Player):
    if player.id != room.host_id:
        await player.ws.send_json({"type": "error", "message": "Only the host can remove bots."})
        return
    if room.started:
        return

    bot_ids = [pid for pid in room.order if room.players[pid].is_bot]
    if not bot_ids:
        return
    remove_id = bot_ids[-1]  # most recently added
    room.order.remove(remove_id)
    room.players.pop(remove_id, None)
    await send_room_state(room)


async def handle_leave(room: Room, player: Player):
    if not room.started:
        remove_from_lobby(room, player)
        if room.order:
            await send_room_state(room)
        else:
            ROOMS.pop(room.code, None)
        return

    if room.finished or player.left:
        return

    player.left = True
    player.connected = False

    remaining = [pid for pid in room.order if not room.players[pid].left]
    if len(remaining) <= 1:
        room.finished = True
        room.winner_id = remaining[0] if remaining else None
    elif room.current_turn == player.id:
        advance_turn(room)

    await send_room_state(room)
    await send_game_state(room)
    await run_bot_turns(room)


def start_game(room: Room):
    deck = build_shuffled_deck(room.num_decks)
    hands = deal(deck, room.order)
    for pid, hand in hands.items():
        room.players[pid].hand = hand
    room.table = Table()
    room.current_turn = find_starting_player(hands, room.order)
    room.started = True


async def handle_play(room: Room, player: Player, msg: dict):
    if not room.started or room.finished:
        return
    if room.current_turn != player.id:
        await player.ws.send_json({"type": "error", "message": "It's not your turn."})
        return

    rank, suit = msg.get("rank"), msg.get("suit")
    hand = player.hand
    match = next((c for c in hand if c["rank"] == rank and c["suit"] == suit), None)
    if match is None:
        await player.ws.send_json({"type": "error", "message": "You don't have that card."})
        return
    if not room.table.is_playable(match):
        await player.ws.send_json({"type": "error", "message": "That card can't be played right now."})
        return

    hand.remove(match)
    room.table.apply(match)
    await send_private_hand(room, player.id)

    last_action = {"playerId": player.id, "name": player.name, "action": "play", "card": match}

    if not hand:
        room.finished = True
        room.winner_id = player.id
        await send_game_state(room, last_action)
        return

    advance_turn(room)
    await send_game_state(room, last_action)
    await run_bot_turns(room)


async def handle_pass(room: Room, player: Player):
    if not room.started or room.finished:
        return
    if room.current_turn != player.id:
        await player.ws.send_json({"type": "error", "message": "It's not your turn."})
        return

    if room.table.playable_cards(player.hand):
        await player.ws.send_json(
            {"type": "error", "message": "You have a legal move, so you can't pass."}
        )
        return

    last_action = {"playerId": player.id, "name": player.name, "action": "pass", "card": None}
    advance_turn(room)
    await send_game_state(room, last_action)
    await run_bot_turns(room)


@app.get("/")
def health():
    return {"status": "ok", "rooms": len(ROOMS)}
