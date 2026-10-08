import {voiceInstructions,voiceTool} from '@/lib/meeting-protocol';
import {apiError,checkOrigin,openAIKey,privateHeaders,providerMessage} from '@/lib/openai-server';
export const dynamic='force-dynamic';
export async function GET(){return Response.json({configured:!!process.env.OPENAI_API_KEY},{headers:privateHeaders})}
export async function POST(request:Request){
  if(!checkOrigin(request))return apiError('Open this from Pulse.',403);
  const key=openAIKey(request);if(!key)return apiError('Connect your OpenAI API key first.',503);
  const sdp=await request.text();
  if(sdp.length>64000||!sdp.startsWith('v=0'))return apiError('Invalid voice connection request.');
  const session={type:'realtime',model:process.env.OPENAI_REALTIME_MODEL||'gpt-realtime-2.1',
    output_modalities:['text'],instructions:voiceInstructions,max_output_tokens:320,tools:[voiceTool],tool_choice:{type:'function',name:'report_delivery'},reasoning:{effort:'minimal'},
    audio:{input:{turn_detection:null,noise_reduction:{type:'near_field'}}}};
  const body=new FormData();body.set('sdp',sdp);body.set('session',JSON.stringify(session));
  try{
    const response=await fetch('https://api.openai.com/v1/realtime/calls',{
      method:'POST',headers:{Authorization:`Bearer ${key}`},body,
      signal:AbortSignal.any([request.signal,AbortSignal.timeout(20000)]),
    });
    if(!response.ok)return apiError(providerMessage(response.status),response.status===401?401:502);
    return new Response(await response.text(),{headers:{...privateHeaders,'Content-Type':'application/sdp'}});
  }catch{return apiError('The voice connection timed out. Please reconnect.',502)}
}
