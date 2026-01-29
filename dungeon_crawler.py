#!/usr/bin/env python3
"""
Procedural Roll-and-Write Dungeon Crawler
A deterministic, procedurally-generated dungeon crawler with 100 floors.
"""

from enum import Enum, auto
from dataclasses import dataclass, field
from typing import List, Tuple, Optional, Dict, Set, Callable
import hashlib
import struct
import json
import os


# =============================================================================
# 1) ENUMS AND CONSTANTS
# =============================================================================

class Tile(Enum):
    """All possible tile types in the dungeon."""
    EMPTY = auto()
    WALL = auto()
    START = auto()
    STAIRS = auto()
    COIN = auto()
    CHEST = auto()
    HEART_UNKNOWN = auto()
    ENEMY = auto()
    WEB = auto()
    KEY = auto()
    LOCKED_DOOR = auto()
    PORTAL = auto()  # Portal tiles also have a group_id attribute


class Direction(Enum):
    """Movement directions."""
    # Orthogonal (for even rolls)
    N = (0, -1)
    S = (0, 1)
    E = (1, 0)
    W = (-1, 0)
    # Diagonal (for odd rolls)
    NE = (1, -1)
    NW = (-1, -1)
    SE = (1, 1)
    SW = (-1, 1)

    @property
    def is_orthogonal(self) -> bool:
        return self in (Direction.N, Direction.S, Direction.E, Direction.W)

    @property
    def is_diagonal(self) -> bool:
        return self in (Direction.NE, Direction.NW, Direction.SE, Direction.SW)

    @staticmethod
    def orthogonal_directions() -> List['Direction']:
        return [Direction.N, Direction.S, Direction.E, Direction.W]

    @staticmethod
    def diagonal_directions() -> List['Direction']:
        return [Direction.NE, Direction.NW, Direction.SE, Direction.SW]

    def reverse(self) -> 'Direction':
        """Get the opposite direction."""
        dx, dy = self.value
        for d in Direction:
            if d.value == (-dx, -dy):
                return d
        raise ValueError("No reverse found")


class Difficulty(Enum):
    """Game difficulty levels affecting enemy damage."""
    EASY = 2
    NORMAL = 4
    HARD = 8
    DEMONIC = 10


class ItemType(Enum):
    """Shop item types."""
    COMPASS_OF_TRUE_NORTH = auto()
    ANCHOR_STONE = auto()
    SMOKE_BOMB = auto()
    LOADED_DICE = auto()
    LUCKY_CHARM = auto()
    LOCKPICK = auto()
    PARITY_FLIP = auto()


# Item costs
ITEM_COSTS = {
    ItemType.COMPASS_OF_TRUE_NORTH: 8,
    ItemType.ANCHOR_STONE: 5,
    ItemType.SMOKE_BOMB: 10,
    ItemType.LOADED_DICE: 15,
    ItemType.LUCKY_CHARM: 6,
    ItemType.LOCKPICK: 7,
    ItemType.PARITY_FLIP: 6,
}

ITEM_NAMES = {
    ItemType.COMPASS_OF_TRUE_NORTH: "Compass of True North",
    ItemType.ANCHOR_STONE: "Anchor Stone",
    ItemType.SMOKE_BOMB: "Smoke Bomb",
    ItemType.LOADED_DICE: "Loaded Dice",
    ItemType.LUCKY_CHARM: "Lucky Charm",
    ItemType.LOCKPICK: "Lockpick",
    ItemType.PARITY_FLIP: "Parity Flip",
}


# =============================================================================
# 2) DETERMINISTIC RNG
# =============================================================================

class DeterministicRNG:
    """
    A deterministic PRNG using a simple xorshift algorithm.
    Ensures identical results given the same seed.
    """

    def __init__(self, seed: int):
        # Ensure seed is non-zero for xorshift
        self.state = seed if seed != 0 else 1
        # Mask to 64-bit
        self.state &= 0xFFFFFFFFFFFFFFFF

    def _next(self) -> int:
        """Generate next random 64-bit number using xorshift64."""
        x = self.state
        x ^= (x << 13) & 0xFFFFFFFFFFFFFFFF
        x ^= (x >> 7) & 0xFFFFFFFFFFFFFFFF
        x ^= (x << 17) & 0xFFFFFFFFFFFFFFFF
        self.state = x & 0xFFFFFFFFFFFFFFFF
        return self.state

    def randint(self, a: int, b: int) -> int:
        """Return random integer N such that a <= N <= b."""
        if a > b:
            a, b = b, a
        range_size = b - a + 1
        return a + (self._next() % range_size)

    def d6(self) -> int:
        """Roll a d6 (1-6)."""
        return self.randint(1, 6)

    def shuffle(self, lst: List) -> None:
        """Fisher-Yates shuffle in place."""
        for i in range(len(lst) - 1, 0, -1):
            j = self.randint(0, i)
            lst[i], lst[j] = lst[j], lst[i]

    def choice(self, lst: List):
        """Choose a random element from a list."""
        return lst[self.randint(0, len(lst) - 1)]

    def sample(self, lst: List, k: int) -> List:
        """Return k unique elements from lst."""
        if k > len(lst):
            raise ValueError("Sample larger than population")
        pool = list(lst)
        self.shuffle(pool)
        return pool[:k]


def hash_seed(*args) -> int:
    """
    Create a deterministic hash from multiple arguments.
    Returns a 64-bit integer suitable for seeding RNG.
    """
    data = "|".join(str(a) for a in args).encode('utf-8')
    digest = hashlib.sha256(data).digest()
    return struct.unpack('<Q', digest[:8])[0]


def event_d6(*args) -> int:
    """
    Roll a d6 keyed to specific event parameters.
    Ensures deterministic outcomes independent of other events.
    """
    seed = hash_seed(*args)
    rng = DeterministicRNG(seed)
    return rng.d6()


# =============================================================================
# 3) GRID CELL AND LEVEL DATA STRUCTURES
# =============================================================================

@dataclass
class GridCell:
    """Represents a single cell in the dungeon grid."""
    tile: Tile
    portal_group_id: Optional[int] = None  # Only for PORTAL tiles

    def is_blocking(self, player_keys: int) -> bool:
        """Check if this cell blocks movement."""
        if self.tile == Tile.WALL:
            return True
        if self.tile == Tile.LOCKED_DOOR and player_keys == 0:
            return True
        return False

    def is_passable(self) -> bool:
        """Check if this tile can ever be walked on."""
        return self.tile != Tile.WALL


@dataclass
class Room:
    """Represents a detected room in the dungeon."""
    x: int  # Top-left interior x
    y: int  # Top-left interior y
    width: int  # Interior width
    height: int  # Interior height
    openings: List[Tuple[int, int]] = field(default_factory=list)

    @property
    def area(self) -> int:
        return self.width * self.height

    def interior_tiles(self) -> Set[Tuple[int, int]]:
        """Return set of all interior tile coordinates."""
        return {(self.x + dx, self.y + dy)
                for dx in range(self.width)
                for dy in range(self.height)}


