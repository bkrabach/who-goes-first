import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installGuide,INSTALL_TIP_KEY} from '../install.js';
test('consumer install steps cover iPhone, touch iPad, Android, Safari, Edge and Chrome',()=>{
  const cases=[
    [{userAgent:'iPhone Safari'},/Share/,/Home Screen/],
    [{userAgent:'Safari',platform:'MacIntel',maxTouchPoints:5},/Share/,/Home Screen/],
    [{userAgent:'Android Chrome'},/three dots/,/Install app/],
    [{userAgent:'Version/18 Safari',platform:'MacIntel'},/File menu/,/Dock/],
    [{userAgent:'Chrome Safari Edg/140',platform:'MacIntel'},/Microsoft Edge/,/Apps/],
    [{userAgent:'Chrome Safari',platform:'Linux'},/address bar/,/Install/],
    [{userAgent:'Firefox',platform:'Linux'},/Safari, Chrome/,/bookmark/]
  ];
  for(const[environment,...expected]of cases){
    const guide=installGuide(environment),text=guide.steps.join(' ');
    assert.ok(guide.title.length>0);
    assert.ok(guide.steps.length>=2&&guide.steps.length<=3);
    for(const pattern of expected)assert.match(text,pattern);
    assert.doesNotMatch(text,/\bPWA\b|standalone|manifest|permission/i);
  }
  assert.equal(INSTALL_TIP_KEY,'who-goes-first:install-tip-dismissed:v1');
});