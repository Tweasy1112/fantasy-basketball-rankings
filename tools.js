/* Optional trade, lineup and saved roster tools. No external APIs or accounts. */
(()=>{'use strict';
const $=id=>document.getElementById(id), E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SLOTS=['PG','SG','G','G','G','SF','PF','C','FC','FC','Util','Util','Util'];
const STORE='fantasy-basketball-teams-v1';
let teams={};try{const obj=JSON.parse(localStorage.getItem(STORE)||'{}');if(obj&&typeof obj==='object'&&!Array.isArray(obj))teams=obj;}catch(e){}
let rosterA=Array(13).fill(''),rosterB=Array(13).fill(''),tradeGive=['',''],tradeGet=['','',''];
let rosterTeamA='',rosterTeamB='',activeTeam='',draftPlayers=[];
let originalDraft=[],draftLoadError='';
// Manual scenario only: never infer injuries from missing games or historical samples.
const FAIR_TOLERANCE=550; // Experimental absolute adjusted-value tolerance, not a calibrated model.
let tradeHorizon=8, injuryWeeks={}, injuryDates={}; // Manual total-duration overrides and optional onset dates.
let injuryFeed={updated_at:null,players:[],error:'Injury feed has not been generated yet.'};
const injuryName=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
function reportFor(id){const name=getName(id);const key=injuryName(name);return injuryFeed.players.find(p=>p.active!==false&&injuryName(p.name)===key)||null;}
function injuryDisplay(id){const p=reportFor(id);if(!p)return '<span class="tool-subtle">No matching official report entry; this does not confirm healthy status.</span>';
 const status=E(p.status||'Unknown'),reason=E(p.reason||'Not specified'),date=E(p.game_date||'');
 return `<span class="injury-report"><strong>NBA report: ${status}</strong> · ${reason}${date?' · game '+date:''}</span>`;}
async function loadInjuries(){try{const response=await fetch('data/injuries.json?ts='+Date.now(),{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();if(!Array.isArray(data.players))throw Error('Invalid feed');injuryFeed=data;}catch(err){injuryFeed={players:[],error:String(err),updated_at:null};}if($('tradeView')&&!$('tradeView').hidden)renderTrade();}

// Provisional reference medians discussed from Hashtag Basketball (calendar days, not remaining days).
// This is a tiny manually entered lookup, NOT a live feed, licensed dataset or player prognosis.
const INJURY_BASELINES=[
 {label:'Ankle sprain',days:5,pattern:/\b(ankle[\s;,:-]*sprain|sprained ankle)\b/i},
 {label:'Hamstring strain',days:12,pattern:/\b(hamstring[\s;,:-]*strain|strained hamstring)\b/i},
 {label:'Calf strain',days:11,pattern:/\b(calf[\s;,:-]*strain|strained calf)\b/i},
 {label:'Knee sprain',days:11,pattern:/\b(knee[\s;,:-]*sprain|sprained knee)\b/i},
 {label:'Hand fracture',days:29,pattern:/\b(hand[\s;,:-]*fracture|fractured hand|(?:first|second|third|fourth|fifth|[1-5](?:st|nd|rd|th)?)?\s*metacarpal(?:\s+bone)?\s+fracture|metacarpal\s+fracture)\b/i},
 {label:'Concussion',days:5,pattern:/\bconcussion\b/i},
];
function injuryBaseline(id){
 const p=reportFor(id);
 if(!p||!/^out$/i.test(String(p.status||'').trim()))return null;
 const reason=String(p.reason||'');
 const match=INJURY_BASELINES.find(x=>x.pattern.test(reason));
 if(!match)return null;
 // We don't know when the injury began, so this is an initial scenario estimate,
 // not an estimate of *remaining* recovery time.
 return {...match,weeks:Math.ceil(match.days/7)};
}
// Date is intentionally user-entered: the official game-specific feed does not supply injury onset.
// Dates and overrides are kept in memory for this session; no invented onset date.
const INJURY_CAP_WEEKS=8, MAX_INJURY_DISCOUNT=0.80;
function todayUTC(){const d=new Date();return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());}
function elapsedInjuryDays(id){const date=injuryDates[String(id)]||reportFor(id)?.first_reported_at?.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return 0;const onset=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(onset)||onset>todayUTC())return 0;return Math.floor((todayUTC()-onset)/86400000);}
function totalWeeksOut(id){const override=injuryWeeks[String(id)];return override===undefined?(injuryBaseline(id)?.weeks||0):Math.max(0,Number(override)||0);}
function remainingInjuryDays(id){const total=totalWeeksOut(id);if(!total)return 0;const date=injuryDates[String(id)]||reportFor(id)?.first_reported_at;if(!date)return Math.ceil(total*7);return Math.max(0,Math.ceil(total*7)-elapsedInjuryDays(id));}
function weeksOut(id){return Math.ceil(remainingInjuryDays(id)/7);}
// Convex injury-risk curve: additional weeks have increasingly severe marginal costs.
// Maximum penalty is 80% of healthy value at eight remaining weeks; no penalty after recovery.
function injuryRiskFraction(id){const w=Math.min(INJURY_CAP_WEEKS,weeksOut(id));return MAX_INJURY_DISCOUNT*Math.pow(w/INJURY_CAP_WEEKS,1.35);}
const scenarioFactor=id=>1-injuryRiskFraction(id);
const adjustedVal=id=>getVal(id)*scenarioFactor(id);
const injuryDeduction=id=>getVal(id)-adjustedVal(id);
const injuryDeductionSum=ids=>ids.reduce((s,id)=>s+injuryDeduction(id),0);
function tradeBreakdown(ids,opposingIds,heading){
 const base=sum(ids),loss=injuryDeductionSum(ids),adjusted=base-loss,premium=packagePremium(ids,opposingIds,starScale());
 return `<div class="trade-breakdown" aria-label="${E(heading)} value breakdown"><div class="trade-breakdown-row"><span>Players · healthy/base value</span><strong>${V(base)}</strong></div><div class="trade-breakdown-row trade-deduction"><span>Compounding injury-risk deduction</span><strong>−${V(loss)}</strong></div><div class="trade-breakdown-row"><span>Star / consolidation premium (increases with depth imbalance)</span><strong>+${V(premium)}</strong></div><div class="trade-breakdown-row trade-breakdown-total"><span>Final adjusted trade total</span><strong>${V(adjusted+premium)}</strong></div></div>`;
}
const adjustedSum=ids=>ids.reduce((s,id)=>s+adjustedVal(id),0);
// Experimental consolidation premium. Added separately; never changes base player values.
// Elite single-player packages receive a larger premium than equal-sum depth packages.
function starScale(){return Math.max(1,...playerList().map(x=>x.value));}
function starPremium(value,scale){return value<=0?0:0.55*value*Math.pow(value/scale,1.2);}
function premiumSum(ids,scale){return ids.reduce((n,id)=>n+starPremium(adjustedVal(id),scale),0);}
// Consolidation scarcity: when a side has fewer players, its strongest asset gets
// an extra package-level premium. This grows with the number of extra players
// on the opposing side, and never changes any player's underlying base value.
function consolidationPremium(ids,opposingIds,scale){
 const countGap=Math.max(0,opposingIds.length-ids.length);
 if(!countGap||!ids.length)return 0;
 const top=Math.max(...ids.map(adjustedVal));
 const dominance=top/Math.max(1,adjustedSum(ids));
 return top*0.13*countGap*Math.pow(top/scale,0.5)*dominance;
}
function packagePremium(ids,opposingIds,scale){return premiumSum(ids,scale)+consolidationPremium(ids,opposingIds,scale);}
function effectivePlayerValue(value,scale){return value+starPremium(value,scale);}
function tradeEquity(a,b){
 const scale=starScale(),givePremium=packagePremium(a,b,scale),receivePremium=packagePremium(b,a,scale);
 const raw=adjustedSum(b)-adjustedSum(a),studAdjustment=receivePremium-givePremium;
 const effective=raw+studAdjustment,side=effective<0?'get':'give',shortfall=Math.abs(effective);
 // Recompute consolidation on candidate additions rather than using a fixed target.
 const receiving=side==='get'?b:a,other=side==='get'?a:b;
 const evaluate=v=>{
   const base=adjustedSum(receiving)+v;
   const premium=premiumSum(receiving,scale)+starPremium(v,scale);
   const count=receiving.length+1, gap=Math.max(0,other.length-count);
   const top=Math.max(v,...receiving.map(adjustedVal));
   const extra=gap?top*0.13*gap*Math.pow(top/scale,0.5)*(top/Math.max(1,base)):0;
   const otherPremium=packagePremium(other,Array(count).fill(''),scale);
   return base+premium+extra-(adjustedSum(other)+otherPremium);
 };
 let lo=0,hi=Math.max(scale,shortfall+1);
 while(evaluate(hi)<0&&hi<1e9)hi*=2;
 for(let i=0;i<55;i++){const mid=(lo+hi)/2;if(evaluate(mid)<0)lo=mid;else hi=mid;}
 return {scale,givePremium,receivePremium,effective,raw,studAdjustment,side,target:(lo+hi)/2};
}
const playerMap=()=>new Map(aggregates().map(p=>[String(p.id),p]));
const can=(slot,p)=>slot==='Util'||slot==='G'&&p.positions.some(x=>x==='PG'||x==='SG')||slot==='FC'&&p.positions.some(x=>['SF','PF','C'].includes(x))||p.positions.includes(slot);
const median=a=>{if(!a.length)return 0;const b=[...a].sort((x,y)=>x-y);return b[Math.floor(b.length/2)]};
const stats=p=>{
 const vals=[...p.byWeek.values()];const avg=p.avgStandard||0;
 // Shrink sparse historical weekly maxima toward a conservative expected max.
 const historical=p.avgHigh||avg;const reliability=p.weeks/(p.weeks+6);
 const gamesPerWeek=p.games/Math.max(1,p.weeks);
 const expected=avg+Math.max(0,historical-avg)*reliability;
 const dispersion=p.logs.length>1?Math.sqrt(p.logs.reduce((s,r)=>s+(r.fp-avg)**2,0)/p.logs.length):0;
 const weeklyDisp=vals.length>1?Math.sqrt(vals.reduce((s,v)=>s+(v-historical)**2,0)/vals.length):dispersion;
 return {avg,expected,dispersion,weeklyDisp,weeks:p.weeks,games:p.games,gamesPerWeek};
};
let cached=null,cacheRows=null;
function model(){if(cacheRows===rows&&cached)return cached;const all=aggregates().filter(p=>p.positions.length&&p.games>0);const s=new Map(all.map(p=>[String(p.id),stats(p)]));
 const baselines={};for(const pos of ['PG','SG','SF','PF','C']){const eligible=all.filter(p=>p.positions.includes(pos)).map(p=>s.get(String(p.id)).expected).sort((a,b)=>b-a);baselines[pos]=eligible[Math.min(24,eligible.length-1)]||0;}
 const result=new Map();for(const p of all){const x=s.get(String(p.id));const replacement=Math.min(...p.positions.filter(pos=>baselines[pos]!==undefined).map(pos=>baselines[pos]));const baseline=Number.isFinite(replacement)?replacement:0;
 const surplus=Math.max(0,x.expected-baseline);const uncertainty=1-Math.min(.20,2/(x.weeks+5));
 // Experimental: value scale is projected weekly surplus + a small production component.
 const value=Math.max(0,(surplus+.22*x.expected)*uncertainty)*100;
 result.set(String(p.id),{...x,value,baseline,surplus,player:p});}
 cached=result;cacheRows=rows;return result;}
const V=n=>Math.round(n).toLocaleString("en-US");
function playerList(){return [...model().values()].sort((a,b)=>b.value-a.value||a.player.name.localeCompare(b.player.name));}
function optionHtml(selected='',slot='',exclude=[]){let list=playerList().filter(x=>(!slot||can(slot,x.player))&&(!exclude.includes(x.player.id)||String(x.player.id)===String(selected)));return '<option value="">Select player…</option>'+list.map(x=>`<option value="${E(x.player.id)}" ${String(x.player.id)===String(selected)?'selected':''}>${E(x.player.name)} · ${E(x.player.positions.join('/'))} · ${V(x.value)}</option>`).join('');}
function playerSelect(selected,slot,exclude,attr){return `<select class="tool-input" ${attr}>${optionHtml(selected,slot,exclude)}</select>`;}
// Searchable trade-only player picker: case/accent-insensitive substring matching.
function tradePicker(id,side,i){const name=id?getName(id):'';return `<div class="trade-picker" data-picker="${side}" data-i="${i}"><input class="tool-input trade-search" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-label="Search player by first or last name" placeholder="Type a first or last name…" value="${E(name)}"><div class="trade-results" role="listbox" hidden></div></div>`;}
const normalized=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function wireTradePickers(){
 const root=$('tradeView');
 root.querySelectorAll('.trade-picker').forEach(picker=>{
  const input=picker.querySelector('input'),menu=picker.querySelector('.trade-results');
  const side=picker.dataset.picker,i=+picker.dataset.i;
  let active=0, matches=[];
  const current=()=>side==='give'?tradeGive:tradeGet;
  function close(){menu.hidden=true;input.setAttribute('aria-expanded','false');}
  function select(id){current()[i]=String(id);renderTrade();}
  function draw(){
   const q=normalized(input.value);
   const taken=new Set([...tradeGive,...tradeGet].filter(Boolean).map(String));
   taken.delete(String(current()[i]));
   matches=q?playerList().filter(x=>!taken.has(String(x.player.id))&&normalized(x.player.name).includes(q)).slice(0,40):[];
   active=0;
   if(!q){close();menu.innerHTML='';return;}
   menu.innerHTML=matches.length?matches.map((x,j)=>`<button type="button" role="option" class="trade-result${j===active?' active':''}" data-id="${E(x.player.id)}" aria-selected="${j===active}"><span>${E(x.player.name)}<small>${E(x.player.positions.join('/'))}</small></span><strong>${V(x.value)}</strong></button>`).join(''):'<div class="trade-no-results">No matching players</div>';
   menu.hidden=false;input.setAttribute('aria-expanded','true');
  }
  input.addEventListener('focus',()=>{if(current()[i])input.select();if(input.value.trim()&&input.value!==getName(current()[i]))draw();});
  input.addEventListener('input',draw);
  input.addEventListener('keydown',e=>{
   if(e.key==='Escape'){close();input.blur();return;}
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(menu.hidden)draw();else if(matches.length){active=(active+(e.key==='ArrowDown'?1:-1)+matches.length)%matches.length;menu.querySelectorAll('.trade-result').forEach((b,j)=>{b.classList.toggle('active',j===active);b.setAttribute('aria-selected',String(j===active));});menu.querySelectorAll('.trade-result')[active]?.scrollIntoView({block:'nearest'});}return;}
   if(e.key==='Enter'&&!menu.hidden&&matches.length){e.preventDefault();select(matches[active].player.id);}
  });
  menu.addEventListener('pointerdown',e=>e.preventDefault());
  menu.addEventListener('click',e=>{const btn=e.target.closest('[data-id]');if(btn)select(btn.dataset.id)});
  input.addEventListener('blur',()=>{close();input.value=current()[i]?getName(current()[i]):'';});
 });
}
function getVal(id){return model().get(String(id))?.value||0;}
function getName(id){return model().get(String(id))?.player.name||'Unknown player';}
function sum(ids){return ids.reduce((a,id)=>a+getVal(id),0);}
function switchView(view){for(const v of ['rankings','trade','lineups','teams','draft'])$(v+'View').hidden=v!==view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='trade')renderTrade();if(view==='lineups')renderLineups();if(view==='teams')renderTeams();if(view==='draft')renderDraft();}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
function addSelector(side){let arr=side==='give'?tradeGive:tradeGet;arr.push('');renderTrade();}
// Fair Trade Finder: ranked suggestions centered on the exact balancing value.
// Suggestions are raw-value comparisons, not guarantees of improved lineup value.
function fairTradeFinder(a,b){
 if(!a.length||!b.length)return '';
 const equity=tradeEquity(a,b);
 const difference=equity.effective;
 const side=equity.side;
 const target=equity.target;
 const chosen=new Set([...a,...b].map(String));
 // Rank by the SAME injury-adjusted value used to calculate the target.
 const pool=playerList().filter(x=>!chosen.has(String(x.player.id)))
   .sort((x,y)=>adjustedVal(y.player.id)-adjustedVal(x.player.id)||x.player.name.localeCompare(y.player.name));
 if(!pool.length)return '';
 const pivot=pool.reduce((best,x,i)=>Math.abs(adjustedVal(x.player.id)-target)<Math.abs(adjustedVal(pool[best].player.id)-target)?i:best,0);
 const heading=difference===0?'Current adjusted totals are exactly balanced':`To balance the adjusted trade, add approximately ${V(target)} in value to ${side==='get'?'You receive':'You give'}`;
 return `<section class="fair-finder"><div class="fair-header"><div><h3>Fair Trade Finder</h3><p class="tool-subtle">${E(heading)}. The list automatically centers on the closest match.</p></div><div class="fair-target">Target <strong>${V(target)}</strong><small>±${V(FAIR_TOLERANCE)} fair range</small></div></div>
 <div class="fair-finder-controls"><label class="tool-subtle" for="fairFilter">Filter player names</label><input id="fairFilter" class="tool-input" type="search" placeholder="Search first or last name…" autocomplete="off"><button type="button" class="tool-btn alt" id="fairJump">Recenter fair-value range</button></div>
 <div class="fair-list" id="fairList" role="list" aria-label="Available players ranked by injury-adjusted trade value">${pool.map((x,i)=>{const val=adjustedVal(x.player.id),gap=val-target,isFair=Math.abs(tradeEquity(side==='get'?a:[...a,x.player.id],side==='get'?[...b,x.player.id]:b).effective)<=FAIR_TOLERANCE;return `<div role="listitem" class="fair-player ${isFair?'fair-match':'fair-miss'}${i===pivot?' fair-pivot':''}" data-fair-index="${i}" data-fair-name="${E(normalized(x.player.name))}"><span class="fair-rank">#${i+1}</span><span class="fair-player-name"><strong>${E(x.player.name)}</strong><small>${E(x.player.positions.join('/'))}</small></span><span class="fair-number">${V(val)}</span><span class="fair-gap">${gap>0?'+':''}${V(gap)}</span><span class="fair-verdict">${isFair?'FAIR':'UNFAIR'}</span><button class="tool-btn alt fair-add" type="button" data-fair-id="${E(x.player.id)}" data-fair-side="${side}">+ ${side==='get'?'Receive':'Give'}</button></div>`;}).join('')}</div>
 <p class="tool-subtle">Green = resulting star/depth-adjusted gap within ±${V(FAIR_TOLERANCE)}; red = outside. Candidate gap shows player value minus the target. This is an experimental model, not a market trade guarantee.</p></section>`;
}
function wireFairTradeFinder(){
 const list=$('fairList');if(!list)return;
 const jump=()=>{const anchor=list.querySelector('.fair-pivot:not([hidden])');if(anchor){list.scrollTop=Math.max(0,anchor.offsetTop-list.offsetTop-list.clientHeight/2+anchor.offsetHeight/2);}};
 // Center only the results container, never scroll the user's entire page.
 jump();
 $('fairJump').onclick=()=>{$('fairFilter').value='';list.querySelectorAll('.fair-player').forEach(x=>x.hidden=false);jump();};
 $('fairFilter').oninput=e=>{const q=normalized(e.target.value);list.querySelectorAll('.fair-player').forEach(x=>x.hidden=!x.dataset.fairName.includes(q));if(!q)jump();};
 list.onclick=e=>{const btn=e.target.closest('[data-fair-id]');if(!btn)return;const arr=btn.dataset.fairSide==='give'?tradeGive:tradeGet;const empty=arr.indexOf('');if(empty>=0)arr[empty]=btn.dataset.fairId;else arr.push(btn.dataset.fairId);renderTrade();};
}
function renderTrade(){let ready=playerList().length>0;
 const sideMarkup=side=>{const arr=side==='give'?tradeGive:tradeGet;return `<div class="tool-card"><h3>${side==='give'?'You give':'You receive'}</h3>${arr.map((id,i)=>`<div class="tool-row">${tradePicker(id,side,i)}<button class="small-action" data-remove="${side}" data-i="${i}" aria-label="Remove player">×</button></div>${id?(()=>{const baseline=injuryBaseline(id),manual=injuryWeeks[String(id)]!==undefined;return `<div class="trade-absence"><label>Estimated total injury weeks <input type="number" min="0" max="52" step="1" data-injury-id="${E(id)}" value="${totalWeeksOut(id)}"></label><span class="injury-baseline">First seen: ${E(reportFor(id)?.first_reported_at?.slice(0,10)||'not tracked yet')}</span><span class="injury-baseline">Remaining: <strong>${remainingInjuryDays(id)} days (${weeksOut(id)} rounded-up weeks)</strong> · ${reportFor(id)?.first_reported_at?'auto countdown from first report':'awaiting tracked first report'}</span>${baseline?`<span class="injury-baseline">${manual?'Manual override':'Suggested baseline'}: ${baseline.weeks} weeks · ${E(baseline.label)} (${baseline.days} historical calendar days)${manual?` <button type="button" class="baseline-reset" data-reset-injury="${E(id)}">Reset suggestion</button>`:''}</span>`:'<span class="tool-subtle">No specific historical injury match — defaults to 0; edit if needed.</span>'}${injuryDisplay(id)}<span>Historical High Score avg: <strong>${(model().get(String(id))?.player.avgHigh||0).toFixed(2)}</strong><span class="trade-player-value">Base value: <strong>${V(getVal(id))}</strong> · Injury: <strong>−${V(injuryDeduction(id))}</strong> · Adjusted: <strong>${V(adjustedVal(id))}</strong></span></span></div>`;})():''}`).join('')}<div class="tool-actions"><button class="tool-btn alt" data-add="${side}">+ Add player</button></div>${tradeBreakdown(arr,side==='give'?tradeGet.filter(Boolean):tradeGive.filter(Boolean),side==='give'?'Outgoing':'Incoming')}</div>`};
 $('tradeView').innerHTML=`<section class="panel tool-pad"><div class="tool-heading"><div><h2>Trade Calculator</h2><p class="muted">Compare historical production, experimental trade values and injury-adjusted scenarios.</p></div></div>${!ready?'<p class="tool-notice">Waiting for NBA game logs and Yahoo positions.</p>':''}<div class="tool-control tool-horizon"><label for="tradeHorizon">Comparison horizon: <strong>${tradeHorizon} weeks</strong></label><input id="tradeHorizon" type="range" min="1" max="24" step="1" value="${tradeHorizon}"><p class="tool-subtle">For a specifically matched Out injury, a provisional total-duration baseline is suggested. First-seen injury dates are recorded automatically by the GitHub updater; the countdown advances daily. Remaining weeks always round up. Injury risk compounds and caps at an 80% discount after 8 remaining weeks; it falls to zero after the estimated return date.</p></div><p class="tool-subtle">Injury feed: ${injuryFeed.updated_at?E(injuryFeed.updated_at):'not yet available'}. No matching report entry does not mean healthy.</p><div class="tool-grid">${sideMarkup('give')}${sideMarkup('get')}</div><div id="tradeAnalysis"></div><p class="tool-footer">Historical baselines are manually entered reference medians, not a live Hashtag Basketball API, a verified remaining-time estimate, or a medical prognosis. They apply only to exact injury categories on official Out reports. Missing or nonspecific injuries default to zero until manually adjusted. First-seen report timestamps are not necessarily actual injury onset dates; tracking starts after the new updater is installed. Estimates are experimental; no replacements or actual playoff odds are modeled. Star premium uses an experimental 0.55 × value × (value / highest player value)^1.2 curve inspired by KeepTradeCut’s published concept, NOT its proprietary algorithm. Trade values are experimental, not backtested.</p></section>`;
 wireTradePickers();
 $('tradeHorizon').oninput=e=>{tradeHorizon=+e.target.value;renderTrade()};
 $('tradeView').querySelectorAll('[data-injury-id]').forEach(el=>el.onchange=()=>{injuryWeeks[el.dataset.injuryId]=Math.max(0,Math.min(52,Math.ceil(Number(el.value)||0)));renderTrade()});
 
 $('tradeView').querySelectorAll('[data-reset-injury]').forEach(el=>el.onclick=()=>{delete injuryWeeks[el.dataset.resetInjury];renderTrade()});
 $('tradeView').querySelectorAll('[data-add]').forEach(el=>el.onclick=()=>addSelector(el.dataset.add));
 $('tradeView').querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{let arr=el.dataset.remove==='give'?tradeGive:tradeGet;arr.splice(+el.dataset.i,1);if(!arr.length)arr.push('');renderTrade()});
 const a=tradeGive.filter(Boolean),b=tradeGet.filter(Boolean),equity=a.length&&b.length?tradeEquity(a,b):null,diff=equity?equity.effective:adjustedSum(b)-adjustedSum(a),rawDiff=sum(b)-sum(a),extra=b.length-a.length;
 let msg='Select players on both sides to see the trade analysis.';
 if(a.length&&b.length){if(extra>0){msg=`You receive ${extra} extra player${extra===1?'':'s'}. To break even, the combined adjusted value of players displaced from your roster must be ${V(diff)} or less${diff<0?' — this trade is already behind before considering roster spots':''}.`;}else if(extra<0){msg=`You free ${-extra} roster spot${extra===-1?'':'s'}. To break even, the combined adjusted value of replacement players added in those spots must be at least ${V(-diff)}${diff>=0?' (already ahead before replacement additions)':''}.`;}else{msg=`Equal player counts do NOT guarantee equal value. ${diff>=0?'Receiving side leads':'Giving side leads'} by ${V(Math.abs(diff))} adjusted units. The Fair Trade Finder below suggests additions for the lower-valued side.`;}}
 const balancingSide=diff<0?'You receive':'You give';
 const tradeFair=a.length&&b.length&&Math.abs(diff)<=FAIR_TOLERANCE;
 const verdict=a.length&&b.length?`<div class="trade-verdict ${tradeFair?'trade-verdict-fair':'trade-verdict-unfair'}" role="status"><strong>${tradeFair?'FAIR TRADE':'UNFAIR TRADE'}</strong><span>Star/depth-adjusted gap: ${V(Math.abs(diff))} points · fair threshold ±${V(FAIR_TOLERANCE)}${!tradeFair?' · '+(diff>0?'You receive more value':'You give more value'):''}</span></div>`:'';
 $('tradeAnalysis').innerHTML=`<div class="tool-stats"><div class="tool-stat"><strong>${V(adjustedSum(a)+equity?.givePremium||adjustedSum(a))}</strong><span>Outgoing final adjusted total</span></div><div class="tool-stat"><strong>${V(adjustedSum(b)+equity?.receivePremium||adjustedSum(b))}</strong><span>Incoming final adjusted total</span></div><div class="tool-stat"><strong class="${diff>=0?'tool-good':'tool-warning'}">${diff>0?'+':''}${V(diff)}</strong><span>Adjusted difference (including stud/depth)</span></div></div>${verdict}<div class="tool-notice">${E(msg)}</div>${a.length&&b.length?`<section class="trade-breakdown trade-balance" aria-label="Fair trade balancing breakdown"><h3>Trade adjustments · separate from player values</h3><div class="trade-breakdown-row"><span>Base player value difference (receive − give)</span><strong>${rawDiff>=0?'+':''}${V(rawDiff)}</strong></div><div class="trade-breakdown-row trade-deduction"><span>Compounding injury deduction · receiving players</span><strong>−${V(injuryDeductionSum(b))}</strong></div><div class="trade-breakdown-row"><span>Compounding injury deduction · outgoing players (benefit to receiving side)</span><strong>+${V(injuryDeductionSum(a))}</strong></div><div class="trade-breakdown-row trade-breakdown-total"><span>Net injury-adjusted advantage (receive − give)</span><strong>${equity.raw>=0?'+':''}${V(equity.raw)}</strong></div><div class="trade-breakdown-row"><span>Star premium difference (receive − give)</span><strong>${equity.studAdjustment>=0?'+':''}${V(equity.studAdjustment)}</strong></div><div class="trade-breakdown-row trade-breakdown-total"><span>Final adjusted advantage (receive − give)</span><strong>${diff>=0?'+':''}${V(diff)}</strong></div><div class="trade-breakdown-row trade-suggestion"><span>Suggested additional player value on ${balancingSide} side · not included in totals</span><strong>+${V(equity.target)}</strong></div><p class="tool-subtle">Suggested addition solves the experimental star/depth-weighted gap, not just the raw totals. It is not credited until a player is added. Injury deductions and the stud/depth adjustment are shown separately from base player values.</p></section>`:''}${a.length&&b.length?fairTradeFinder(a,b):''}`;
 wireFairTradeFinder();
}
// Max-weight legal assignment of up to 13 slots, allowing a bench. Dynamic programming over slot masks.
function optimize(ids){const available=[...new Set(ids.filter(id=>model().has(String(id))))].slice(0,30);let dp=new Map([[0,{score:0,assigned:Array(13).fill('')}]]);for(const id of available){const next=new Map(dp);const p=model().get(String(id));for(const [mask,st] of dp){for(let j=0;j<13;j++){if(mask&(1<<j)||!can(SLOTS[j],p.player))continue;const m=mask|(1<<j),score=st.score+p.expected;const old=next.get(m);if(!old||score>old.score){let assigned=st.assigned.slice();assigned[j]=id;next.set(m,{score,assigned});}}}dp=next;}let best={score:0,assigned:Array(13).fill('')};for(const st of dp.values())if(st.score>best.score)best=st;return best.assigned;}
function renderLineups(){const names=Object.keys(teams).sort();$('lineupsView').innerHTML=`<section class="panel tool-pad"><div class="tool-heading"><div><h2>Starting Lineup Comparison</h2><p class="muted">Choose 13 players per lineup, or import saved rosters. The same player may appear in both lineups.</p></div></div><div class="tool-grid">${['A','B'].map(side=>{let arr=side==='A'?rosterA:rosterB;return `<div class="tool-card"><h3>Lineup ${side}</h3><div class="tool-chooser"><select class="tool-input" data-import="${side}"><option value="">Import saved team…</option>${names.map(n=>`<option value="${E(n)}">${E(n)}</option>`).join('')}</select><button class="tool-btn alt" data-clear="${side}">Start from scratch</button></div><div class="tool-actions"><button class="tool-btn alt" data-opt="${side}">Optimize selected players</button><button class="tool-btn alt" data-save="${side}">Save as team</button></div>${SLOTS.map((slot,i)=>`<div class="tool-row"><span class="slot">${slot}</span>${playerSelect(arr[i],slot,arr.filter((x,j)=>j!==i),'data-lineup="'+side+'" data-i="'+i+'"')}<span class="player-value">${arr[i]?model().get(String(arr[i]))?.expected.toFixed(1)||'—':'—'}</span></div>`).join('')}<div class="tool-metric">${arr.reduce((s,id)=>s+(model().get(String(id))?.expected||0),0).toFixed(1)}</div><span class="tool-subtle">Projected sum of weekly best-game scores (selected slots)</span></div>`}).join('')}</div><div id="lineupAnalysis"></div><p class="tool-footer">Each slot counts the player's projected best game in a typical active week. This is not a guarantee of actual weekly points; the model does not yet simulate game schedules, missed games or Yahoo lineup-lock rules. FC accepts SF, PF or C; G accepts PG or SG.</p></section>`;
 $('lineupsView').querySelectorAll('[data-lineup]').forEach(el=>el.onchange=()=>{(el.dataset.lineup==='A'?rosterA:rosterB)[+el.dataset.i]=el.value;renderLineups()});
 $('lineupsView').querySelectorAll('[data-clear]').forEach(el=>el.onclick=()=>{if(el.dataset.clear==='A')rosterA=Array(13).fill('');else rosterB=Array(13).fill('');renderLineups()});
 $('lineupsView').querySelectorAll('[data-opt]').forEach(el=>el.onclick=()=>{if(el.dataset.opt==='A')rosterA=optimize(rosterA);else rosterB=optimize(rosterB);renderLineups()});
 $('lineupsView').querySelectorAll('[data-import]').forEach(el=>el.onchange=()=>{const t=teams[el.value];if(!t)return;let ids=(Array.isArray(t.players)?t.players:[]).map(String);const saved=Array.isArray(t.lineup)?t.lineup.map(String):[];const valid=saved.length===13&&saved.every((id,i)=>!id||model().has(id)&&can(SLOTS[i],model().get(id).player));const lineup=valid?saved:optimize(ids);if(el.dataset.import==='A')rosterA=lineup;else rosterB=lineup;renderLineups()});
 $('lineupsView').querySelectorAll('[data-save]').forEach(el=>el.onclick=()=>{let arr=el.dataset.save==='A'?rosterA:rosterB;let name=prompt('Team name to save this lineup under:');if(name===null)return;name=name.trim();if(!name)return alert('Enter a team name.');if(teams[name]&&!confirm('Replace the existing saved team '+name+'?'))return;teams[name]={players:[...new Set(arr.filter(Boolean))],lineup:arr.slice(),updated:new Date().toISOString()};persist();renderLineups();alert('Saved '+name+'. You can add bench players under My Teams.');});
 const info=arr=>{const selected=arr.filter(Boolean).map(id=>model().get(String(id))).filter(Boolean);return {n:selected.length,total:selected.reduce((s,p)=>s+p.expected,0),avg:selected.reduce((s,p)=>s+p.avg,0),upside:selected.reduce((s,p)=>s+p.weeklyDisp,0),scarcity:selected.reduce((s,p)=>s+p.surplus,0),lowSample:selected.filter(p=>p.weeks<5).length,stars:selected.filter(p=>p.expected>=45).length};};const a=info(rosterA),b=info(rosterB);let winner=a.total>b.total?'A':b.total>a.total?'B':'Tie';const pros=(v,o)=>[v.total>o.total?'Higher projected weekly scoring':'',v.scarcity>o.scarcity?'More positional surplus value':'',v.upside<o.upside?'Lower historical weekly volatility':'',v.stars>o.stars?'More 45+ projected weekly scorers':''].filter(Boolean);const cons=(v,o)=>[v.total<o.total?'Lower projected weekly scoring':'',v.upside>o.upside?'Higher historical weekly volatility':'',v.lowSample?'Includes '+v.lowSample+' player(s) with fewer than 5 active weeks':'',v.n<13?'Incomplete lineup ('+v.n+'/13 slots)':''].filter(Boolean);
 $('lineupAnalysis').innerHTML=`<div class="tool-notice"><strong>${a.n===13&&b.n===13?winner==='Tie'?'Lineups project equally':`Lineup ${winner} leads by ${Math.abs(a.total-b.total).toFixed(1)} projected weekly points`:'Complete both lineups for a full comparison'}</strong><p class="tool-subtle">Lineup A: ${a.n}/13 filled · Lineup B: ${b.n}/13 filled</p></div><div class="tool-grid">${[[a,b,'A'],[b,a,'B']].map(([v,o,side])=>`<div class="tool-card"><h3>Lineup ${side}: Pros & Cons</h3><p class="tool-good"><strong>Strengths</strong></p><ul class="tool-list">${(pros(v,o).length?pros(v,o):['No clear measured advantage yet']).map(s=>`<li>${E(s)}</li>`).join('')}</ul><p class="tool-warning"><strong>Tradeoffs</strong></p><ul class="tool-list">${(cons(v,o).length?cons(v,o):['No major measured drawback']).map(s=>`<li>${E(s)}</li>`).join('')}</ul><p class="tool-subtle">Historical volatility is descriptive, not a calibrated future risk forecast.</p></div>`).join('')}</div>`;
}
function persist(){try{localStorage.setItem(STORE,JSON.stringify(teams));return true}catch(e){alert('Could not save to this browser: '+e.message);return false}}
function renderTeams(){const names=Object.keys(teams).sort();$('teamsView').innerHTML=`<section class="panel tool-pad"><div class="tool-heading"><div><h2>My Teams</h2><p class="muted">Save full rosters and reuse them in lineup comparisons. Rosters stay in this browser unless exported.</p></div></div><div class="tool-actions"><button class="tool-btn" id="createTeam">+ Create team</button><button class="tool-btn alt" id="exportTeams">Export backup (.json)</button><button class="tool-btn alt" id="importTeams">Import backup (.json)</button><input type="file" accept=".json,application/json" id="teamFile" hidden></div>${names.length?names.map(n=>{let t=teams[n];return `<div class="tool-team-item"><h3>${E(n)}</h3><p class="tool-subtle">${t.players.length} players · Last saved ${E(t.updated?new Date(t.updated).toLocaleString():'unknown')}</p><div class="tool-actions"><button class="tool-btn alt" data-edit="${E(n)}">Edit roster</button><button class="tool-btn alt" data-compare="${E(n)}">Compare lineup</button><button class="tool-btn warn" data-delete="${E(n)}">Delete</button></div></div>`}).join(''):'<p class="tool-notice">No saved teams yet. Create one, or save a lineup from the comparison tool.</p>'}<div id="teamEditor"></div><p class="tool-footer">No accounts or cloud syncing. Clearing browser site data may delete saved teams. Export backups regularly. Imported files should come from sources you trust.</p></section>`;
 $('createTeam').onclick=()=>{let name=prompt('Name your team:');if(name===null)return;name=name.trim();if(!name)return;if(teams[name])return alert('That team already exists.');teams[name]={players:[],lineup:Array(13).fill(''),updated:new Date().toISOString()};persist();activeTeam=name;renderTeams();};
 $('exportTeams').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,teams},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='fantasy-basketball-teams-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
 $('importTeams').onclick=()=>$('teamFile').click();$('teamFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1e6)throw Error('Backup is too large');const data=JSON.parse(await file.text());if(data.version!==1||!data.teams||typeof data.teams!=='object'||Array.isArray(data.teams))throw Error('Invalid team backup');const entries=Object.entries(data.teams);if(entries.length>100)throw Error('Too many teams');const cleaned={};for(const [name,t] of entries){if(!name||name.length>80||!Array.isArray(t.players)||t.players.length>100)throw Error('Invalid team entry');cleaned[name]={players:[...new Set(t.players.map(String))].filter(id=>model().has(id)),lineup:Array.isArray(t.lineup)&&t.lineup.length===13?t.lineup.map(String):Array(13).fill(''),updated:new Date().toISOString()}}if(!confirm(`Import ${entries.length} team(s)? Teams with matching names will be replaced.`))return;Object.assign(teams,cleaned);persist();renderTeams()}catch(err){alert('Import failed: '+err.message)}e.target.value=''};
 $('teamsView').querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>{activeTeam=el.dataset.edit;showTeamEditor()});
 $('teamsView').querySelectorAll('[data-compare]').forEach(el=>el.onclick=()=>{const t=teams[el.dataset.compare];rosterA=optimize(t.players);switchView('lineups')});
 $('teamsView').querySelectorAll('[data-delete]').forEach(el=>el.onclick=()=>{if(confirm('Delete '+el.dataset.delete+' from this browser?')){delete teams[el.dataset.delete];if(activeTeam===el.dataset.delete)activeTeam='';persist();renderTeams()}});
 if(activeTeam&&teams[activeTeam])showTeamEditor();}
