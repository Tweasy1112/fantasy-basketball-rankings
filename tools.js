/* Optional trade, lineup and saved roster tools. No external APIs or accounts. */
(()=>{'use strict';
const $=id=>document.getElementById(id), E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SLOTS=['PG','SG','G','G','G','SF','PF','C','FC','FC','Util','Util','Util'];
const STORE='fantasy-basketball-teams-v1';
let teams={};try{const obj=JSON.parse(localStorage.getItem(STORE)||'{}');if(obj&&typeof obj==='object'&&!Array.isArray(obj))teams=obj;}catch(e){}
let rosterA=Array(13).fill(''),rosterB=Array(13).fill(''),tradeGive=['',''],tradeGet=['','',''];
let rosterTeamA='',rosterTeamB='',activeTeam='',draftPlayers=[];
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
   matches=playerList().filter(x=>!taken.has(String(x.player.id))&&(!q||normalized(x.player.name).includes(q))).slice(0,35);
   active=0;
   menu.innerHTML=matches.length?matches.map((x,j)=>`<button type="button" role="option" class="trade-result${j===active?' active':''}" data-id="${E(x.player.id)}" aria-selected="${j===active}"><span>${E(x.player.name)}<small>${E(x.player.positions.join('/'))}</small></span><strong>${V(x.value)}</strong></button>`).join(''):'<div class="trade-no-results">No matching players</div>';
   menu.hidden=false;input.setAttribute('aria-expanded','true');
  }
  input.addEventListener('focus',()=>{input.select();draw()});
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
function switchView(view){for(const v of ['rankings','trade','lineups','teams'])$(v+'View').hidden=v!==view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));if(view==='trade')renderTrade();if(view==='lineups')renderLineups();if(view==='teams')renderTeams();}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
function addSelector(side){let arr=side==='give'?tradeGive:tradeGet;arr.push('');renderTrade();}
// Fair Trade Finder: ranked suggestions centered on the exact balancing value.
// Suggestions are raw-value comparisons, not guarantees of improved lineup value.
function fairTradeFinder(a,b){
 if(!a.length||!b.length)return '';
 const difference=sum(b)-sum(a);
 const side=difference<0?'get':'give';
 const target=Math.abs(difference);
 const chosen=new Set([...a,...b].map(String));
 const pool=playerList().filter(x=>!chosen.has(String(x.player.id)));
 if(!pool.length)return '';
 // The first candidate whose value is at or below the target is the scroll anchor.
 let pivot=pool.findIndex(x=>x.value<=target);
 if(pivot<0)pivot=pool.length-1;
 const heading=difference===0?'The current player totals are balanced':`Add approximately ${V(target)} in value to ${side==='get'?'You receive':'You give'} to balance the trade`;
 return `<section class="fair-finder"><div class="fair-header"><div><h3>Fair Trade Finder</h3><p class="tool-subtle">${E(heading)}. Ranked highest to lowest, automatically positioned near ${V(target)}.</p></div><div class="fair-target">Target <strong>${V(target)}</strong></div></div>
 <div class="fair-finder-controls"><label class="tool-subtle" for="fairFilter">Filter player names</label><input id="fairFilter" class="tool-input" type="search" placeholder="Search first or last name…" autocomplete="off"><button type="button" class="tool-btn alt" id="fairJump">Jump to fair-value range</button></div>
 <div class="fair-list" id="fairList" role="list" aria-label="Available players ranked by trade value">${pool.map((x,i)=>`<div role="listitem" class="fair-player${i===pivot?' fair-pivot':''}" data-fair-index="${i}" data-fair-name="${E(normalized(x.player.name))}"><span class="fair-rank">#${i+1}</span><span class="fair-player-name"><strong>${E(x.player.name)}</strong><small>${E(x.player.positions.join('/'))}</small></span><span class="fair-number">${V(x.value)}</span><span class="fair-gap">${x.value>=target?'+':''}${V(x.value-target)}</span><button class="tool-btn alt fair-add" type="button" data-fair-id="${E(x.player.id)}" data-fair-side="${side}">+ ${side==='get'?'Receive':'Give'}</button></div>`).join('')}</div>
 <p class="tool-subtle">Difference column = player's value minus the amount needed. A value near zero is the closest one-player match. Adding a player changes roster counts and may require dropping or replacing someone; evaluate the updated break-even guidance above.</p></section>`;
}
function wireFairTradeFinder(){
 const list=$('fairList');if(!list)return;
 const jump=()=>{const anchor=list.querySelector('.fair-pivot:not([hidden])');if(anchor)list.scrollTop=anchor.offsetTop-list.offsetTop-list.clientHeight/2+anchor.offsetHeight/2;};
 jump();$('fairJump').onclick=()=>{$('fairFilter').value='';list.querySelectorAll('.fair-player').forEach(x=>x.hidden=false);jump();};
 $('fairFilter').oninput=e=>{const q=normalized(e.target.value);list.querySelectorAll('.fair-player').forEach(x=>x.hidden=!x.dataset.fairName.includes(q));};
 list.onclick=e=>{const btn=e.target.closest('[data-fair-id]');if(!btn)return;const arr=btn.dataset.fairSide==='give'?tradeGive:tradeGet;const empty=arr.indexOf('');if(empty>=0)arr[empty]=btn.dataset.fairId;else arr.push(btn.dataset.fairId);renderTrade();};
}
function renderTrade(){let ready=playerList().length>0;
 $('tradeView').innerHTML=`<section class="panel tool-pad"><div class="tool-heading"><div><h2>Trade Calculator</h2><p class="muted">Compare experimental player trade values, including weekly High Score production and positional scarcity.</p></div></div>${!ready?'<p class="tool-notice">Waiting for NBA game logs and Yahoo positions.</p>':''}<div class="tool-grid">${['give','get'].map(side=>{let arr=side==='give'?tradeGive:tradeGet;return `<div class="tool-card"><h3>${side==='give'?'You give':'You receive'}</h3>${arr.map((id,i)=>`<div class="tool-row">${tradePicker(id,side,i)}<button class="small-action" data-remove="${side}" data-i="${i}" aria-label="Remove player">×</button></div>`).join('')}<div class="tool-actions"><button class="tool-btn alt" data-add="${side}">+ Add player</button></div><div class="tool-metric">${V(sum(arr))}</div><span class="tool-subtle">Combined trade value</span></div>`}).join('')}</div><div id="tradeAnalysis"></div><p class="tool-footer">Experimental values are not actual Yahoo trade values. Role/injury status is not yet connected to a verified live injury feed; no injury assumptions are made. Historical High Score weeks currently use provisional Monday–Sunday boundaries.</p></section>`;
 wireTradePickers();
 $('tradeView').querySelectorAll('[data-add]').forEach(el=>el.onclick=()=>addSelector(el.dataset.add));
 $('tradeView').querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>{let arr=el.dataset.remove==='give'?tradeGive:tradeGet;arr.splice(+el.dataset.i,1);if(!arr.length)arr.push('');renderTrade()});
 const a=tradeGive.filter(Boolean),b=tradeGet.filter(Boolean),diff=sum(b)-sum(a),extra=b.length-a.length;
 let msg='Select players on both sides to see the trade analysis.';
 if(a.length&&b.length){const low=b.map(getVal).sort((x,y)=>x-y)[0];if(extra>0){msg=`You receive ${extra} extra player${extra===1?'':'s'} and must free ${extra} roster spot${extra===1?'':'s'}. The COMBINED value of the players you drop must be ${V(diff)} or lower to break even${diff<0?' (impossible with nonnegative values)':''}. ${extra===1?`The lowest-valued incoming player is ${V(low)}, but the correct break-even threshold is ${V(diff)}.`:''}`;}else if(extra<0){msg=`You free ${-extra} roster spot${extra===-1?'':'s'}. To break even, the COMBINED value of players you add in those spots must be at least ${V(-diff)}. If the number is negative, the trade already gains value before replacements.`;}else{msg=`Same number of players exchanged. ${diff>=0?'Receiving side gains':'Receiving side loses'} ${V(Math.abs(diff))} trade-value units before lineup fit.`;}}
 $('tradeAnalysis').innerHTML=`<div class="tool-stats"><div class="tool-stat"><strong>${V(sum(a))}</strong><span>Outgoing value</span></div><div class="tool-stat"><strong>${V(sum(b))}</strong><span>Incoming value</span></div><div class="tool-stat"><strong class="${diff>=0?'tool-good':'tool-warning'}">${diff>0?'+':''}${V(diff)}</strong><span>Before roster-slot changes</span></div></div><div class="tool-notice">${E(msg)}</div>${a.length&&b.length?'<p class="tool-subtle">Compare both sides using the same units. A positive difference alone does not guarantee a better lineup; available roster spots, position fit, and replacements matter.</p>':''}${a.length&&b.length?fairTradeFinder(a,b):''}`;
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
// Data is loaded asynchronously by app.js. Refresh selectors once loading completes.
const previousRender=render;render=function(...args){const result=previousRender(...args);if(!$('tradeView').hidden)renderTrade();if(!$('lineupsView').hidden)renderLineups();return result};
})();
