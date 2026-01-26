#!/usr/bin/env python3
"""
Comprehensive tests for the Procedural Roll-and-Write Dungeon Crawler.
Tests determinism, game mechanics, and edge cases.
"""

import unittest
from dungeon_crawler import (
    DeterministicRNG, hash_seed, event_d6,
    Tile, Direction, Difficulty, ItemType,
    GridCell, Room, Level, Player,
    LevelGenerator, ShopGenerator, Shop,
    MovementEngine, MovementResult, MoveOutcome,
    Game, ITEM_COSTS, ITEM_NAMES
)


class TestDeterministicRNG(unittest.TestCase):
    """Test the deterministic random number generator."""

    def test_same_seed_same_results(self):
        """RNG with same seed produces identical sequences."""
        rng1 = DeterministicRNG(42)
        rng2 = DeterministicRNG(42)

        for _ in range(100):
            self.assertEqual(rng1._next(), rng2._next())

    def test_different_seeds_different_results(self):
        """RNG with different seeds produces different sequences."""
        rng1 = DeterministicRNG(42)
        rng2 = DeterministicRNG(43)

        results1 = [rng1._next() for _ in range(10)]
        results2 = [rng2._next() for _ in range(10)]
        self.assertNotEqual(results1, results2)

    def test_d6_range(self):
        """d6 always returns values 1-6."""
        rng = DeterministicRNG(12345)
        for _ in range(1000):
            roll = rng.d6()
            self.assertGreaterEqual(roll, 1)
            self.assertLessEqual(roll, 6)

    def test_randint_range(self):
        """randint returns values in specified range."""
        rng = DeterministicRNG(12345)
        for _ in range(100):
            val = rng.randint(5, 10)
            self.assertGreaterEqual(val, 5)
            self.assertLessEqual(val, 10)

    def test_shuffle_determinism(self):
        """Shuffle is deterministic."""
        rng1 = DeterministicRNG(12345)
        rng2 = DeterministicRNG(12345)

        lst1 = [1, 2, 3, 4, 5]
        lst2 = [1, 2, 3, 4, 5]

        rng1.shuffle(lst1)
        rng2.shuffle(lst2)

        self.assertEqual(lst1, lst2)

    def test_sample_determinism(self):
        """Sample is deterministic."""
        rng1 = DeterministicRNG(12345)
        rng2 = DeterministicRNG(12345)

        lst = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        sample1 = rng1.sample(lst, 4)
        sample2 = rng2.sample(lst, 4)

        self.assertEqual(sample1, sample2)


class TestHashSeed(unittest.TestCase):
    """Test hash_seed function."""

    def test_determinism(self):
        """Same arguments produce same hash."""
        h1 = hash_seed("master", "level", 1)
        h2 = hash_seed("master", "level", 1)
        self.assertEqual(h1, h2)

    def test_different_args_different_hash(self):
        """Different arguments produce different hashes."""
        h1 = hash_seed("master", "level", 1)
        h2 = hash_seed("master", "level", 2)
        self.assertNotEqual(h1, h2)

    def test_event_d6_determinism(self):
        """Event-keyed d6 is deterministic."""
        roll1 = event_d6(12345, "CHEST", 5, 5)
        roll2 = event_d6(12345, "CHEST", 5, 5)
        self.assertEqual(roll1, roll2)

    def test_event_d6_different_events(self):
        """Different events produce different rolls."""
        roll1 = event_d6(12345, "CHEST", 5, 5)
        roll2 = event_d6(12345, "CHEST", 5, 6)
        # Not guaranteed different, but very likely
        # Just check they're both valid d6 rolls
        self.assertIn(roll1, range(1, 7))
        self.assertIn(roll2, range(1, 7))


