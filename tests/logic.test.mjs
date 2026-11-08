import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPlayers, cleanName, decodePlayers, encodePlayers, randomIndex, pickPlayer, createReel, createFlickReel, loadPlayerState, gamePlayers, artifactLayout } from '../logic.js';

test('sample crew contains six original playful adventurer names', () => {
  const players = defaultPlayers();
  assert.equal(players.length, 6);
  assert.equal(players.filter(p => p.active).length, 6);
  players[0].name = 'Changed';
  assert.equal(defaultPlayers()[0].name, 'Pip Pebblewhistle');
  assert.ok(defaultPlayers().every(player=>player.id.startsWith('sample-')));
});
test('artifact sizing caps both axes and frames spare height as well as spare width',()=>{
  for(const width of [280,300,320,390,520,640,680,1000,1920,3840]){
    for(const height of [300,390,568,780,920,1000,1600,2400]){
      const layout=artifactLayout(width,height);
      assert.ok(layout.width<=640&&layout.height<=920+.0001);
      assert.ok(layout.width+layout.gutter*2<=width+.0001);
      assert.ok(Math.abs(layout.width/layout.height-640/920)<.00001);
      assert.ok(layout.width>=Math.min(width,width<320?248:280));
      const fullWidth=Math.min(width,640,Math.max(Math.min(width,width<320?248:280),(height-16)*640/920));
      assert.equal(layout.framed,width-fullWidth>=48||height-fullWidth*920/640>=64);
      assert.equal(layout.blockSpace,layout.framed?32:0);
    }
  }
  assert.equal(artifactLayout(390,1600).framed,true);
  assert.equal(artifactLayout(640,1600).framed,true);
  assert.equal(artifactLayout(1920,1000).framed,true);
  assert.equal(artifactLayout(390,570).framed,false);
  assert.equal(artifactLayout(680,1000).width,640);
});
test('round trips a saved crew, including a deliberately empty crew', () => {
  assert.deepEqual(decodePlayers(encodePlayers(defaultPlayers())), defaultPlayers());
  assert.deepEqual(decodePlayers(encodePlayers([])), []);
});
test('samples stay separate from actual crew and never replace empty or inactive saved rosters',()=>{
  assert.deepEqual(loadPlayerState(null),{players:[],samplesAllowed:true});
  assert.equal(gamePlayers([],{samplesAllowed:true}).length,6);
  assert.deepEqual(gamePlayers([],{samplesAllowed:true,appWindow:true}),[]);
  const empty=loadPlayerState(encodePlayers([]));
  assert.deepEqual(empty,{players:[],samplesAllowed:false});
  assert.deepEqual(gamePlayers(empty.players,empty),[]);
  const inactive=[{id:'real',name:'My real player',active:false}];
  assert.deepEqual(gamePlayers(inactive,{samplesAllowed:true}),[]);
});
test('only exact unmarked legacy samples are recognized; modified or explicitly imported lists are preserved',()=>{
  const legacy=['Kevin Flynn','Andrew Wiggin','Frodo Baggins','Inigo Montoyo','Rick Deckard','Dade Murphy','Mazer Rackham','Richard Riddick','Thomas Anderson'].map((name,i)=>({id:`original-${i}`,name,active:i<6}));
  assert.deepEqual(loadPlayerState(JSON.stringify({version:1,players:legacy})),{players:[],samplesAllowed:true});
  for(const modify of [
    crew=>{crew[0].name='Kevin Flynn ';},
    crew=>{crew[0].active=false;},
    crew=>crew.reverse(),
    crew=>{crew.push({id:'own',name:'Own',active:true});},
    crew=>{crew[0].id='different';}
  ]){
    const crew=structuredClone(legacy);modify(crew);
    const loaded=loadPlayerState(JSON.stringify({version:1,players:crew}));
    assert.equal(loaded.samplesAllowed,false);
    assert.equal(loaded.players.length,crew.length);
  }
  const imported=loadPlayerState(encodePlayers(legacy));
  assert.deepEqual(imported.players,legacy);
  assert.equal(imported.samplesAllowed,false);
  assert.equal(loadPlayerState(JSON.stringify({version:1,kind:'unknown',players:legacy})).samplesAllowed,false);
  assert.throws(()=>loadPlayerState('{broken'));
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
test('flick reels preserve fractional drag positions and land every winner in either direction',()=>{
  for(const count of [1,2,6,25,100]){
    const crew=Array.from({length:count},(_,i)=>({id:`p${i}`,name:`Player ${i}`}));
    for(const player of crew)for(const position of [-100.75,-.2,0,4.8,101.125])for(const direction of [-1,1]){
      const reel=createFlickReel(crew,player.id,position,direction);
      assert.equal(reel.names[reel.target],player.name);
      assert.ok((reel.target-reel.start)*direction>=Math.max(12,count*16));
      assert.ok(reel.start>=3&&reel.target>=3);
      assert.ok(reel.start<reel.names.length-3&&reel.target<reel.names.length-3);
      const base=Math.floor(reel.start),world=Math.floor(position);
      assert.equal(reel.names[base],crew[((world%count)+count)%count].name);
      assert.ok(Math.abs((reel.start-base)-(position-world))<1e-10);
    }
  }
  assert.throws(()=>createFlickReel([],0,0,1));
  assert.throws(()=>createFlickReel([{id:'a'}],'a',NaN,1));
});