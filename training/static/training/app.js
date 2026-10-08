'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parseDate = s => new Date(Number(s.slice(0,4)), Number(s.slice(5,7))-1, Number(s.slice(8,10)), 12);
const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
const today = `${parts.year}-${parts.month}-${parts.day}`;
let month = today.slice(0,7), selected = today, data = null, activeView = 'calendar';
let loadGeneration = 0;
const colors = ['#a7c9c7','#85b297','#d4bd67','#dc9264','#bc6570'];
const zoneNames = ['Regeneracja','Wytrzymałość tlenowa','Tempo','Próg','Powyżej progu'];
const num = (n, digits=0) => Number(n || 0).toLocaleString('pl-PL',{maximumFractionDigits:digits});
const time = mins => mins >= 60 ? `${Math.floor(mins/60)} h ${Math.round(mins%60)} min` : `${num(mins,1)} min`;
const shortDay = key => parseDate(key).toLocaleDateString('pl-PL',{day:'numeric',month:'short'});
const activitiesOn = key => data.activities.filter(a=>a.date===key);
const labelOf = a => a.title || a.kind_label;
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const RUNNING_KINDS=new Set(['endurance','recovery_run','starts','short_sprints','fast_intervals','tempo_intervals','tempo_run','intervals','speed']);
const RUNNING_CATEGORIES=[
  {label:'Bieg spokojny',kinds:['endurance'],note:'Spokojna praca tlenowa'},
  {label:'Bieg regeneracyjny',kinds:['recovery_run'],note:'Lekki bieg połączony z regeneracją'},
  {label:'Starty biegowe',kinds:['starts'],note:'Krótkie starty i pierwsze kroki'},
  {label:'Krótkie sprinty',kinds:['short_sprints'],note:'Krótkie odcinki szybkościowe'},
  {label:'Szybkie biegi interwałowe',kinds:['fast_intervals'],note:'Szybkie powtarzane odcinki'},
  {label:'Interwały tempowe',kinds:['tempo_intervals'],note:'Dłuższe odcinki w tempie'},
  {label:'Bieg tempowy',kinds:['tempo_run'],note:'Ciągła praca w tempie'},
  {label:'Interwały',kinds:['intervals'],note:'Dotychczasowa, ogólna kategoria interwałów'},
  {label:'Szybkość i sprinty',kinds:['speed'],note:'Dotychczasowa, ogólna kategoria szybkości'},
  {label:'Rozciąganie regeneracyjne',kinds:['recovery_stretch'],note:'Regeneracja i zakres ruchu'}
];