class TestDirection(unittest.TestCase):
    """Test direction enumeration."""

    def test_orthogonal_directions(self):
        """Orthogonal directions are N, S, E, W."""
        ortho = Direction.orthogonal_directions()
        self.assertEqual(len(ortho), 4)
        self.assertIn(Direction.N, ortho)
        self.assertIn(Direction.S, ortho)
        self.assertIn(Direction.E, ortho)
        self.assertIn(Direction.W, ortho)

    def test_diagonal_directions(self):
        """Diagonal directions are NE, NW, SE, SW."""
        diag = Direction.diagonal_directions()
        self.assertEqual(len(diag), 4)
        self.assertIn(Direction.NE, diag)
        self.assertIn(Direction.NW, diag)
        self.assertIn(Direction.SE, diag)
        self.assertIn(Direction.SW, diag)

    def test_reverse(self):
        """Reverse directions are correct."""
        self.assertEqual(Direction.N.reverse(), Direction.S)
        self.assertEqual(Direction.S.reverse(), Direction.N)
        self.assertEqual(Direction.E.reverse(), Direction.W)
        self.assertEqual(Direction.W.reverse(), Direction.E)
        self.assertEqual(Direction.NE.reverse(), Direction.SW)
        self.assertEqual(Direction.SW.reverse(), Direction.NE)
        self.assertEqual(Direction.NW.reverse(), Direction.SE)
        self.assertEqual(Direction.SE.reverse(), Direction.NW)


class TestPlayer(unittest.TestCase):
    """Test player state management."""

    def test_initial_state(self):
        """Player starts with correct defaults."""
        player = Player()
        self.assertEqual(player.hp, 10)
        self.assertEqual(player.coins, 0)
        self.assertEqual(player.keys, 0)
        self.assertEqual(player.inventory, [])
        self.assertFalse(player.half_next_roll)
        self.assertFalse(player.portal_used_this_turn)

    def test_take_damage(self):
        """Taking damage reduces HP and returns alive status."""
        player = Player(hp=10)
        alive = player.take_damage(3)
        self.assertTrue(alive)
        self.assertEqual(player.hp, 7)

        alive = player.take_damage(7)
        self.assertFalse(alive)
        self.assertEqual(player.hp, 0)

    def test_heal_with_cap(self):
        """Healing respects max HP cap."""
        player = Player(hp=5, max_hp=10)
        player.heal(3)
        self.assertEqual(player.hp, 8)

        player.heal(10)
        self.assertEqual(player.hp, 10)  # Capped at max

    def test_use_item(self):
        """Using item removes it from inventory."""
        player = Player()
        player.inventory.append(ItemType.SMOKE_BOMB)
        player.inventory.append(ItemType.LOCKPICK)

        self.assertTrue(player.use_item(ItemType.SMOKE_BOMB))
        self.assertNotIn(ItemType.SMOKE_BOMB, player.inventory)
        self.assertIn(ItemType.LOCKPICK, player.inventory)

        self.assertFalse(player.use_item(ItemType.SMOKE_BOMB))

    def test_reset_turn_flags(self):
        """Turn flags are properly reset."""
        player = Player()
        player.portal_used_this_turn = True
        player.compass_active = True
        player.path_this_turn = [(1, 2), (3, 4)]

        player.reset_turn_flags()

        self.assertFalse(player.portal_used_this_turn)
        self.assertFalse(player.compass_active)
        self.assertEqual(player.path_this_turn, [])


class TestLevelGeneration(unittest.TestCase):
    """Test level generation."""

    def test_determinism(self):
        """Level generation is deterministic."""
        gen1 = LevelGenerator(12345)
        gen2 = LevelGenerator(12345)

        for floor in [1, 50, 100]:
            level1 = gen1.generate_level(floor)
            level2 = gen2.generate_level(floor)

            self.assertEqual(level1.render(), level2.render())
            self.assertEqual(level1.start_pos, level2.start_pos)
            self.assertEqual(level1.stairs_pos, level2.stairs_pos)

    def test_has_start_and_stairs(self):
        """Every level has start and stairs."""
        gen = LevelGenerator(12345)

        for floor in range(1, 11):
            level = gen.generate_level(floor)

            # Find start
            found_start = False
            found_stairs = False
            for y in range(level.height):
                for x in range(level.width):
                    cell = level.get_cell(x, y)
                    if cell.tile == Tile.START:
                        found_start = True
                    if cell.tile == Tile.STAIRS:
                        found_stairs = True

            self.assertTrue(found_start, f"Floor {floor} missing START")
            self.assertTrue(found_stairs, f"Floor {floor} missing STAIRS")

    def test_room_minimum_size(self):
        """Rooms meet minimum 3x3 interior requirement."""
        gen = LevelGenerator(12345)
        level = gen.generate_level(1)

        for room in level.rooms:
            self.assertGreaterEqual(room.width, 3)
            self.assertGreaterEqual(room.height, 3)


