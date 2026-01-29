#!/usr/bin/env python3
"""
Graphical User Interface for the Procedural Roll-and-Write Dungeon Crawler.
Uses tkinter for cross-platform GUI support.
"""

import tkinter as tk
from tkinter import ttk, messagebox, simpledialog
from typing import Optional, List, Tuple, Dict
from dungeon_crawler import (
    Game, Tile, Direction, Difficulty, ItemType,
    MovementEngine, MovementResult, MoveOutcome,
    ITEM_NAMES, ITEM_COSTS, hash_seed
)
import os


# =============================================================================
# VISUAL THEME AND CONSTANTS
# =============================================================================

# Tile colors and symbols
TILE_CONFIG = {
    Tile.EMPTY: {'bg': '#2d2d2d', 'fg': '#555555', 'symbol': '·', 'name': 'Floor'},
    Tile.WALL: {'bg': '#1a1a2e', 'fg': '#4a4a6a', 'symbol': '█', 'name': 'Wall'},
    Tile.START: {'bg': '#1e5631', 'fg': '#90EE90', 'symbol': '⌂', 'name': 'Start'},
    Tile.STAIRS: {'bg': '#4a1e5c', 'fg': '#DDA0DD', 'symbol': '▼', 'name': 'Stairs'},
    Tile.COIN: {'bg': '#2d2d2d', 'fg': '#FFD700', 'symbol': '●', 'name': 'Coin'},
    Tile.CHEST: {'bg': '#2d2d2d', 'fg': '#CD853F', 'symbol': '◆', 'name': 'Chest'},
    Tile.HEART_UNKNOWN: {'bg': '#2d2d2d', 'fg': '#FF69B4', 'symbol': '♥', 'name': 'Heart'},
    Tile.ENEMY: {'bg': '#4a1a1a', 'fg': '#FF4444', 'symbol': '◈', 'name': 'Enemy'},
    Tile.WEB: {'bg': '#2d2d2d', 'fg': '#AAAAAA', 'symbol': '※', 'name': 'Web'},
    Tile.KEY: {'bg': '#2d2d2d', 'fg': '#FFD700', 'symbol': '⚷', 'name': 'Key'},
    Tile.LOCKED_DOOR: {'bg': '#5c4a1e', 'fg': '#8B4513', 'symbol': '▣', 'name': 'Locked Door'},
    Tile.PORTAL: {'bg': '#1e3a5c', 'fg': '#00BFFF', 'symbol': '◎', 'name': 'Portal'},
}

PLAYER_CONFIG = {'bg': '#2d2d2d', 'fg': '#00FF00', 'symbol': '@'}

# Direction key bindings
DIRECTION_KEYS = {
    'w': Direction.N, 'Up': Direction.N,
    's': Direction.S, 'Down': Direction.S,
    'a': Direction.W, 'Left': Direction.W,
    'd': Direction.E, 'Right': Direction.E,
    'q': Direction.NW,
    'e': Direction.NE,
    'z': Direction.SW,
    'c': Direction.SE,
}

# Colors
COLORS = {
    'bg_dark': '#1a1a1a',
    'bg_panel': '#252525',
    'bg_button': '#3a3a3a',
    'fg_text': '#ffffff',
    'fg_dim': '#888888',
    'accent': '#4a9eff',
    'hp_bar': '#ff4444',
    'hp_bar_bg': '#4a1a1a',
    'coin_color': '#ffd700',
    'key_color': '#ffd700',
    'success': '#44ff44',
    'warning': '#ffaa00',
    'danger': '#ff4444',
}


# =============================================================================
# MAIN GUI CLASS
# =============================================================================