function notify(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(notify.timer); notify.timer=setTimeout(()=>$('#toast').hidden=true,3500);
}
function csrf() { return document.cookie.split('; ').find(c=>c.startsWith('csrftoken='))?.split('=')[1] || ''; }
async function request(url, options={}) {
  if (window.FormaLocal) return window.FormaLocal.request(url, options);
  const headers = {'X-CSRFToken':csrf(), ...options.headers};
  if(options.body && !(options.body instanceof FormData)) headers['Content-Type']='application/json';
  const response = await fetch(url,{...options,headers,credentials:'same-origin'});
  const result = await response.json().catch(()=>({error:'Nieprawidłowa odpowiedź serwera.'}));
  if(!response.ok) throw new Error(result.error || 'Nie udało się zapisać danych. Odśwież stronę i spróbuj ponownie.');
  return result;
}
async function load() {
  const generation = ++loadGeneration;
  try {
    const result = await request(`/api/state/?month=${month}`);
    if(generation!==loadGeneration) return;
    data=result; $('#error-banner').hidden=true; render();
  } catch(error) {
    if(generation!==loadGeneration) return;
    $('#error-banner').textContent=error.message; $('#error-banner').hidden=false;
  }
}
function render() {
  $('#month-label').textContent=parseDate(month+'-01').toLocaleDateString('pl-PL',{month:'long',year:'numeric'});
  $('#export-link').href=window.FormaLocal?'#':`/api/export/?month=${month}`;
  $('#metric-count').textContent=data.summary.completed;
  $('#metric-planned').textContent=`${data.summary.planned} ${data.summary.planned===1?'aktywność w planie':'aktywności w planie'}`;
  $('#metric-time').textContent=time(data.summary.minutes);
  $('#metric-match-distance').textContent=num(data.summary.match_distance_km,1);
  $('#metric-training-distance').textContent=num(data.summary.training_distance_km,1);
  $('#metric-distance').textContent=num(data.summary.distance_km,1);
  $('#metric-matches').textContent=`${data.summary.matches} wykonanych meczów w tym miesiącu`;
  $('#metric-load').innerHTML=`${num(data.summary.load)} <small>AU</small>`;
  $('#metric-rpe').textContent=data.summary.unrated ? `${data.summary.unrated} wykonanych aktywności bez RPE` : 'Czas w minutach × odczuwany wysiłek';
  $('#activity-kind').innerHTML=Object.entries(data.kinds).map(([key,value])=>`<option value="${key}">${esc(value)}</option>`).join('');
  renderCalendar(); renderDay(); renderAnalysis(); renderRunningAnalysis(); renderCycles();
}
function renderCalendar() {
  const first=parseDate(month+'-01'), offset=(first.getDay()+6)%7;
  const days=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
  const cells=Math.ceil((offset+days)/7)*7;
  let html='';
  for(let i=0;i<cells;i++) {
    const day=new Date(first.getFullYear(),first.getMonth(),i-offset+1,12), key=dateKey(day), outside=key.slice(0,7)!==month;
    const entries=activitiesOn(key), isMatch=entries.some(a=>a.is_match);
    html+=`<div class="day-cell ${outside?'outside':''} ${selected===key?'selected':''} ${isMatch?'match-day':''}"><div class="day-top"><button class="day-number ${key===today?'today':''}" ${outside?'disabled':''} data-day="${key}" aria-label="Wybierz ${key}">${day.getDate()}</button>${isMatch?'<span class="day-badge">MECZ</span>':''}</div>`;
    if(!outside) for(let slot=1;slot<=2;slot++) {
      const activity=entries.find(a=>a.slot===slot);
      if(activity) html+=`<button class="day-slot ${activity.is_match?'match':activity.status}" data-edit="${activity.id}" aria-label="${esc(labelOf(activity))}, ${key}, ${activity.status==='done'?'wykonana':'zaplanowana'}">${activity.status==='done'?'<svg class="done-check"><use href="#i-check"/></svg>':'<span class="small-dot '+(activity.is_match?'match-dot':'planned-dot')+'"></span>'}<span class="slot-title">${esc(labelOf(activity))}</span></button>`;
      else html+=`<button class="day-slot empty" data-new-date="${key}" data-new-slot="${slot}" aria-label="Dodaj aktywność ${slot} dnia ${key}">＋</button>`;
    }
    html+='</div>';
  }
  $('#calendar-grid').innerHTML=html;
}
function renderDay() {
  $('#selected-day-label').textContent=parseDate(selected).toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long'});
  const entries=activitiesOn(selected);
  $('#day-activities').innerHTML=[1,2].map(slot=>{
    const a=entries.find(a=>a.slot===slot);
    return `<div class="day-activity"><div class="activity-kicker"><span>AKTYWNOŚĆ ${slot}</span>${a?`<span>${a.status==='done'?'WYKONANA':'PLAN'}</span>`:''}</div>${a?`<button data-edit="${a.id}"><strong>${esc(labelOf(a))}</strong><div class="activity-details">${esc(a.kind_label)}<br>${time(a.duration_minutes)}${a.distance_km?` · ${num(a.distance_km,2)} km`:''}${a.rpe?` · RPE ${a.rpe}`:''}${a.source==='tcx'?'<br>↳ Dane z Garmina':''}</div></button>`:`<button class="day-add" data-new-date="${selected}" data-new-slot="${slot}">＋ Zaplanuj aktywność</button>`}</div>`;
  }).join('');
  const cycle=data.microcycles[selected];
  $('#day-cycle').innerHTML=cycle?`<span class="cycle-badge">${cycle.badge}</span><h4>${cycle.label}</h4><p>${cycle.description}</p><button class="text-button" data-suggestion="${selected}">Dodaj propozycję do planu ↗</button>`:'';
  const match=data.next_match;
  $('#next-match').innerHTML=match?`<strong>${esc(match.kind_label)}</strong>${parseDate(match.date).toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long'})}${match.title?`<br>${esc(match.title)}`:''}`:'Zaznacz termin meczu w kalendarzu.';
}
function zoneMarkup(compact=false) {
  const zones=data.summary.zones_seconds, known=zones.reduce((a,b)=>a+b,0), limits=data.profile.zone_limits;
  if(!known) return '<div class="empty-state">Tu zobaczysz czas spędzony w każdej strefie.<br>Zaimportuj TCX z próbkami tętna, aby rozpocząć analizę.</div>';
  let html=`<div class="zone-stack">${zones.map((seconds,i)=>`<div style="width:${seconds/known*100}%;background:${colors[i]}" title="Z${i+1}: ${time(seconds/60)}"></div>`).join('')}</div>`;
  for(let i=0;i<5;i++) {
    const range=i===0?`≤ ${limits[0]} bpm`:i===4?`≥ ${limits[3]+1} bpm`:`${limits[i-1]+1}–${limits[i]} bpm`;
    html+=`<div class="zone-row"><span class="zone-label" style="color:${colors[i]}">Z${i+1}</span><span title="${zoneNames[i]}">${compact?range:zoneNames[i]+' · '+range}</span><div class="zone-track"><div class="zone-fill" style="width:${zones[i]/known*100}%;background:${colors[i]}"></div></div><span class="zone-value">${num(zones[i]/60,1)} min</span></div>`;
  }
  return html+`<div class="zone-nodata">${time(known/60)} z pomiarem HR · ${time(data.summary.unknown_hr_seconds/60)} bez danych HR<br>Strefy biegu względem LT ${data.profile.hr_lthr} bpm. Proporcje dotyczą czasu z pomiarem.</div>`;
}
function typesMarkup(compact=false) {
  const types=[...data.summary.types].sort((a,b)=>b.minutes-a.minutes);
  if(!types.length) return '<div class="empty-state">Zacznij od pierwszego treningu lub meczu.<br>Wykonane aktywności utworzą Twój profil treningu.</div>';
  const visible=compact?types.slice(0,4):types;
  return visible.map(t=>`<div class="type-row"><span class="type-label"><span class="type-mark" style="background:${t.kind.startsWith('match')?'#c57955':'#98b391'}"></span>${esc(t.label)}</span><span>${t.count} ×</span><strong>${time(t.minutes)}</strong></div>`).join('')+(compact&&types.length>4?`<p class="footnote">+ ${types.length-4} rodzajów w pełnej analizie</p>`:'');
}
function renderAnalysis() {
  $('#zones-compact').innerHTML=zoneMarkup(true); $('#zones-full').innerHTML=zoneMarkup();
  $('#types-compact').innerHTML=typesMarkup(true); $('#types-full').innerHTML=typesMarkup();
  $('#hr-overview').innerHTML=`<div><strong>${data.summary.avg_hr??'—'}</strong>Średnie HR · średnia ważona czasem próbek</div><div><strong>${data.summary.max_hr??'—'}</strong>Maksymalne HR · bpm</div>`;
  const weeks=data.summary.weeks, maximum=Math.max(...weeks.map(w=>w.load),1);
  $('#weekly-chart').innerHTML=weeks.length?weeks.map(w=>`<div class="weekly-row"><span>Od ${shortDay(w.date)}<small>${time(w.minutes)}</small></span><div class="weekly-track"><div class="weekly-fill" style="width:${w.load/maximum*100}%"></div></div><span class="weekly-value">${num(w.load)}<small>AU${w.unrated?` · ${w.unrated} bez RPE`:''}</small></span></div>`).join(''):'<div class="empty-state">Obciążenie pojawi się po zapisaniu wykonanych aktywności z oceną RPE.</div>';
  renderTable();
}
function renderRunningAnalysis() {
  const types=data.summary.types;
  const sumFor=kinds=>types.filter(t=>kinds.includes(t.kind)).reduce((total,t)=>({count:total.count+t.count,minutes:total.minutes+t.minutes,distance:total.distance+t.distance_km}),{count:0,minutes:0,distance:0});
  const run=sumFor([...RUNNING_KINDS]);
  const quality=sumFor(['starts','short_sprints','fast_intervals','tempo_intervals','tempo_run','intervals','speed']);
  $('#running-overview').innerHTML=`<div><strong>${num(data.summary.training_distance_km,1)} km</strong>Dystans biegowy na treningu</div><div><strong>${run.count}</strong>Treningi biegowe</div><div><strong>${quality.count}</strong>Treningi szybkościowe i tempowe</div><div><strong>${time(run.minutes)}</strong>Czas w biegu</div>`;
  const totalDistance=data.summary.training_distance_km||0;
  const rows=RUNNING_CATEGORIES.map(category=>{
    const stats=sumFor(category.kinds),width=totalDistance?Math.min(100,stats.distance/totalDistance*100):0;
    return `<div class="running-type-row"><div class="running-type-name"><strong>${esc(category.label)}</strong><small>${esc(category.note)}</small></div><div class="running-type-track"><span style="width:${width}%"></span></div><span class="running-type-count">${stats.count} ${stats.count===1?'sesja':'sesji'}</span><strong class="running-type-distance">${num(stats.distance,2)} km</strong><span class="running-type-time">${time(stats.minutes)}</span></div>`;
  }).join('');
  $('#running-types').innerHTML=rows;
  const weeks=new Map();
  for(const activity of data.activities.filter(a=>a.status==='done'&&RUNNING_KINDS.has(a.kind))){
    const date=parseDate(activity.date);date.setDate(date.getDate()-(date.getDay()+6)%7);const key=dateKey(date),week=weeks.get(key)||{date:key,distance:0,count:0};week.distance+=activity.distance_km;week.count++;weeks.set(key,week);
  }
  const values=[...weeks.values()].sort((a,b)=>a.date.localeCompare(b.date)),maximum=Math.max(...values.map(w=>w.distance),1);
  $('#running-weekly-chart').innerHTML=values.length?values.map(w=>`<div class="weekly-row"><span>Od ${shortDay(w.date)}<small>${w.count} ${w.count===1?'bieg':'biegów'}</small></span><div class="weekly-track"><div class="weekly-fill" style="width:${w.distance/maximum*100}%"></div></div><span class="weekly-value">${num(w.distance,1)}<small>km</small></span></div>`).join(''):'<div class="empty-state">Po zapisaniu lub zaimportowaniu biegu zobaczysz kilometraż w kolejnych tygodniach.</div>';
  const recovery=sumFor(['recovery_run','recovery_stretch']);
  $('#running-recovery').innerHTML=recovery.count?`${recovery.count} aktywności regeneracyjne · ${time(recovery.minutes)}${recovery.distance?` · ${num(recovery.distance,2)} km biegu regeneracyjnego`:''}`:'Zapisuj osobno lekki bieg i rozciąganie regeneracyjne, aby śledzić ich regularność.';
}
function renderTable() {
  const filter=$('#activity-filter').value;
  const activities=data.activities.filter(a=>filter==='all'||(filter==='matches'?a.is_match:a.status===filter));
  $('#activity-table').innerHTML=activities.length?activities.map(a=>`<tr><td>${shortDay(a.date)}<br><small>#${a.slot}</small></td><td><button class="${a.is_match?'match-title':''}" data-edit="${a.id}">${esc(labelOf(a))}</button><br><small>${esc(a.kind_label)}${a.source==='tcx'?' · TCX':''}</small></td><td><span class="status-pill ${a.status}">${a.status==='done'?'Wykonana':'Plan'}</span></td><td>${time(a.duration_minutes)}</td><td>${a.distance_km?num(a.distance_km,2)+' km':'—'}</td><td>${a.avg_hr??'—'} / ${a.max_hr??'—'}</td><td>${a.avg_power?num(a.avg_power)+' W':'—'}</td><td>${a.rpe??'—'}</td><td>${a.load??'—'}</td></tr>`).join(''):'<tr><td colspan="9" class="empty-state">Brak aktywności dla wybranego filtra.</td></tr>';
}
function renderCycles() {
  $('#cycle-date').value=selected;
  const start=parseDate(selected); start.setDate(start.getDate()-(start.getDay()+6)%7);
  $('#cycle-week').innerHTML=Array.from({length:7},(_,i)=>{
    const date=new Date(start); date.setDate(start.getDate()+i); const key=dateKey(date), cycle=data.microcycles[key];
    if(!cycle) return `<div class="week-day"><h4>${shortDay(key)}</h4><p>Poza wybranym miesiącem.</p><button class="text-button" data-go-date="${key}">Otwórz ten dzień ↗</button></div>`;
    const entries=activitiesOn(key), isMatch=entries.some(a=>a.is_match);
    return `<div class="week-day ${isMatch?'match-day':''}"><h4>${date.toLocaleDateString('pl-PL',{weekday:'short',day:'numeric',month:'short'})}</h4><span class="cycle-badge">${cycle.badge}</span><h5>${cycle.label}</h5><p>${cycle.description}</p>${entries.length?`<div class="week-existing">${entries.map(a=>esc(labelOf(a))).join('<br>')}</div>`:''}<button class="text-button" data-suggestion="${key}">${cycle.minutes} min · RPE ${cycle.rpe}<br>＋ Dopasuj i dodaj</button></div>`;
  }).join('');
}
function showView(view) {
  activeView=view;
  for(const key of ['calendar','analysis','running-analysis','cycles']) $(`#${key}-view`).hidden=key!==view;
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
}
function openActivity(activity=null, day=selected, slot=null, suggestion=null) {
  if(!data) return;
  const form=$('#activity-form'); form.reset();
  form.querySelector('.form-error').textContent='';
  const entries=activitiesOn(day);
  slot=slot||[1,2].find(s=>!entries.some(a=>a.slot===s));
  if(!activity&&!slot) return notify('Ten dzień ma już dwie aktywności. Edytuj jedną z nich.');
  const values=activity||{date:day,slot,kind:suggestion?.kind||'endurance',duration_minutes:suggestion?.minutes||0,distance_km:0,status:'planned',rpe:suggestion?.rpe||'',notes:suggestion?.description||''};
  for(const key of ['id','date','slot','kind','title','status','duration_minutes','distance_km','avg_hr','max_hr','rpe','notes']) form.elements[key].value=values[key]??'';
  const imported=activity?.source==='tcx';
  for(const key of ['duration_minutes','distance_km','avg_hr','max_hr']) form.elements[key].readOnly=imported;
  $('#activity-dialog-title').textContent=activity?'Szczegóły aktywności':'Dodaj aktywność';
  $('#delete-activity').hidden=!activity; $('#attach-tcx').hidden=!activity;
  $('#imported-detail').hidden=!imported;
  if(imported) {
    const known=activity.zones_seconds.reduce((a,b)=>a+b,0);
    const pace=activity.distance_km>0?Math.round(activity.duration_minutes/activity.distance_km*60):0;
    const powerRelevant=(activity.kind==='cycling')===(data.profile.power_sport==='cycling');
    const paceText=pace?`${Math.floor(pace/60)}:${String(pace%60).padStart(2,'0')} min/km`:'';
    $('#imported-detail').innerHTML=`<b>TCX: ${esc(activity.imported_filename)}</b><br>Czas, dystans i HR pochodzą z pliku.${paceText?` Średnie tempo: ${paceText}.`:''}${activity.avg_power?`<br>Moc średnia ${activity.avg_power} W ${powerRelevant?`(${num(activity.avg_power/data.profile.threshold_power*100)}% progu ${data.profile.threshold_power} W)`:''}, max ${activity.max_power} W.`:''}<div class="mini-zones">${activity.zones_seconds.map((seconds,i)=>`<span style="color:${colors[i]}">Z${i+1} · ${num(seconds/60,1)} min</span>`).join('')}</div>${time(Math.max(0,activity.duration_minutes-known/60))} bez próbek HR.`;
  }
  $('#activity-dialog').showModal();
}
function openImport(activityId='') {
  const form=$('#import-form');form.reset();form.elements.activity_id.value=activityId;
  form.querySelector('.form-error').textContent='';$('#upload-filename').textContent='Nie wybrano pliku';
  form.elements.date.disabled=!!activityId;
  const target=activityId&&data.activities.find(a=>a.id===Number(activityId));
  $('#import-dialog .muted').textContent=target?`Dodajesz TCX do: ${target.kind_label} · ${shortDay(target.date)}. Wczytane dane zastąpią planowany czas i dystans, a termin, kategoria, RPE oraz notatki pozostaną.`:'W Garmin Connect otwórz aktywność i wybierz „Eksportuj do TCX”. Wczytamy czas, dystans oraz próbki tętna.';
  $('#import-dialog h2').textContent=target?(target.status==='planned'?'Uzupełnij zaplanowaną aktywność.':'Uzupełnij aktywność.'):'Przenieś trening do dziennika.';
  form.querySelector('[type=submit]').textContent=activityId?'Importuj do tej aktywności':'Importuj aktywność';
  $('#import-date-hint').textContent=activityId?'TCX uzupełni wybraną aktywność. Jej data, rodzaj, RPE i notatki zostaną zachowane.':'Pusta data oznacza datę z TCX w strefie Europe/Warsaw. Aktywność zajmie pierwsze wolne miejsce w tym dniu.';
  $('#import-dialog').showModal();
}
function openSettings() {
  if(!data) return;
  const form=$('#settings-form');form.querySelector('.form-error').textContent='';
  for(const key of ['hr_max','hr_lthr','hr_rest','threshold_power','power_sport']) form.elements[key].value=data.profile[key];
  data.profile.zone_limits.forEach((value,i)=>form.elements[`z${i+1}`].value=value);
  $('#settings-dialog').showModal();
}
function moveMonth(delta) {
  const d=parseDate(month+'-01');d.setMonth(d.getMonth()+delta);month=dateKey(d).slice(0,7);selected=month===today.slice(0,7)?today:month+'-01';load();
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button) return;
  if(button.classList.contains('close-button')) return button.closest('dialog').close();
  if(button.dataset.view) return showView(button.dataset.view);
  if(button.dataset.edit&&data) return openActivity(data.activities.find(a=>a.id===Number(button.dataset.edit)));
  if(button.dataset.newDate) {selected=button.dataset.newDate;renderCalendar();renderDay();return openActivity(null,selected,Number(button.dataset.newSlot));}
  if(button.dataset.day) {selected=button.dataset.day;renderCalendar();renderDay();renderCycles();}
  if(button.dataset.suggestion) {
    const day=button.dataset.suggestion;return openActivity(null,day,null,data.microcycles[day]);
  }
  if(button.dataset.goDate) {selected=button.dataset.goDate;month=selected.slice(0,7);load();}
});
$('#prev-month').onclick=()=>moveMonth(-1);$('#next-month').onclick=()=>moveMonth(1);
$('#today-button').onclick=()=>{month=today.slice(0,7);selected=today;load();};
$('#add-button').onclick=()=>openActivity();$('#import-button').onclick=()=>openImport();
$('#settings-button').onclick=openSettings;$('#analysis-settings').onclick=openSettings;
$('#activity-filter').onchange=()=>data&&renderTable();
$('#cycle-date').onchange=event=>{if(!event.target.value)return;selected=event.target.value;if(selected.slice(0,7)!==month){month=selected.slice(0,7);load();}else renderCycles();};
async function submit(form, callback) {
  const button=form.querySelector('[type=submit]');button.disabled=true;form.querySelector('.form-error').textContent='';
  try {await callback();} catch(error) {form.querySelector('.form-error').textContent=error.message;} finally {button.disabled=false;}
}
$('#activity-form').onsubmit=event=>{
  event.preventDefault();const form=event.target;
  submit(form,async()=>{
    const values=Object.fromEntries(new FormData(form)), id=values.id;delete values.id;
    const saved=await request(id?`/api/activities/${id}/`:'/api/activities/',{method:'POST',body:JSON.stringify(values)});
    month=saved.date.slice(0,7);selected=saved.date;$('#activity-dialog').close();await load();notify('Aktywność zapisana.');
  });
};
$('#delete-activity').onclick=async()=>{
  const form=$('#activity-form');if(!confirm('Usunąć tę aktywność?')) return;
  try {await request(`/api/activities/${form.elements.id.value}/`,{method:'DELETE'});$('#activity-dialog').close();await load();notify('Aktywność usunięta.');}catch(error){form.querySelector('.form-error').textContent=error.message;}
};
$('#attach-tcx').onclick=()=>{const id=$('#activity-form').elements.id.value;$('#activity-dialog').close();openImport(id);};
$('#import-form').onsubmit=event=>{
  event.preventDefault();submit(event.target,async()=>{
    const saved=await request('/api/import/',{method:'POST',body:new FormData(event.target)});
    month=saved.date.slice(0,7);selected=saved.date;$('#import-dialog').close();await load();notify('Trening z Garmina został zaimportowany.');openActivity(data.activities.find(a=>a.id===saved.id));
  });
};
const fileInput=$('#import-form').elements.file;
fileInput.onchange=()=>$('#upload-filename').textContent=fileInput.files[0]?.name||'Nie wybrano pliku';
const drop=$('.upload-area');
for(const name of ['dragenter','dragover']) drop.addEventListener(name,event=>{event.preventDefault();drop.classList.add('dragging');});
for(const name of ['dragleave','drop']) drop.addEventListener(name,event=>{event.preventDefault();drop.classList.remove('dragging');});
drop.addEventListener('drop',event=>{if(event.dataTransfer.files.length){fileInput.files=event.dataTransfer.files;fileInput.dispatchEvent(new Event('change'));}});
$('#calculate-zones').onclick=()=>{const form=$('#settings-form'),lt=Number(form.elements.hr_lthr.value);[.85,.90,.95,1].forEach((fraction,i)=>form.elements[`z${i+1}`].value=Math.ceil(lt*fraction)-1);};
$('#settings-form').onsubmit=event=>{
  event.preventDefault();const form=event.target;
  submit(form,async()=>{
    const values=Object.fromEntries(new FormData(form));values.zone_limits=[1,2,3,4].map(i=>Number(values[`z${i}`]));
    await request('/api/profile/',{method:'POST',body:JSON.stringify(values)});$('#settings-dialog').close();await load();notify('Strefy zapisane. Analiza została przeliczona.');
  });
};
if (window.FormaLocal) window.FormaLocal.installUI({load, notify, getMonth:()=>month, today});
load();
