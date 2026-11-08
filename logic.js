export const STORAGE_KEY = 'who-goes-first:players:v1';
export const MAX_PLAYERS = 100;
export const MAX_NAME = 40;

// Keep this fingerprint fixed when the demo naming direction changes.
const legacyNames = ['Kevin Flynn', 'Andrew Wiggin', 'Frodo Baggins', 'Inigo Montoyo', 'Rick Deckard', 'Dade Murphy', 'Mazer Rackham', 'Richard Riddick', 'Thomas Anderson'];
const defaults = ['Pip Pebblewhistle','Juniper Kettlefern','Milo Thistletop','Tessa Bramblewick','Nori Copperfern','Otis Cloudskip'];
export function defaultPlayers() {
  return defaults.map((name, i) => ({ id: `sample-${i}`, name, active: true }));
}
// Samples are display-only. Never write them as a user's crew on first launch.
export function loadPlayerState(raw) {
  if(raw===null)return {players:[],samplesAllowed:true};
  const data=JSON.parse(raw);
  const decoded=decodePlayers(raw);
  const legacy=legacyNames.map((name,i)=>({id:`original-${i}`,name,active:i<6}));
  const untouchedLegacy=data.kind===undefined&&data.players.length===legacy.length&&data.players.every((player,i)=>
    player.id===legacy[i].id&&player.name===legacy[i].name&&player.active===legacy[i].active);
  return untouchedLegacy?{players:[],samplesAllowed:true}:{players:decoded,samplesAllowed:false};
}
export function gamePlayers(players,{samplesAllowed=false,appWindow=false}={}) {
  if(players.length)return players.filter(player=>player.active);
  return samplesAllowed&&!appWindow?defaultPlayers().filter(player=>player.active):[];
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
  return JSON.stringify({ version: 1, kind:'crew', players });
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
export function createFlickReel(players,winnerId,position,direction,turns=16){
  const count=players.length,winner=players.findIndex(player=>player.id===winnerId);
  if(!count||winner<0||!Number.isFinite(position)||![-1,1].includes(direction))throw new Error('Invalid flick reel');
  const distance=Math.max(12,count*turns);
  const end=direction>0
    ? Math.ceil((position+distance-winner)/count)*count+winner
    : Math.floor((position-distance-winner)/count)*count+winner;
  const first=Math.floor(Math.min(position,end))-3,last=Math.ceil(Math.max(position,end))+3;
  const mod=index=>((index%count)+count)%count;
  return {
    names:Array.from({length:last-first+1},(_,i)=>players[mod(first+i)].name),
    start:position-first,target:end-first
  };
}