// Display only: stored evidence and signed payloads retain their original timestamps.
export function localTime(value,options={}){
 if(value===null||value===undefined||value==='')return 'Not recorded';
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Not recorded';
 return new Intl.DateTimeFormat(options.locale,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',...(options.precision==='minute'?{}:{second:'2-digit'}),timeZoneName:'short',...(options.timeZone?{timeZone:options.timeZone}:{})}).format(date);
}
export function localZone(){return Intl.DateTimeFormat().resolvedOptions().timeZone;}

// Localize unambiguous time references in saved AI prose without altering its archive.
// A shorthand time must resolve to a cited source or an explicit UTC calendar date.
export function localReportText(text,sources=[],options={}){
 let day=/\b(\d{4}-\d{2}-\d{2})(?: UTC:| \d{2}:\d{2}:\d{2} UTC)/.exec(text)?.[1];
 const captured=sources.map(s=>s.at).filter(v=>typeof v==='string'&&Number.isFinite(Date.parse(v))).map(v=>new Date(v).toISOString());
 const holders=[];const hold=value=>{const key=`\u0000${holders.length}\u0000`;holders.push(value);return key;};
 let result=text.replace(/\b(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC\b/g,(all,d,t)=>hold(localTime(d+'T'+t+'Z',options)));
 let converted=holders.length>0;
 result=result.replace(/\b(\d{2}:\d{2}(?::\d{2})?)(?: UTC\b)?/g,(all,t)=>{
  const matches=[...new Set(captured.filter(at=>at.slice(11,11+t.length)===t).map(at=>at.slice(0,10)))];
  const utcDay=day??(matches.length===1?matches[0]:null);if(!utcDay)return all;
  const instant=utcDay+'T'+t+(t.length===5?':00':'')+'Z';if(!Number.isFinite(Date.parse(instant)))return all;
  converted=true;return hold(localTime(instant,t.length===5?{...options,precision:'minute'}:options));
 });
 if(converted)result=result.replace(/\b\d{4}-\d{2}-\d{2} UTC:/g,'Recorded activity:').replace(/(\u0000\d+\u0000) UTC\b/g,'$1');
 return result.replace(/\u0000(\d+)\u0000/g,(_,i)=>holders[Number(i)]);
}
