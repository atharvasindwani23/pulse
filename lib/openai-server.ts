export const privateHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export function apiError(message:string,status=400){return Response.json({message},{status,headers:privateHeaders})}
export function checkOrigin(request:Request){
  const origin=new URL(request.url).origin;
  return request.headers.get('origin')===origin;
}
export function openAIKey(request:Request){
  const key=request.headers.get('X-OpenAI-Key')?.trim()||process.env.OPENAI_API_KEY?.trim();
  return key&&key.length<512&&!/[\r\n]/.test(key)?key:null;
}
export function providerMessage(status:number){
  if(status===401)return 'OpenAI rejected this key. Check your OpenAI connection.';
  if(status===403||status===404)return 'This OpenAI project does not have access to the requested model.';
  if(status===429)return 'OpenAI reports a credit or rate limit. Check billing and retry.';
  return `OpenAI could not complete the request (${status}). Please retry.`;
}