function showTeamEditor(){const t=teams[activeTeam];if(!t)return;const ids=t.players.map(String).filter(id=>model().has(id));$('teamEditor').innerHTML=`<hr class="tool-divider"><div class="tool-card"><h3>Edit ${E(activeTeam)}</h3><p class="tool-subtle">Add or remove players, then save. When imported for comparison, the site automatically optimizes the 13 starting slots.</p><div class="tool-actions"><select class="tool-input" id="teamAddPlayer" style="max-width:420px">${optionHtml('','',ids)}</select><button class="tool-btn" id="teamAdd">Add player</button></div>${ids.map(id=>`<div class="tool-row"><span>${E(getName(id))} <span class="tool-subtle">(${getVal(id).toFixed(1)})</span></span><button class="small-action" data-drop-id="${E(id)}">Remove</button></div>`).join('')||'<p class="muted">No players yet.</p>'}<div class="tool-actions"><button class="tool-btn" id="teamSave">Save roster</button><button class="tool-btn alt" id="teamRename">Rename team</button></div></div>`;
 $('teamAdd').onclick=()=>{const id=$('teamAddPlayer').value;if(id&&!ids.includes(id)){t.players.push(id);showTeamEditor()}};
 $('teamEditor').querySelectorAll('[data-drop-id]').forEach(el=>el.onclick=()=>{t.players=t.players.filter(id=>String(id)!==el.dataset.dropId);showTeamEditor()});
 $('teamSave').onclick=()=>{t.updated=new Date().toISOString();t.lineup=optimize(t.players);persist();renderTeams()};
 $('teamRename').onclick=()=>{let name=prompt('New team name:',activeTeam);if(name===null)return;name=name.trim();if(!name||name===activeTeam)return;if(teams[name])return alert('That name is already used.');teams[name]=teams[activeTeam];delete teams[activeTeam];activeTeam=name;persist();renderTeams()};}