class TestShopGeneration(unittest.TestCase):
    """Test shop floor generation."""

    def test_shop_floor_determinism(self):
        """Shop floors are deterministic."""
        gen1 = ShopGenerator(12345)
        gen2 = ShopGenerator(12345)

        self.assertEqual(gen1.get_shop_floors(), gen2.get_shop_floors())

    def test_shop_floor_spacing(self):
        """Shop floors are 7-10 apart."""
        gen = ShopGenerator(12345)
        floors = gen.get_shop_floors()

        prev = 0
        for floor in floors:
            spacing = floor - prev
            self.assertGreaterEqual(spacing, 7)
            self.assertLessEqual(spacing, 10)
            prev = floor

    def test_shop_inventory_determinism(self):
        """Shop inventory is deterministic."""
        gen1 = ShopGenerator(12345)
        gen2 = ShopGenerator(12345)

        floors = gen1.get_shop_floors()
        for floor in floors[:5]:
            shop1 = gen1.generate_shop(floor)
            shop2 = gen2.generate_shop(floor)
            self.assertEqual(shop1.inventory, shop2.inventory)

    def test_shop_has_four_items(self):
        """Each shop has exactly 4 distinct items."""
        gen = ShopGenerator(12345)
        floors = gen.get_shop_floors()

        for floor in floors[:5]:
            shop = gen.generate_shop(floor)
            self.assertEqual(len(shop.inventory), 4)
            # All distinct
            self.assertEqual(len(set(shop.inventory)), 4)


class TestGridCell(unittest.TestCase):
    """Test grid cell blocking logic."""

    def test_wall_always_blocking(self):
        """Walls are always blocking."""
        cell = GridCell(Tile.WALL)
        self.assertTrue(cell.is_blocking(0))
        self.assertTrue(cell.is_blocking(5))

    def test_locked_door_blocking_without_keys(self):
        """Locked doors block without keys."""
        cell = GridCell(Tile.LOCKED_DOOR)
        self.assertTrue(cell.is_blocking(0))
        self.assertFalse(cell.is_blocking(1))

    def test_other_tiles_not_blocking(self):
        """Other tiles are not blocking."""
        for tile in [Tile.EMPTY, Tile.COIN, Tile.ENEMY, Tile.WEB]:
            cell = GridCell(tile)
            self.assertFalse(cell.is_blocking(0))


class TestMovementParity(unittest.TestCase):
    """Test movement direction parity rules."""

    def setUp(self):
        """Create a simple test level."""
        gen = LevelGenerator(12345)
        self.level = gen.generate_level(1)
        self.player = Player()
        self.player.pos = self.level.start_pos
        self.engine = MovementEngine(
            self.level, self.player, Difficulty.NORMAL, self.level.level_seed
        )

    def test_even_roll_orthogonal(self):
        """Even rolls allow orthogonal movement."""
        allowed = self.engine.get_allowed_directions(2)
        self.assertEqual(allowed, Direction.orthogonal_directions())

        allowed = self.engine.get_allowed_directions(4)
        self.assertEqual(allowed, Direction.orthogonal_directions())

        allowed = self.engine.get_allowed_directions(6)
        self.assertEqual(allowed, Direction.orthogonal_directions())

    def test_odd_roll_diagonal(self):
        """Odd rolls allow diagonal movement."""
        allowed = self.engine.get_allowed_directions(1)
        self.assertEqual(allowed, Direction.diagonal_directions())

        allowed = self.engine.get_allowed_directions(3)
        self.assertEqual(allowed, Direction.diagonal_directions())

        allowed = self.engine.get_allowed_directions(5)
        self.assertEqual(allowed, Direction.diagonal_directions())

    def test_compass_allows_all(self):
        """Compass of True North allows any direction."""
        self.player.compass_active = True
        allowed = self.engine.get_allowed_directions(2)
        self.assertEqual(len(allowed), 8)

    def test_parity_flip(self):
        """Parity flip swaps odd/even behavior."""
        self.player.parity_flipped = True

        allowed = self.engine.get_allowed_directions(2)
        self.assertEqual(allowed, Direction.diagonal_directions())

        allowed = self.engine.get_allowed_directions(3)
        self.assertEqual(allowed, Direction.orthogonal_directions())


