/* Standalone storage and TCX analysis: all data stays in this browser. */
(() => {
  'use strict';
  const KEY='forma.referee.v1';
  const KINDS={endurance:'Bieg spokojny',recovery_run:'Bieg regeneracyjny',recovery_stretch:'Rozciąganie regeneracyjne',starts:'Starty biegowe',short_sprints:'Krótkie sprinty',fast_intervals:'Szybkie biegi interwałowe',tempo_intervals:'Interwały tempowe',tempo_run:'Bieg tempowy',intervals:'Interwały',speed:'Szybkość i sprinty',strength:'Siła',mobility:'Mobilność',recovery:'Regeneracja aktywna',cycling:'Rower',test:'Test sprawnościowy',match_iii:'Mecz · III liga',match_district:'Mecz · liga okręgowa',match_assistant:'Mecz · sędzia asystent',other:'Inna aktywność'};
  const RUNNING_KINDS=new Set(['endurance','recovery_run','starts','short_sprints','fast_intervals','tempo_intervals','tempo_run','intervals','speed']);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const isMatch=a=>a.kind.startsWith('match_');
  const defaults=()=>({version:1,nextId:1,profile:{hr_max:199,hr_lthr:177,hr_rest:57,threshold_power:411,power_sport:'running',zone_limits:[150,159,168,176]},activities:[]});
  const fail=message=>{throw new Error(message);};
  const number=(value,label,min,max,integer=false,nullable=false)=>{
    if(nullable&&(value===null||value===undefined||value==='')) return null;
    if(value===null||value===undefined||value===''||typeof value==='boolean') fail('Uzupełnij: '+label+'.');
    const n=Number(value);
    if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n))) fail('Nieprawidłowa wartość: '+label+'.');
    return n;
  };
  function validDate(key) {
    if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key)) fail('Nieprawidłowa data.');
    const d=new Date(key+'T12:00:00Z');
    if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==key||Number(key.slice(0,4))<1900) fail('Nieprawidłowa data.');
    return key;
  }
  function shift(key,days) {
    const d=new Date(key+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
  }
  function warsawDate(d=new Date()) {
    const p=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(p=>[p.type,p.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  function validateProfile(values) {
    if(!values||typeof values!=='object') fail('Nieprawidłowy profil.');
    const hr_max=number(values.hr_max,'HRmax',80,250,true);
    const hr_lthr=number(values.hr_lthr,'próg LT',60,hr_max,true);
    const hr_rest=number(values.hr_rest,'tętno spoczynkowe',25,hr_lthr-1,true);
    const threshold_power=number(values.threshold_power,'próg mocy',1,2000,true);
    const power_sport=values.power_sport;
    if(!['running','cycling'].includes(power_sport)) fail('Wybierz rodzaj mocy.');
    if(!Array.isArray(values.zone_limits)||values.zone_limits.length!==4) fail('Podaj cztery granice stref.');
    const zone_limits=values.zone_limits.map(v=>number(v,'granice stref',30,249,true));
    if(zone_limits.some((v,i)=>i&&v<=zone_limits[i-1])||zone_limits[3]>=hr_max) fail('Granice stref muszą rosnąć i być poniżej HRmax.');
    return {hr_max,hr_lthr,hr_rest,threshold_power,power_sport,zone_limits};
  }
  function validateActivity(values,original=null) {
    if(!values||typeof values!=='object'||Array.isArray(values)) fail('Nieprawidłowe dane aktywności.');
    const activity={...original,date:validDate(values.date),slot:number(values.slot,'miejsce w dniu',1,2,true),kind:values.kind,status:values.status,
      title:String(values.title??'').trim().slice(0,160),notes:String(values.notes??'').trim().slice(0,5000),
      duration_seconds:number(values.duration_minutes,'czas (0–1440 min)',0,1440)*60,distance_km:number(values.distance_km,'dystans',0,1000),
      avg_hr:number(values.avg_hr,'średnie tętno',20,250,true,true),max_hr:number(values.max_hr,'maksymalne tętno',20,250,true,true),rpe:number(values.rpe,'RPE (1–10)',1,10,true,true)};
    if(!Object.hasOwn(KINDS,activity.kind)||!['planned','done'].includes(activity.status)) fail('Nieprawidłowy rodzaj lub status aktywności.');
    if(activity.avg_hr&&activity.max_hr&&activity.avg_hr>activity.max_hr) fail('Średnie tętno nie może przekraczać maksymalnego.');
    if(activity.status==='done'&&!activity.duration_seconds) fail('Podaj czas wykonanej aktywności.');
    if(original?.source==='tcx') {
      if(Math.abs(activity.duration_seconds-original.duration_seconds)>.5||Math.abs(activity.distance_km-original.distance_km)>.001) fail('Czas i dystans pochodzą z TCX. Zaimportuj poprawiony plik, aby je zmienić.');
      activity.duration_seconds=original.duration_seconds;activity.distance_km=original.distance_km;
      activity.avg_hr=original.avg_hr;activity.max_hr=original.max_hr;
    }
    return activity;
  }
  function validateDatabase(raw) {
    if(!raw||raw.version!==1||!Array.isArray(raw.activities)||raw.activities.length>20000) fail('Nieprawidłowa lub nieobsługiwana kopia danych Forma.');
    const profile=validateProfile(raw.profile), ids=new Set(),slots=new Set();
    const activities=raw.activities.map(item=>{
      const a=validateActivity({...item,duration_minutes:item.duration_seconds/60});
      a.id=number(item.id,'identyfikator aktywności',1,Number.MAX_SAFE_INTEGER-1,true);
      if(ids.has(a.id)||slots.has(`${a.date}:${a.slot}`)) fail('Kopia zawiera powtórzone aktywności lub zajęte miejsca.');
      ids.add(a.id);slots.add(`${a.date}:${a.slot}`);
      if(!['manual','tcx'].includes(item.source)) fail('Nieprawidłowe źródło aktywności w kopii.');
      a.source=item.source;a.imported_filename=String(item.imported_filename??'').slice(0,200);
      a.avg_power=number(item.avg_power,'średnia moc',0,5000,true,true);a.max_power=number(item.max_power,'maksymalna moc',0,5000,true,true);
      if(!Array.isArray(item.hr_segments)||item.hr_segments.length>1000) fail('Nieprawidłowe próbki HR w kopii.');
      a.hr_segments=item.hr_segments.map(s=>{
        if(!Array.isArray(s)||s.length!==2) fail('Nieprawidłowa próbka HR.');
        return [number(s[0],'tętno próbki',20,250,true),number(s[1],'czas próbki',0,86400)];
      });
      if(a.hr_segments.reduce((sum,s)=>sum+s[1],0)>a.duration_seconds+1) fail('Czas próbek HR przekracza czas aktywności.');
      if(a.source==='manual'&&a.hr_segments.length) fail('Ręczna aktywność zawiera nieprawidłowe próbki.');
      return a;
    });
    return {version:1,profile,activities,nextId:Math.max(0,...ids)+1};
  }
  function readDatabase() {
    let raw;
    try {raw=localStorage.getItem(KEY);}catch {fail('Przeglądarka blokuje lokalny zapis. Otwórz plik w zwykłym oknie Chrome, Edge lub Firefox i zezwól na zapis danych.');}
    if(raw===null) return defaults();
    try{return validateDatabase(JSON.parse(raw));}catch {fail('Zapisane dane są uszkodzone. Niczego nie nadpisano. Użyj „Kopia danych”, aby pobrać zapis lub przywrócić poprawną kopię.');}
  }
  function persist(state) {
    try{localStorage.setItem(KEY,JSON.stringify(state));}catch{fail('Nie udało się zapisać danych w przeglądarce. Zrób kopię danych i sprawdź wolne miejsce oraz ustawienia zapisu.');}
  }
  function zones(a,limits) {
    const result=[0,0,0,0,0];for(const [hr,seconds] of a.hr_segments) result[limits.filter(n=>hr>n).length]+=seconds;return result;
  }
  function serialize(a,profile) {
    const times=zones(a,profile.zone_limits);
    return {...a,kind_label:KINDS[a.kind],duration_minutes:Math.round(a.duration_seconds/60*100)/100,zones_seconds:times,unknown_hr_seconds:Math.max(0,a.duration_seconds-times.reduce((x,y)=>x+y,0)),load:a.rpe?Math.round(a.duration_seconds/60*a.rpe):null,is_match:isMatch(a)};
  }
  function summary(activities,profile) {
    const done=activities.filter(a=>a.status==='done'),types=new Map(),weeks=new Map(),times=[0,0,0,0,0];let weighted=0,covered=0;
    for(const a of done) {
      zones(a,profile.zone_limits).forEach((s,i)=>times[i]+=s);
      const type=types.get(a.kind)||{kind:a.kind,label:KINDS[a.kind],count:0,minutes:0,distance_km:0};type.count++;type.minutes+=a.duration_seconds/60;type.distance_km+=a.distance_km;types.set(a.kind,type);
      const date=new Date(a.date+'T12:00:00Z'),key=shift(a.date,-(date.getUTCDay()+6)%7);
      const week=weeks.get(key)||{date:key,load:0,minutes:0,count:0,unrated:0};week.minutes+=a.duration_seconds/60;week.count++;if(a.rpe)week.load+=a.duration_seconds/60*a.rpe;else week.unrated++;weeks.set(key,week);
      for(const [hr,seconds] of a.hr_segments){weighted+=hr*seconds;covered+=seconds;}
    }
    const total=done.reduce((sum,a)=>sum+a.duration_seconds,0);
    const matchDistance=done.filter(isMatch).reduce((s,a)=>s+a.distance_km,0),trainingDistance=done.filter(a=>!isMatch(a)&&RUNNING_KINDS.has(a.kind)).reduce((s,a)=>s+a.distance_km,0),runningDistance=matchDistance+trainingDistance;
    return {completed:done.length,planned:activities.filter(a=>a.status==='planned').length,matches:done.filter(isMatch).length,minutes:Math.round(total/60*10)/10,distance_km:Math.round(runningDistance*100)/100,match_distance_km:Math.round(matchDistance*100)/100,training_distance_km:Math.round(trainingDistance*100)/100,running_distance_km:Math.round(runningDistance*100)/100,load:Math.round(done.reduce((s,a)=>s+(a.rpe?a.duration_seconds/60*a.rpe:0),0)),unrated:done.filter(a=>!a.rpe).length,avg_hr:covered?roundEven(weighted/covered):null,max_hr:done.reduce((max,a)=>a.max_hr?Math.max(max||0,a.max_hr):max,null),zones_seconds:times,unknown_hr_seconds:Math.max(0,total-times.reduce((x,y)=>x+y,0)),types:[...types.values()],weeks:[...weeks.values()].sort((a,b)=>a.date.localeCompare(b.date))};
  }
  function microcycle(day,matches) {
    const dates=[...new Set(matches.map(a=>a.date))].sort();
    if(dates.includes(day)) return {badge:'MD',label:'Dzień meczowy',kind:'mobility',minutes:15,rpe:2,description:'Rozgrzewka przed meczem; po meczu spokojne schłodzenie. Bez dodatkowego ciężkiego treningu.'};
    const prev=dates.filter(d=>d<day).at(-1),next=dates.find(d=>d>day);
    const since=prev?(new Date(day)-new Date(prev))/86400000:null,until=next?(new Date(next)-new Date(day))/86400000:null;
    if(since===1)return {badge:'MD+1',label:'Odbudowa po meczu',kind:'recovery',minutes:25,rpe:2,description:'Lekki ruch i mobilność. Dostosuj czas do zmęczenia i obciążenia meczu.'};
    if(until===1)return {badge:'MD−1',label:'Aktywacja przed meczem',kind:'speed',minutes:20,rpe:3,description:'Krótka aktywacja i kilka swobodnych przyspieszeń, z pełnym odpoczynkiem.'};
    if(since===2)return {badge:'MD+2',label:'Spokojny powrót',kind:'endurance',minutes:30,rpe:3,description:'Spokojny wysiłek tlenowy. Przy utrzymującym się zmęczeniu wybierz regenerację.'};
    if(until===2)return {badge:'MD−2',label:'Zmniejszenie objętości',kind:'endurance',minutes:30,rpe:3,description:'Lekki bieg i technika. Zostaw zapas energii na mecz.'};
    if(until===3)return {badge:'MD−3',label:'Bodziec jakościowy',kind:'intervals',minutes:40,rpe:6,description:'Miejsce na interwały lub szybkość, jeśli jesteś zregenerowany. Uwzględnij rozgrzewkę i schłodzenie.'};
    return {badge:'BAZA',label:'Dzień budowania formy',kind:'endurance',minutes:40,rpe:4,description:'Trening tlenowy lub siła według Twojego planu. Wybierz odpoczynek, jeśli go potrzebujesz.'};
  }
  function stateForMonth(db,month) {
    if(!/^\d{4}-\d{2}$/.test(month)) fail('Nieprawidłowy miesiąc.');
    const first=validDate(month+'-01'),activities=db.activities.filter(a=>a.date.startsWith(month)).sort((a,b)=>a.date.localeCompare(b.date)||a.slot-b.slot);
    const matches=db.activities.filter(isMatch),cycles={};
    for(let key=first;key.startsWith(month);key=shift(key,1)) cycles[key]=microcycle(key,matches);
    const next=matches.filter(a=>a.date>=warsawDate()).sort((a,b)=>a.date.localeCompare(b.date)||a.slot-b.slot)[0];
    return {activities:activities.map(a=>serialize(a,db.profile)),summary:summary(activities,db.profile),profile:clone(db.profile),kinds:KINDS,next_match:next?serialize(next,db.profile):null,microcycles:cycles};
  }
  const children=(node,name)=>[...node.children].filter(n=>n.localName===name);
  const descendants=(node,name)=>[...node.getElementsByTagName('*')].filter(n=>n.localName===name);
  function xmlNumber(node,name) {
    const found=node.localName===name?node:descendants(node,name)[0];if(!found?.textContent.trim())return null;
    const n=Number(found.textContent);return Number.isFinite(n)&&n>=0?n:null;
  }
  function xmlTime(value) {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim()))fail('Nieprawidłowy czas w TCX (wymagana strefa czasowa).');
    validDate(value.trim().slice(0,10));const n=Date.parse(value.trim());if(!Number.isFinite(n))fail('Nieprawidłowy czas w TCX.');return n;
  }
  function roundEven(n){const floor=Math.floor(n);return n-floor===.5?floor+(floor%2):Math.round(n);}
  function parseTCX(text) {
    if(!text||/<!DOCTYPE|<!ENTITY/i.test(text))fail('Nieprawidłowy lub niedozwolony plik XML/TCX.');
    const xml=new DOMParser().parseFromString(text,'application/xml');
    if(descendants(xml,'parsererror').length||xml.documentElement.localName!=='TrainingCenterDatabase')fail('To nie jest poprawny plik Garmin TCX.');
    const activities=descendants(xml,'Activity');if(activities.length!==1)fail('Importuj plik TCX zawierający jedną aktywność.');
    const a=activities[0],starts=[],timestamps=[],hearts=[],powers=[],durations=[],distances=[],samples=new Map();let fallback=0,powerWeighted=0,powerSeconds=0;
    for(const lap of children(a,'Lap')) {
      if(lap.getAttribute('StartTime'))starts.push(xmlTime(lap.getAttribute('StartTime')));
      for(const [name,target] of [['TotalTimeSeconds',durations],['DistanceMeters',distances]])for(const node of children(lap,name)){const n=xmlNumber(node,name);if(n!==null)target.push(n);}
      for(const track of children(lap,'Track')) {
        let previous=null;
        for(const point of children(track,'Trackpoint')) {
          const t=children(point,'Time')[0],timestamp=t?xmlTime(t.textContent):null;
          const hrNode=children(point,'HeartRateBpm')[0];let hr=hrNode?xmlNumber(hrNode,'Value'):null;
          hr=hr!==null&&hr>=20&&hr<=250?roundEven(hr):null;
          const distance=xmlNumber(point,'DistanceMeters');let power=xmlNumber(point,'Watts');if(power>5000)power=null;
          if(timestamp!==null)timestamps.push(timestamp);if(hr)hearts.push(hr);if(power!==null)powers.push(power);
          if(previous) {
            if(timestamp!==null&&previous.timestamp!==null){const seconds=(timestamp-previous.timestamp)/1000;if(seconds>0&&seconds<=120){if(previous.hr)samples.set(previous.hr,(samples.get(previous.hr)||0)+seconds);if(previous.power!==null){powerWeighted+=previous.power*seconds;powerSeconds+=seconds;}}}
            if(distance!==null&&previous.distance!==null)fallback+=Math.max(0,distance-previous.distance);
          }
          previous={timestamp,hr,distance,power};
        }
      }
    }
    if(!starts.length&&!timestamps.length){const id=children(a,'Id')[0];if(id)starts.push(xmlTime(id.textContent));}
    const times=[...starts,...timestamps];if(!times.length)fail('Plik nie zawiera daty aktywności.');
    const earliest=times.reduce((min,v)=>Math.min(min,v),Infinity),latest=times.reduce((max,v)=>Math.max(max,v),-Infinity);
    const duration=durations.length?durations.reduce((x,y)=>x+y,0):(latest-earliest)/1000;
    if(!Number.isFinite(duration)||duration<=0||duration>86400)fail('Brak poprawnego czasu aktywności (maksymalnie 24 godziny).');
    let covered=[...samples.values()].reduce((x,y)=>x+y,0);if(covered>duration){for(const [hr,s]of samples)samples.set(hr,s*duration/covered);covered=duration;}
    let avg_hr=covered?roundEven([...samples].reduce((sum,[hr,s])=>sum+hr*s,0)/covered):null;
    if(avg_hr===null)for(const node of descendants(a,'AverageHeartRateBpm')){const n=xmlNumber(node,'Value');if(n!==null&&n>=20&&n<=250){avg_hr=roundEven(n);break;}}
    let max_hr=hearts.length?hearts.reduce((max,v)=>Math.max(max,v),0):null;
    if(max_hr===null)for(const node of descendants(a,'MaximumHeartRateBpm')){const n=xmlNumber(node,'Value');if(n!==null&&n>=20&&n<=250)max_hr=Math.max(max_hr||0,roundEven(n));}
    const meters=distances.length?distances.reduce((x,y)=>x+y,0):fallback;if(!Number.isFinite(meters)||meters>1000000)fail('Nieprawidłowy dystans w TCX.');
    return {date:warsawDate(new Date(earliest)),kind:a.getAttribute('Sport')==='Biking'?'cycling':'endurance',duration_seconds:Math.round(duration*100)/100,distance_km:Math.round(meters)/1000,avg_hr,max_hr,avg_power:powerSeconds?roundEven(powerWeighted/powerSeconds):null,max_power:powers.length?roundEven(powers.reduce((max,v)=>Math.max(max,v),0)):null,hr_segments:[...samples].sort((a,b)=>a[0]-b[0]).map(([hr,s])=>[hr,Math.round(s*1000)/1000])};
  }
  function freeSlot(db,date,id=null,slot=null) {
    const occupied=db.activities.filter(a=>a.date===date&&a.id!==id).map(a=>a.slot);
    if(slot!==null){if(occupied.includes(slot))fail('To miejsce jest już zajęte. Każdy dzień ma dwie aktywności.');return slot;}
    return [1,2].find(s=>!occupied.includes(s))||fail('Ten dzień ma już dwie aktywności. Otwórz istniejącą aktywność i wybierz „Dołącz TCX”.');
  }
  async function request(url,options={}) {
    const parsed=new URL(url,'https://forma.invalid'),method=options.method||'GET';
    if(parsed.pathname==='/api/import/'&&method==='POST') {
      const form=options.body,file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024)fail('Wybierz plik TCX do 10 MB.');
      const values=parseTCX(await file.text()),db=readDatabase(),id=form.get('activity_id');let activity;
      if(id){activity=db.activities.find(a=>a.id===Number(id));if(!activity)fail('Nie znaleziono aktywności.');delete values.kind;delete values.date;Object.assign(activity,values);}
      else {if(form.get('date'))values.date=validDate(form.get('date'));activity={...values,id:db.nextId++,slot:freeSlot(db,values.date),title:'',notes:'',rpe:null};db.activities.push(activity);}
      activity.source='tcx';activity.status='done';activity.imported_filename=file.name.slice(0,200);persist(db);return serialize(activity,db.profile);
    }
    const db=readDatabase();
    if(parsed.pathname==='/api/state/'&&method==='GET')return stateForMonth(db,parsed.searchParams.get('month')||warsawDate().slice(0,7));
    if(parsed.pathname==='/api/profile/'&&method==='POST'){db.profile=validateProfile(JSON.parse(options.body));persist(db);return {saved:true};}
    const detail=parsed.pathname.match(/^\/api\/activities\/(\d+)\/$/);
    if(detail){const id=Number(detail[1]),index=db.activities.findIndex(a=>a.id===id);if(index<0)fail('Nie znaleziono aktywności.');if(method==='DELETE'){db.activities.splice(index,1);persist(db);return {deleted:true};}if(method==='POST'){const a=validateActivity(JSON.parse(options.body),db.activities[index]);freeSlot(db,a.date,id,a.slot);db.activities[index]=a;persist(db);return serialize(a,db.profile);}}
    if(parsed.pathname==='/api/activities/'&&method==='POST'){const a=validateActivity(JSON.parse(options.body));freeSlot(db,a.date,null,a.slot);Object.assign(a,{id:db.nextId++,source:'manual',hr_segments:[],imported_filename:'',avg_power:null,max_power:null});db.activities.push(a);persist(db);return serialize(a,db.profile);}
    fail('Nieobsługiwana operacja.');
  }
  function download(contents,filename,type) {
    const blob=new Blob([contents],{type}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  function csvForMonth(month) {
    const db=readDatabase(),state=stateForMonth(db,month);
    const row=values=>values.map(value=>{let s=value===null||value===undefined?'':typeof value==='number'?value.toLocaleString('pl-PL',{useGrouping:false,maximumFractionDigits:3}):String(value);if(/^\s*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(';');
    const lines=[row(['Data','Miejsce','Rodzaj','Nazwa','Status','Czas (min)','Dystans (km)','HR średnie','HR max','Moc średnia (W)','Moc max (W)','RPE','Obciążenie sRPE','Z1 (min)','Z2 (min)','Z3 (min)','Z4 (min)','Z5 (min)','Bez danych HR (min)','Notatki'])];
    for(const a of state.activities)lines.push(row([a.date,a.slot,a.kind_label,a.title,a.status==='done'?'Wykonana':'Plan',a.duration_minutes,a.distance_km,a.avg_hr,a.max_hr,a.avg_power,a.max_power,a.rpe,a.load,...a.zones_seconds.map(s=>s/60),a.unknown_hr_seconds/60,a.notes]));
    return '\ufeff'+lines.join('\r\n');
  }
  function installUI({load,notify,getMonth,today}) {
    document.querySelector('#export-link').addEventListener('click',event=>{event.preventDefault();try{download(csvForMonth(getMonth()),`forma-${getMonth()}.csv`,'text/csv;charset=utf-8');}catch(error){notify(error.message);}});
    const dialog=document.querySelector('#backup-dialog'),error=dialog.querySelector('.form-error');
    document.querySelector('#backup-button').onclick=()=>{error.textContent='';dialog.showModal();};
    document.querySelector('#download-backup').onclick=()=>{try{const raw=localStorage.getItem(KEY);const contents=raw??JSON.stringify(defaults());download(contents,`forma-kopia-${today}.json`,'application/json');notify('Kopia danych pobrana. Zachowaj ją w bezpiecznym miejscu.');}catch(e){error.textContent=e.message;}};
    const input=document.querySelector('#restore-backup');
    input.onchange=async()=>{
      error.textContent='';const file=input.files[0];if(!file)return;
      try{
        if(file.size>20*1024*1024)fail('Kopia może mieć maksymalnie 20 MB.');
        const incoming=validateDatabase(JSON.parse(await file.text()));
        let existing;try{existing=readDatabase();}catch{existing={activities:[{}]};}
        if(existing.activities.length&&!confirm(`Przywrócić kopię zawierającą ${incoming.activities.length} aktywności? Zastąpi ona obecny kalendarz i ustawienia. Jeśli potrzebujesz obecnych danych, najpierw pobierz ich kopię.`))return;
        persist(incoming);await load();dialog.close();notify('Kopia przywrócona. Wybierz miesiąc, w którym zapisano aktywności.');
      }catch(e){error.textContent=e instanceof SyntaxError?'To nie jest poprawny plik kopii JSON.':e.message;}finally{input.value='';}
    };
    window.addEventListener('storage',event=>{if(event.key===KEY)load();});
  }
  window.FormaLocal={request,installUI};
})();