// Historical Yahoo draft picks, persisted as a static CSV; redraft ranking is live from app.js.
const draftKey=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(jr|iii|ii|iv)\b/g,'').replace(/[^a-z0-9]/g,'');
const draftAlias={'jimmybutler':'jimmybutleriii','pjwashington':'pjwashingtonjr','bobbyportis':'bobbyportisjr'};
function draftPlayerKey(s){let k=draftKey(s);return draftAlias[k]||k;}
async function loadDraft(){try{const r=await fetch('data/draft_results.csv',{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const parsed=parseCSV(await r.text());originalDraft=parsed.filter(x=>x.player&&Number(x.draft_round)>0).map(x=>({name:x.player,round:Number(x.draft_round),pick:Number(x.draft_pick_in_round)}));if(!originalDraft.length)throw Error('No draft picks found');draftLoadError='';}catch(e){draftLoadError='Draft data unavailable: '+e.message;originalDraft=[];}if($('draftView')&&!$('draftView').hidden)renderDraft();}
function draftAnalysis(){
 const actual=aggregates().filter(p=>p.weeks>0).sort((a,b)=>b.avgHigh-a.avgHigh||b.totalHigh-a.totalHigh||a.name.localeCompare(b.name));
 const original=new Map(originalDraft.map((p,i)=>[draftPlayerKey(p.name),{...p,overall:i+1}]));
 const current=new Map();actual.forEach((p,i)=>{const key=draftPlayerKey(p.name);if(!current.has(key))current.set(key,{...p,rank:i+1,redraftRound:Math.ceil((i+1)/10)});});
 const out=originalDraft.map((d,i)=>{const p=current.get(draftPlayerKey(d.name));return {name:d.name,originalRound:d.round,originalPick:i+1,avg:p?.avgHigh??null,weeks:p?.weeks??0,redraftRound:p?.redraftRound??null,redraftRank:p?.rank??null,change:p?d.round-p.redraftRound:null,undrafted:false};});
 // Current performers not originally drafted are meaningful redraft steals.
 for(const p of current.values()){const key=draftPlayerKey(p.name);if(!original.has(key)&&p.rank<=originalDraft.length){out.push({name:p.name,originalRound:null,originalPick:null,avg:p.avgHigh,weeks:p.weeks,redraftRound:p.redraftRound,redraftRank:p.rank,change:null,undrafted:true});}}
 return out;
}
function renderDraft(){const root=$('draftView');if(!root)return;
 if(!root.querySelector('#draftStealsRows'))root.innerHTML=`<section class="panel tool-pad"><div class="tool-heading"><div><h2>🏆 Draft Steals & Busts</h2><p class="muted">The biggest movers from your original 170-pick Yahoo draft, redrafted using today's average weekly High Score.</p></div></div><div class="draft-dual"><section class="draft-column draft-steals"><h3>🟢 Top 25 Draft Steals</h3><div class="tablewrap"><table class="draft-side-table"><thead><tr><th>#</th><th>PLAYER</th><th class="right">AVG WK HS</th><th class="right">DRAFT</th><th class="right">TODAY</th><th class="right">CHANGE</th></tr></thead><tbody id="draftStealsRows"></tbody></table></div></section><section class="draft-column draft-busts"><h3>🔴 Top 25 Draft Busts</h3><div class="tablewrap"><table class="draft-side-table"><thead><tr><th>#</th><th>PLAYER</th><th class="right">AVG WK HS</th><th class="right">DRAFT</th><th class="right">TODAY</th><th class="right">CHANGE</th></tr></thead><tbody id="draftBustsRows"></tbody></table></div></section></div><p id="draftSummary" class="draft-note"></p><p class="draft-note">Based on actual High Score production so far, not future projections. Ten picks per round. Undrafted breakouts appear as steals. Drafted players with no logged games are shown as unranked busts; missing games or injuries may exaggerate movement.</p></section>`;
 const status=$('draftSummary'),steals=$('draftStealsRows'),busts=$('draftBustsRows');
 if(draftLoadError||!originalDraft.length||!rows.length){const msg=draftLoadError||(!originalDraft.length?'Loading original draft results…':'Waiting for NBA game logs. Check data/game_logs.csv on GitHub.');status.textContent=msg;steals.innerHTML=`<tr><td colspan="6">${E(msg)}</td></tr>`;busts.innerHTML=`<tr><td colspan="6">${E(msg)}</td></tr>`;return;}
 const all=draftAnalysis();const good=all.filter(x=>x.undrafted||x.change>0);const bad=all.filter(x=>x.change<0||x.avg===null);
 const impact=x=>x.undrafted?18-(x.redraftRound||18):x.change===null?18:x.change;
 good.sort((a,b)=>impact(b)-impact(a)||(a.redraftRank??999)-(b.redraftRank??999));
 bad.sort((a,b)=>{const av=a.avg===null?18:Math.abs(a.change),bv=b.avg===null?18:Math.abs(b.change);return bv-av||(a.originalPick??999)-(b.originalPick??999)});
 function cells(items,kind){return items.slice(0,25).map((p,i)=>{const isGood=kind==='good';const movement=p.undrafted?'↑ Undrafted':p.avg===null?'↓ Unranked':(isGood?'↑ ':'↓ ')+Math.abs(p.change)+' rd';const cls=isGood?'draft-green':'draft-red';return `<tr><td>${i+1}</td><td><strong>${E(p.name)}</strong></td><td class="right">${p.avg===null?'—':p.avg.toFixed(2)}</td><td class="right">${p.originalRound===null?'UD':'R'+p.originalRound}</td><td class="right">${p.redraftRound===null?'—':'R'+p.redraftRound}</td><td class="right ${cls}">${movement}</td></tr>`}).join('')||'<tr><td colspan="6">No qualifying players yet.</td></tr>'}
 steals.innerHTML=cells(good,'good');busts.innerHTML=cells(bad,'bad');status.textContent=`${originalDraft.length} original picks · ${good.length} steals/breakouts · ${bad.length} busts/fallers · Updated from current game logs`;
}
loadDraft();
// Data is loaded asynchronously by app.js. Refresh selectors once loading completes.
loadInjuries();
const previousRender=render;render=function(...args){const result=previousRender(...args);if(!$('tradeView').hidden)renderTrade();if(!$('lineupsView').hidden)renderLineups();if(!$('draftView').hidden)renderDraft();return result};
})();
