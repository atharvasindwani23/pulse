import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Transpile only the browser engine; dependencies run as native type-stripped TS.
const source=readFileSync(new URL('../lib/meeting-engine.ts',import.meta.url),'utf8')
  .replace("'./meeting-protocol'",JSON.stringify(new URL('../lib/meeting-protocol.ts',import.meta.url).href))
  .replace("'./meeting-context'",JSON.stringify(new URL('../lib/meeting-context.ts',import.meta.url).href));
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {MeetingEngine}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('Realtime requests reuse adjacent audio, keep latest pending work, and score wordless laughter',t=>{
  let now=1000; t.mock.method(Date,'now',()=>now);
  const sent=[],evidence=[],updates=[];
  const engine=new MeetingEngine(state=>updates.push(state));
  engine.state.ai='live';
  engine.dc={readyState:'open',send:message=>sent.push(JSON.parse(message)),close(){}};
  engine.decisionQueue={push:value=>evidence.push(value),stop(){}};
  const commit=id=>engine.onEvent({type:'input_audio_buffer.committed',item_id:id});
  const complete=voice=>engine.onEvent({type:'response.done',response:{status:'completed',output:[{type:'function_call',name:'report_delivery',arguments:JSON.stringify(voice)}]}});
  const calls=()=>sent.filter(event=>event.type==='response.create');
  try{
    commit('one');
    assert.deepEqual(calls()[0].response.input,[{type:'item_reference',id:'one'}]);
    now=2000;commit('two');now=3000;commit('three');
    assert.equal(calls().length,1,'Only one voice inference may run at a time');
    complete({audible:false,observations:'',words:''});
    assert.deepEqual(calls()[1].response.input.map(item=>item.id),['one','two','three']);
    assert.equal(calls()[1].response.metadata.sequence,'3','The newest pending item owns the reading');
    assert.ok(!sent.some(event=>event.type==='conversation.item.delete'),'Audio needed for context must remain available');
    complete({audible:true,observations:'Warm, playful laughter with bright pitch variation.',words:''});
    assert.equal(evidence.length,1);assert.equal(evidence[0].sequence,3);
    assert.equal(evidence[0].voice.words,'');assert.equal(updates.at(-1).voiceContextSeconds,3);
    now=7000;commit('after-pause');
    assert.deepEqual(calls()[2].response.input.map(item=>item.id),['after-pause']);
    assert.deepEqual(sent.filter(event=>event.type==='conversation.item.delete').map(event=>event.item_id),['one','two','three']);
  }finally{engine.stop();}
});

test('a delayed voice response cannot produce a fresh emotion score',t=>{
  let now=1000;t.mock.method(Date,'now',()=>now);
  const evidence=[];const engine=new MeetingEngine(()=>{});
  engine.state.ai='live';engine.dc={readyState:'open',send(){},close(){}};
  engine.decisionQueue={push:value=>evidence.push(value),stop(){}};
  try{
    engine.onEvent({type:'input_audio_buffer.committed',item_id:'old'});
    now=7000;
    engine.onEvent({type:'response.done',response:{status:'completed',output:[{type:'function_call',name:'report_delivery',arguments:JSON.stringify({audible:true,observations:'Heated delivery.',words:''})}]}});
    assert.equal(evidence.length,0);assert.equal(engine.state.voice,null);
  }finally{engine.stop();}
});

test('recognized phrases reach scoring intact when enabled and are omitted when disabled',t=>{
  t.mock.method(Date,'now',()=>1000);
  for(const includeWords of [true,false]){
    const evidence=[];const engine=new MeetingEngine(()=>{});
    engine.state.ai='live';engine.includeWords=includeWords;
    engine.dc={readyState:'open',send(){},close(){}};
    engine.decisionQueue={push:value=>evidence.push(value),stop(){}};
    const words='I am not angry. I am really sad that it ended.';
    try{
      engine.onEvent({type:'input_audio_buffer.committed',item_id:'phrase'});
      engine.onEvent({type:'response.done',response:{status:'completed',output:[{type:'function_call',name:'report_delivery',arguments:JSON.stringify({audible:true,observations:'Quiet, steady voice.',words})}]}});
      assert.equal(evidence.length,1);assert.equal(evidence[0].includeWords,includeWords);
      assert.equal(evidence[0].voice.words,includeWords?words:'');
    }finally{engine.stop();}
  }
});
