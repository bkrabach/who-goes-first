import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings,decodeSettings,encodeSettings} from '../settings.js';
test('preferences roundtrip and keep the accepted default experience',()=>{
  assert.deepEqual(defaultSettings(),{sound:true,volume:100,motion:'system'});
  const changed={sound:false,volume:35,motion:'reduced'};
  assert.deepEqual(decodeSettings(encodeSettings(changed)),changed);
});
test('invalid preferences are rejected without affecting player storage',()=>{
  for(const data of ['{','null','{}',
    JSON.stringify({version:2,settings:defaultSettings()}),
    JSON.stringify({version:1,settings:{sound:'yes',volume:100,motion:'system'}}),
    JSON.stringify({version:1,settings:{sound:true,volume:101,motion:'system'}}),
    JSON.stringify({version:1,settings:{sound:true,volume:4.2,motion:'system'}}),
    JSON.stringify({version:1,settings:{sound:true,volume:100,motion:'fast'}})]){
    assert.throws(()=>decodeSettings(data));
  }
});