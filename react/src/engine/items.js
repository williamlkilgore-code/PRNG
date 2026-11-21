/* Equipment: one weapon and one armor. The player stores the index into
 * these lists; a higher index is always better. */

// hit: bonus to hit; die: damage die (plus STR).
export const WEAPONS = [
  { id: 'club', name: 'Club', hit: 0, die: 4 },
  { id: 'dagger', name: 'Dagger', hit: 2, die: 4 },
  { id: 'shortsword', name: 'Short sword', hit: 1, die: 6 },
  { id: 'mace', name: 'Mace', hit: 0, die: 8 },
  { id: 'longsword', name: 'Long sword', hit: 1, die: 8 },
  { id: 'waraxe', name: 'War axe', hit: 0, die: 10 },
  { id: 'greatsword', name: 'Greatsword', hit: 1, die: 12 },
  { id: 'runeblade', name: 'Runeblade', hit: 3, die: 12 },
];

// ac: added to armor class.
export const ARMORS = [
  { id: 'clothes', name: 'Clothes', ac: 0 },
  { id: 'padded', name: 'Padded armor', ac: 1 },
  { id: 'leather', name: 'Leather armor', ac: 2 },
  { id: 'studded', name: 'Studded leather', ac: 3 },
  { id: 'chain', name: 'Chain mail', ac: 4 },
  { id: 'scale', name: 'Scale mail', ac: 5 },
  { id: 'plate', name: 'Plate armor', ac: 6 },
  { id: 'mithril', name: 'Mithril plate', ac: 7 },
];

export const weaponLabel = (w) => `${w.name} (d${w.die}${w.hit ? `, +${w.hit} hit` : ''})`;
export const armorLabel = (a) => `${a.name} (+${a.ac} AC)`;

// The gear tier found on floor f: about one step every 5 floors, give or take one.
export function gearTier(f, roll3, max) {
  return Math.max(1, Math.min(max, 1 + Math.floor(f / 5) + (roll3 - 2)));
}

// What gear sells for (or is worth when you find something worse).
export const gearValue = (idx) => 2 * idx;
// Shop price of the next tier up.
export const gearPrice = (idx, f) => 8 + 6 * idx + Math.floor(f / 10) * 2;