@dataclass
class Level:
    """Represents a single dungeon floor."""
    floor_number: int
    width: int
    height: int
    grid: List[List[GridCell]]
    start_pos: Tuple[int, int]
    stairs_pos: Tuple[int, int]
    rooms: List[Room]
    portal_groups: Dict[int, List[Tuple[int, int]]]  # group_id -> list of positions
    level_seed: int

    def get_cell(self, x: int, y: int) -> Optional[GridCell]:
        """Get cell at position, or None if out of bounds."""
        if 0 <= x < self.width and 0 <= y < self.height:
            return self.grid[y][x]
        return None

    def set_tile(self, x: int, y: int, tile: Tile):
        """Set tile at position."""
        if 0 <= x < self.width and 0 <= y < self.height:
            self.grid[y][x].tile = tile

    def in_bounds(self, x: int, y: int) -> bool:
        """Check if coordinates are within grid bounds."""
        return 0 <= x < self.width and 0 <= y < self.height

    def render(self, player_pos: Optional[Tuple[int, int]] = None) -> str:
        """Render the level as ASCII art."""
        symbols = {
            Tile.EMPTY: '.',
            Tile.WALL: '#',
            Tile.START: 'S',
            Tile.STAIRS: '>',
            Tile.COIN: '$',
            Tile.CHEST: 'C',
            Tile.HEART_UNKNOWN: 'H',
            Tile.ENEMY: 'E',
            Tile.WEB: 'W',
            Tile.KEY: 'K',
            Tile.LOCKED_DOOR: 'D',
            Tile.PORTAL: 'P',
        }
        lines = []
        for y in range(self.height):
            row = ""
            for x in range(self.width):
                if player_pos and (x, y) == player_pos:
                    row += '@'
                else:
                    cell = self.grid[y][x]
                    row += symbols.get(cell.tile, '?')
            lines.append(row)
        return '\n'.join(lines)


# =============================================================================
# 4) PLAYER STATE
# =============================================================================

@dataclass
class Player:
    """Player state including HP, coins, inventory, and status flags."""
    hp: int = 10
    max_hp: int = 10  # Optional cap
    coins: int = 0
    keys: int = 0
    inventory: List[ItemType] = field(default_factory=list)
    x: int = 0
    y: int = 0

    # Status flags
    half_next_roll: bool = False
    portal_used_this_turn: bool = False

    # Item usage flags for current turn
    compass_active: bool = False  # Ignore parity this turn
    anchor_available: bool = False  # Can stop early
    smoke_bomb_available: bool = False  # Can negate enemy damage
    loaded_dice_value: Optional[int] = None  # Predetermined roll
    lucky_charm_available: bool = False  # Can adjust roll
    parity_flipped: bool = False  # Parity is flipped

    # Movement tracking
    path_this_turn: List[Tuple[int, int]] = field(default_factory=list)

    def reset_turn_flags(self):
        """Reset per-turn status flags."""
        self.portal_used_this_turn = False
        self.compass_active = False
        self.anchor_available = False
        self.smoke_bomb_available = False
        self.loaded_dice_value = None
        self.lucky_charm_available = False
        self.parity_flipped = False
        self.path_this_turn = []

    def heal(self, amount: int):
        """Heal the player."""
        self.hp = min(self.hp + amount, self.max_hp) if self.max_hp else self.hp + amount

    def take_damage(self, amount: int) -> bool:
        """Take damage. Returns True if player is still alive."""
        self.hp -= amount
        return self.hp > 0

    @property
    def pos(self) -> Tuple[int, int]:
        return (self.x, self.y)

    @pos.setter
    def pos(self, value: Tuple[int, int]):
        self.x, self.y = value

    def has_item(self, item_type: ItemType) -> bool:
        """Check if player has an item."""
        return item_type in self.inventory

    def use_item(self, item_type: ItemType) -> bool:
        """Use and remove an item from inventory. Returns True if successful."""
        if item_type in self.inventory:
            self.inventory.remove(item_type)
            return True
        return False


# =============================================================================
# 5) LEVEL GENERATION
# =============================================================================