class DungeonGUI:
    """Main GUI application for the dungeon crawler."""

    def __init__(self, master: tk.Tk):
        self.master = master
        self.master.title("Procedural Dungeon Crawler")
        self.master.configure(bg=COLORS['bg_dark'])
        self.master.resizable(True, True)

        # Game state
        self.game: Optional[Game] = None
        self.current_roll: Optional[int] = None
        self.allowed_directions: List[Direction] = []
        self.awaiting_direction: bool = False
        self.awaiting_direction_change: bool = False
        self.remaining_steps: int = 0
        self.current_direction: Optional[Direction] = None
        self.movement_outcomes: List[MoveOutcome] = []
        self.backtrack_allowed: bool = False  # True when trapped in corner

        # UI state
        self.cell_size = 32
        self.tile_labels: Dict[Tuple[int, int], tk.Label] = {}

        self._setup_styles()
        self._create_widgets()
        self._bind_keys()

        # Show start screen
        self._show_start_screen()

    def _setup_styles(self):
        """Configure ttk styles."""
        style = ttk.Style()
        style.theme_use('clam')

        style.configure('Dark.TFrame', background=COLORS['bg_dark'])
        style.configure('Panel.TFrame', background=COLORS['bg_panel'])
        style.configure('Dark.TLabel', background=COLORS['bg_dark'],
                       foreground=COLORS['fg_text'])
        style.configure('Panel.TLabel', background=COLORS['bg_panel'],
                       foreground=COLORS['fg_text'])
        style.configure('Title.TLabel', background=COLORS['bg_panel'],
                       foreground=COLORS['accent'], font=('Helvetica', 14, 'bold'))
        style.configure('Stat.TLabel', background=COLORS['bg_panel'],
                       foreground=COLORS['fg_text'], font=('Helvetica', 11))
        style.configure('Dark.TButton', background=COLORS['bg_button'],
                       foreground=COLORS['fg_text'])

    def _create_widgets(self):
        """Create all GUI widgets."""
        # Main container
        self.main_frame = ttk.Frame(self.master, style='Dark.TFrame')
        self.main_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        # Left panel - Game grid
        self.grid_frame = ttk.Frame(self.main_frame, style='Dark.TFrame')
        self.grid_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        # Grid canvas with scrollbars
        self.canvas_frame = ttk.Frame(self.grid_frame, style='Dark.TFrame')
        self.canvas_frame.pack(fill=tk.BOTH, expand=True)

        self.canvas = tk.Canvas(
            self.canvas_frame,
            bg=COLORS['bg_dark'],
            highlightthickness=0
        )
        self.canvas.pack(fill=tk.BOTH, expand=True)

        # Right panel - Stats and controls
        self.right_panel = ttk.Frame(self.main_frame, style='Panel.TFrame', width=320)
        self.right_panel.pack(side=tk.RIGHT, fill=tk.Y, padx=(10, 0))
        self.right_panel.pack_propagate(False)

        self._create_stats_panel()
        self._create_movement_panel()
        self._create_inventory_panel()
        self._create_log_panel()

    def _create_stats_panel(self):
        """Create the player stats panel."""
        stats_frame = ttk.LabelFrame(
            self.right_panel, text="Player Stats",
            style='Panel.TFrame', padding=10
        )
        stats_frame.pack(fill=tk.X, pady=(0, 10))

        # Floor indicator
        self.floor_label = ttk.Label(
            stats_frame, text="Floor: 1/100",
            style='Title.TLabel'
        )
        self.floor_label.pack(anchor=tk.W)

        # HP bar
        hp_frame = ttk.Frame(stats_frame, style='Panel.TFrame')
        hp_frame.pack(fill=tk.X, pady=(10, 5))

        ttk.Label(hp_frame, text="HP:", style='Stat.TLabel').pack(side=tk.LEFT)
        self.hp_label = ttk.Label(hp_frame, text="10/10", style='Stat.TLabel')
        self.hp_label.pack(side=tk.RIGHT)

        self.hp_bar_canvas = tk.Canvas(
            stats_frame, height=20, bg=COLORS['hp_bar_bg'],
            highlightthickness=1, highlightbackground='#444'
        )
        self.hp_bar_canvas.pack(fill=tk.X, pady=(0, 5))

        # Coins
        coins_frame = ttk.Frame(stats_frame, style='Panel.TFrame')
        coins_frame.pack(fill=tk.X, pady=2)
        ttk.Label(coins_frame, text="💰 Coins:", style='Stat.TLabel').pack(side=tk.LEFT)
        self.coins_label = ttk.Label(coins_frame, text="0", style='Stat.TLabel',
                                     foreground=COLORS['coin_color'])
        self.coins_label.pack(side=tk.RIGHT)

        # Keys
        keys_frame = ttk.Frame(stats_frame, style='Panel.TFrame')
        keys_frame.pack(fill=tk.X, pady=2)
        ttk.Label(keys_frame, text="🔑 Keys:", style='Stat.TLabel').pack(side=tk.LEFT)
        self.keys_label = ttk.Label(keys_frame, text="0", style='Stat.TLabel',
                                    foreground=COLORS['key_color'])
        self.keys_label.pack(side=tk.RIGHT)

        # Difficulty
        diff_frame = ttk.Frame(stats_frame, style='Panel.TFrame')
        diff_frame.pack(fill=tk.X, pady=2)
        ttk.Label(diff_frame, text="Difficulty:", style='Stat.TLabel').pack(side=tk.LEFT)
        self.diff_label = ttk.Label(diff_frame, text="Normal", style='Stat.TLabel')
        self.diff_label.pack(side=tk.RIGHT)

        # Save and Help buttons
        btn_row = ttk.Frame(stats_frame, style='Panel.TFrame')
        btn_row.pack(fill=tk.X, pady=(10, 0))

        tk.Button(
            btn_row, text="💾 Save",
            command=self._save_game,
            bg=COLORS['bg_button'], fg=COLORS['fg_text'],
            font=('Helvetica', 9),
            relief=tk.FLAT, padx=8, pady=3
        ).pack(side=tk.LEFT, padx=(0, 5))

        tk.Button(
            btn_row, text="❓ Help",
            command=self._show_help,
            bg=COLORS['bg_button'], fg=COLORS['fg_text'],
            font=('Helvetica', 9),
            relief=tk.FLAT, padx=8, pady=3
        ).pack(side=tk.LEFT, padx=(0, 5))

        tk.Button(
            btn_row, text="🔄 New",
            command=lambda: self._show_start_screen(show_splash=False),
            bg=COLORS['bg_button'], fg=COLORS['fg_text'],
            font=('Helvetica', 9),
            relief=tk.FLAT, padx=8, pady=3
        ).pack(side=tk.LEFT)

    def _create_movement_panel(self):
        """Create movement controls panel."""
        move_frame = ttk.LabelFrame(
            self.right_panel, text="Movement",
            style='Panel.TFrame', padding=10
        )
        move_frame.pack(fill=tk.X, pady=(0, 10))

        # Roll display
        roll_frame = ttk.Frame(move_frame, style='Panel.TFrame')
        roll_frame.pack(fill=tk.X, pady=(0, 10))

        self.roll_label = ttk.Label(
            roll_frame, text="Roll: -",
            style='Title.TLabel', font=('Helvetica', 16, 'bold')
        )
        self.roll_label.pack()

        self.parity_label = ttk.Label(
            roll_frame, text="",
            style='Stat.TLabel', foreground=COLORS['fg_dim']
        )
        self.parity_label.pack()

        # Roll button
        self.roll_button = tk.Button(
            move_frame, text="🎲 Roll Die",
            command=self._on_roll,
            bg=COLORS['accent'], fg='white',
            font=('Helvetica', 11, 'bold'),
            relief=tk.FLAT, padx=20, pady=8
        )
        self.roll_button.pack(fill=tk.X, pady=(0, 10))

        # Direction buttons grid
        dir_frame = ttk.Frame(move_frame, style='Panel.TFrame')
        dir_frame.pack()

        # Direction button layout
        dir_buttons = [
            ('NW', 0, 0, Direction.NW), ('N', 0, 1, Direction.N), ('NE', 0, 2, Direction.NE),
            ('W', 1, 0, Direction.W), ('·', 1, 1, None), ('E', 1, 2, Direction.E),
            ('SW', 2, 0, Direction.SW), ('S', 2, 1, Direction.S), ('SE', 2, 2, Direction.SE),
        ]

        self.direction_buttons: Dict[Direction, tk.Button] = {}
        for text, row, col, direction in dir_buttons:
            btn = tk.Button(
                dir_frame, text=text, width=4, height=2,
                bg=COLORS['bg_button'], fg=COLORS['fg_text'],
                relief=tk.FLAT,
                command=lambda d=direction: self._on_direction(d) if d else None,
                state=tk.DISABLED if direction else tk.NORMAL
            )
            btn.grid(row=row, column=col, padx=2, pady=2)
            if direction:
                self.direction_buttons[direction] = btn

        # Status label
        self.status_label = ttk.Label(
            move_frame, text="Press Roll to start turn",
            style='Stat.TLabel', wraplength=240
        )
        self.status_label.pack(pady=(10, 0))

    def _create_inventory_panel(self):
        """Create inventory panel."""
        inv_frame = ttk.LabelFrame(
            self.right_panel, text="Inventory",
            style='Panel.TFrame', padding=10
        )
        inv_frame.pack(fill=tk.X, pady=(0, 10))

        self.inventory_listbox = tk.Listbox(
            inv_frame, height=5,
            bg=COLORS['bg_dark'], fg=COLORS['fg_text'],
            selectbackground=COLORS['accent'],
            highlightthickness=0, relief=tk.FLAT
        )
        self.inventory_listbox.pack(fill=tk.X)

        # Item use buttons
        btn_frame = ttk.Frame(inv_frame, style='Panel.TFrame')
        btn_frame.pack(fill=tk.X, pady=(5, 0))

        self.use_item_btn = tk.Button(
            btn_frame, text="Use Item",
            command=self._use_selected_item,
            bg=COLORS['bg_button'], fg=COLORS['fg_text'],
            relief=tk.FLAT
        )
        self.use_item_btn.pack(fill=tk.X)

    def _create_log_panel(self):
        """Create game log panel."""
        log_frame = ttk.LabelFrame(
            self.right_panel, text="Game Log",
            style='Panel.TFrame', padding=5
        )
        log_frame.pack(fill=tk.BOTH, expand=True)

        self.log_text = tk.Text(
            log_frame, height=8, width=30,
            bg=COLORS['bg_dark'], fg=COLORS['fg_dim'],
            font=('Consolas', 9), wrap=tk.WORD,
            highlightthickness=0, relief=tk.FLAT
        )
        self.log_text.pack(fill=tk.BOTH, expand=True)
        self.log_text.config(state=tk.DISABLED)

    def _bind_keys(self):
        """Bind keyboard shortcuts."""
        self.master.bind('<Key>', self._on_key_press)
        self.master.bind('<space>', lambda e: self._on_roll())
        self.master.bind('<Return>', lambda e: self._on_roll())

    def _log(self, message: str, tag: str = None):
        """Add message to game log."""
        self.log_text.config(state=tk.NORMAL)
        self.log_text.insert(tk.END, message + '\n')
        self.log_text.see(tk.END)
        self.log_text.config(state=tk.DISABLED)

    def _clear_log(self):
        """Clear the game log."""
        self.log_text.config(state=tk.NORMAL)
        self.log_text.delete(1.0, tk.END)
        self.log_text.config(state=tk.DISABLED)

    # =========================================================================
    # GAME INITIALIZATION
    # =========================================================================

    def _show_start_screen(self, show_splash: bool = True):
        """Show the game start dialog."""
        # Show splash/help screen on first launch
        if show_splash:
            splash = HelpDialog(self.master, show_continue=True)
            self.master.wait_window(splash)

        dialog = StartGameDialog(self.master)
        self.master.wait_window(dialog)

        if dialog.load_result:
            # Load saved game
            loaded_game = Game.load_game(dialog.load_result)
            if loaded_game:
                self.game = loaded_game
                self._log(f"Loaded game from floor {self.game.state.current_floor}")
                self._log(f"HP: {self.game.player.hp}/{self.game.player.max_hp}")
                self._log(f"Coins: {self.game.player.coins}")
                self._update_display()
            else:
                messagebox.showerror("Load Error", "Failed to load save file!")
                self._show_start_screen(show_splash=False)
        elif dialog.result:
            seed, difficulty = dialog.result
            self._start_game(seed, difficulty)
        else:
            self.master.quit()

    def _start_game(self, seed: int, difficulty: Difficulty):
        """Initialize and start a new game."""
        self.game = Game(master_seed=seed, difficulty=difficulty)
        self.game.start_game()

        self._log(f"Game started! Seed: {seed}")
        self._log(f"Difficulty: {difficulty.name}")
        self._log(f"Shop floors: {self.game.shop_floors[:5]}...")

        self._update_display()

    def _save_game(self):
        """Save the current game state."""
        if not self.game:
            return

        save_path = Game.get_default_save_path()
        if self.game.save_game(save_path):
            self._log(f"Game saved! Floor {self.game.state.current_floor}")
            messagebox.showinfo("Saved", f"Game saved successfully!\nFloor: {self.game.state.current_floor}")
        else:
            self._log("Failed to save game!")
            messagebox.showerror("Save Error", "Failed to save game!")

    def _show_help(self):
        """Show the help dialog."""
        help_dialog = HelpDialog(self.master, show_continue=False)
        self.master.wait_window(help_dialog)

    # =========================================================================
    # DISPLAY UPDATES
    # =========================================================================

    def _update_display(self):
        """Update all display elements."""
        if not self.game:
            return

        self._update_stats()
        self._update_inventory()

        if self.game.is_shop_floor():
            self._show_shop_screen()
        else:
            self._render_grid()

    def _update_stats(self):
        """Update stats panel."""
        player = self.game.player

        self.floor_label.config(text=f"Floor: {self.game.state.current_floor}/100")
        self.hp_label.config(text=f"{player.hp}/{player.max_hp}")
        self.coins_label.config(text=str(player.coins))
        self.keys_label.config(text=str(player.keys))
        self.diff_label.config(text=self.game.difficulty.name)

        # Update HP bar
        self.hp_bar_canvas.delete('all')
        width = self.hp_bar_canvas.winfo_width()
        if width > 1:
            hp_ratio = player.hp / player.max_hp
            bar_width = int(width * hp_ratio)
            color = COLORS['hp_bar'] if hp_ratio > 0.3 else COLORS['danger']
            self.hp_bar_canvas.create_rectangle(
                0, 0, bar_width, 20, fill=color, outline=''
            )

    def _update_inventory(self):
        """Update inventory listbox."""
        self.inventory_listbox.delete(0, tk.END)
        for item in self.game.player.inventory:
            self.inventory_listbox.insert(tk.END, ITEM_NAMES[item])

    def _render_grid(self):
        """Render the dungeon grid on canvas."""
        if not self.game or not self.game.state.current_level:
            return

        level = self.game.state.current_level
        player = self.game.player

        # Clear canvas
        self.canvas.delete('all')

        # Calculate cell size based on canvas size
        canvas_width = self.canvas.winfo_width()
        canvas_height = self.canvas.winfo_height()

        if canvas_width < 10 or canvas_height < 10:
            # Canvas not yet sized, schedule redraw
            self.master.after(100, self._render_grid)
            return

        cell_w = canvas_width // level.width
        cell_h = canvas_height // level.height
        self.cell_size = min(cell_w, cell_h, 40)

        # Center the grid
        grid_width = self.cell_size * level.width
        grid_height = self.cell_size * level.height
        offset_x = (canvas_width - grid_width) // 2
        offset_y = (canvas_height - grid_height) // 2

        # Draw tiles
        for y in range(level.height):
            for x in range(level.width):
                cell = level.get_cell(x, y)
                config = TILE_CONFIG.get(cell.tile, TILE_CONFIG[Tile.EMPTY])

                x1 = offset_x + x * self.cell_size
                y1 = offset_y + y * self.cell_size
                x2 = x1 + self.cell_size
                y2 = y1 + self.cell_size

                # Draw cell background
                self.canvas.create_rectangle(
                    x1, y1, x2, y2,
                    fill=config['bg'],
                    outline='#333333',
                    width=1
                )

                # Draw symbol
                cx = x1 + self.cell_size // 2
                cy = y1 + self.cell_size // 2

                # Check if player is here
                if (x, y) == (player.x, player.y):
                    symbol = PLAYER_CONFIG['symbol']
                    fg = PLAYER_CONFIG['fg']
                    # Draw player highlight
                    self.canvas.create_rectangle(
                        x1 + 2, y1 + 2, x2 - 2, y2 - 2,
                        fill='#004400', outline=PLAYER_CONFIG['fg'], width=2
                    )
                else:
                    symbol = config['symbol']
                    fg = config['fg']

                font_size = max(12, self.cell_size // 2)
                self.canvas.create_text(
                    cx, cy, text=symbol,
                    fill=fg, font=('Segoe UI Symbol', font_size)
                )

        # Draw legend
        self._draw_legend(offset_x, offset_y + grid_height + 10)

    def _draw_legend(self, x: int, y: int):
        """Draw tile legend below grid."""
        legend_items = [
            (Tile.COIN, "Coin"), (Tile.CHEST, "Chest"), (Tile.HEART_UNKNOWN, "Heart"),
            (Tile.ENEMY, "Enemy"), (Tile.KEY, "Key"), (Tile.LOCKED_DOOR, "Door"),
            (Tile.PORTAL, "Portal"), (Tile.WEB, "Web"), (Tile.STAIRS, "Stairs")
        ]

        col = 0
        for tile, name in legend_items:
            config = TILE_CONFIG[tile]
            lx = x + col * 70
            self.canvas.create_text(
                lx, y, text=f"{config['symbol']} {name}",
                fill=config['fg'], font=('Consolas', 9), anchor=tk.W
            )
            col += 1
            if col >= 5:
                col = 0
                y += 15

    # =========================================================================
    # MOVEMENT HANDLING
    # =========================================================================

    def _on_roll(self):
        """Handle roll button click."""
        if not self.game or self.game.is_shop_floor():
            return

        if self.awaiting_direction or self.awaiting_direction_change:
            return

        # Start new turn
        self.game.start_turn()
        self.current_roll = self.game.roll_movement_die()

        # Apply half movement if needed
        effective = self.current_roll
        if self.game.player.half_next_roll:
            effective = self.current_roll // 2
            self._log(f"Web effect! Roll {self.current_roll} → {effective}")
            self.game.player.half_next_roll = False

        self.remaining_steps = effective
        self.allowed_directions = self.game.movement_engine.get_allowed_directions(self.current_roll)

        # Update display
        self.roll_label.config(text=f"Roll: {self.current_roll}")

        if self.current_roll % 2 == 0:
            parity_text = "Orthogonal (N/S/E/W)"
        else:
            parity_text = "Diagonal (NE/NW/SE/SW)"

        if self.game.player.compass_active:
            parity_text = "Any direction (Compass)"

        self.parity_label.config(text=parity_text)

        # Enable valid direction buttons
        self._update_direction_buttons()

        # Check if any legal moves exist
        legal = self.game.movement_engine.get_legal_directions(self.allowed_directions, allow_backtrack=False)
        if not legal:
            self._log("No legal moves available! Turn skipped.")
            self._finish_turn()
            return

        self.awaiting_direction = True
        self.status_label.config(text=f"Choose direction ({self.remaining_steps} steps)")
        self._log(f"Rolled {self.current_roll} - {parity_text}")

    def _update_direction_buttons(self, legal: List[Direction] = None):
        """Enable/disable direction buttons based on allowed directions."""
        if legal is None:
            legal = self.game.movement_engine.get_legal_directions(
                self.allowed_directions, allow_backtrack=False
            )

        for direction, btn in self.direction_buttons.items():
            if direction in legal:
                btn.config(
                    state=tk.NORMAL,
                    bg=COLORS['accent'] if direction in self.allowed_directions else COLORS['bg_button']
                )
            else:
                btn.config(state=tk.DISABLED, bg=COLORS['bg_button'])

    def _on_direction(self, direction: Direction):
        """Handle direction button click."""
        if not self.awaiting_direction and not self.awaiting_direction_change:
            return

        # Double-check direction is actually legal (safeguard)
        excluded = None
        allow_backtrack = False

        if self.awaiting_direction_change and self.current_direction:
            # When changing direction after wall, check if backtracking was allowed
            allow_backtrack = getattr(self, 'backtrack_allowed', False)
            if not allow_backtrack:
                excluded = {self.current_direction.reverse()}

        legal = self.game.movement_engine.get_legal_directions(
            self.allowed_directions, excluded=excluded, allow_backtrack=allow_backtrack
        )

        if direction not in legal:
            self._log(f"Direction {direction.name} not legal!")
            return

        if self.awaiting_direction:
            # Starting movement
            self.current_direction = direction
            self._execute_movement()
        elif self.awaiting_direction_change:
            # Changing direction after wall hit
            self.current_direction = direction
            self.awaiting_direction_change = False
            self.backtrack_allowed = False  # Reset for next wall hit
            self._continue_movement()

    def _execute_movement(self):
        """Execute the full movement for this turn."""
        self.awaiting_direction = False
        self.movement_outcomes = []

        self._continue_movement()

    def _continue_movement(self):
        """Continue movement step by step with animation."""
        if self.remaining_steps <= 0:
            self._finish_turn()
            return

        # Execute one step
        outcome = self.game.movement_engine.execute_step(self.current_direction)
        self.movement_outcomes.append(outcome)

        # Log effects
        self._log_outcome(outcome)

        # Update display
        self._render_grid()
        self._update_stats()
        self._update_inventory()

        # Check result
        if outcome.result == MovementResult.PLAYER_DIED:
            self._game_over()
            return

        if outcome.result == MovementResult.REACHED_STAIRS:
            self._complete_floor()
            return

        if outcome.result == MovementResult.WEB_STOPPED:
            self._log("Caught in web! Turn ends.")
            self._finish_turn()
            return

        if outcome.result == MovementResult.BLOCKED:
            # Need to choose new direction
            self._log("Hit a wall!")
            self.allowed_directions = self.game.movement_engine.get_allowed_directions(self.current_roll)
            # Don't allow backtracking (moving onto tiles already visited this turn)
            reverse_dir = self.current_direction.reverse()
            legal = self.game.movement_engine.get_legal_directions(
                self.allowed_directions,
                {reverse_dir},
                allow_backtrack=False
            )

            # Debug logging
            self._log(f"Path: {self.game.player.path_this_turn}")
            self._log(f"Legal: {[d.name for d in legal]} (excl {reverse_dir.name})")

            # Track if we're allowing backtracking as last resort
            self.backtrack_allowed = False

            if not legal:
                # Allow backtracking only as last resort (trapped in corner)
                legal = self.game.movement_engine.get_legal_directions(
                    self.allowed_directions, excluded=None, allow_backtrack=True
                )
                if not legal:
                    self._log("No valid moves. Turn ends.")
                    self._finish_turn()
                    return
                else:
                    self._log("Trapped! Backtracking allowed.")
                    self.backtrack_allowed = True

            self._update_direction_buttons(legal)
            self.awaiting_direction_change = True
            self.status_label.config(text=f"Choose new direction ({self.remaining_steps} steps)")
            return

        # Successful step
        self.remaining_steps -= 1

        if self.remaining_steps > 0:
            # Animate delay then continue
            self.master.after(150, self._continue_movement)
        else:
            self._finish_turn()

    def _log_outcome(self, outcome: MoveOutcome):
        """Log movement outcome effects."""
        effects = []
        if outcome.smoke_bomb_used:
            effects.append("Smoke Bomb blocked enemy!")
        if outcome.coins_gained:
            effects.append(f"+{outcome.coins_gained} coins")
        if outcome.coins_lost:
            effects.append(f"-{outcome.coins_lost} coins")
        if outcome.hp_healed:
            effects.append(f"+{outcome.hp_healed} HP")
        if outcome.damage_taken:
            effects.append(f"-{outcome.damage_taken} HP")
        if outcome.keys_gained:
            effects.append(f"+{outcome.keys_gained} key")
        if outcome.keys_used:
            effects.append(f"used 1 key")
        if outcome.portal_teleported:
            effects.append(f"teleported!")

        if effects:
            self._log(", ".join(effects))

    def _finish_turn(self):
        """Finish the current turn."""
        self.awaiting_direction = False
        self.awaiting_direction_change = False
        self.current_roll = None
        self.remaining_steps = 0

        # Disable direction buttons
        for btn in self.direction_buttons.values():
            btn.config(state=tk.DISABLED, bg=COLORS['bg_button'])

        self.roll_label.config(text="Roll: -")
        self.parity_label.config(text="")
        self.status_label.config(text="Press Roll to start turn")

        # Check if on web and exited (only if we're still on a normal floor)
        level = self.game.state.current_level
        if level:
            start_pos = self.game.player.path_this_turn[0] if self.game.player.path_this_turn else None
            if start_pos:
                cell = level.get_cell(*start_pos)
                if cell and cell.tile == Tile.WEB and self.game.player.pos != start_pos:
                    level.set_tile(start_pos[0], start_pos[1], Tile.EMPTY)
                    self._log("Escaped the web!")
                    self._render_grid()

    def _complete_floor(self):
        """Complete the current floor."""
        self._log(f"Completed floor {self.game.state.current_floor}!")

        if self.game.state.current_floor >= 100:
            self._victory()
            return

        self.game.advance_to_floor(self.game.state.current_floor + 1)

        # Reset turn state (don't call _finish_turn as level changed)
        self.awaiting_direction = False
        self.awaiting_direction_change = False
        self.current_roll = None
        self.remaining_steps = 0

        for btn in self.direction_buttons.values():
            btn.config(state=tk.DISABLED, bg=COLORS['bg_button'])

        self.roll_label.config(text="Roll: -")
        self.parity_label.config(text="")
        self.status_label.config(text="Press Roll to start turn")

        self._update_display()

    def _game_over(self):
        """Handle game over."""
        self._log("YOU DIED!")
        messagebox.showinfo(
            "Game Over",
            f"You died on floor {self.game.state.current_floor}!\n"
            f"Final coins: {self.game.player.coins}"
        )
        self._show_start_screen()

    def _victory(self):
        """Handle victory."""
        self._log("VICTORY!")
        messagebox.showinfo(
            "Victory!",
            f"You conquered all 100 floors!\n"
            f"Final coins: {self.game.player.coins}"
        )
        self._show_start_screen()

    # =========================================================================
    # SHOP HANDLING
    # =========================================================================

    def _show_shop_screen(self):
        """Show shop interface."""
        self.canvas.delete('all')

        # Draw shop title
        self.canvas.create_text(
            self.canvas.winfo_width() // 2, 50,
            text=f"🏪 SHOP - Floor {self.game.state.current_floor}",
            fill=COLORS['accent'], font=('Helvetica', 24, 'bold')
        )

        self.canvas.create_text(
            self.canvas.winfo_width() // 2, 90,
            text=f"Your coins: {self.game.player.coins}",
            fill=COLORS['coin_color'], font=('Helvetica', 14)
        )

        shop = self.game.state.current_shop
        y = 140

        # Draw items (keep positions fixed, mark purchased items)
        for i, item in enumerate(shop.inventory):
            price = ITEM_COSTS[item]
            name = ITEM_NAMES[item]
            is_purchased = shop.purchased[i] if i < len(shop.purchased) else False
            can_afford = self.game.player.coins >= price

            if is_purchased:
                # Show purchased items as struck through / grayed
                display_text = f"{i+1}. {name} - SOLD"
                color = COLORS['fg_dim']
            elif can_afford:
                display_text = f"{i+1}. {name} - {price} coins"
                color = COLORS['fg_text']
            else:
                display_text = f"{i+1}. {name} - {price} coins"
                color = COLORS['fg_dim']

            self.canvas.create_text(
                self.canvas.winfo_width() // 2, y,
                text=display_text,
                fill=color, font=('Helvetica', 12)
            )
            y += 30

        # Instructions
        y += 30
        self.canvas.create_text(
            self.canvas.winfo_width() // 2, y,
            text="Press 1-4 to buy, G to gamble, L to leave",
            fill=COLORS['fg_dim'], font=('Helvetica', 11)
        )

        # Update status
        self.status_label.config(text="Shop - Press keys to interact")
        self.roll_button.config(state=tk.DISABLED)

    def _on_key_press(self, event):
        """Handle key press events."""
        if not self.game:
            return

        key = event.keysym

        if self.game.is_shop_floor():
            self._handle_shop_key(key)
        else:
            self._handle_game_key(key)

    def _handle_shop_key(self, key: str):
        """Handle key press in shop."""
        shop = self.game.state.current_shop

        if key in '1234':
            idx = int(key) - 1
            if idx < len(shop.inventory):
                # Check if already purchased
                if not shop.is_available(idx):
                    self._log("Already purchased!")
                    return
                item = shop.inventory[idx]
                price = ITEM_COSTS[item]
                if self.game.player.coins < price:
                    self._log("Not enough coins!")
                    return
                if self.game.buy_item_by_index(idx):
                    self._log(f"Bought {ITEM_NAMES[item]}!")
                    self._update_display()

        elif key.lower() == 'g':
            # Gamble dialog
            choice = simpledialog.askstring(
                "Gamble",
                "Choose 'high' (5-6 wins) or 'low' (1-2 wins):",
                parent=self.master
            )
            if choice and choice.lower() in ('high', 'low'):
                won, change = self.game.gamble(choice.lower())
                if won:
                    self._log(f"Won {change} coins!")
                else:
                    self._log(f"Lost {-change} coins!")
                self._update_display()

        elif key.lower() == 'l':
            self.game.leave_shop()
            self._log(f"Left shop. Now on floor {self.game.state.current_floor}")
            self.roll_button.config(state=tk.NORMAL)
            self._update_display()

    def _handle_game_key(self, key: str):
        """Handle key press during normal gameplay."""
        # Direction keys
        if key in DIRECTION_KEYS:
            direction = DIRECTION_KEYS[key]
            if self.awaiting_direction or self.awaiting_direction_change:
                # Check if direction is actually legal (includes backtracking check)
                excluded = None
                allow_backtrack = False

                if self.awaiting_direction_change and self.current_direction:
                    # Check if backtracking was allowed as last resort
                    allow_backtrack = getattr(self, 'backtrack_allowed', False)
                    if not allow_backtrack:
                        excluded = {self.current_direction.reverse()}

                legal = self.game.movement_engine.get_legal_directions(
                    self.allowed_directions, excluded=excluded, allow_backtrack=allow_backtrack
                )
                if direction in legal:
                    self._on_direction(direction)

    def _use_selected_item(self):
        """Use the selected inventory item."""
        selection = self.inventory_listbox.curselection()
        if not selection:
            return

        idx = selection[0]
        if idx >= len(self.game.player.inventory):
            return

        item = self.game.player.inventory[idx]

        # Handle different item types
        if item == ItemType.COMPASS_OF_TRUE_NORTH:
            if not self.awaiting_direction:
                self._log("Use Compass after rolling!")
                return
            if self.game.use_compass():
                self._log("Compass activated - any direction allowed!")
                # Update allowed directions now that compass is active
                self.allowed_directions = self.game.movement_engine.get_allowed_directions(self.current_roll)
                self._update_direction_buttons()
                self._update_inventory()

        elif item == ItemType.LOADED_DICE:
            if self.awaiting_direction:
                self._log("Use Loaded Dice before rolling!")
                return
            value = simpledialog.askinteger(
                "Loaded Dice",
                "Choose die result (1-6):",
                parent=self.master, minvalue=1, maxvalue=6
            )
            if value and self.game.use_loaded_dice(value):
                self._log(f"Loaded Dice set to {value}!")
                self._update_inventory()

        elif item == ItemType.PARITY_FLIP:
            if not self.awaiting_direction:
                self._log("Use Parity Flip after rolling!")
                return
            if self.game.use_parity_flip():
                self._log("Parity flipped!")
                self.allowed_directions = self.game.movement_engine.get_allowed_directions(self.current_roll)
                parity_text = "Diagonal (flipped)" if self.current_roll % 2 == 0 else "Orthogonal (flipped)"
                self.parity_label.config(text=parity_text)
                self._update_direction_buttons()
                self._update_inventory()

        elif item == ItemType.LUCKY_CHARM:
            if not self.awaiting_direction or self.current_roll is None:
                self._log("Use Lucky Charm after rolling!")
                return
            adj = simpledialog.askinteger(
                "Lucky Charm",
                "Adjust roll by +1 or -1:",
                parent=self.master, minvalue=-1, maxvalue=1
            )
            if adj in (-1, 1):
                new_roll = self.game.apply_lucky_charm(self.current_roll, adj)
                self.current_roll = new_roll
                self.roll_label.config(text=f"Roll: {self.current_roll}")
                self.allowed_directions = self.game.movement_engine.get_allowed_directions(self.current_roll)
                parity_text = "Orthogonal" if self.current_roll % 2 == 0 else "Diagonal"
                self.parity_label.config(text=parity_text)
                self._log(f"Roll adjusted to {self.current_roll}")
                self._update_direction_buttons()
                self._update_inventory()

        else:
            self._log(f"{ITEM_NAMES[item]} used automatically during play")


# =============================================================================
# HELP / SPLASH SCREEN DIALOG
# =============================================================================

class HelpDialog(tk.Toplevel):
    """Dialog showing game instructions and tile explanations."""

    HELP_TEXT = """
╔══════════════════════════════════════════════════════════════╗
║           PROCEDURAL DUNGEON CRAWLER - HELP                  ║
╚══════════════════════════════════════════════════════════════╝

═══ OBJECTIVE ═══
Navigate through 100 procedurally-generated dungeon floors.
Reach the stairs (▼) on each floor to advance.

═══ MOVEMENT ═══
Each turn, roll a die (1-6) to determine movement:

  • EVEN rolls (2, 4, 6): Move ORTHOGONALLY
    Use N, S, E, W directions only

  • ODD rolls (1, 3, 5): Move DIAGONALLY
    Use NE, NW, SE, SW directions only

The roll number = how many tiles you must move.
You cannot backtrack over tiles visited this turn.
If you hit a wall, choose a new valid direction.

═══ CONTROLS ═══
  Keyboard:
    W / ↑     = North          Q = Northwest    E = Northeast
    A / ←     = West           Z = Southwest    C = Southeast
    S / ↓     = South
    D / →     = East
    Space/Enter = Roll Die

═══ TILES ═══
  ●  Coin      - Collect for currency (+1 coin)
  ◆  Chest     - Open for coins (roll d6 for amount)
  ♥  Heart     - Heal HP (roll d6 for amount, up to max 32)
  ◈  Enemy     - Takes damage when passed (damage = difficulty)
  ⚷  Key       - Collect to open locked doors
  ▣  Door      - Requires a key to pass through
  ◎  Portal    - Teleport to linked portal (once per turn)
  ※  Web       - Lose coins, next move halved, turn ends
  ▼  Stairs    - Advance to next floor

═══ DIFFICULTY ═══
  Easy    - Enemies deal 2 damage
  Normal  - Enemies deal 4 damage
  Hard    - Enemies deal 8 damage
  Demonic - Enemies deal 10 damage

═══ SHOP FLOORS ═══
Every 7-10 floors is a shop where you can:
  • Buy items with coins
  • Gamble (high/low) for more coins
  • Press 1-4 to buy, G to gamble, L to leave

═══ ITEMS ═══
  Compass of True North - Ignore parity, any direction allowed
  Anchor Stone          - Stop movement early
  Smoke Bomb            - Negate one enemy attack
  Loaded Dice           - Choose your next roll (1-6)
  Lucky Charm           - Adjust roll by +1 or -1
  Lockpick              - Open a locked door without a key
  Parity Flip           - Swap odd/even direction rules

═══ TIPS ═══
  • Collect hearts to build HP above starting 10 (max 32)
  • Plan your route to avoid enemies when low on HP
  • Save your game when you reach a new floor!
  • Keys are precious - there's exactly one per door
"""

    def __init__(self, parent, show_continue: bool = True):
        super().__init__(parent)
        self.title("How to Play")
        self.result = None

        self.configure(bg=COLORS['bg_panel'])
        self.transient(parent)
        self.grab_set()

        # Make it larger for the help text
        self.geometry("680x600")

        # Title
        title_frame = tk.Frame(self, bg=COLORS['bg_dark'])
        title_frame.pack(fill=tk.X, pady=(0, 10))

        tk.Label(
            title_frame, text="⚔ DUNGEON CRAWLER ⚔",
            bg=COLORS['bg_dark'], fg=COLORS['accent'],
            font=('Helvetica', 20, 'bold')
        ).pack(pady=15)

        # Scrollable text area
        text_frame = tk.Frame(self, bg=COLORS['bg_panel'])
        text_frame.pack(fill=tk.BOTH, expand=True, padx=10)

        scrollbar = tk.Scrollbar(text_frame)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        self.help_text = tk.Text(
            text_frame,
            bg=COLORS['bg_dark'],
            fg=COLORS['fg_text'],
            font=('Consolas', 10),
            wrap=tk.WORD,
            yscrollcommand=scrollbar.set,
            highlightthickness=0,
            relief=tk.FLAT,
            padx=10,
            pady=10
        )
        self.help_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.config(command=self.help_text.yview)

        # Insert help text
        self.help_text.insert(tk.END, self.HELP_TEXT)
        self.help_text.config(state=tk.DISABLED)

        # Button frame
        btn_frame = tk.Frame(self, bg=COLORS['bg_panel'])
        btn_frame.pack(fill=tk.X, pady=15)

        btn_text = "Continue" if show_continue else "Close"
        tk.Button(
            btn_frame, text=btn_text,
            command=self._on_close,
            bg=COLORS['accent'], fg='white',
            font=('Helvetica', 12, 'bold'),
            relief=tk.FLAT, padx=30, pady=10
        ).pack()

        self.bind('<Return>', lambda e: self._on_close())
        self.bind('<Escape>', lambda e: self._on_close())

    def _on_close(self):
        self.result = True
        self.destroy()


# =============================================================================
# START GAME DIALOG
# =============================================================================

class StartGameDialog(tk.Toplevel):
    """Dialog for starting a new game."""

    def __init__(self, parent):
        super().__init__(parent)
        self.title("Dungeon Crawler")
        self.result = None
        self.load_result = None  # For loading saved games

        self.configure(bg=COLORS['bg_panel'])
        self.transient(parent)
        self.grab_set()

        # Center on parent
        self.geometry("320x380")

        # Title
        tk.Label(
            self, text="⚔ Dungeon Crawler ⚔",
            bg=COLORS['bg_panel'], fg=COLORS['accent'],
            font=('Helvetica', 18, 'bold')
        ).pack(pady=(20, 5))

        tk.Label(
            self, text="100 Floors of Procedural Adventure",
            bg=COLORS['bg_panel'], fg=COLORS['fg_dim'],
            font=('Helvetica', 9, 'italic')
        ).pack(pady=(0, 15))

        # New Game section
        new_frame = tk.LabelFrame(
            self, text="New Game",
            bg=COLORS['bg_panel'], fg=COLORS['fg_text'],
            font=('Helvetica', 10)
        )
        new_frame.pack(fill=tk.X, padx=20, pady=5)

        # Seed input
        seed_frame = tk.Frame(new_frame, bg=COLORS['bg_panel'])
        seed_frame.pack(fill=tk.X, padx=10, pady=5)

        tk.Label(
            seed_frame, text="Seed:",
            bg=COLORS['bg_panel'], fg=COLORS['fg_text']
        ).pack(side=tk.LEFT)

        self.seed_entry = tk.Entry(seed_frame, width=15)
        self.seed_entry.insert(0, "12345")
        self.seed_entry.pack(side=tk.RIGHT)

        # Difficulty selection
        tk.Label(
            new_frame, text="Difficulty:",
            bg=COLORS['bg_panel'], fg=COLORS['fg_text']
        ).pack(pady=(5, 0))

        self.difficulty_var = tk.StringVar(value="NORMAL")
        difficulties = [("Easy", "EASY"), ("Normal", "NORMAL"),
                       ("Hard", "HARD"), ("Demonic", "DEMONIC")]

        diff_frame = tk.Frame(new_frame, bg=COLORS['bg_panel'])
        diff_frame.pack(pady=5)

        for text, value in difficulties:
            tk.Radiobutton(
                diff_frame, text=text, variable=self.difficulty_var,
                value=value, bg=COLORS['bg_panel'], fg=COLORS['fg_text'],
                selectcolor=COLORS['bg_dark'], activebackground=COLORS['bg_panel']
            ).pack(side=tk.LEFT, padx=3)

        # Start button
        tk.Button(
            new_frame, text="Start New Game",
            command=self._on_start,
            bg=COLORS['accent'], fg='white',
            font=('Helvetica', 10, 'bold'),
            relief=tk.FLAT, padx=15, pady=6
        ).pack(pady=10)

        # Load Game section
        load_frame = tk.Frame(self, bg=COLORS['bg_panel'])
        load_frame.pack(fill=tk.X, padx=20, pady=10)

        # Check if save file exists
        self.save_path = Game.get_default_save_path()
        save_exists = os.path.exists(self.save_path)

        load_btn = tk.Button(
            load_frame, text="Load Saved Game",
            command=self._on_load,
            bg=COLORS['bg_button'] if save_exists else COLORS['bg_dark'],
            fg=COLORS['fg_text'] if save_exists else COLORS['fg_dim'],
            font=('Helvetica', 10),
            relief=tk.FLAT, padx=15, pady=6,
            state=tk.NORMAL if save_exists else tk.DISABLED
        )
        load_btn.pack(fill=tk.X)

        if save_exists:
            # Show save info
            try:
                import json
                with open(self.save_path, 'r') as f:
                    save_data = json.load(f)
                info_text = f"Floor {save_data['current_floor']} | {save_data['difficulty']} | HP: {save_data['player']['hp']}"
                tk.Label(
                    load_frame, text=info_text,
                    bg=COLORS['bg_panel'], fg=COLORS['fg_dim'],
                    font=('Helvetica', 8)
                ).pack(pady=(2, 0))
            except:
                pass

        # Help button
        tk.Button(
            self, text="How to Play",
            command=self._show_help,
            bg=COLORS['bg_button'], fg=COLORS['fg_text'],
            font=('Helvetica', 10),
            relief=tk.FLAT, padx=15, pady=6
        ).pack(pady=10)

        # Focus on seed entry
        self.seed_entry.focus_set()
        self.bind('<Return>', lambda e: self._on_start())

    def _on_start(self):
        """Handle start button click."""
        seed_text = self.seed_entry.get().strip()
        try:
            seed = int(seed_text)
        except ValueError:
            seed = hash_seed(seed_text)

        difficulty = Difficulty[self.difficulty_var.get()]
        self.result = (seed, difficulty)
        self.destroy()

    def _on_load(self):
        """Handle load game button click."""
        self.load_result = self.save_path
        self.destroy()

    def _show_help(self):
        """Show the help dialog."""
        help_dialog = HelpDialog(self, show_continue=True)
        self.wait_window(help_dialog)


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

def main():
    """Launch the GUI application."""
    root = tk.Tk()
    root.geometry("1200x800")
    root.minsize(1000, 700)

    app = DungeonGUI(root)

    # Handle window close
    root.protocol("WM_DELETE_WINDOW", root.quit)

    root.mainloop()


if __name__ == "__main__":
    main()
