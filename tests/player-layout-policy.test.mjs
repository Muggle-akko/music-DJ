import test from 'node:test';
import assert from 'node:assert/strict';
import {nextPlayerLayout,keyboardVisible} from '../public/player-layout-policy.mjs';
test('a finger moving near the docking boundary does not reverse the layout repeatedly',()=>{
 let compact=false,changes=0;
 for(const deckTop of [180,120,95,90,84,92,110,91,86,130,151,170]){
  const next=nextPlayerLayout({compact,deckTop,dockTop:84});if(next!==compact)changes++;compact=next;
 }
 assert.equal(changes,2);assert.equal(compact,false);
});
test('keyboard panning never requests a different player layout while locked',()=>{
 for(const compact of [true,false])for(const deckTop of [-300,84,800])assert.equal(nextPlayerLayout({compact,deckTop,dockTop:84,locked:true}),compact);
});
test('keyboard closing remains locked after blur until viewport height actually recovers',()=>{
 assert.equal(keyboardVisible({focused:true,wasOpen:false,baseline:844,height:480}),true);
 assert.equal(keyboardVisible({focused:false,wasOpen:true,baseline:844,height:490}),true);
 assert.equal(keyboardVisible({focused:false,wasOpen:true,baseline:844,height:844}),false);
});
test('toolbar height and pinch zoom are not mistaken for the software keyboard',()=>{
 assert.equal(keyboardVisible({focused:true,wasOpen:false,baseline:844,height:760}),false);
 assert.equal(keyboardVisible({focused:true,wasOpen:false,baseline:844,height:422,scale:2}),false);
 assert.equal(keyboardVisible({focused:false,wasOpen:false,baseline:844,height:422}),false);
});
