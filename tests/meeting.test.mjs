import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LatestOnly,decisionRequest,evidenceSchema,evidenceSources,faceCues,parseDecisions,parseVoice,signals,scoredSignals,strongestSignal} from '../lib/meeting-protocol.ts';
import {AudioContextWindow} from '../lib/meeting-context.ts';
test('voice context includes recent adjacent audio and resets after a pause',()=>{
  const window=new AudioContextWindow();
  for(let i=1;i<=6;i++)window.add({id:`audio-${i}`,at:i*1000});
  assert.deepEqual(window.context(6000).map(item=>item.id),['audio-3','audio-4','audio-5','audio-6']);
  window.add({id:'new-phrase',at:9000});
  assert.deepEqual(window.context(9000).map(item=>item.id),['new-phrase']);
  assert.deepEqual(window.context(14000),[]);
});
test('in-flight audio stays available while old context is deleted, with bounded retention',()=>{
  const window=new AudioContextWindow(),retained=new Set();
  for(let i=1;i<=4;i++){window.add({id:String(i),at:i*1000});retained.add(String(i));}
  const active=window.context(4000).map(item=>item.id);
  for(let i=5;i<=100;i++){
    window.add({id:String(i),at:i*1000});retained.add(String(i));
    for(const id of window.prune(i*1000,active)){assert.ok(!active.includes(id));retained.delete(id);}
    assert.ok(retained.size<=8);
  }
  assert.deepEqual(window.prune(100000),active);
  assert.deepEqual(window.context(100000).map(item=>item.id),['97','98','99','100']);
  window.clear();assert.deepEqual(window.context(100000),[]);
});
test('only the newest pending observation is analyzed; stop drops pending work',async()=>{
  let finish;const held=new Promise(resolve=>finish=resolve),seen=[];
  const queue=new LatestOnly(async value=>{seen.push(value);if(value===1)await held;});
  queue.push(1);queue.push(2);queue.push(3);finish();await new Promise(r=>setImmediate(r));
  assert.deepEqual(seen,[1,3]);queue.stop();queue.push(4);await new Promise(r=>setImmediate(r));assert.deepEqual(seen,[1,3]);
});
test('missing faces clear movement signals, and shape strength is bounded',()=>{
  const categories=[{categoryName:'mouthSmileLeft',score:.9},{categoryName:'mouthSmileRight',score:.7},{categoryName:'browInnerUp',score:2}];
  assert.equal(faceCues(categories,true).smile,.8);assert.equal(faceCues(categories,true).browRaise,1);
  assert.deepEqual(faceCues(categories,false),{present:false,smile:0,browRaise:0,browFurrow:0,blink:0,jawOpen:0});
});
test('words are omitted unless opted in; no camera pixels or transcript history enter Decisions',()=>{
  const evidence=evidenceSchema.parse({sequence:1,voice:{audible:true,observations:'Varied pitch',words:'private words'},face:null});
  const request=decisionRequest(evidence);assert.equal(request.model,'gpt-6-luna');assert.equal(request.questions.length,16);
  assert.ok(!request.input.includes('private words'));assert.ok(decisionRequest({...evidence,includeWords:true}).input.includes('private words'));
  assert.throws(()=>evidenceSchema.parse({...evidence,voice:{...evidence.voice,observations:'a'.repeat(900)}}));
});
test('source reporting reflects words actually supplied, including opt-out and missing transcripts',()=>{
  const evidence=evidenceSchema.parse({sequence:1,voice:{audible:true,observations:'Calm voice.',words:'I feel really sad today.'},face:null,includeWords:true});
  assert.deepEqual(evidenceSources(evidence),{words:true,voice:true,face:false});
  assert.deepEqual(JSON.parse(decisionRequest(evidence).input).sources,evidenceSources(evidence));
  assert.equal(evidenceSources({...evidence,includeWords:false}).words,false);
  assert.equal(evidenceSources({...evidence,voice:{...evidence.voice,words:'  '}}).words,false);
  assert.equal(evidenceSources({...evidence,voice:null}).voice,false);
  assert.equal(JSON.parse(decisionRequest({...evidence,includeWords:false}).input).voice.words,undefined);
});
test('malformed scores never become plausible feedback; refusals remain unavailable',()=>{
  const answers=scoredSignals.map(s=>({type:'score',name:s.id,score:1.5,confidence:.75}));
  const result=parseDecisions({model:'gpt-6-luna',answers});assert.equal(result.scores.happy,50);assert.equal(result.details.excited,50);
  assert.throws(()=>parseDecisions({model:'x',answers:answers.slice(1)}));
  assert.throws(()=>parseDecisions({model:'x',answers:[...answers,answers[0]]}));
  assert.throws(()=>parseDecisions({model:'x',answers:answers.map(a=>({...a,score:NaN}))}));
  answers[0]={type:'refusal',name:'happy'};assert.equal(parseDecisions({model:'x',answers}).scores.happy,null);
  assert.throws(()=>parseVoice('some guesses'));
  assert.equal(parseVoice('```json\n{"audible":false,"observations":"","words":""}\n```').audible,false);
});

