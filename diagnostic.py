#!/usr/bin/env python3
"""
Diagnostic script to verify level generation and movement logic.
Run this and share the output to help debug issues.
"""

from dungeon_crawler import *

print("=" * 60)
print("DIAGNOSTIC OUTPUT - Please share this with the developer")
print("=" * 60)

# Test 1: Hash determinism
print("\n1. Hash function test:")
h = hash_seed(12345, "level", 1)
print(f"   hash_seed(12345, 'level', 1) = {h}")
expected_hash = 10892914701354153095
print(f"   Expected: {expected_hash}")
print(f"   Match: {h == expected_hash}")

# Test 2: RNG determinism
print("\n2. RNG test:")
rng = DeterministicRNG(12345)
vals = [rng.randint(1, 6) for _ in range(5)]
print(f"   First 5 d6 rolls with seed 12345: {vals}")
expected_vals = [4, 4, 6, 1, 3]
print(f"   Expected: {expected_vals}")
print(f"   Match: {vals == expected_vals}")

# Test 3: Level generation
print("\n3. Level generation test (seed 12345, floor 1):")
gen = LevelGenerator(12345, 15, 15)
level = gen.generate_level(1)
print(f"   Start position: {level.start_pos}")
print(f"   Expected: (10, 10)")
print(f"   Match: {level.start_pos == (10, 10)}")

# Count entities
keys = sum(1 for y in range(15) for x in range(15) if level.get_cell(x, y).tile == Tile.KEY)
doors = sum(1 for y in range(15) for x in range(15) if level.get_cell(x, y).tile == Tile.LOCKED_DOOR)
coins = sum(1 for y in range(15) for x in range(15) if level.get_cell(x, y).tile == Tile.COIN)
enemies = sum(1 for y in range(15) for x in range(15) if level.get_cell(x, y).tile == Tile.ENEMY)
print(f"   Keys: {keys} (expected: 0)")
print(f"   Doors: {doors} (expected: 0)")
print(f"   Coins: {coins} (expected: 4)")
print(f"   Enemies: {enemies} (expected: 4)")

print("\n4. Level ASCII render:")
print(level.render())

# Test 4: Movement and backtracking
print("\n5. Movement/backtracking test:")
game = Game(master_seed=12345, difficulty=Difficulty.NORMAL)
game.start_game()

game.start_turn()
print(f"   Initial path: {game.player.path_this_turn}")

# Move NE
outcome = game.movement_engine.execute_step(Direction.NE)
print(f"   After NE move: player at {game.player.pos}, result={outcome.result}")
print(f"   Path: {game.player.path_this_turn}")

# Check legal directions
allowed = game.movement_engine.get_allowed_directions(5)
legal = game.movement_engine.get_legal_directions(allowed, allow_backtrack=False)
print(f"   Legal directions (no backtrack): {[d.name for d in legal]}")
print(f"   Expected: ['NE', 'NW', 'SE'] (SW excluded)")
print(f"   SW in legal: {'SW' in [d.name for d in legal]} (should be False)")

# Check SW specifically
sw_target = (game.player.x - 1, game.player.y + 1)
print(f"\n6. SW direction check:")
print(f"   SW target: {sw_target}")
print(f"   In path: {sw_target in game.player.path_this_turn}")
print(f"   Can move: {game.movement_engine.can_move_to(*sw_target, Direction.SW)}")

print("\n" + "=" * 60)
print("END OF DIAGNOSTIC")
print("=" * 60)
