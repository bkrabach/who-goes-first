export const STORAGE_KEY = 'who-goes-first:players:v1';
export const MAX_PLAYERS = 100;
export const MAX_NAME = 40;

const defaults = ['Kevin Flynn', 'Andrew Wiggin', 'Frodo Baggins', 'Inigo Montoyo', 'Rick Deckard', 'Dade Murphy', 'Mazer Rackham', 'Richard Riddick', 'Thomas Anderson'];
export function defaultPlayers() {
  return defaults.map((name, i) => ({ id: `original-${i}`, name, active: i < 6 }));
}

export function cleanName(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
}

export function decodePlayers(raw) {
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.players) || data.players.length > MAX_PLAYERS) throw new Error('Invalid saved player list');
  const ids = new Set();
  return data.players.map(player => {
    if (!player || typeof player.id !== 'string' || !player.id || player.id.length > 100 || ids.has(player.id) || !cleanName(player.name) || typeof player.active !== 'boolean') throw new Error('Invalid saved player');
    ids.add(player.id);
    return { id: player.id, name: cleanName(player.name), active: player.active };
  });
}

export function encodePlayers(players) {
  return JSON.stringify({ version: 1, players });
}

// Reject the incomplete tail of the uint32 range, avoiding modulo bias.
export function randomIndex(length, fill = array => globalThis.crypto.getRandomValues(array)) {
  if (!Number.isInteger(length) || length < 1 || length > MAX_PLAYERS) throw new RangeError('Choose between 1 and 100 players');
  const ceiling = Math.floor(2 ** 32 / length) * length;
  const values = new Uint32Array(1);
  do { fill(values); } while (values[0] >= ceiling);
  return values[0] % length;
}

export function pickPlayer(players, fill) {
  const active = players.filter(player => player.active);
  return active.length ? active[randomIndex(active.length, fill)] : null;
}

export function createReel(players, winnerId, turns = 6) {
  if (!players.length) return { names: [], target: 0 };
  const winner = players.findIndex(player => player.id === winnerId);
  if (winner < 0) throw new Error('Winner must be an active player');
  const target = Math.max(12, players.length * turns) + winner;
  // Choose a full-cycle starting offset so the target always lands on the winner.
  const offset = ((winner - target) % players.length + players.length) % players.length;
  const names = Array.from({ length: target + 3 }, (_, i) => players[(i + offset) % players.length].name);
  return { names, target };
}