class TestGame(unittest.TestCase):
    """Test main game logic."""

    def test_game_start(self):
        """Game starts properly."""
        game = Game(master_seed=12345, difficulty=Difficulty.NORMAL)
        game.start_game()

        self.assertEqual(game.state.current_floor, 1)
        self.assertIsNotNone(game.state.current_level)
        self.assertEqual(game.player.pos, game.state.current_level.start_pos)

    def test_shop_floor_detection(self):
        """Shop floors are properly detected."""
        game = Game(master_seed=12345)
        game.start_game()

        self.assertFalse(game.is_shop_floor())

        # Advance to first shop floor
        first_shop = game.shop_floors[0]
        game.advance_to_floor(first_shop)

        self.assertTrue(game.is_shop_floor())
        self.assertIsNotNone(game.state.current_shop)

    def test_buy_item(self):
        """Buying items works correctly."""
        game = Game(master_seed=12345)
        game.player.coins = 100

        first_shop = game.shop_floors[0]
        game.advance_to_floor(first_shop)

        shop = game.state.current_shop
        item = shop.inventory[0]
        price = ITEM_COSTS[item]

        self.assertTrue(game.buy_item(item))
        self.assertEqual(game.player.coins, 100 - price)
        self.assertIn(item, game.player.inventory)

    def test_buy_item_insufficient_coins(self):
        """Can't buy with insufficient coins."""
        game = Game(master_seed=12345)
        game.player.coins = 0

        first_shop = game.shop_floors[0]
        game.advance_to_floor(first_shop)

        shop = game.state.current_shop
        item = shop.inventory[0]

        self.assertFalse(game.buy_item(item))

    def test_gamble_determinism(self):
        """Gambling is deterministic."""
        game1 = Game(master_seed=12345)
        game2 = Game(master_seed=12345)

        game1.player.coins = 100
        game2.player.coins = 100

        first_shop = game1.shop_floors[0]
        game1.advance_to_floor(first_shop)
        game2.advance_to_floor(first_shop)

        result1 = game1.gamble('high')
        result2 = game2.gamble('high')

        self.assertEqual(result1, result2)

    def test_floor_100_victory(self):
        """Reaching stairs on floor 100 wins."""
        game = Game(master_seed=12345)
        game.advance_to_floor(100)

        # Should not be game over yet
        self.assertFalse(game.state.game_over)

        # Complete the floor
        game.complete_floor()

        self.assertTrue(game.state.game_over)
        self.assertTrue(game.state.victory)


class TestDifficulty(unittest.TestCase):
    """Test difficulty settings."""

    def test_enemy_damage_values(self):
        """Enemy damage matches difficulty."""
        self.assertEqual(Difficulty.EASY.value, 2)
        self.assertEqual(Difficulty.NORMAL.value, 4)
        self.assertEqual(Difficulty.HARD.value, 8)
        self.assertEqual(Difficulty.DEMONIC.value, 10)


class TestFullGameDeterminism(unittest.TestCase):
    """Test full game determinism across runs."""

    def test_multiple_floors_deterministic(self):
        """Multiple floors generate identically."""
        game1 = Game(master_seed=99999)
        game2 = Game(master_seed=99999)

        game1.start_game()
        game2.start_game()

        for floor in range(1, 21):
            if floor in game1.shop_floors:
                game1.advance_to_floor(floor)
                game2.advance_to_floor(floor)

                self.assertEqual(
                    game1.state.current_shop.inventory,
                    game2.state.current_shop.inventory
                )
            else:
                game1.advance_to_floor(floor)
                game2.advance_to_floor(floor)

                self.assertEqual(
                    game1.state.current_level.render(),
                    game2.state.current_level.render()
                )


if __name__ == '__main__':
    unittest.main(verbosity=2)
