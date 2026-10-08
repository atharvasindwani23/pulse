class PulseMeter extends AudioWorkletProcessor {
  count=0; sum=0;
  process(inputs){
    const samples=inputs[0]?.[0];
    if(samples){for(const x of samples)this.sum+=x*x;this.count+=samples.length;}
    if(this.count>=1024){this.port.postMessage({rms:Math.sqrt(this.sum/this.count),at:currentTime});this.count=0;this.sum=0;}
    return true;
  }
}
registerProcessor('pulse-meter',PulseMeter);
