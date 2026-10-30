/** Public conversation updates only: never forward tools, reasoning, or raw logs. */
export function conversationUpdates(send, onError = () => {}) {
  let sequence=0, agentCount=0, pending=Promise.resolve();
  const seen=new Set();
  const post=message=>{
    if(sequence>=20)return pending;
    const data={sequence:sequence++,message};
    pending=pending.then(async()=>{
      // Lost-response retries reuse the sequence, so the card gets one message.
      try {await send(data);} catch {await send(data);}
    }).catch(onError);
    return pending;
  };
  return {post,flush:()=>pending,onEvent:event=>{
    const item=event.item;
    if(event.type!=='item.completed' || item?.type!=='agent_message' || typeof item.text!=='string' || agentCount>=6)return;
    const text=item.text.trim();
    // The structured final result is published only after validation.
    if(!text || text.length>800 || /^[{\[`]/.test(text) || seen.has(item.id))return;
    seen.add(item.id);agentCount++;void post(text);
  }};
}
export function failureMessage(stage,error) {
  if(stage==='tests' && String(error.diagnostic??error.message).includes('Timeout calling "onTaskUpdate"'))
    return 'I made the change, but the automatic test runner stopped responding while reporting its results. This is a technical problem, not a request for you to explain your idea again. Your idea and work are saved for Jason to inspect.';
  if(['typecheck','tests','build'].includes(stage))
    return 'I made the change, but it has not passed the automatic checks needed for a preview. Your idea and work are saved. Jason can inspect the technical problem; you do not need to repeat your request.';
  if(stage==='publishing')
    return 'The change passed its local checks, but I could not finish publishing the preview. Your work is saved for Jason to inspect. You do not need to explain your idea again.';
  return 'The builder stopped before it could finish this turn. Your conversation is saved. Jason can inspect the technical problem; this does not mean your request was unclear.';
}
