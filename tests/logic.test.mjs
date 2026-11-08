import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPlayers, cleanName, decodePlayers, encodePlayers, randomIndex, pickPlayer, createReel } from '../logic.js';

test('demo crew matches the source list; six players are in', () => {
  const players = defaultPlayers();
  assert.equal(players.length, 9);
  assert.equal(players.filter(p => p.active).length, 6);
  players[0].name = 'Changed';
  assert.equal(defaultPlayers()[0].name, 'Kevin Flynn');
});
test('round trips a saved crew, including a deliberately empty crew', () => {
  assert.deepEqual(decodePlayers(encodePlayers(defaultPlayers())), defaultPlayers());
  assert.deepEqual(decodePlayers(encodePlayers([])), []);
});
test('rejects malformed, oversized, duplicate, or incompatible saved data', () => {
  for (const raw of ['null', '{}', '{', '{"version":2,"players":[]}', encodePlayers([{ id: 'a', name: ' ', active: true }]), encodePlayers([{ id: 'a', name: 'A', active: 1 }]), encodePlayers([{ id: 'a', name: 'A', active: true }, { id: 'a', name: 'B', active: true }]), encodePlayers(Array.from({length:101}, (_,i) => ({id:`${i}`, name:'X', active:true})))]) assert.throws(() => decodePlayers(raw));
});
test('names trim and normalize, preserve non-Latin names, and cap length', () => {
  assert.equal(cleanName('  Zoë   王  '), 'Zoë 王');
  assert.equal(cleanName('\u0000A\u0001'), 'A');
  assert.equal(cleanName('x'.repeat(90)).length, 40);
  assert.equal(cleanName(null), '');
});
test('only opted-in players are eligible; empty and solo cases work', () => {
  const players = [{ id:'out', name:'Out', active:false }, { id:'in', name:'In', active:true }];
  assert.equal(pickPlayer(players, a => { a[0] = 0; }).id, 'in');
  assert.equal(pickPlayer([]), null);
});
test('unbiased bounded selection rejects the incomplete uint32 tail', () => {
  const values = [4294967295, 4294967294, 5];
  assert.equal(randomIndex(3, a => { a[0] = values.shift(); }), 2);
  assert.equal(values.length, 1);
  for (const length of [0, -1, 101, 1.2, NaN]) assert.throws(() => randomIndex(length), RangeError);
});
test('every eligible position is reachable with equal accepted residue counts', () => {
  for (const size of [1,2,3,6,17,100]) {
    const counts = Array(size).fill(0);
    for (let value = 0; value < size * 20; value++) counts[randomIndex(size, a => { a[0] = value; })]++;
    assert.deepEqual(counts, Array(size).fill(20));
  }
});
test('reel lands on the chosen name for all table sizes and winners', () => {
  for (let size = 1; size <= 100; size++) {
    const players = Array.from({ length:size }, (_, i) => ({ id:`${i}`, name:`Name ${i}` }));
    for (const player of players) {
      const reel = createReel(players, player.id);
      assert.equal(reel.names[reel.target], player.name);
      assert.ok(reel.target >= 12);
      assert.ok(reel.names.length >= reel.target + 3);
    }
  }
  assert.deepEqual(createReel([], ''), { names:[], target:0 });
  assert.throws(() => createReel([{id:'x',name:'X'}], 'not-in'));
});