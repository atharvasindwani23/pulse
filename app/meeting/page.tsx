'use client';
import {useEffect,useRef,useState} from 'react';
import {Activity,ArrowUpRight,AudioLines,Camera,Check,ChevronDown,Eye,KeyRound,LoaderCircle,Mic,ShieldCheck,Square,X} from 'lucide-react';
import {MeetingEngine,initialEngine,type EngineState} from '@/lib/meeting-engine';
import {signals,strongestSignal,type SignalId,type DecisionResult} from '@/lib/meeting-protocol';
import styles from './meeting.module.css';

type HistoryItem={at:number;result:DecisionResult};
function CameraPreview({stream}:{stream:MediaStream|null}){
  const video=useRef<HTMLVideoElement>(null);
  useEffect(()=>{if(video.current){video.current.srcObject=stream;if(stream)void video.current.play().catch(()=>{});}return()=>{if(video.current)video.current.srcObject=null}},[stream]);
  return <video ref={video} autoPlay muted playsInline aria-label="Your camera preview" className={styles.video}/>;
}
function FaceOutline(){return <svg viewBox="0 0 200 240" aria-hidden="true"><path d="M40 84Q43 24 100 24T160 84L153 154Q139 204 100 216Q61 204 47 154Z"/><path d="M40 84L70 68L100 72L130 68L160 84M47 154L74 160L100 179L126 160L153 154M70 68L63 102L87 108L100 72L113 108L137 102L130 68M87 108L86 145L100 155L114 145L113 108M74 160L100 156L126 160L100 179Z"/><path d="M63 102L78 96L87 108M113 108L122 96L137 102M100 24V72M40 84L25 121L47 154M160 84L175 121L153 154"/>{[[100,24],[70,68],[130,68],[63,102],[87,108],[113,108],[137,102],[86,145],[114,145],[74,160],[126,160],[100,179],[100,216]].map(([cx,cy],i)=><circle key={i} cx={cx} cy={cy} r="2.8"/>)}</svg>}

