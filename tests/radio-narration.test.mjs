import test from 'node:test';
import assert from 'node:assert/strict';
import {narrationCount,coverageSlots,lyricWindows,relevantComments,filterNarration,scheduleNarration,createNarrationContext} from '../lib/radio-narration.mjs';
test('默认恢复38%和12段上限，覆盖首中尾，频率设置影响预算',()=>{
  assert.equal(narrationCount(11),5);assert.equal(narrationCount(30),12);
  assert.equal(narrationCount(11,'sparse'),3);assert.equal(narrationCount(11,'frequent'),7);
  assert.deepEqual(coverageSlots(11,5),[0,3,5,8,10]);
});
test('LRC 空档扣除边缘并标为启发式，缺失歌词不虚构窗口',()=>{
  const windows=lyricWindows('[00:25.000]第一句\n[00:35.000]第二句\n[01:20.000]第三句',120000);
  assert.ok(windows.some(w=>w.placement==='intro' && w.safeUntilMs===22500));
  assert.ok(windows.some(w=>w.placement==='interlude' && w.startAtMs===37500 && w.safeUntilMs===77500));
  assert.ok(windows.every(w=>w.basis==='lyric_gap_heuristic'));
  assert.deepEqual(lyricWindows('',120000),[]);
});
test('短稿匹配间奏窗口，长稿无窗口时不强塞语音，手动时间不被悄悄覆盖',()=>{
  const context={a:{cueWindows:[{placement:'interlude',startAtMs:40000,safeUntilMs:70000}]}};
  const [short]=scheduleNarration([{trackId:'a',kind:'transition',text:'在这段旋律里稍微停一下，让音乐继续。'}],context);
  assert.equal(short.startAtMs,40000);assert.equal(short.windowEndMs,70000);assert.equal(short.fitsWindow,true);
  assert.equal(scheduleNarration([{trackId:'a',kind:'transition',text:'很长的稿件'.repeat(40)}],context)[0].fitsWindow,false);
  const [manual]=scheduleNarration([{trackId:'a',kind:'transition',text:'保持手动位置',startAtMs:20000}],context,true);
  assert.equal(manual.startAtMs,20000);assert.equal(manual.fitsWindow,false);
});
test('过滤套话和替换歌名后的重复长句，相关评论不包含用户身份',()=>{
  const filtered=filterNarration([{trackId:'1',text:'今晚，让我们一起出发。'},{trackId:'2',text:'《甲》把这段音乐带进一个值得停下来仔细看看的日常瞬间。'},{trackId:'3',text:'《乙》把这段音乐带进一个值得停下来仔细看看的日常瞬间。'}]);
  assert.deepEqual(filtered.rejected,['1','3']);
  const comments=relevantComments({hotComments:[{content:'日推来的大家集合，给我点赞吧',user:{nickname:'私密用户'}},{content:'这段前奏的吉他让我想起下班走路回家时戴着耳机的感觉',user:{nickname:'私密用户'}}]},{title:'歌'});
  assert.equal(comments.length,1);assert.equal(typeof comments[0],'string');assert.ok(!comments[0].includes('私密用户'));
});
test('上下文请求并发有界，缺失接口不阻塞电台制作',async()=>{
  let active=0,peak=0;
  const load=createNarrationContext(async path=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));active--;if(path==='/lyric')return {lrc:{lyric:'[00:30]第一句\n[01:00]第二句'}};throw new Error('comments unavailable');});
  const data=await load(Array.from({length:8},(_,i)=>({id:String(i),title:'测试',duration:120000})));
  assert.ok(peak<=4);assert.equal(Object.keys(data).length,8);assert.ok(data['0'].cueWindows.length);assert.deepEqual(data['0'].hotComments,[]);
});
