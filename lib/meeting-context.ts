/** Bounded references to audio already in this Realtime session; no audio is copied to disk. */
export class AudioContextWindow<T extends {id:string;at:number}> {
  private items=new Map<string,T>();
  add(item:T){this.items.set(item.id,item);}
  context(now:number):T[]{
    const recent=[...this.items.values()].filter(item=>now-item.at<4500).slice(-4);
    // A long pause starts a new phrase instead of reviving the previous expression.
    let start=0;
    for(let i=1;i<recent.length;i++)if(recent[i].at-recent[i-1].at>1600)start=i;
    return recent.slice(start);
  }
  prune(now:number,pinned:readonly string[]=[]):string[]{
    const keep=new Set([...this.context(now).map(item=>item.id),...pinned]),removed:string[]=[];
    for(const id of this.items.keys())if(!keep.has(id)){this.items.delete(id);removed.push(id);}
    return removed;
  }
  clear(){this.items.clear();}
}