export default function MeetingPage(){
  const [state,setState]=useState<EngineState>(initialEngine),[key,setKey]=useState(''),[configured,setConfigured]=useState(false);
  const [camera,setCamera]=useState(true),[words,setWords]=useState(true),[settings,setSettings]=useState(true);
  const [notice,setNotice]=useState(''),[test,setTest]=useState(''),[testing,setTesting]=useState(false),[now,setNow]=useState(0),[history,setHistory]=useState<HistoryItem[]>([]),[selectedEmotion,setSelectedEmotion]=useState<SignalId>('happy');
  const engine=useRef<MeetingEngine|null>(null),mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;engine.current=new MeetingEngine(value=>{if(mounted.current)setState(value)});
    void fetch('/api/openai/session').then(r=>r.json() as Promise<{configured:boolean}>).then(d=>{if(mounted.current)setConfigured(d.configured)}).catch(()=>{});
    const timer=setInterval(()=>setNow(Date.now()),500);
    const stop=()=>engine.current?.stop();window.addEventListener('pagehide',stop);
    return()=>{mounted.current=false;clearInterval(timer);engine.current?.stop();window.removeEventListener('pagehide',stop);};
  },[]);
  useEffect(()=>{if(state.result&&state.resultAt)setHistory(h=>[...h,{at:state.resultAt!,result:state.result!}].slice(-24))},[state.result,state.resultAt]);
  function start(ai:boolean){
    if(ai&&!key.trim()&&!configured){setSettings(true);setNotice('Add your OpenAI key, or try local feedback first.');return;}
    setNotice('');setHistory([]);setSettings(false);void engine.current?.start({key:key.trim(),ai,camera,includeWords:words});
  }
  async function testConnection(){
    setTesting(true);setTest('');
    try{
      const response=await fetch('/api/openai/decisions',{method:'POST',headers:{'Content-Type':'application/json',...key.trim()?{'X-OpenAI-Key':key.trim()}:{}},body:JSON.stringify({sequence:0,voice:{audible:true,observations:'Synthetic connection test: calm, even delivery.',words:'I am really happy that we did it. This is wonderful.'},face:null,includeWords:words})});
      const data=await response.json() as {latencyMs?:number;message?:string};setTest(response.ok?`Decisions connected · ${data.latencyMs} ms. Voice connects when you start.`:data.message||'Could not connect.');
    }catch{setTest('Could not reach OpenAI. Check your connection.');}finally{setTesting(false);}
  }
  const active=state.running||state.connecting;
  const age=state.resultAt?Math.max(0,Math.round(((now||Date.now())-state.resultAt)/1000)):null;
  const fresh=active&&age!==null&&age<5;
  const top=state.result?strongestSignal(state.result.scores):null;
  const recentVoice=!!(state.voice&&state.voiceAt&&(now||Date.now())-state.voiceAt<6000);
  const sourceLabel=active&&state.ai==='off'?'Local feedback only':fresh&&state.result?.sources?(state.result.sources.words?(state.result.sources.voice?'Using words + voice':'Using words'):(state.result.sources.voice?(words?'Voice only · waiting for clear words':'Using voice only'):'Waiting for clear evidence')):(words?'Words + voice enabled':'Spoken meaning is off');
  const selected=signals.find(s=>s.id===selectedEmotion)??signals[0];
  const tone=fresh?(top?.label??'Neutral / unclear'):state.ai==='live'?'Listening':state.running?'Live feedback':'Ready when you are';
  return <div className={styles.page}>
    <header className={styles.header}><a href="/" className={styles.brand}><AudioLines size={27}/>Pulse</a><div className={styles.nav}><span className={styles.tag}>MEETING MODE</span><button onClick={()=>setSettings(!settings)}><span className={state.ai==='live'?styles.dot:styles.quietDot}/>{state.ai==='live'?'OpenAI connected':key||configured?'OpenAI ready':'Connect OpenAI'}<ChevronDown size={14}/></button></div></header>
    <main className={styles.main}>
      <div className={styles.heading}><div><div className={styles.eyebrow}><span className={state.running?styles.dot:styles.quietDot}/>PERSONAL MEETING COMPANION</div><h1>Stay in the conversation.</h1><p>Your voice. Your expressions. A little more awareness.</p></div></div>
      {(notice||state.error)&&<div role="status" className={styles.notice}><span>{notice||state.error}</span>{notice&&<button onClick={()=>setNotice('')} aria-label="Dismiss notice"><X size={16}/></button>}</div>}
      {settings&&<section className={styles.settings} aria-label="OpenAI connection settings"><div className={styles.settingsTitle}><KeyRound size={20}/><div><h2>Connect OpenAI</h2><p>Realtime listens to your voice. Decisions interprets the cues.</p></div><button onClick={()=>setSettings(false)} aria-label="Close connection settings"><X size={18}/></button></div><div className={styles.keyRow}><label htmlFor="openai-key">OpenAI API key<input id="openai-key" type="password" autoComplete="off" spellCheck={false} placeholder={configured?'Server key configured':'Paste your OpenAI key'} value={key} disabled={active} onChange={e=>{setKey(e.target.value);setTest('')}}/></label><button className={styles.secondary} disabled={testing||active||(!key.trim()&&!configured)} onClick={testConnection}>{testing?<LoaderCircle className={styles.spin} size={15}/>:<Check size={15}/>}Check connection</button></div><p className={styles.keyHelp}>Your key stays in this tab’s memory and clears on reload. It is only sent to this local server to connect to OpenAI.</p>{test&&<p role="status" className={styles.test}>{test}</p>}</section>}
      <div className={styles.grid}>
        <section className={styles.stage} aria-label="Live voice and camera feedback"><div className={styles.stageTop}><span><Eye size={16}/>YOUR PRESENCE</span><span className={styles.stageStatus}>{state.running?<><i className={styles.dot}/>LIVE</>:state.connecting?'CONNECTING':'CAPTURE OFF'}</span></div>
          <div className={styles.presence}>
            <div className={styles.cameraArea}>{state.cameraStream?<CameraPreview stream={state.cameraStream}/>:<div className={styles.faceIllustration}><FaceOutline/></div>}<div className={styles.cameraGradient}/><div className={styles.cameraLabel}><span>You</span><small>{state.camera==='on'?(state.face.present?'Face cues detected':'Looking for your face'):state.camera==='starting'?'Starting camera…':state.camera==='error'?'Camera unavailable':'Camera is off'}</small></div><span className={styles.localBadge}><ShieldCheck size={12}/>VIDEO STAYS LOCAL</span></div>
            <div className={styles.voiceArea}><div className={styles.orb} style={{'--energy':state.level,'--signal-color':fresh&&top?top.color:'#d8ee85'} as React.CSSProperties}><AudioLines size={42}/></div><div className={styles.tone}>{tone}</div><p>{state.connecting?state.captureStatus:state.running?(state.ai==='live'?'Reading your delivery, in the background.':'Microphone feedback, directly on your device.'):'Start when you’re ready. Nothing is recording.'}</p><div className={styles.wave} aria-label="Live microphone level">{state.wave.map((v,i)=><i key={i} style={{height:`${4+v*55}px`,opacity:.3+v*.7}}/>)}</div><div className={styles.voiceMeta}><span><Mic size={13}/>{state.running?'YOUR MICROPHONE':'MICROPHONE OFF'}</span><span>{state.level>.08&&state.running?'Sound detected':state.running?'Quiet':'—'}</span></div></div>
          </div>
          <div className={styles.cues}><div className={styles.cuesTitle}><Camera size={15}/><span>Visible expression cues</span><small>{state.faceMs!==null?`${state.faceMs} ms processing`:'Local processing'}</small></div><div className={styles.cueGrid}>{([{id:'smile',label:'Smile'},{id:'browRaise',label:'Brow raise'},{id:'browFurrow',label:'Brow furrow'},{id:'blink',label:'Blink'}] as const).map(c=><div key={c.id}><span>{c.label}<b>{state.face.present?`${Math.round(state.face[c.id]*100)}%`:'—'}</b></span><div><i style={{width:`${state.face[c.id]*100}%`}}/></div></div>)}</div>{state.cameraError&&<p className={styles.cameraError}>{state.cameraError}</p>}<p className={styles.cueNote}>Movement strength, not an emotion or a reading of your thoughts.</p></div>
          <div className={styles.controls}><div className={styles.options}><label><input type="checkbox" checked={camera} disabled={state.connecting} onChange={e=>{setCamera(e.target.checked);if(state.running)void engine.current?.setCamera(e.target.checked)}}/><Camera size={15}/>Camera cues</label><label><input type="checkbox" checked={words} disabled={active} onChange={e=>setWords(e.target.checked)}/>Use spoken words</label></div><div className={styles.startButtons}>{active?<button className={styles.stop} onClick={()=>engine.current?.stop()}><Square size={14} fill="currentColor"/>{state.connecting?'Cancel':'Stop capture'}</button>:<><button className={styles.secondary} onClick={()=>start(false)}>Try local feedback</button><button className={styles.primary} onClick={()=>start(true)}><Mic size={16}/>Start live analysis</button></>}</div></div>
        </section>
        <aside className={styles.analysis}>
          <div className={styles.analysisTop}><span><Activity size={17}/>Emotions</span><span className={styles.beta}>BETA</span></div>
          <div className={styles.analysisIntro}><h2>Four emotions. More nuance.</h2><p>Choose an emotion to explore its finer shades. Your words and voice both count; camera movements add context.</p></div>
          <div className={styles.sourceStatus} aria-label="Analysis sources">{sourceLabel}</div>
          <div className={styles.emotionGrid} aria-label="Main emotions">{signals.map(s=>{
            const value=fresh?state.result?.scores[s.id]:null;
            return <button key={s.id} className={styles.emotionCard} aria-label={`Explore ${s.label}`} aria-pressed={selected.id===s.id} aria-controls="emotion-details" onClick={()=>setSelectedEmotion(s.id)} style={{'--emotion-color':s.color} as React.CSSProperties}>
              <span><i/>{s.label}</span><strong>{value??'—'}</strong><div className={styles.emotionTrack}><i style={{width:`${value??0}%`}}/></div>
            </button>;
          })}</div>
          <section id="emotion-details" className={styles.emotionDetails} aria-label={`${selected.label} breakdown`}>
            <div className={styles.detailHeading}><h3>Inside {selected.label}</h3><span>Signal strength · 0–100</span></div>
            {selected.nuances.map(n=>{const value=fresh?state.result?.details?.[n.id]:null;return <div className={styles.nuance} key={n.id}><div><span>{n.label}</span><strong>{value??'—'}</strong></div><div className={styles.signalTrack}><i style={{background:selected.color,width:`${value??0}%`}}/></div></div>})}
            <p>{fresh?'Each shade is scored separately from the same moment.':'Start live analysis to see the finer shades as you speak.'}</p>
          </section>
          <div className={styles.evidence}>
            {words&&<><span>WORDS HEARD</span>{recentVoice&&state.voice?.words?<blockquote aria-label="Recent spoken words">“{state.voice.words}”</blockquote>:<p>{state.running?'Listening for clear words…':'Your recent spoken words will appear here.'}</p>}</>}
            <span>VOICE CUES{state.running&&state.voiceContextSeconds>0?` · ~${state.voiceContextSeconds}S OF CONTEXT`:''}</span><p>{recentVoice?state.voice?.observations:state.running?'Listening for your voice or expressive sounds…':'Your voice observations will appear here.'}</p>
          </div>
          <p className={styles.analysisNote}>These reflect what you express, not a reading of hidden feelings. Clear words count even with a calm voice or neutral face. — means uncertain or unavailable. Weak or mixed signals stay neutral / unclear.</p>
        </aside>
      </div>
      <section className={styles.timeline}><div><h2>As the conversation unfolds</h2><span>{history.length?'Latest expression readings':'Your live timeline will appear here'}</span></div><div className={styles.timelineBars}>{history.length?history.map((h,i)=>{const best=strongestSignal(h.result.scores);return <div key={`${h.at}-${i}`} title={`${new Date(h.at).toLocaleTimeString()} · ${best?.label??'Neutral / unclear'}`} style={{height:`${18+(best?h.result.scores[best.id]??0:0)*.5}px`,background:best?.color??'#687460'}}/>}):Array.from({length:38},(_,i)=><i key={i}/>)}</div><div className={styles.timelineFoot}><span>Only this session · nothing saved by Pulse</span><span>{fresh?'Latest reading now':age!==null?`Last reading ${age}s ago`:'Awaiting your first signal'}</span></div></section>
      <footer className={styles.footer}><div><span><ShieldCheck size={14}/>Your camera stays on this device.</span><span>{words?'With live analysis, OpenAI receives your mic audio, spoken words and cue summaries.':'With live analysis, OpenAI receives your mic audio and cue summaries.'}</span></div><div className={styles.latencies}><span>Local meter {state.meterMs!==null&&state.running?`${state.meterMs} ms`:'—'}</span><span>Voice AI {state.voiceMs!==null&&state.ai==='live'?`${state.voiceMs} ms`:'—'}</span><span>Decisions {fresh?`${state.result?.latencyMs} ms`:'—'}</span></div></footer>
      <div className={styles.bottom}><span>Local prototype · microphone and optional camera</span><a href="https://developers.openai.com/api/docs/guides/decisions" target="_blank" rel="noreferrer">About Decisions<ArrowUpRight size={13}/></a></div>
    </main>
  </div>;
}