test('neutral and refused readings do not force a winning emotion',()=>{
  assert.equal(strongestSignal({happy:0,sad:0,angry:0,surprised:0}),null);
  assert.equal(strongestSignal({happy:null,sad:null,angry:null,surprised:null}),null);
  assert.equal(strongestSignal({happy:60,sad:5,angry:10,surprised:90}).id,'surprised');
});
test('weak or conflicting anger does not become a headline; clear anger is still possible',()=>{
  assert.equal(strongestSignal({happy:12,sad:8,angry:48,surprised:15}),null);
  assert.equal(strongestSignal({happy:70,sad:8,angry:75,surprised:15}),null);
  assert.equal(strongestSignal({happy:70,sad:8,angry:70,surprised:15}),null);
  assert.equal(strongestSignal({happy:80,sad:8,angry:30,surprised:15}).id,'happy');
  assert.equal(strongestSignal({happy:10,sad:8,angry:85,surprised:15}).id,'angry');
});
test('uncertain high scores are unavailable, not strong emotion readings',()=>{
  const answers=scoredSignals.map(s=>({type:'score',name:s.id,score:0,confidence:.9}));
  for(const name of ['angry','furious'])Object.assign(answers.find(a=>a.name===name),{score:2.8,confidence:.35});
  const result=parseDecisions({model:'gpt-6-luna',answers});
  assert.equal(result.scores.angry,null);assert.equal(result.details.furious,null);
  assert.equal(strongestSignal(result.scores),null);
  Object.assign(answers.find(a=>a.name==='angry'),{confidence:.9});
  assert.equal(strongestSignal(parseDecisions({model:'gpt-6-luna',answers}).scores).id,'angry');
});
test('uncertain presence is hidden, but uncertainty between clear and strong stays visible',()=>{
  const answers=scoredSignals.map(s=>({type:'score',name:s.id,score:0,confidence:.9}));
  const distribution=values=>values.map((probability,value)=>({value,probability}));
  Object.assign(answers.find(a=>a.name==='angry'),{score:1.5,confidence:.2,probabilities:distribution([.5,0,0,.5])});
  Object.assign(answers.find(a=>a.name==='happy'),{score:2.5,confidence:.2,probabilities:distribution([0,0,.5,.5])});
  const result=parseDecisions({model:'gpt-6-luna',answers});
  assert.equal(result.scores.angry,null);assert.equal(result.scores.happy,83);
  assert.equal(strongestSignal(result.scores).id,'happy');
  answers.find(a=>a.name==='happy').probabilities=distribution([.5,.5,.5,.5]);
  assert.throws(()=>parseDecisions({model:'gpt-6-luna',answers}));
});
test('a refused nuance stays unavailable without changing the parent score',()=>{
  const answers=scoredSignals.map(s=>({type:'score',name:s.id,score:1.5,confidence:.75}));
  answers[4]={type:'refusal',name:'excited'};
  const result=parseDecisions({model:'gpt-6-luna',answers});
  assert.equal(result.scores.happy,50);assert.equal(result.details.excited,null);assert.equal(result.details.amused,50);
  assert.throws(()=>parseDecisions({model:'gpt-6-luna',answers:answers.slice(0,4)}));
});