class LevelGenerator:
    """Generates dungeon levels procedurally."""

    def __init__(self, master_seed: int, width: int = 15, height: int = 15):
        self.master_seed = master_seed
        self.width = width
        self.height = height

    def generate_level(self, floor_number: int) -> Level:
        """Generate a single dungeon level."""
        level_seed = hash_seed(self.master_seed, "level", floor_number)
        layout_seed = hash_seed(level_seed, "layout")
        content_seed = hash_seed(level_seed, "content")
        portal_seed = hash_seed(level_seed, "portals")

        layout_rng = DeterministicRNG(layout_seed)
        content_rng = DeterministicRNG(content_seed)
        portal_rng = DeterministicRNG(portal_seed)

        # Initialize grid with walls
        grid = [[GridCell(Tile.WALL) for _ in range(self.width)]
                for _ in range(self.height)]

        # Generate layout using BSP-like room placement
        rooms = self._generate_rooms(grid, layout_rng)

        # Connect rooms with corridors
        self._connect_rooms(grid, rooms, layout_rng)

        # Place start and stairs
        start_pos, stairs_pos = self._place_start_and_stairs(grid, rooms, layout_rng)

        # Place locked doors on room entries FIRST (before keys)
        num_doors = self._place_locked_doors(grid, rooms, layout_rng)

        # Place portals
        portal_groups = self._place_portals(grid, rooms, portal_rng)

        # Place content (coins, chests, enemies, keys based on doors, etc.)
        self._place_content(grid, rooms, content_rng, start_pos, stairs_pos, num_doors)

        return Level(
            floor_number=floor_number,
            width=self.width,
            height=self.height,
            grid=grid,
            start_pos=start_pos,
            stairs_pos=stairs_pos,
            rooms=rooms,
            portal_groups=portal_groups,
            level_seed=level_seed
        )

    def _generate_rooms(self, grid: List[List[GridCell]], rng: DeterministicRNG) -> List[Room]:
        """Generate rooms using a simple placement algorithm."""
        rooms = []
        max_attempts = 50
        target_rooms = rng.randint(4, 7)

        for _ in range(max_attempts):
            if len(rooms) >= target_rooms:
                break

            # Room interior size (min 3x3 as per spec)
            room_w = rng.randint(3, min(6, self.width - 4))
            room_h = rng.randint(3, min(6, self.height - 4))

            # Position (leaving space for walls)
            room_x = rng.randint(2, self.width - room_w - 2)
            room_y = rng.randint(2, self.height - room_h - 2)

            # Check for overlap with existing rooms (including buffer)
            overlaps = False
            new_room = Room(room_x, room_y, room_w, room_h)

            for existing in rooms:
                # Check if interiors would overlap or touch
                if (room_x - 2 < existing.x + existing.width and
                    room_x + room_w + 2 > existing.x and
                    room_y - 2 < existing.y + existing.height and
                    room_y + room_h + 2 > existing.y):
                    overlaps = True
                    break

            if not overlaps:
                rooms.append(new_room)
                # Carve out room interior
                for dx in range(room_w):
                    for dy in range(room_h):
                        grid[room_y + dy][room_x + dx] = GridCell(Tile.EMPTY)

        return rooms

    def _connect_rooms(self, grid: List[List[GridCell]], rooms: List[Room],
                       rng: DeterministicRNG):
        """Connect rooms with corridors."""
        if len(rooms) < 2:
            return

        # Connect each room to the next
        for i in range(len(rooms) - 1):
            room1 = rooms[i]
            room2 = rooms[i + 1]

            # Get center points
            x1 = room1.x + room1.width // 2
            y1 = room1.y + room1.height // 2
            x2 = room2.x + room2.width // 2
            y2 = room2.y + room2.height // 2

            # Carve L-shaped corridor
            if rng.randint(0, 1) == 0:
                # Horizontal first
                self._carve_horizontal(grid, x1, x2, y1)
                self._carve_vertical(grid, y1, y2, x2)
            else:
                # Vertical first
                self._carve_vertical(grid, y1, y2, x1)
                self._carve_horizontal(grid, x1, x2, y2)

    def _carve_horizontal(self, grid: List[List[GridCell]], x1: int, x2: int, y: int):
        """Carve a horizontal corridor."""
        for x in range(min(x1, x2), max(x1, x2) + 1):
            if 0 <= x < self.width and 0 <= y < self.height:
                grid[y][x] = GridCell(Tile.EMPTY)

    def _carve_vertical(self, grid: List[List[GridCell]], y1: int, y2: int, x: int):
        """Carve a vertical corridor."""
        for y in range(min(y1, y2), max(y1, y2) + 1):
            if 0 <= x < self.width and 0 <= y < self.height:
                grid[y][x] = GridCell(Tile.EMPTY)

    def _place_start_and_stairs(self, grid: List[List[GridCell]], rooms: List[Room],
                                 rng: DeterministicRNG) -> Tuple[Tuple[int, int], Tuple[int, int]]:
        """Place start and stairs in different rooms."""
        if len(rooms) < 2:
            # Fallback: find any empty tiles
            empty_tiles = [(x, y) for y in range(self.height)
                           for x in range(self.width)
                           if grid[y][x].tile == Tile.EMPTY]
            rng.shuffle(empty_tiles)
            start_pos = empty_tiles[0]
            stairs_pos = empty_tiles[-1]
        else:
            # Place in first and last room
            start_room = rooms[0]
            stairs_room = rooms[-1]

            start_pos = (start_room.x + rng.randint(0, start_room.width - 1),
                        start_room.y + rng.randint(0, start_room.height - 1))
            stairs_pos = (stairs_room.x + rng.randint(0, stairs_room.width - 1),
                         stairs_room.y + rng.randint(0, stairs_room.height - 1))

        grid[start_pos[1]][start_pos[0]] = GridCell(Tile.START)
        grid[stairs_pos[1]][stairs_pos[0]] = GridCell(Tile.STAIRS)

        return start_pos, stairs_pos

    def _place_content(self, grid: List[List[GridCell]], rooms: List[Room],
                       rng: DeterministicRNG, start_pos: Tuple[int, int],
                       stairs_pos: Tuple[int, int], num_locked_doors: int = 0):
        """Place coins, chests, enemies, hearts, keys, and webs."""
        # Find tiles reachable from start WITHOUT going through locked doors
        # This ensures keys are always accessible
        reachable = self._find_reachable_tiles(grid, start_pos)

        # Collect all empty tiles (excluding start and stairs)
        empty_tiles = []
        reachable_empty = []
        for y in range(self.height):
            for x in range(self.width):
                if grid[y][x].tile == Tile.EMPTY and (x, y) not in (start_pos, stairs_pos):
                    empty_tiles.append((x, y))
                    if (x, y) in reachable:
                        reachable_empty.append((x, y))

        if not empty_tiles:
            return

        rng.shuffle(empty_tiles)
        rng.shuffle(reachable_empty)

        # Determine counts based on available space
        tile_count = len(empty_tiles)
        num_coins = min(rng.randint(3, 6), tile_count)
        num_chests = min(rng.randint(1, 2), tile_count - num_coins)
        num_enemies = min(rng.randint(2, 4), tile_count - num_coins - num_chests)
        num_hearts = min(rng.randint(1, 2), tile_count - num_coins - num_chests - num_enemies)
        # Place keys exactly equal to number of locked doors (no extras)
        # Keys MUST be placed in reachable tiles only
        num_keys = min(num_locked_doors, len(reachable_empty))
        num_webs = min(rng.randint(1, 3), tile_count - num_coins - num_chests - num_enemies - num_hearts - num_keys)

        # Place keys FIRST in reachable tiles only
        key_positions = set()
        for i in range(num_keys):
            if i < len(reachable_empty):
                x, y = reachable_empty[i]
                grid[y][x] = GridCell(Tile.KEY)
                key_positions.add((x, y))

        # Remove key positions from empty_tiles
        empty_tiles = [t for t in empty_tiles if t not in key_positions]
        rng.shuffle(empty_tiles)

        idx = 0

        # Place coins
        for _ in range(num_coins):
            if idx < len(empty_tiles):
                x, y = empty_tiles[idx]
                grid[y][x] = GridCell(Tile.COIN)
                idx += 1

        # Place chests
        for _ in range(num_chests):
            if idx < len(empty_tiles):
                x, y = empty_tiles[idx]
                grid[y][x] = GridCell(Tile.CHEST)
                idx += 1

        # Place enemies
        for _ in range(num_enemies):
            if idx < len(empty_tiles):
                x, y = empty_tiles[idx]
                grid[y][x] = GridCell(Tile.ENEMY)
                idx += 1

        # Place hearts
        for _ in range(num_hearts):
            if idx < len(empty_tiles):
                x, y = empty_tiles[idx]
                grid[y][x] = GridCell(Tile.HEART_UNKNOWN)
                idx += 1

        # Place webs
        for _ in range(num_webs):
            if idx < len(empty_tiles):
                x, y = empty_tiles[idx]
                grid[y][x] = GridCell(Tile.WEB)
                idx += 1

    def _find_reachable_tiles(self, grid: List[List[GridCell]],
                               start_pos: Tuple[int, int]) -> Set[Tuple[int, int]]:
        """Find all tiles reachable from start without going through locked doors."""
        reachable = set()
        queue = [start_pos]
        reachable.add(start_pos)

        while queue:
            x, y = queue.pop(0)
            # Check all 8 directions (including diagonals for movement)
            for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1),
                          (-1, -1), (-1, 1), (1, -1), (1, 1)]:
                nx, ny = x + dx, y + dy
                if (nx, ny) in reachable:
                    continue
                if not (0 <= nx < self.width and 0 <= ny < self.height):
                    continue
                tile = grid[ny][nx].tile
                # Can't pass through walls or locked doors
                if tile == Tile.WALL or tile == Tile.LOCKED_DOOR:
                    continue
                reachable.add((nx, ny))
                queue.append((nx, ny))

        return reachable

    def _place_portals(self, grid: List[List[GridCell]], rooms: List[Room],
                       rng: DeterministicRNG) -> Dict[int, List[Tuple[int, int]]]:
        """Place portal pairs. Max portals = rooms - 1."""
        portal_groups: Dict[int, List[Tuple[int, int]]] = {}

        if len(rooms) < 2:
            return portal_groups

        max_portals = len(rooms) - 1

        # Find available tiles for portals
        available = []
        for y in range(self.height):
            for x in range(self.width):
                if grid[y][x].tile == Tile.EMPTY:
                    available.append((x, y))

        if len(available) < 4:  # Need at least 2 pairs
            return portal_groups

        rng.shuffle(available)

        # Create portal groups (each group has 2+ portals)
        num_groups = min(rng.randint(1, 2), max_portals // 2)

        idx = 0
        for group_id in range(num_groups):
            portals_in_group = rng.randint(2, 3)
            portal_groups[group_id] = []

            for _ in range(portals_in_group):
                if idx < len(available) and len(portal_groups[group_id]) < max_portals:
                    x, y = available[idx]
                    grid[y][x] = GridCell(Tile.PORTAL, portal_group_id=group_id)
                    portal_groups[group_id].append((x, y))
                    idx += 1

        return portal_groups

    def _place_locked_doors(self, grid: List[List[GridCell]], rooms: List[Room],
                            rng: DeterministicRNG) -> int:
        """Place locked doors at room entrances. Returns number of doors placed."""
        doors_placed = 0
        for room in rooms:
            if rng.randint(0, 2) == 0:  # 1/3 chance for locked door
                openings = self._find_room_openings(grid, room)
                if openings:
                    opening = rng.choice(openings)
                    grid[opening[1]][opening[0]] = GridCell(Tile.LOCKED_DOOR)
                    room.openings.append(opening)
                    doors_placed += 1
        return doors_placed

    def _find_room_openings(self, grid: List[List[GridCell]], room: Room) -> List[Tuple[int, int]]:
        """
        Find potential door positions for a room.
        A valid door position must:
        1. Be an empty tile in a corridor/passage connecting to the room
        2. Have walls on perpendicular sides (forming a doorway)
        3. Connect room interior to exterior walkable space
        """
        openings = []

        # Check tiles adjacent to room boundary (not corners)
        # North and South edges
        for dx in range(room.width):
            for dy, interior_dy in [(-1, 0), (room.height, room.height - 1)]:
                x = room.x + dx
                y = room.y + dy

                if self._is_valid_door_position(grid, x, y, room, horizontal=True):
                    openings.append((x, y))

        # East and West edges
        for dy in range(room.height):
            for dx, interior_dx in [(-1, 0), (room.width, room.width - 1)]:
                x = room.x + dx
                y = room.y + dy

                if self._is_valid_door_position(grid, x, y, room, horizontal=False):
                    openings.append((x, y))

        return openings

    def _is_valid_door_position(self, grid: List[List[GridCell]], x: int, y: int,
                                 room: Room, horizontal: bool) -> bool:
        """
        Check if position is valid for a door.
        horizontal=True means passage runs north-south (walls on east-west)
        horizontal=False means passage runs east-west (walls on north-south)
        """
        if not (0 <= x < self.width and 0 <= y < self.height):
            return False

        cell = grid[y][x]
        if cell.tile != Tile.EMPTY:
            return False

        # Check for walls on perpendicular sides
        if horizontal:
            # Passage runs N-S, need walls on E and W
            west = self._get_tile(grid, x - 1, y)
            east = self._get_tile(grid, x + 1, y)
            if west != Tile.WALL or east != Tile.WALL:
                return False
            # Check passage connects to room and exterior
            north = self._get_tile(grid, x, y - 1)
            south = self._get_tile(grid, x, y + 1)
            has_passage = north not in (Tile.WALL, None) and south not in (Tile.WALL, None)
        else:
            # Passage runs E-W, need walls on N and S
            north = self._get_tile(grid, x, y - 1)
            south = self._get_tile(grid, x, y + 1)
            if north != Tile.WALL or south != Tile.WALL:
                return False
            # Check passage connects to room and exterior
            west = self._get_tile(grid, x - 1, y)
            east = self._get_tile(grid, x + 1, y)
            has_passage = west not in (Tile.WALL, None) and east not in (Tile.WALL, None)

        if not has_passage:
            return False

        # Verify it connects room interior to exterior
        has_interior = False
        has_exterior = False

        for ddx, ddy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nx, ny = x + ddx, y + ddy
            if 0 <= nx < self.width and 0 <= ny < self.height:
                tile = grid[ny][nx].tile
                in_room = (room.x <= nx < room.x + room.width and
                          room.y <= ny < room.y + room.height)
                if in_room and tile != Tile.WALL:
                    has_interior = True
                elif not in_room and tile not in (Tile.WALL, None):
                    has_exterior = True

        return has_interior and has_exterior

    def _get_tile(self, grid: List[List[GridCell]], x: int, y: int) -> Optional[Tile]:
        """Get tile at position, or None if out of bounds."""
        if 0 <= x < self.width and 0 <= y < self.height:
            return grid[y][x].tile
        return None


# =============================================================================
# 6) SHOP SYSTEM
# =============================================================================

@dataclass
class Shop:
    """Represents a shop floor."""
    floor_number: int
    inventory: List[ItemType]
    shop_seed: int
    purchased: List[bool] = field(default_factory=list)

    def __post_init__(self):
        """Initialize purchased tracking."""
        if not self.purchased:
            self.purchased = [False] * len(self.inventory)

    def get_price(self, item: ItemType) -> int:
        """Get price for an item."""
        return ITEM_COSTS[item]

    def is_available(self, index: int) -> bool:
        """Check if item at index is available for purchase."""
        return 0 <= index < len(self.inventory) and not self.purchased[index]

    def mark_purchased(self, index: int):
        """Mark item at index as purchased."""
        if 0 <= index < len(self.purchased):
            self.purchased[index] = True


class ShopGenerator:
    """Generates shop floors and their inventories."""

    def __init__(self, master_seed: int):
        self.master_seed = master_seed

    def get_shop_floors(self) -> List[int]:
        """Determine which floors are shop floors (every 7-10 floors)."""
        shop_floors = []
        rng = DeterministicRNG(hash_seed(self.master_seed, "shop_floors"))

        floor = rng.randint(7, 10)
        while floor <= 100:
            shop_floors.append(floor)
            floor += rng.randint(7, 10)

        return shop_floors

    def generate_shop(self, floor_number: int) -> Shop:
        """Generate a shop for a specific floor."""
        shop_seed = hash_seed(self.master_seed, "shop", floor_number)
        rng = DeterministicRNG(shop_seed)

        # Select 4 distinct items from the pool
        all_items = list(ItemType)
        inventory = rng.sample(all_items, 4)

        return Shop(floor_number, inventory, shop_seed)


# =============================================================================
# 7) MOVEMENT SYSTEM
# =============================================================================

class MovementResult(Enum):
    """Result of a movement attempt."""
    SUCCESS = auto()
    BLOCKED = auto()
    WEB_STOPPED = auto()
    PLAYER_DIED = auto()
    ANCHOR_STOPPED = auto()
    REACHED_STAIRS = auto()


@dataclass
class MoveOutcome:
    """Detailed outcome of a move step."""
    result: MovementResult
    new_pos: Tuple[int, int]
    tile_effect_triggered: bool = False
    damage_taken: int = 0
    coins_gained: int = 0
    coins_lost: int = 0
    hp_healed: int = 0
    keys_gained: int = 0
    keys_used: int = 0
    portal_teleported: bool = False
    portal_destination: Optional[Tuple[int, int]] = None
    smoke_bomb_used: bool = False


class MovementEngine:
    """Handles all movement logic including step-by-step tile effects."""

    def __init__(self, level: Level, player: Player, difficulty: Difficulty,
                 level_seed: int):
        self.level = level
        self.player = player
        self.difficulty = difficulty
        self.level_seed = level_seed
        self.web_entry_counts: Dict[Tuple[int, int], int] = {}

    def get_allowed_directions(self, roll: int) -> List[Direction]:
        """Get allowed directions based on roll parity and player items."""
        if self.player.compass_active:
            # Compass allows any direction
            return list(Direction)

        effective_roll = roll
        if self.player.parity_flipped:
            # Flip parity: odd becomes even, even becomes odd
            effective_roll = roll + 1 if roll % 2 == 0 else roll - 1

        if effective_roll % 2 == 0:
            return Direction.orthogonal_directions()
        else:
            return Direction.diagonal_directions()

    def is_diagonal_blocked(self, x: int, y: int, direction: Direction) -> bool:
        """Check if diagonal movement is blocked by corner clipping rules."""
        if not direction.is_diagonal:
            return False

        dx, dy = direction.value

        # Get the two orthogonally adjacent tiles
        adj1 = self.level.get_cell(x + dx, y)
        adj2 = self.level.get_cell(x, y + dy)

        # If both orthogonal adjacents are blocking, diagonal is blocked
        if adj1 is None or adj2 is None:
            return True

        blocking1 = adj1.is_blocking(self.player.keys)
        blocking2 = adj2.is_blocking(self.player.keys)

        return blocking1 and blocking2

    def can_move_to(self, x: int, y: int, direction: Direction,
                   use_lockpick: bool = False) -> bool:
        """Check if player can move to a position."""
        cell = self.level.get_cell(x, y)
        if cell is None:
            return False

        # Check diagonal blocking
        if direction.is_diagonal:
            px, py = self.player.pos
            if self.is_diagonal_blocked(px, py, direction):
                return False

        # Check if destination is blocking
        if cell.tile == Tile.WALL:
            return False

        if cell.tile == Tile.LOCKED_DOOR:
            if self.player.keys > 0 or use_lockpick:
                return True
            return False

        return True

    def get_legal_directions(self, allowed_directions: List[Direction],
                            excluded: Optional[Set[Direction]] = None,
                            allow_backtrack: bool = False) -> List[Direction]:
        """
        Get directions that are both allowed and have valid destinations.
        By default, prevents backtracking onto tiles visited this turn.
        """
        legal = []
        excluded = excluded or set()

        for direction in allowed_directions:
            if direction in excluded:
                continue

            dx, dy = direction.value
            nx, ny = self.player.x + dx, self.player.y + dy

            # Check if this would backtrack onto a tile we already visited this turn
            if not allow_backtrack and (nx, ny) in self.player.path_this_turn:
                continue

            if self.can_move_to(nx, ny, direction):
                legal.append(direction)

        return legal

    def execute_step(self, direction: Direction, use_lockpick: bool = False,
                    portal_choice: Optional[Tuple[int, int]] = None) -> MoveOutcome:
        """Execute a single movement step and handle tile effects."""
        dx, dy = direction.value
        nx, ny = self.player.x + dx, self.player.y + dy

        # Check if move is valid
        if not self.can_move_to(nx, ny, direction, use_lockpick):
            return MoveOutcome(MovementResult.BLOCKED, self.player.pos)

        cell = self.level.get_cell(nx, ny)
        outcome = MoveOutcome(MovementResult.SUCCESS, (nx, ny))

        # Handle locked door
        if cell.tile == Tile.LOCKED_DOOR:
            if self.player.keys > 0:
                self.player.keys -= 1
                outcome.keys_used = 1
            elif use_lockpick:
                self.player.use_item(ItemType.LOCKPICK)
            self.level.set_tile(nx, ny, Tile.EMPTY)
            outcome.tile_effect_triggered = True

        # Move player
        self.player.x, self.player.y = nx, ny
        self.player.path_this_turn.append((nx, ny))

        # Handle tile effects
        if cell.tile == Tile.COIN:
            self.player.coins += 1
            outcome.coins_gained = 1
            self.level.set_tile(nx, ny, Tile.EMPTY)
            outcome.tile_effect_triggered = True

        elif cell.tile == Tile.CHEST:
            roll = event_d6(self.level_seed, "CHEST", nx, ny)
            self.player.coins += roll
            outcome.coins_gained = roll
            self.level.set_tile(nx, ny, Tile.EMPTY)
            outcome.tile_effect_triggered = True

        elif cell.tile == Tile.HEART_UNKNOWN:
            roll = event_d6(self.level_seed, "HEART", nx, ny)
            self.player.heal(roll)
            outcome.hp_healed = roll
            self.level.set_tile(nx, ny, Tile.EMPTY)
            outcome.tile_effect_triggered = True

        elif cell.tile == Tile.KEY:
            self.player.keys += 1
            outcome.keys_gained = 1
            self.level.set_tile(nx, ny, Tile.EMPTY)
            outcome.tile_effect_triggered = True

        elif cell.tile == Tile.ENEMY:
            # Automatically use smoke bomb if player has one
            if self.player.has_item(ItemType.SMOKE_BOMB):
                self.player.use_item(ItemType.SMOKE_BOMB)
                outcome.smoke_bomb_used = True
                # Enemy damage negated
            else:
                damage = self.difficulty.value
                alive = self.player.take_damage(damage)
                outcome.damage_taken = damage
                if not alive:
                    outcome.result = MovementResult.PLAYER_DIED
                    return outcome
            self.level.set_tile(nx, ny, Tile.EMPTY)
            outcome.tile_effect_triggered = True

        elif cell.tile == Tile.WEB:
            # Track entry count
            key = (nx, ny)
            self.web_entry_counts[key] = self.web_entry_counts.get(key, 0) + 1

            # Lose coins
            roll = event_d6(self.level_seed, "WEB", nx, ny, self.web_entry_counts[key])
            coin_loss = min(self.player.coins, roll)
            self.player.coins = max(0, self.player.coins - roll)
            outcome.coins_lost = coin_loss

            # Set half_next_roll
            self.player.half_next_roll = True

            outcome.result = MovementResult.WEB_STOPPED
            outcome.tile_effect_triggered = True
            return outcome

        elif cell.tile == Tile.PORTAL:
            if not self.player.portal_used_this_turn:
                group_id = cell.portal_group_id
                if group_id is not None and group_id in self.level.portal_groups:
                    other_portals = [p for p in self.level.portal_groups[group_id]
                                    if p != (nx, ny)]
                    if other_portals:
                        # Use provided choice or first available
                        dest = portal_choice if portal_choice in other_portals else other_portals[0]
                        self.player.x, self.player.y = dest
                        self.player.path_this_turn.append(dest)
                        self.player.portal_used_this_turn = True
                        outcome.portal_teleported = True
                        outcome.portal_destination = dest
                        outcome.new_pos = dest
            outcome.tile_effect_triggered = True

        elif cell.tile == Tile.STAIRS:
            outcome.result = MovementResult.REACHED_STAIRS

        return outcome

    def execute_full_movement(self, roll: int, initial_direction: Direction,
                             decision_callback: Callable = None) -> List[MoveOutcome]:
        """
        Execute full movement for a turn.
        decision_callback: function(engine, outcomes, remaining_steps, allowed_dirs) -> Direction or None
        """
        outcomes = []
        remaining = roll

        # Apply half_next_roll
        if self.player.half_next_roll:
            remaining = roll // 2
            self.player.half_next_roll = False

        current_direction = initial_direction
        allowed_directions = self.get_allowed_directions(roll)

        # Track directions we can't reverse to
        forbidden_reversal = set()

        while remaining > 0:
            # Check for anchor stone early stop
            if self.player.anchor_available and self.player.has_item(ItemType.ANCHOR_STONE):
                # Could prompt for early stop via callback
                pass

            outcome = self.execute_step(current_direction)
            outcomes.append(outcome)

            if outcome.result == MovementResult.PLAYER_DIED:
                break

            if outcome.result == MovementResult.WEB_STOPPED:
                break

            if outcome.result == MovementResult.REACHED_STAIRS:
                break

            if outcome.result == MovementResult.BLOCKED:
                # Hit a wall - can change direction
                forbidden_reversal.add(current_direction.reverse())

                # Find new legal direction (no backtracking allowed)
                legal = self.get_legal_directions(allowed_directions, forbidden_reversal, allow_backtrack=False)

                if not legal:
                    # Check if we're trapped - allow backtracking as last resort
                    legal = self.get_legal_directions(allowed_directions, excluded=None, allow_backtrack=True)
                    if not legal:
                        break  # Truly stuck

                if decision_callback:
                    new_dir = decision_callback(self, outcomes, remaining, legal)
                    if new_dir and new_dir in legal:
                        current_direction = new_dir
                    elif legal:
                        current_direction = legal[0]
                    else:
                        break
                elif legal:
                    current_direction = legal[0]
                else:
                    break
                continue  # Don't decrement remaining for blocked move

            remaining -= 1

            # Handle portal teleport - continue in same direction
            if outcome.portal_teleported:
                # Direction stays the same, position changed
                pass

        return outcomes


# =============================================================================
# 8) GAME STATE AND MAIN LOOP
# =============================================================================

@dataclass
class GameState:
    """Complete game state."""
    master_seed: int
    difficulty: Difficulty
    current_floor: int
    player: Player
    shop_floors: List[int]
    current_level: Optional[Level] = None
    current_shop: Optional[Shop] = None
    game_over: bool = False
    victory: bool = False
    turn_number: int = 0


class Game:
    """Main game controller."""

    # Health cap - player can heal up to this amount by collecting hearts
    MAX_HP_CAP = 32

    def __init__(self, master_seed: int = 12345, difficulty: Difficulty = Difficulty.NORMAL,
                 starting_hp: int = 10, max_hp: int = None, grid_width: int = 15, grid_height: int = 15):
        self.master_seed = master_seed
        self.difficulty = difficulty
        self.grid_width = grid_width
        self.grid_height = grid_height

        self.level_generator = LevelGenerator(master_seed, grid_width, grid_height)
        self.shop_generator = ShopGenerator(master_seed)

        # Start with 10 HP, cap at 32 (can collect hearts to heal up to max)
        actual_max_hp = max_hp if max_hp is not None else self.MAX_HP_CAP
        self.player = Player(hp=starting_hp, max_hp=actual_max_hp)
        self.shop_floors = self.shop_generator.get_shop_floors()

        self.state = GameState(
            master_seed=master_seed,
            difficulty=difficulty,
            current_floor=0,
            player=self.player,
            shop_floors=self.shop_floors
        )

        self.movement_engine: Optional[MovementEngine] = None
        self.turn_rng: Optional[DeterministicRNG] = None

    def start_game(self):
        """Initialize and start the game."""
        self.advance_to_floor(1)

    def advance_to_floor(self, floor_number: int):
        """Advance to a specific floor."""
        self.state.current_floor = floor_number
        self.state.turn_number = 0

        if floor_number in self.shop_floors:
            # Shop floor
            self.state.current_level = None
            self.state.current_shop = self.shop_generator.generate_shop(floor_number)
        else:
            # Normal floor
            self.state.current_shop = None
            self.state.current_level = self.level_generator.generate_level(floor_number)
            self.player.pos = self.state.current_level.start_pos

            self.movement_engine = MovementEngine(
                self.state.current_level,
                self.player,
                self.difficulty,
                self.state.current_level.level_seed
            )

            # Initialize turn RNG
            turn_seed = hash_seed(self.master_seed, "turns", floor_number)
            self.turn_rng = DeterministicRNG(turn_seed)

    def is_shop_floor(self) -> bool:
        """Check if current floor is a shop."""
        return self.state.current_shop is not None

    def roll_movement_die(self) -> int:
        """Roll the movement die for the current turn."""
        if self.player.loaded_dice_value is not None:
            roll = self.player.loaded_dice_value
            self.player.loaded_dice_value = None
        else:
            roll = self.turn_rng.d6()

        return roll

    def apply_lucky_charm(self, roll: int, adjustment: int) -> int:
        """Apply Lucky Charm adjustment to roll."""
        if adjustment not in (-1, 1):
            raise ValueError("Lucky Charm adjustment must be +1 or -1")

        new_roll = max(1, min(6, roll + adjustment))
        self.player.use_item(ItemType.LUCKY_CHARM)
        return new_roll

    def start_turn(self):
        """Start a new turn."""
        self.state.turn_number += 1
        self.player.reset_turn_flags()

        # Initialize path with current position to prevent backtracking to start
        self.player.path_this_turn = [self.player.pos]

        # Check if starting on WEB and can move off
        if self.state.current_level:
            cell = self.state.current_level.get_cell(*self.player.pos)
            if cell and cell.tile == Tile.WEB:
                # Will be consumed if player successfully exits
                pass

    def execute_turn(self, roll: int, direction: Direction,
                    decision_callback: Callable = None) -> List[MoveOutcome]:
        """Execute a full turn of movement."""
        if self.movement_engine is None:
            return []

        # Check web exit
        start_pos = self.player.pos
        start_cell = self.state.current_level.get_cell(*start_pos)
        was_on_web = start_cell and start_cell.tile == Tile.WEB

        outcomes = self.movement_engine.execute_full_movement(roll, direction, decision_callback)

        # Check if exited web
        if was_on_web and self.player.pos != start_pos:
            self.state.current_level.set_tile(start_pos[0], start_pos[1], Tile.EMPTY)

        # Check for game over / victory
        for outcome in outcomes:
            if outcome.result == MovementResult.PLAYER_DIED:
                self.state.game_over = True
                break
            if outcome.result == MovementResult.REACHED_STAIRS:
                self.complete_floor()
                break

        return outcomes

    def complete_floor(self):
        """Complete current floor and advance."""
        if self.state.current_floor >= 100:
            self.state.victory = True
            self.state.game_over = True
        else:
            self.advance_to_floor(self.state.current_floor + 1)

    # Shop operations
    def buy_item_by_index(self, index: int) -> bool:
        """Attempt to buy an item from shop by index."""
        if not self.is_shop_floor():
            return False

        shop = self.state.current_shop
        if not shop.is_available(index):
            return False

        item = shop.inventory[index]
        price = shop.get_price(item)
        if self.player.coins < price:
            return False

        self.player.coins -= price
        self.player.inventory.append(item)
        shop.mark_purchased(index)
        return True

    def buy_item(self, item: ItemType) -> bool:
        """Attempt to buy an item from shop (legacy, finds first available)."""
        if not self.is_shop_floor():
            return False

        shop = self.state.current_shop
        for i, inv_item in enumerate(shop.inventory):
            if inv_item == item and shop.is_available(i):
                return self.buy_item_by_index(i)
        return False

    def gamble(self, choice: str) -> Tuple[bool, int]:
        """
        Gamble in shop.
        choice: 'high' or 'low'
        Returns: (won, coin_change)
        """
        if not self.is_shop_floor():
            return (False, 0)

        gamble_seed = hash_seed(self.master_seed, "gamble",
                               self.state.current_floor, self.state.turn_number)
        roll = event_d6(gamble_seed)
        self.state.turn_number += 1  # Increment to ensure different rolls

        won = False
        if choice.lower() == 'low' and roll in (1, 2):
            won = True
        elif choice.lower() == 'high' and roll in (5, 6):
            won = True

        if won:
            self.player.coins += 10
            return (True, 10)
        else:
            loss = min(4, self.player.coins)
            self.player.coins = max(0, self.player.coins - 4)
            return (False, -loss)

    def leave_shop(self):
        """Leave shop and proceed to next floor."""
        self.complete_floor()

    # Item usage
    def use_compass(self) -> bool:
        """Use Compass of True North."""
        if self.player.use_item(ItemType.COMPASS_OF_TRUE_NORTH):
            self.player.compass_active = True
            return True
        return False

    def use_loaded_dice(self, value: int) -> bool:
        """Use Loaded Dice to set next roll."""
        if not (1 <= value <= 6):
            return False
        if self.player.use_item(ItemType.LOADED_DICE):
            self.player.loaded_dice_value = value
            return True
        return False

    def use_parity_flip(self) -> bool:
        """Use Parity Flip."""
        if self.player.use_item(ItemType.PARITY_FLIP):
            self.player.parity_flipped = True
            return True
        return False

    def use_anchor_stone(self) -> bool:
        """Prepare Anchor Stone for use during movement."""
        if self.player.has_item(ItemType.ANCHOR_STONE):
            self.player.anchor_available = True
            return True
        return False

    def get_state_summary(self) -> str:
        """Get a summary of current game state."""
        lines = [
            f"Floor: {self.state.current_floor}/100",
            f"HP: {self.player.hp}/{self.player.max_hp}",
            f"Coins: {self.player.coins}",
            f"Keys: {self.player.keys}",
            f"Inventory: {[ITEM_NAMES[i] for i in self.player.inventory]}",
        ]

        if self.is_shop_floor():
            lines.append("\n=== SHOP FLOOR ===")
            shop = self.state.current_shop
            lines.append("Items for sale:")
            for item in shop.inventory:
                lines.append(f"  - {ITEM_NAMES[item]}: {ITEM_COSTS[item]} coins")
        else:
            lines.append(f"\nPosition: {self.player.pos}")
            if self.state.current_level:
                lines.append("\n" + self.state.current_level.render(self.player.pos))

        return '\n'.join(lines)

    # =========================================================================
    # SAVE / LOAD SYSTEM
    # =========================================================================

    def get_save_data(self) -> dict:
        """Get game state as a dictionary for saving."""
        return {
            'version': 1,
            'master_seed': self.master_seed,
            'difficulty': self.difficulty.name,
            'current_floor': self.state.current_floor,
            'player': {
                'hp': self.player.hp,
                'max_hp': self.player.max_hp,
                'coins': self.player.coins,
                'keys': self.player.keys,
                'inventory': [item.name for item in self.player.inventory],
            },
            'turn_number': self.state.turn_number,
        }

    def save_game(self, filepath: str) -> bool:
        """Save game state to a file. Returns True on success."""
        try:
            save_data = self.get_save_data()
            with open(filepath, 'w') as f:
                json.dump(save_data, f, indent=2)
            return True
        except (IOError, OSError) as e:
            print(f"Error saving game: {e}")
            return False

    @classmethod
    def load_game(cls, filepath: str) -> Optional['Game']:
        """Load game from a save file. Returns Game instance or None on failure."""
        try:
            with open(filepath, 'r') as f:
                save_data = json.load(f)

            # Validate version
            if save_data.get('version', 0) != 1:
                print("Incompatible save file version")
                return None

            # Create game with saved parameters
            difficulty = Difficulty[save_data['difficulty']]
            game = cls(
                master_seed=save_data['master_seed'],
                difficulty=difficulty,
                starting_hp=save_data['player']['hp'],
                max_hp=save_data['player']['max_hp'],
            )

            # Restore player state
            game.player.coins = save_data['player']['coins']
            game.player.keys = save_data['player']['keys']
            game.player.inventory = [
                ItemType[name] for name in save_data['player']['inventory']
            ]

            # Advance to saved floor
            game.advance_to_floor(save_data['current_floor'])
            game.state.turn_number = save_data.get('turn_number', 0)

            return game

        except (IOError, OSError, json.JSONDecodeError, KeyError) as e:
            print(f"Error loading game: {e}")
            return None

    @staticmethod
    def get_default_save_path() -> str:
        """Get the default save file path."""
        # Use user's home directory for cross-platform compatibility
        home = os.path.expanduser("~")
        save_dir = os.path.join(home, ".dungeon_crawler")
        os.makedirs(save_dir, exist_ok=True)
        return os.path.join(save_dir, "savegame.json")

    @staticmethod
    def list_save_files() -> List[str]:
        """List all save files in the default save directory."""
        home = os.path.expanduser("~")
        save_dir = os.path.join(home, ".dungeon_crawler")
        if not os.path.exists(save_dir):
            return []
        return [f for f in os.listdir(save_dir) if f.endswith('.json')]


# =============================================================================
# 9) CLI INTERFACE
# =============================================================================

def parse_direction(s: str) -> Optional[Direction]:
    """Parse direction from string input."""
    mapping = {
        'n': Direction.N, 'north': Direction.N,
        's': Direction.S, 'south': Direction.S,
        'e': Direction.E, 'east': Direction.E,
        'w': Direction.W, 'west': Direction.W,
        'ne': Direction.NE, 'northeast': Direction.NE,
        'nw': Direction.NW, 'northwest': Direction.NW,
        'se': Direction.SE, 'southeast': Direction.SE,
        'sw': Direction.SW, 'southwest': Direction.SW,
    }
    return mapping.get(s.lower().strip())


def direction_change_callback(engine: MovementEngine, outcomes: List[MoveOutcome],
                             remaining: int, legal_dirs: List[Direction]) -> Optional[Direction]:
    """Callback for direction changes during movement."""
    if not legal_dirs:
        return None

    print(f"\nHit a wall! {remaining} steps remaining.")
    print(f"Legal directions: {[d.name for d in legal_dirs]}")

    while True:
        choice = input("Choose new direction: ").strip()
        direction = parse_direction(choice)
        if direction in legal_dirs:
            return direction
        print("Invalid direction. Try again.")


def run_cli_game():
    """Run the game with command-line interface."""
    print("=" * 50)
    print("PROCEDURAL ROLL-AND-WRITE DUNGEON CRAWLER")
    print("=" * 50)

    # Get seed
    seed_input = input("Enter master seed (or press Enter for default): ").strip()
    if seed_input:
        try:
            master_seed = int(seed_input)
        except ValueError:
            master_seed = hash_seed(seed_input)
    else:
        master_seed = 12345

    # Get difficulty
    print("\nDifficulty levels:")
    print("1. Easy (enemies deal 2 damage)")
    print("2. Normal (enemies deal 4 damage)")
    print("3. Hard (enemies deal 8 damage)")
    print("4. Demonic (enemies deal 10 damage)")

    diff_choice = input("Choose difficulty (1-4, default 2): ").strip() or "2"
    difficulty_map = {'1': Difficulty.EASY, '2': Difficulty.NORMAL,
                     '3': Difficulty.HARD, '4': Difficulty.DEMONIC}
    difficulty = difficulty_map.get(diff_choice, Difficulty.NORMAL)

    # Create game
    game = Game(master_seed=master_seed, difficulty=difficulty)
    game.start_game()

    print(f"\nStarting game with seed: {master_seed}")
    print(f"Difficulty: {difficulty.name}")
    print(f"Shop floors: {game.shop_floors}")

    # Main game loop
    while not game.state.game_over:
        print("\n" + "=" * 50)
        print(game.get_state_summary())

        if game.is_shop_floor():
            # Shop interface
            print("\nCommands: buy <number>, gamble <high/low>, leave")
            cmd = input("> ").strip().lower()

            if cmd == 'leave':
                game.leave_shop()
            elif cmd.startswith('buy '):
                try:
                    idx = int(cmd.split()[1]) - 1
                    shop = game.state.current_shop
                    if 0 <= idx < len(shop.inventory):
                        item = shop.inventory[idx]
                        if game.buy_item(item):
                            print(f"Bought {ITEM_NAMES[item]}!")
                        else:
                            print("Not enough coins!")
                    else:
                        print("Invalid item number.")
                except (ValueError, IndexError):
                    print("Invalid command.")
            elif cmd.startswith('gamble '):
                choice = cmd.split()[1]
                if choice in ('high', 'low'):
                    won, change = game.gamble(choice)
                    if won:
                        print(f"Won! Gained {change} coins.")
                    else:
                        print(f"Lost! Lost {-change} coins.")
                else:
                    print("Choose 'high' or 'low'.")
            else:
                print("Unknown command.")

        else:
            # Normal floor interface
            game.start_turn()

            # Pre-roll item usage
            print("\nPre-roll items: compass, loaded <1-6>, parity, skip")
            pre_cmd = input("Use item (or press Enter to roll): ").strip().lower()

            if pre_cmd == 'compass':
                if game.use_compass():
                    print("Compass activated - any direction allowed!")
                else:
                    print("No Compass of True North in inventory.")
            elif pre_cmd.startswith('loaded '):
                try:
                    value = int(pre_cmd.split()[1])
                    if game.use_loaded_dice(value):
                        print(f"Loaded Dice set to {value}!")
                    else:
                        print("No Loaded Dice in inventory or invalid value.")
                except (ValueError, IndexError):
                    print("Invalid value.")
            elif pre_cmd == 'parity':
                if game.use_parity_flip():
                    print("Parity Flip activated!")
                else:
                    print("No Parity Flip in inventory.")

            # Roll
            roll = game.roll_movement_die()
            print(f"\nRolled: {roll}")

            # Apply half movement if needed
            effective = roll
            if game.player.half_next_roll:
                effective = roll // 2
                print(f"Web effect: movement halved to {effective}")

            # Post-roll item usage (Lucky Charm)
            if game.player.has_item(ItemType.LUCKY_CHARM):
                print("Use Lucky Charm? (+1/-1/no): ", end="")
                charm_cmd = input().strip().lower()
                if charm_cmd in ('+1', '1', 'plus'):
                    roll = game.apply_lucky_charm(roll, 1)
                    print(f"Roll adjusted to {roll}")
                elif charm_cmd in ('-1', 'minus'):
                    roll = game.apply_lucky_charm(roll, -1)
                    print(f"Roll adjusted to {roll}")

            # Get allowed directions
            allowed = game.movement_engine.get_allowed_directions(roll)
            legal = game.movement_engine.get_legal_directions(allowed)

            parity = "orthogonal (N/S/E/W)" if roll % 2 == 0 else "diagonal (NE/NW/SE/SW)"
            if game.player.compass_active:
                parity = "any direction"

            print(f"Movement: {parity}")
            print(f"Legal directions: {[d.name for d in legal]}")

            if not legal:
                print("No legal moves! Turn skipped.")
                continue

            # Get direction choice
            while True:
                dir_input = input("Choose direction: ").strip()
                direction = parse_direction(dir_input)
                if direction in legal:
                    break
                print(f"Invalid. Choose from: {[d.name for d in legal]}")

            # Execute turn
            outcomes = game.execute_turn(roll, direction, direction_change_callback)

            # Report outcomes
            for i, outcome in enumerate(outcomes):
                if outcome.tile_effect_triggered:
                    effects = []
                    if outcome.coins_gained:
                        effects.append(f"+{outcome.coins_gained} coins")
                    if outcome.coins_lost:
                        effects.append(f"-{outcome.coins_lost} coins")
                    if outcome.hp_healed:
                        effects.append(f"+{outcome.hp_healed} HP")
                    if outcome.damage_taken:
                        effects.append(f"-{outcome.damage_taken} HP")
                    if outcome.keys_gained:
                        effects.append(f"+{outcome.keys_gained} keys")
                    if outcome.keys_used:
                        effects.append(f"-{outcome.keys_used} keys")
                    if outcome.portal_teleported:
                        effects.append(f"teleported to {outcome.portal_destination}")

                    if effects:
                        print(f"Step {i+1}: {', '.join(effects)}")

                if outcome.result == MovementResult.WEB_STOPPED:
                    print("Caught in web! Movement ends.")
                elif outcome.result == MovementResult.REACHED_STAIRS:
                    print("Reached stairs!")

    # Game end
    print("\n" + "=" * 50)
    if game.state.victory:
        print("VICTORY! You cleared all 100 floors!")
    else:
        print("GAME OVER")
        print(f"Reached floor {game.state.current_floor}")
    print(f"Final score: {game.player.coins} coins")


# =============================================================================
# 10) MAIN ENTRY POINT
# =============================================================================

if __name__ == "__main__":
    run_cli_game()
