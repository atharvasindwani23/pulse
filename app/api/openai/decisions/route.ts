import {decisionRequest,evidenceSchema,evidenceSources,parseDecisions} from '@/lib/meeting-protocol';
import {apiError,checkOrigin,openAIKey,privateHeaders,providerMessage} from '@/lib/openai-server';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  if(!checkOrigin(request))return apiError('Open this from Pulse.',403);
  const key=openAIKey(request);if(!key)return apiError('Connect your OpenAI API key first.',503);
  let evidence;try{const body=await request.text();if(body.length>10000)throw new Error();evidence=evidenceSchema.parse(JSON.parse(body))}catch{return apiError('Invalid observation.');}
  if(!evidence.voice?.audible)return apiError('Waiting for your voice or an expressive sound. Facial movements alone are not scored as emotions.');
  const start=performance.now();
  try{
    const response=await fetch('https://api.openai.com/v1/decisions',{
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify(decisionRequest(evidence)),signal:AbortSignal.any([request.signal,AbortSignal.timeout(8000)]),
    });
    if(!response.ok)return apiError(providerMessage(response.status),response.status===401?401:502);
    return Response.json({...parseDecisions(await response.json()),sources:evidenceSources(evidence),sequence:evidence.sequence,latencyMs:Math.round(performance.now()-start)},{headers:privateHeaders});
  }catch{return apiError('OpenAI did not return valid scores in time. Live local feedback is still available.',502)}
}
