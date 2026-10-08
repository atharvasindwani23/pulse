import {faceCues,noFace,parseVoice,voiceInstructions,voiceTool,LatestOnly,type FaceCues,type VoiceObservation,type DecisionResult,type Evidence} from './meeting-protocol';
import {AudioContextWindow} from './meeting-context';

export type EngineState={
  running:boolean;connecting:boolean;captureStatus:string;ai:'off'|'connecting'|'live'|'error';error:string;
  level:number;wave:number[];face:FaceCues;camera:'off'|'starting'|'on'|'error';cameraError:string;
  cameraStream:MediaStream|null;faceMs:number|null;meterMs:number|null;
  voice:VoiceObservation|null;voiceMs:number|null;voiceAt:number|null;voiceContextSeconds:number;result:DecisionResult|null;resultAt:number|null;
};
export const initialEngine:EngineState={running:false,connecting:false,captureStatus:'',ai:'off',error:'',level:0,wave:Array(44).fill(0),face:{...noFace},camera:'off',cameraError:'',cameraStream:null,faceMs:null,meterMs:null,voice:null,voiceMs:null,voiceAt:null,voiceContextSeconds:0,result:null,resultAt:null};
type Options={key:string;ai:boolean;camera:boolean;includeWords:boolean};
type AudioItem={id:string;at:number;sequence:number;face:FaceCues|null};
export class MeetingEngine {
  private state:EngineState={...initialEngine};
  private emit:(state:EngineState)=>void;
  private generation=0; private cameraGeneration=0; private key='';private includeWords=false;
  private mic:MediaStream|null=null;private context:AudioContext|null=null;private meter:AudioWorkletNode|null=null;
  private peer:RTCPeerConnection|null=null;private dc:RTCDataChannel|null=null;
  private camera:MediaStream|null=null;private video:HTMLVideoElement|null=null;private worker:Worker|null=null;
  private faceTimer:ReturnType<typeof setInterval>|null=null;private faceBusy=false;private faceReady=false;
  private abort:AbortController|null=null;private decisionQueue:LatestOnly<Evidence&{at:number}>|null=null;
  private sequence=0;private speech=false;private lastCommit=0;private lastMeter=0;
  private pendingItem:AudioItem|null=null;
  private audioWindow=new AudioContextWindow<AudioItem>();
  private response:{item:AudioItem;context:AudioItem[];started:number;id?:string;timer:ReturnType<typeof setTimeout>}|null=null;
  constructor(emit:(state:EngineState)=>void){this.emit=emit;}
  private update(patch:Partial<EngineState>){this.state={...this.state,...patch};this.emit(this.state);}
  async start(options:Options){
    this.stop();const generation=this.generation;this.key=options.key;this.includeWords=options.includeWords;
    this.abort=new AbortController();this.update({...initialEngine,connecting:true,captureStatus:'Allow microphone access in your browser to continue.',ai:options.ai?'connecting':'off'});
    try{
      const context=new AudioContext({latencyHint:'interactive'});this.context=context;
      // Request capture while the click gesture is active. Waiting for audio playback
      // first can deadlock browsers that only resume the context after mic permission.
      void context.resume().catch(()=>{});
      const mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false},video:false});
      if(generation!==this.generation){mic.getTracks().forEach(t=>t.stop());return;}
      this.mic=mic;
      this.update({captureStatus:'Starting microphone feedback…'});
      if(context.state!=='running'){
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{await Promise.race([context.resume(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('audio-context-timeout')),5000)})]);}
        finally{clearTimeout(timer);}
      }
      if(generation!==this.generation)return;
      mic.getAudioTracks()[0].addEventListener('ended',()=>{if(generation===this.generation){this.stop();this.update({error:'Microphone disconnected. Reconnect to continue.'});}});
      await context.audioWorklet.addModule('/pulse-meter.js');
      if(generation!==this.generation)return;
      const source=context.createMediaStreamSource(mic),meter=new AudioWorkletNode(context,'pulse-meter'),mute=context.createGain();mute.gain.value=0;
      source.connect(meter).connect(mute).connect(context.destination);this.meter=meter;
      meter.port.onmessage=({data})=>{
        if(generation!==this.generation)return;
        const now=performance.now();this.speech ||= data.rms>.012;
        if(now-this.lastMeter>45){
          this.lastMeter=now;const level=Math.min(1,Math.sqrt(data.rms)*2.6);
          this.update({level,wave:[...this.state.wave.slice(1),level],meterMs:Math.round(Math.max(0,context.currentTime-data.at)*1000)});
        }
        if(this.dc?.readyState==='open'&&now-this.lastCommit>=1000){
          this.send({type:this.speech?'input_audio_buffer.commit':'input_audio_buffer.clear'});
          this.lastCommit=now;this.speech=false;
          this.pruneAudio();
        }
      };
      this.update({running:true,connecting:false,captureStatus:''});
      if(options.camera)void this.setCamera(true);
      if(options.ai)await this.connectAI(generation,mic);
    }catch(error){
      if(generation!==this.generation)return;
      this.stop();this.update({error:error instanceof DOMException&&error.name==='NotAllowedError'?'Microphone access was declined. Allow it in your browser, then start again.':error instanceof Error&&error.message==='audio-context-timeout'?'This browser paused audio processing. Click Start again to resume it.':'Could not start the microphone. Check that your input device is available.'});
    }
  }
  private async connectAI(generation:number,mic:MediaStream){
    const peer=new RTCPeerConnection();this.peer=peer;
    peer.addTrack(mic.getAudioTracks()[0],mic);
    const dc=peer.createDataChannel('oai-events');this.dc=dc;
    const connectionTimer=setTimeout(()=>{if(generation===this.generation&&this.state.ai==='connecting')this.failAI('The OpenAI voice connection did not open. Try reconnecting.');},25000);
    dc.onopen=()=>{clearTimeout(connectionTimer);if(generation!==this.generation)return;this.lastCommit=performance.now();this.speech=false;this.update({ai:'live'});};
    dc.onmessage=({data})=>{if(generation!==this.generation)return;try{this.onEvent(JSON.parse(data))}catch{/* Invalid events never become user-visible scores. */}};
    dc.onclose=()=>{clearTimeout(connectionTimer);if(generation===this.generation&&this.state.ai!=='error')this.failAI('OpenAI disconnected. Local feedback is still running.');};
    peer.onconnectionstatechange=()=>{if(generation===this.generation&&peer.connectionState==='failed')this.failAI('Voice connection lost. Local feedback is still running.');};
    this.decisionQueue=new LatestOnly(async evidence=>{
      if(generation!==this.generation||this.state.ai!=='live'||Date.now()-evidence.at>4000)return;
      try{
        const response=await fetch('/api/openai/decisions',{method:'POST',headers:{'Content-Type':'application/json',...this.key?{'X-OpenAI-Key':this.key}:{}},
          body:JSON.stringify(evidence),signal:this.abort?.signal});
        const result=await response.json() as DecisionResult&{message?:string};
        if(generation!==this.generation)return;
        if(!response.ok){this.failAI(result.message||'OpenAI analysis failed. Reconnect to try again.');return;}
        if(Date.now()-evidence.at>5000||result.sequence<(this.state.result?.sequence??-1))return;
        this.update({result,resultAt:evidence.at,error:''});
      }catch{if(generation===this.generation)this.failAI('Analysis connection failed. Local feedback is still running.');}
    });
    try{
      const offer=await peer.createOffer();await peer.setLocalDescription(offer);
      const response=await fetch('/api/openai/session',{method:'POST',headers:{'Content-Type':'application/sdp',...this.key?{'X-OpenAI-Key':this.key}:{}},body:offer.sdp,signal:this.abort?.signal});
      if(generation!==this.generation){clearTimeout(connectionTimer);return;}
      if(!response.ok){const data=await response.json() as {message:string};throw new Error(data.message);}
      await peer.setRemoteDescription({type:'answer',sdp:await response.text()});
    }catch(error){clearTimeout(connectionTimer);if(generation===this.generation)this.failAI(error instanceof Error?error.message:'Could not connect to OpenAI.');}
  }
  private send(event:object){if(this.dc?.readyState==='open')this.dc.send(JSON.stringify(event));}
  private deleteItem(id:string){this.send({type:'conversation.item.delete',item_id:id});}
  private pruneAudio(){
    for(const id of this.audioWindow.prune(Date.now(),this.response?.context.map(item=>item.id)))this.deleteItem(id);
  }
  private onEvent(event:Record<string,any>){
    if(event.type==='error'){
      // Empty windows can occur just after WebRTC connects; do not fabricate observations.
      if(event.error?.code==='input_audio_buffer_commit_empty')return;
      this.failAI('OpenAI rejected a live audio request. Reconnect to try again.');return;
    }
    if(event.type==='input_audio_buffer.committed'){
      this.pendingItem={id:event.item_id,at:Date.now(),sequence:++this.sequence,face:this.state.face.present?{...this.state.face}:null};
      this.audioWindow.add(this.pendingItem);this.pruneAudio();this.nextVoice();
    }
    if(event.type==='response.created'&&this.response)this.response.id=event.response?.id;
    if(event.type==='response.done'&&this.response&&(!this.response.id||event.response?.id===this.response.id)){
      const current=this.response;clearTimeout(current.timer);this.response=null;
      try{
        if(event.response?.status==='completed'){
          const text=(event.response.output??[]).find((o:any)=>o.type==='function_call'&&o.name==='report_delivery')?.arguments??'';
          const voice=parseVoice(text);
          if(Date.now()-current.item.at<5000){
            this.update({voice,error:'',voiceAt:current.item.at,voiceMs:Math.round(performance.now()-current.started),voiceContextSeconds:current.context.length});
            if(voice.audible)this.decisionQueue?.push({sequence:current.item.sequence,voice:this.includeWords?voice:{...voice,words:''},face:current.item.face,includeWords:this.includeWords,at:current.item.at});
          }
        }else if(event.response?.status==='failed')this.failAI('OpenAI could not analyze this audio. Check account access and reconnect.');
      }catch{console.warn('Pulse audio format',JSON.stringify({status:event.response?.status,outputTypes:(event.response?.output??[]).map((o:any)=>({type:o.type,content:(o.content??[]).map((c:any)=>({type:c.type,characters:typeof c.text==='string'?c.text.length:0}))}))}));this.update({error:'An audio result was incomplete; waiting for the next clear segment.'});}
      this.pruneAudio();this.nextVoice();
    }
  }
  private nextVoice(){
    if(this.response||!this.pendingItem||this.state.ai!=='live')return;
    const item=this.pendingItem;this.pendingItem=null;
    if(Date.now()-item.at>3500){this.pruneAudio();return;}
    const context=this.audioWindow.context(Date.now());
    if(!context.some(previous=>previous.id===item.id))return;
    const timer=setTimeout(()=>this.failAI('OpenAI analysis is taking too long. Local feedback is still running.'),8000);
    this.response={item,context,started:performance.now(),timer};
    this.send({type:'response.create',response:{conversation:'none',output_modalities:['text'],max_output_tokens:320,
      input:context.map(previous=>({type:'item_reference',id:previous.id})),instructions:voiceInstructions,tools:[voiceTool],tool_choice:{type:'function',name:'report_delivery'},reasoning:{effort:'minimal'},metadata:{sequence:String(item.sequence)}}});
  }
  private failAI(message:string){
    this.update({ai:'error',error:message});this.decisionQueue?.stop();
    this.abort?.abort();if(this.response)clearTimeout(this.response.timer);this.response=null;this.pendingItem=null;
    this.audioWindow.clear();
    const dc=this.dc;this.dc=null;if(dc){dc.onclose=null;dc.close();}this.peer?.close();this.peer=null;
  }
  async setCamera(enabled:boolean){
    const generation=++this.cameraGeneration;
    this.camera?.getTracks().forEach(t=>t.stop());this.camera=null;
    this.worker?.terminate();this.worker=null;this.faceReady=false;this.faceBusy=false;
    if(this.faceTimer)clearInterval(this.faceTimer);this.faceTimer=null;
    this.video?.pause();if(this.video)this.video.srcObject=null;this.video=null;
    this.update({cameraStream:null,face:{...noFace},faceMs:null,camera:enabled?'starting':'off',cameraError:''});
    if(!enabled)return;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:15,max:20},facingMode:'user'},audio:false});
      if(generation!==this.cameraGeneration){stream.getTracks().forEach(t=>t.stop());return;}
      this.camera=stream;
      const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;this.video=video;await video.play();
      if(generation!==this.cameraGeneration)return;
      stream.getVideoTracks()[0].onended=()=>{if(generation===this.cameraGeneration)void this.setCamera(false);};
      this.update({cameraStream:stream});
      const worker=new Worker('/pulse-face.js');this.worker=worker;
      const fail=()=>{if(generation===this.cameraGeneration){this.update({camera:'error',cameraError:'Face tracking could not start. Voice feedback still works.',face:{...noFace}});this.faceReady=false;}};
      worker.onerror=fail;
      worker.onmessage=({data})=>{
        if(generation!==this.cameraGeneration)return;
        if(data.type==='ready'){this.faceReady=true;this.update({camera:'on'});}
        if(data.type==='result'){this.faceBusy=false;this.update({face:faceCues(data.categories,data.present),faceMs:data.ms});}
        if(data.type==='error')fail();
      };
      worker.postMessage({type:'init'});
      let lastVideoTime=-1;
      this.faceTimer=setInterval(async()=>{
        if(!this.faceReady||this.faceBusy||video.readyState<2||video.currentTime===lastVideoTime)return;
        this.faceBusy=true;lastVideoTime=video.currentTime;
        try{const bitmap=await createImageBitmap(video);if(generation!==this.cameraGeneration){bitmap.close();return;}worker.postMessage({type:'frame',bitmap,at:performance.now()},[bitmap]);}
        catch{this.faceBusy=false;}
      },70);
    }catch{if(generation===this.cameraGeneration)this.update({camera:'error',cameraError:'Camera unavailable. Allow camera access or continue with voice.'});}
  }
  stop(){
    this.generation++;this.abort?.abort();this.abort=null;this.decisionQueue?.stop();this.decisionQueue=null;
    if(this.response)clearTimeout(this.response.timer);this.response=null;this.pendingItem=null;
    this.audioWindow.clear();
    if(this.dc){this.dc.onclose=null;this.dc.close();}this.dc=null;this.peer?.close();this.peer=null;
    if(this.meter)this.meter.port.onmessage=null;this.meter?.disconnect();this.meter=null;
    this.mic?.getTracks().forEach(t=>t.stop());this.mic=null;
    void this.context?.close().catch(()=>{});this.context=null;
    void this.setCamera(false);this.key='';this.sequence=0;this.speech=false;
    this.update({running:false,connecting:false,captureStatus:'',ai:'off',level:0,wave:Array(44).fill(0)});
  }
}
