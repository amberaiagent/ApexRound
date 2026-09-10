import {config} from './config.js';
export function getRound(now,anchor){const i=Math.floor((now-anchor)/config.roundMs),start=anchor+i*config.roundMs,end=start+config.roundMs;return{id:42+i,nextId:43+i,start,end,entryOpen:now>=end-config.windowMs&&now<end};}
export const qualifies=v=>v>50000000n;
export const inReward=(v,rank)=>qualifies(v)&&rank<=10;
export function equalShares(pool,n){if(n!==10)throw Error('Pending confirmation');return Array(10).fill(pool/10n);}
export function timer(ms){const s=Math.max(0,Math.floor(ms/1000));return[Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');}
export function when(t){return new Intl.DateTimeFormat('en-US',{timeZone:config.timezone,hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(t)+' / '+new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(t)+' local';}
export function demoAnchor(now){const date=new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);let t=Date.parse(date+'T12:00:00Z');for(let i=0;i<3;i++){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:config.timezone,hour:'2-digit',hourCycle:'h23',minute:'2-digit'}).formatToParts(t).map(p=>[p.type,p.value]));t+=(12-Number(p.hour))*3600000-Number(p.minute)*60000;}return t;}
