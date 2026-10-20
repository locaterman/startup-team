import {useRef,type ReactNode} from 'react';

/** Adapted from Untitled UI's horizontal underline/button-gray tab patterns.
 * Copyright (c) 2025 Untitled UI, MIT. See public/legal/Untitled-UI-LICENSE.txt.
 * React Aria/Tailwind implementation reduced to native buttons for this preview.
 */
export function Tabs({items,value,onChange,label}:{items:{id:string;label:string;count?:number}[];value:string;onChange:(id:string)=>void;label:string}){
 const refs=useRef<(HTMLButtonElement|null)[]>([]);
 return <div className="tabs" role="tablist" aria-label={label}>{items.map((item,i)=><button key={item.id} id={'tab-'+item.id} ref={el=>{refs.current[i]=el;}} role="tab" aria-selected={value===item.id} aria-controls={'panel-'+item.id} tabIndex={value===item.id?0:-1} onClick={()=>onChange(item.id)} onKeyDown={e=>{let n=i;if(e.key==='ArrowRight')n=(i+1)%items.length;else if(e.key==='ArrowLeft')n=(i+items.length-1)%items.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=items.length-1;else return;e.preventDefault();onChange(items[n].id);refs.current[n]?.focus();}}>{item.label}{item.count!==undefined&&<span>{item.count}</span>}</button>)}</div>;
}
export function Icon({name}:{name:'search'|'filter'|'close'|'chevron'}){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{name==='search'?<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>:name==='filter'?<><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--bg)"/><circle cx="15" cy="17" r="2" fill="var(--bg)"/></>:name==='close'?<path d="m6 6 12 12M18 6 6 18"/>:<path d="m8 10 4 4 4-4"/>}</svg>}
export function Empty({title,children,action}:{title:string;children?:ReactNode;action?:ReactNode}){return <div className="empty"><h2>{title}</h2>{children&&<p>{children}</p>}{action}</div>}
