// ============================================================
// MiniHorto by LuSoft — script.js
// Versão: 2.0 | Preparado para GitHub Pages
// Para conectar Firebase/Supabase: veja seção DB ADAPTER
// ============================================================

// ── CONFIGURAÇÃO ──
const CONFIG = {
  dadosUrl: './dados.json',   // caminho relativo ao index.html
  dbName: 'MiniHortoLocal',   // IndexedDB local (dados do usuário)
  dbVersion: 1,
  // Firebase (descomente quando quiser migrar):
  // firebaseConfig: { apiKey:'...', authDomain:'...', projectId:'...' }
};

// ============================================================
// DB ADAPTER — troque a implementação para migrar para Firebase
// Atualmente usa IndexedDB para dados do usuário (jardim, logs,
// fotos, produtos). O catálogo vem do dados.json (GitHub Pages).
// ============================================================
const DB = {
  _db: null,

  async open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(CONFIG.dbName, CONFIG.dbVersion);
      r.onupgradeneeded = e => {
        const d = e.target.result;
        const stores = [
          {name:'users',    idx:{phone:'phone', unique:true}},
          {name:'jardim',   idx:{uid:'userId'}},
          {name:'logs',     idx:{jid:'jardimId'}},
          {name:'photos',   idx:{jid:'jardimId'}},
          {name:'produtos', idx:null},
        ];
        stores.forEach(({name, idx}) => {
          if (!d.objectStoreNames.contains(name)) {
            const s = d.createObjectStore(name, {keyPath:'id', autoIncrement:true});
            if (idx) s.createIndex(Object.keys(idx)[0], Object.values(idx)[0],
              {unique: name==='users' && Object.keys(idx)[0]==='phone'});
          }
        });
      };
      r.onsuccess = e => { DB._db = e.target.result; res(); };
      r.onerror   = () => rej(r.error);
    });
  },

  add:    (s,d)  => new Promise((r,j)=>{ const t=DB._db.transaction(s,'readwrite'),q=t.objectStore(s).add(d);  q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); }),
  all:    (s)    => new Promise((r,j)=>{ const t=DB._db.transaction(s,'readonly'), q=t.objectStore(s).getAll(); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); }),
  get:    (s,k)  => new Promise((r,j)=>{ const t=DB._db.transaction(s,'readonly'), q=t.objectStore(s).get(k);  q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); }),
  put:    (s,d)  => new Promise((r,j)=>{ const t=DB._db.transaction(s,'readwrite'),q=t.objectStore(s).put(d);  q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); }),
  del:    (s,k)  => new Promise((r,j)=>{ const t=DB._db.transaction(s,'readwrite'),q=t.objectStore(s).delete(k);q.onsuccess=()=>r();         q.onerror=()=>j(q.error); }),
  byIdx:  (s,i,v)=> new Promise((r,j)=>{ const t=DB._db.transaction(s,'readonly'), q=t.objectStore(s).index(i).getAll(v); q.onsuccess=()=>r(q.result); q.onerror=()=>j(q.error); }),
};

// ── STATE ──
let CU = null, curPId = null, curJId = null;
let aFil = 'todos', calD = new Date(), allP = [], idResult = null, admPh = null;
let APP_CONFIG = {};  // loaded from dados.json

// ── UTILS ──
const b64    = f  => new Promise(r=>{ const fr=new FileReader(); fr.onload=e=>r(e.target.result); fr.readAsDataURL(f); });
const fmtD   = iso=> { if(!iso)return'—'; return new Date(iso).toLocaleDateString('pt-BR'); };
const fmtPh  = p  => { const v=p.replace(/\D/g,''); if(v.length>=11)return`(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`; return p; };
const toast  = m  => { const c=document.getElementById('tbox'); const t=document.createElement('div'); t.className='toast'; t.textContent=m; c.appendChild(t); setTimeout(()=>t.remove(),2900); };

// ── LOAD dados.json ──
async function loadDadosJson() {
  try {
    const res  = await fetch(CONFIG.dadosUrl + '?v=' + Date.now()); // cache-bust
    const data = await res.json();
    allP = (data.plantas || []).map((p, i) => ({...p, id: i+1, views: 0}));
    APP_CONFIG = data.configuracoes || {};
    // Seed users from JSON if DB is empty
    const users = await DB.all('users');
    if (!users.length) {
      const defaultUsers = data.usuarios_padrao || [];
      for (const u of defaultUsers) {
        await DB.add('users', {
          ...u,
          createdAt:   new Date().toISOString(),
          lastAccess:  new Date().toISOString()
        });
      }
    }
    return true;
  } catch(e) {
    console.error('Erro ao carregar dados.json:', e);
    toast('⚠️ Erro ao carregar catálogo. Verifique dados.json');
    return false;
  }
}

// ============================================================
// INIT
// ============================================================
async function init() {
  await DB.open();
  await loadDadosJson();
  const s = localStorage.getItem('mh_sess');
  if (s) {
    CU = JSON.parse(s);
    CU.role === 'admin' ? showAdmin() : showApp();
  }
}

// ── PHONE MASK ──
function mkPh(v){ let d=v.replace(/\D/g,''); if(d.length>11)d=d.slice(0,11); if(d.length>6)return`(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`; if(d.length>2)return`(${d.slice(0,2)}) ${d.slice(2)}`; if(d.length)return`(${d}`; return''; }
document.getElementById('lph').addEventListener('input', function(){ this.value=mkPh(this.value); });
document.getElementById('cph').addEventListener('input', function(){ this.value=mkPh(this.value); });
document.getElementById('lps').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });

// ── SWITCH TAB (login/cadastro) ──
function switchTab(t, el) {
  document.getElementById('t-login').style.display = t==='login' ? 'block':'none';
  document.getElementById('t-cad').style.display   = t==='cad'   ? 'block':'none';
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
  el.classList.add('on');
}

// ── LOGIN ──
async function doLogin() {
  const ph = document.getElementById('lph').value.replace(/\D/g,'');
  const ps = document.getElementById('lps').value.trim();
  const e  = document.getElementById('lerr'); e.style.display='none';
  if (!ph||!ps){ e.textContent='Preencha todos os campos'; e.style.display='block'; return; }
  const users = await DB.all('users');
  const u = users.find(x => x.phone===ph && x.senha===ps);
  if (!u){ e.textContent='Telefone ou senha incorretos'; e.style.display='block'; return; }
  u.lastAccess = new Date().toISOString(); await DB.put('users', u);
  CU = u; localStorage.setItem('mh_sess', JSON.stringify(u));
  u.role === 'admin' ? showAdmin() : showApp();
}
function qLogin(ph, ps) {
  document.getElementById('lph').value = '('+ph.slice(0,2)+') '+ph.slice(2,7)+'-'+ph.slice(7);
  document.getElementById('lps').value = ps;
  doLogin();
}

// ── CADASTRO ──
async function doCad() {
  const nm  = document.getElementById('cnm').value.trim();
  const ph  = document.getElementById('cph').value.replace(/\D/g,'');
  const ps  = document.getElementById('cps').value.trim();
  const ps2 = document.getElementById('cps2').value.trim();
  const e   = document.getElementById('cerr'), ok = document.getElementById('cok');
  e.style.display='none'; ok.style.display='none';
  if (!nm||!ph||!ps){ e.textContent='Preencha todos os campos'; e.style.display='block'; return; }
  if (ph.length<10){ e.textContent='Telefone inválido'; e.style.display='block'; return; }
  if (ps.length!==3||isNaN(ps)){ e.textContent='Senha: 3 dígitos numéricos'; e.style.display='block'; return; }
  if (ps!==ps2){ e.textContent='Senhas não coincidem'; e.style.display='block'; return; }
  const users = await DB.all('users');
  if (users.find(x=>x.phone===ph)){ e.textContent='Telefone já cadastrado'; e.style.display='block'; return; }
  const avs = ['🌺','🌸','🌿','🌻','🍃','🌱','🌼','🌾'];
  await DB.add('users',{ phone:ph, senha:ps, nome:nm, role:'cliente',
    avatar: avs[Math.floor(Math.random()*avs.length)],
    createdAt: new Date().toISOString(), lastAccess: new Date().toISOString() });
  ok.textContent='✅ Conta criada! Faça login.'; ok.style.display='block';
  setTimeout(()=>switchTab('login', document.querySelector('.tab')), 1800);
}

// ── LOGOUT ──
function doLogout() {
  localStorage.removeItem('mh_sess'); CU=null;
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
  document.getElementById('s-login').classList.add('on');
  window.scrollTo(0,0);
}

// ── SHOW SCREENS ──
function showApp() {
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
  document.getElementById('s-app').classList.add('on');
  window.scrollTo(0,0); document.documentElement.scrollTop=0;
  updatePerfil(); goTo('catalogo');
  setTimeout(checkTasks, 900);
}
function showAdmin() {
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
  document.getElementById('s-admin').classList.add('on');
  window.scrollTo(0,0); document.documentElement.scrollTop=0;
  loadDash(); loadAdmP(); loadAdmC(); loadAdmProd();
}

// ── NAVIGATION ──
function goTo(pg) {
  document.querySelectorAll('.pg').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.ni').forEach(n=>n.classList.remove('on'));
  document.getElementById('pg-'+pg).classList.add('on');
  const ni = document.getElementById('ni-'+pg); if(ni) ni.classList.add('on');
  document.getElementById('fab').style.display = pg==='jardim' ? 'flex':'none';
  if(pg==='catalogo')   renderP();
  if(pg==='jardim')     loadJardim();
  if(pg==='favoritos')  loadFavs();
  if(pg==='calendario') loadCal();
  if(pg==='perfil')     updatePerfil();
  window.scrollTo(0,0);
}

// ── CATALOG ──
function renderP() {
  const favs = getFavs();
  let lst = aFil==='todos' ? allP : allP.filter(p=>p.categoria===aFil);
  const q = (document.getElementById('sinput').value||'').toLowerCase().trim();
  if(q) lst = lst.filter(p=>p.nome.toLowerCase().includes(q)||p.sci.toLowerCase().includes(q)||(p.categoria||'').toLowerCase().includes(q));
  const g = document.getElementById('pgrid');
  if(!lst.length){ g.innerHTML='<div class="empty" style="grid-column:1/-1"><div class="empty-ico">🔍</div><h3>Nenhuma planta encontrada</h3></div>'; return; }
  g.innerHTML = lst.map(p=>`
    <div class="pcw">
      <div class="pcard" onclick="openPM(${p.id})">
        <div class="pcard-img">${p.photo?`<img src="${p.photo}" alt="">`:''}<span style="${p.photo?'opacity:0':''}">${p.emoji||'🌿'}</span></div>
        <div class="pcard-body">
          <div class="pcard-nm">${p.nome}</div>
          <div class="pcard-sc">${p.sci}</div>
          <div class="bdgs">
            <span class="bdg ${p.luz==='Sol pleno'?'b-sun':p.luz==='Sombra'?'b-shd':'b-pt'}">${p.luz==='Sol pleno'?'☀️':'⛅'} ${p.luz}</span>
            <span class="bdg ${p.dif==='Fácil'?'b-easy':p.dif==='Médio'?'b-med':'b-hard'}">${p.dif}</span>
          </div>
        </div>
      </div>
      <button class="fav-btn" onclick="event.stopPropagation();tFav(${p.id},this)">${favs.includes(p.id)?'❤️':'🤍'}</button>
    </div>`).join('');
}
function setF(c,el){ aFil=c; document.querySelectorAll('.chip').forEach(x=>x.classList.remove('on')); el.classList.add('on'); renderP(); }

// ── FAVORITES ──
function getFavs(){ const f=localStorage.getItem('fv_'+(CU?.id||0)); return f?JSON.parse(f):[]; }
function saveFavs(f){ localStorage.setItem('fv_'+(CU?.id||0), JSON.stringify(f)); }
function tFav(id, btn){ let f=getFavs(); if(f.includes(id)){f=f.filter(x=>x!==id);if(btn)btn.textContent='🤍';toast('Removido dos favoritos');}else{f.push(id);if(btn)btn.textContent='❤️';toast('❤️ Adicionado aos favoritos!');}saveFavs(f); }
function tFavM(){ if(!curPId)return; let f=getFavs(); const btn=document.getElementById('mfav'); if(f.includes(curPId)){f=f.filter(x=>x!==curPId);btn.textContent='♡ Favoritar';toast('Removido');}else{f.push(curPId);btn.textContent='❤️ Favoritado';toast('❤️ Favorito!');}saveFavs(f); }
async function loadFavs() {
  const ids=getFavs(), g=document.getElementById('fav-grid'), em=document.getElementById('fav-empty');
  if(!ids.length){ g.innerHTML=''; em.style.display='block'; return; }
  em.style.display='none';
  g.innerHTML = allP.filter(p=>ids.includes(p.id)).map(p=>`
    <div class="pcw">
      <div class="pcard" onclick="openPM(${p.id})">
        <div class="pcard-img">${p.photo?`<img src="${p.photo}" alt="">`:''}<span style="${p.photo?'opacity:0':''}">${p.emoji||'🌿'}</span></div>
        <div class="pcard-body"><div class="pcard-nm">${p.nome}</div><div class="pcard-sc">${p.sci}</div><div class="bdgs"><span class="bdg b-cat">❤️ Favorita</span></div></div>
      </div>
      <button class="fav-btn" onclick="event.stopPropagation();tFav(${p.id},this);loadFavs()">❤️</button>
    </div>`).join('');
}

// ── PLANT MODAL ──
function openPM(id) {
  curPId = id;
  const p = allP.find(x=>x.id===id); if(!p) return;
  p.views = (p.views||0)+1;
  const hero=document.getElementById('mhero');
  hero.querySelectorAll('img').forEach(i=>i.remove());
  const emo=document.getElementById('memoji');
  if(p.photo){ const img=document.createElement('img'); img.src=p.photo; img.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover'; hero.appendChild(img); emo.textContent=''; }
  else{ emo.textContent=p.emoji||'🌿'; }
  document.getElementById('mfav').textContent = getFavs().includes(id)?'❤️ Favoritado':'♡ Favoritar';
  document.getElementById('mnm').textContent   = p.nome;
  document.getElementById('msci').textContent  = p.sci;
  const ptx = p.toxicidade||'';
  document.getElementById('mbdgs').innerHTML = `
    <span class="bdg ${p.luz==='Sol pleno'?'b-sun':p.luz==='Sombra'?'b-shd':'b-pt'}">${p.luz}</span>
    <span class="bdg ${p.dif==='Fácil'?'b-easy':p.dif==='Médio'?'b-med':'b-hard'}">${p.dif}</span>
    <span class="bdg b-cat">${p.categoria}</span>
    <span class="bdg ${ptx.toLowerCase().includes('não')?'b-easy':'b-hard'}">${ptx.toLowerCase().includes('não')?'✅ Pet Safe':'⚠️ '+ptx}</span>`;
  document.getElementById('migrid').innerHTML = `
    <div class="ii"><div class="il">Luz</div><div class="iv">${p.luz||'—'}</div></div>
    <div class="ii"><div class="il">Rega</div><div class="iv">${p.rega||'—'}</div></div>
    <div class="ii"><div class="il">Solo</div><div class="iv">${p.solo||'—'}</div></div>
    <div class="ii"><div class="il">Temperatura</div><div class="iv">${p.temp||'—'}</div></div>
    <div class="ii"><div class="il">Adubação</div><div class="iv">${p.adubacao||'—'}</div></div>
    <div class="ii"><div class="il">Porte</div><div class="iv">${p.porte||'—'}</div></div>`;
  document.getElementById('mobs').textContent   = p.obs||'—';
  document.getElementById('mcurio').textContent = p.curio||'—';
  const act = document.getElementById('m-act');
  act.textContent = '🌱 Adicionar ao Meu Jardim';
  act.style.background = 'linear-gradient(135deg,#2D5016,#5C7A3E)';
  act.onclick = ()=>addToJardim(curPId);
  document.getElementById('pm').classList.add('on');
}
function closePM(){ document.getElementById('pm').classList.remove('on'); curPId=null; }

// ── JARDIM ──
async function loadJardim() {
  if(!CU) return;
  const items = await DB.byIdx('jardim','uid',CU.id);
  const totalLogs = (await Promise.all(items.map(j=>DB.byIdx('logs','jid',j.id)))).reduce((a,l)=>a+l.length,0);
  document.getElementById('jstats').innerHTML=`
    <div class="jst"><div class="jsn">${items.length}</div><div class="jsl">Plantas</div></div>
    <div class="jst"><div class="jsn">${totalLogs}</div><div class="jsl">Registros</div></div>
    <div class="jst"><div class="jsn">${getFavs().length}</div><div class="jsl">Favoritos</div></div>`;
  const jl = document.getElementById('jlist');
  if(!items.length){ jl.innerHTML='<div class="empty"><div class="empty-ico">🌱</div><h3>Jardim vazio</h3><p>Explore o catálogo e adicione plantas!</p></div>'; return; }
  jl.innerHTML='';
  for(const j of items){
    const p = allP.find(x=>x.id===j.plantId); if(!p) continue;
    const photos = await DB.byIdx('photos','jid',j.id);
    const thumb  = photos.length ? photos[photos.length-1].data : (p.photo||null);
    const rega   = new Date(j.addedAt); rega.setDate(rega.getDate()+7);
    const div = document.createElement('div'); div.className='jcard'; div.onclick=()=>openJM(j.id);
    div.innerHTML=`<div class="jthumb">${thumb?`<img src="${thumb}" alt="">`:(p.emoji||'🌿')}</div>
      <div><div class="jcnm">${p.nome}</div><div class="jcdt">Desde ${fmtD(j.addedAt)}</div><span class="jcnx">💧 Rega: ${fmtD(rega.toISOString())}</span></div>`;
    jl.appendChild(div);
  }
}
async function addToJardim(pid) {
  if(!CU||!pid) return;
  const items = await DB.byIdx('jardim','uid',CU.id);
  if(items.find(j=>j.plantId===pid)){ toast('🌱 Planta já está no jardim!'); closePM(); return; }
  await DB.add('jardim',{plantId:pid,userId:CU.id,addedAt:new Date().toISOString(),notes:''});
  toast('🌱 Adicionada ao jardim!'); closePM(); goTo('jardim');
}
async function openJM(jid) {
  curJId=jid;
  const j=await DB.get('jardim',jid); if(!j) return;
  const p=allP.find(x=>x.id===j.plantId); if(!p) return;
  const logs=await DB.byIdx('logs','jid',jid);
  const photos=await DB.byIdx('photos','jid',jid);
  document.getElementById('jm-ttl').textContent  = p.nome;
  document.getElementById('jm-nm').textContent   = p.nome;
  document.getElementById('jm-since').textContent= 'No jardim desde '+fmtD(j.addedAt);
  const th=document.getElementById('jm-th');
  const lat=photos.length?photos[photos.length-1].data:null;
  th.innerHTML = lat?`<img src="${lat}" alt="">`:(p.emoji||'🌿');
  renderPh(photos);
  document.getElementById('jm-logs').innerHTML = logs.length?logs.slice().reverse().slice(0,25).map(l=>`
    <div class="log-i"><div class="log-ico">${l.icon}</div>
    <div><div class="log-txt">${l.text}</div><div class="log-dt">${fmtD(l.date)}</div></div></div>`).join(''):'<p style="font-size:13px;color:#6B7A58;padding:4px 0">Nenhum registro ainda.</p>';
  document.getElementById('jm').classList.add('on');
}
function renderPh(photos){
  const g=document.getElementById('phgrid');
  if(!photos.length){ g.innerHTML='<p style="font-size:12px;color:#6B7A58;padding:4px 0;grid-column:1/-1">Nenhuma foto ainda</p>'; return; }
  g.innerHTML=photos.map(ph=>`<div class="pht" onclick="openPV('${ph.data}')"><img src="${ph.data}" alt=""><button class="pht-del" onclick="event.stopPropagation();delJPh(${ph.id})">✕</button></div>`).join('');
}
function closeJM(){ document.getElementById('jm').classList.remove('on'); curJId=null; }
async function handleJPh(e){
  const f=e.target.files[0]; if(!f||!curJId) return;
  const data=await b64(f);
  await DB.add('photos',{jardimId:curJId,data,addedAt:new Date().toISOString()});
  const photos=await DB.byIdx('photos','jid',curJId);
  renderPh(photos);
  document.getElementById('jm-th').innerHTML=`<img src="${photos[photos.length-1].data}" alt="">`;
  e.target.value=''; toast('📸 Foto salva!'); loadJardim();
}
async function delJPh(pid){
  if(!confirm('Excluir foto?')) return;
  await DB.del('photos',pid);
  const photos=await DB.byIdx('photos','jid',curJId);
  renderPh(photos);
  const j=await DB.get('jardim',curJId); const p=allP.find(x=>x.id===j.plantId);
  const lat=photos.length?photos[photos.length-1].data:null;
  document.getElementById('jm-th').innerHTML = lat?`<img src="${lat}" alt="">`:(p.emoji||'🌿');
  toast('🗑️ Foto removida'); loadJardim();
}
async function addLog(icon,text){
  if(!curJId) return;
  await DB.add('logs',{jardimId:curJId,icon,text,date:new Date().toISOString()});
  const logs=await DB.byIdx('logs','jid',curJId);
  document.getElementById('jm-logs').innerHTML=logs.slice().reverse().slice(0,25).map(l=>`
    <div class="log-i"><div class="log-ico">${l.icon}</div>
    <div><div class="log-txt">${l.text}</div><div class="log-dt">${fmtD(l.date)}</div></div></div>`).join('');
  toast(icon+' '+text); loadJardim();
}
async function removeJardim(){
  if(!confirm('Remover planta do jardim?')) return;
  const logs=await DB.byIdx('logs','jid',curJId), photos=await DB.byIdx('photos','jid',curJId);
  for(const l of logs) await DB.del('logs',l.id);
  for(const ph of photos) await DB.del('photos',ph.id);
  await DB.del('jardim',curJId);
  toast('🗑️ Removida do jardim'); closeJM(); loadJardim();
}
function openPV(src){ document.getElementById('pv-img').src=src; document.getElementById('pvw').classList.add('on'); }
function closePV(){ document.getElementById('pvw').classList.remove('on'); }

// ── IDENTIFY ──
const MOCK_ID=[
  {nome:'Monstera Deliciosa',sci:'Monstera deliciosa',conf:94,c:'Regar 2x/semana, luz indireta, adubação mensal.'},
  {nome:'Orquídea Phalaenopsis',sci:'Phalaenopsis spp.',conf:89,c:'Regar 1x/semana, sem sol direto, casca de pinus.'},
  {nome:'Espada de São Jorge',sci:'Sansevieria trifasciata',conf:92,c:'Rega escassa, tolera qualquer iluminação.'},
  {nome:'Echeveria',sci:'Echeveria elegans',conf:86,c:'Regar a cada 2 semanas, sol pleno, solo arenoso.'},
  {nome:'Antúrio',sci:'Anthurium andraeanum',conf:83,c:'Luz indireta, solo úmido, adubação nitrogenada.'},
];
function handleId(e){
  const f=e.target.files[0]; if(!f) return;
  const fr=new FileReader(); fr.onload=ev=>{
    document.getElementById('id-img').src=ev.target.result;
    document.getElementById('id-prev').style.display='block';
    document.getElementById('id-res').style.display='none';
    document.getElementById('upzone').style.display='none';
    document.querySelector('.id-btns').style.display='none';
    doId();
  }; fr.readAsDataURL(f);
}
function doId(){
  document.getElementById('id-load').style.display='block';
  setTimeout(()=>{
    document.getElementById('id-load').style.display='none';
    const r=MOCK_ID[Math.floor(Math.random()*MOCK_ID.length)]; idResult=r;
    document.getElementById('res-nm').textContent=r.nome;
    document.getElementById('res-sc').textContent=r.sci;
    document.getElementById('res-bar').style.width=r.conf+'%';
    document.getElementById('res-pct').textContent=r.conf+'% confiança';
    document.getElementById('res-care').innerHTML='<strong>Cuidados básicos:</strong><br>'+r.c;
    document.getElementById('id-res').style.display='block';
  },2200);
}
async function addIdToJardim(){
  if(!idResult) return;
  const m = allP.find(p=>p.nome.toLowerCase().includes(idResult.nome.split(' ')[0].toLowerCase()));
  if(m) await addToJardim(m.id); else{ toast('✅ Registrada no jardim!'); resetId(); goTo('jardim'); }
}
function resetId(){
  document.getElementById('id-prev').style.display='none';
  document.getElementById('id-load').style.display='none';
  document.getElementById('id-res').style.display='none';
  document.getElementById('upzone').style.display='block';
  document.querySelector('.id-btns').style.display='flex';
  document.getElementById('if-cam').value='';
  document.getElementById('if-gal').value='';
  idResult=null;
}

// ── CALENDAR ──
async function loadCal(){ renderCal(); await renderTasks(); }
function renderCal(){
  const mn=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  document.getElementById('cal-ml').textContent=`${mn[calD.getMonth()]} ${calD.getFullYear()}`;
  const today=new Date(), first=new Date(calD.getFullYear(),calD.getMonth(),1).getDay();
  const dim=new Date(calD.getFullYear(),calD.getMonth()+1,0).getDate();
  let h=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=>`<div class="cdn">${d}</div>`).join('');
  for(let i=0;i<first;i++) h+='<div class="cd oth"></div>';
  for(let d=1;d<=dim;d++){
    const iT=d===today.getDate()&&calD.getMonth()===today.getMonth()&&calD.getFullYear()===today.getFullYear();
    h+=`<div class="cd${iT?' td':''}">${d}</div>`;
  }
  document.getElementById('cgrid').innerHTML=h;
}
function calPrev(){ calD.setMonth(calD.getMonth()-1); renderCal(); }
function calNext(){ calD.setMonth(calD.getMonth()+1); renderCal(); }
async function renderTasks(){
  if(!CU) return;
  const items=await DB.byIdx('jardim','uid',CU.id);
  const tasks=[], today=new Date(); today.setHours(0,0,0,0);
  items.forEach(j=>{
    const p=allP.find(x=>x.id===j.plantId); if(!p) return;
    const a=new Date(j.addedAt);
    const r=new Date(a);r.setDate(r.getDate()+7);r.setHours(0,0,0,0);
    const ad=new Date(a);ad.setDate(ad.getDate()+30);ad.setHours(0,0,0,0);
    const po=new Date(a);po.setDate(po.getDate()+45);po.setHours(0,0,0,0);
    tasks.push({tp:'r',p:p.nome,e:p.emoji,d:r,i:'💧',l:'Rega'});
    tasks.push({tp:'a',p:p.nome,e:p.emoji,d:ad,i:'🌿',l:'Adubação'});
    tasks.push({tp:'p',p:p.nome,e:p.emoji,d:po,i:'✂️',l:'Poda'});
  });
  tasks.sort((a,b)=>a.d-b.d);
  const tl=document.getElementById('tlst');
  if(!tasks.length){ tl.innerHTML='<div class="empty"><div class="empty-ico">📅</div><h3>Nenhuma tarefa</h3><p>Adicione plantas ao jardim</p></div>'; return; }
  tl.innerHTML=tasks.slice(0,12).map((t,i)=>{
    const diff=Math.round((t.d-today)/86400000);
    let bColor='#DCE9CE',bDis='',borderStyle='1px solid #DDD0B8',dateColor='#5C7A3E',dateText=fmtD(t.d.toISOString());
    if(diff<0){bColor='#FFEBEE';bDis='disabled';borderStyle='1px solid #FFCDD2';dateColor='#F44336';dateText='⚠️ Atrasada '+Math.abs(diff)+'d';}
    else if(diff===0){bColor='#FFEBEE';borderStyle='2px solid #F44336';dateColor='#F44336';dateText='🔴 HOJE!';}
    else{bColor='#FFF3E0';bDis='disabled';dateColor='#FF9800';}
    return `<div class="tcard" id="tc-${i}" style="border:${borderStyle}">
      <div class="tico t-${t.tp}">${t.i}</div>
      <div class="tin"><div class="tn">${t.e} ${t.l}</div><div class="tp">${t.p}</div><div class="tddate" style="color:${dateColor}">${dateText}</div></div>
      <button class="tdbtn" style="background:${bColor}" ${bDis} onclick="doneTask(${i})">✓</button>
    </div>`;
  }).join('');
}
function doneTask(i){ const el=document.getElementById('tc-'+i); if(el){el.classList.add('done');toast('✅ Tarefa concluída!');} }

// ── NOTIFICATIONS ──
async function checkTasks(){
  if(!CU) return;
  const items=await DB.byIdx('jardim','uid',CU.id); if(!items.length) return;
  const today=new Date(); today.setHours(0,0,0,0);
  const todayTasks=[];
  items.forEach(j=>{
    const p=allP.find(x=>x.id===j.plantId); if(!p) return;
    const a=new Date(j.addedAt);
    const r=new Date(a);r.setDate(r.getDate()+7);r.setHours(0,0,0,0);
    const ad=new Date(a);ad.setDate(ad.getDate()+30);ad.setHours(0,0,0,0);
    const po=new Date(a);po.setDate(po.getDate()+45);po.setHours(0,0,0,0);
    if(r.getTime()===today.getTime())  todayTasks.push({i:'💧',l:'Rega',p:p.nome});
    if(ad.getTime()===today.getTime()) todayTasks.push({i:'🌿',l:'Adubação',p:p.nome});
    if(po.getTime()===today.getTime()) todayTasks.push({i:'✂️',l:'Poda',p:p.nome});
  });
  if(todayTasks.length){
    document.getElementById('bell-dot').style.display='block';
    window._ntasks=todayTasks;
    try{
      const ctx=new(window.AudioContext||window.webkitAudioContext)();
      [523,659,784].forEach((freq,i)=>{
        const o=ctx.createOscillator(),g=ctx.createGain();
        o.connect(g);g.connect(ctx.destination); o.frequency.value=freq; o.type='sine';
        g.gain.setValueAtTime(0.25,ctx.currentTime+i*.18);
        g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*.18+.28);
        o.start(ctx.currentTime+i*.18); o.stop(ctx.currentTime+i*.18+.28);
      });
    }catch(e){}
  }
}
function openNotif(){
  const tasks=window._ntasks||[];
  document.getElementById('bell-dot').style.display='none';
  const cnt=document.getElementById('notif-cnt');
  cnt.innerHTML=tasks.length?'<p style="font-size:13px;color:#6B7A58;margin-bottom:10px">Tarefas de hoje:</p>'+tasks.map(t=>`
    <div style="display:flex;align-items:center;gap:11px;padding:11px;background:#F8F3EC;border-radius:8px;margin-bottom:7px;border-left:3px solid #2D5016">
      <span style="font-size:20px">${t.i}</span>
      <div><div style="font-size:14px;font-weight:600;color:#1E3A0F">${t.l}</div><div style="font-size:12px;color:#6B7A58">${t.p}</div></div>
    </div>`).join(''):'<div class="empty"><div class="empty-ico">🔔</div><h3>Sem notificações</h3><p>Nenhuma tarefa para hoje.</p></div>';
  document.getElementById('notif-pnl').classList.add('on');
}
function closeNotif(){ document.getElementById('notif-pnl').classList.remove('on'); }

// ── PERFIL ──
function updatePerfil(){
  if(!CU) return;
  document.getElementById('pf-av').textContent = CU.avatar||'👤';
  document.getElementById('pf-nm').textContent  = CU.nome;
  document.getElementById('pf-ph').textContent  = fmtPh(CU.phone);
}

// ── PWA INSTALL ──
let dP=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();dP=e;});
window.addEventListener('appinstalled',()=>{dP=null;toast('✅ MiniHorto instalado!');});
function doPWA(){
  if(dP){dP.prompt();dP.userChoice.then(r=>{if(r.outcome==='accepted')toast('✅ MiniHorto sendo instalado!');dP=null;});}
  else{
    const ua=navigator.userAgent.toLowerCase();
    let msg='';
    if(/iphone|ipad|ipod/.test(ua)) msg='No Safari: toque em 🔗 → "Adicionar à Tela de Início"';
    else if(/android/.test(ua)) msg='No Chrome: toque em ⋮ → "Adicionar à tela inicial"';
    else msg='No Chrome/Edge: clique em ⊕ na barra de endereços ou menu → Instalar';
    showInstallModal(msg);
  }
}
function showInstallModal(msg){
  const ex=document.getElementById('install-modal'); if(ex)ex.remove();
  const div=document.createElement('div'); div.id='install-modal';
  div.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px';
  div.innerHTML=`<div style="background:#FDFAF6;border-radius:20px;padding:24px;max-width:360px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.3)">
    <div style="font-size:40px;text-align:center;margin-bottom:12px">📲</div>
    <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:600;color:#1E3A0F;text-align:center;margin-bottom:10px">Instalar MiniHorto</div>
    <div style="font-size:13px;color:#3D4F2E;text-align:center;line-height:1.7;margin-bottom:18px;background:#DCE9CE;padding:12px;border-radius:10px">${msg}</div>
    <button onclick="document.getElementById('install-modal').remove()" style="width:100%;padding:12px;background:linear-gradient(135deg,#2D5016,#5C7A3E);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Entendido ✓</button>
  </div>`;
  document.body.appendChild(div);
  div.addEventListener('click',e=>{if(e.target===div)div.remove();});
}

// ── ADMIN: TABS ──
function aTab(tab,el){
  document.querySelectorAll('.anb').forEach(b=>b.classList.remove('on'));
  document.querySelectorAll('.asec').forEach(s=>s.classList.remove('on'));
  el.classList.add('on'); document.getElementById('a-'+tab).classList.add('on');
  if(tab==='plantas')  loadAdmP();
  if(tab==='clientes') loadAdmC();
  if(tab==='produtos') loadAdmProd();
}
async function loadDash(){
  const users=await DB.all('users'), jardim=await DB.byIdx('jardim','uid',CU?.id||0).catch(()=>[]);
  const allJardim=(await Promise.all((await DB.all('users')).filter(u=>u.role==='cliente').map(u=>DB.byIdx('jardim','uid',u.id)))).flat();
  let prods=[]; try{prods=await DB.all('produtos');}catch(e){}
  document.getElementById('dgrid').innerHTML=`
    <div class="dstat"><div class="ds-i">🌿</div><div class="ds-n">${allP.length}</div><div class="ds-l">Plantas</div></div>
    <div class="dstat"><div class="ds-i">👥</div><div class="ds-n">${users.filter(u=>u.role==='cliente').length}</div><div class="ds-l">Clientes</div></div>
    <div class="dstat"><div class="ds-i">🌱</div><div class="ds-n">${allJardim.length}</div><div class="ds-l">Jardins</div></div>
    <div class="dstat"><div class="ds-i">📦</div><div class="ds-n">${prods.length}</div><div class="ds-l">Produtos</div></div>`;
  const top=[...allP].sort((a,b)=>(b.views||0)-(a.views||0)).slice(0,5);
  document.getElementById('dtop').innerHTML=`
    <h3 style="font-family:'Cormorant Garamond',serif;font-size:17px;color:#1E3A0F;margin-bottom:10px">Mais Visitadas</h3>
    <div style="background:#FDFAF6;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(45,80,22,.07)">
      ${top.map(p=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #F8F3EC">
        <div style="width:34px;height:34px;border-radius:8px;background:#DCE9CE;display:flex;align-items:center;justify-content:center;font-size:18px;overflow:hidden;flex-shrink:0">${p.photo?`<img src="${p.photo}" style="width:100%;height:100%;object-fit:cover">`:(p.emoji||'🌿')}</div>
        <div style="flex:1"><div style="font-size:13px;font-weight:600">${p.nome}</div><div style="font-size:11px;color:#6B7A58">${p.categoria}</div></div>
        <span style="font-size:12px;font-weight:600;color:#5C7A3E">${p.views||0} vis.</span></div>`).join('')}
    </div>`;
}
async function loadAdmP(){
  document.getElementById('ptbl').innerHTML=allP.map(p=>`<tr>
    <td><div style="width:34px;height:34px;border-radius:8px;background:#DCE9CE;display:flex;align-items:center;justify-content:center;font-size:18px;overflow:hidden">${p.photo?`<img src="${p.photo}" style="width:100%;height:100%;object-fit:cover">`:(p.emoji||'🌿')}</div></td>
    <td><strong>${p.nome}</strong><br><em style="font-size:11px;color:#6B7A58">${p.sci}</em></td>
    <td>${p.categoria}</td>
    <td><span class="bdg ${p.dif==='Fácil'?'b-easy':p.dif==='Médio'?'b-med':'b-hard'}">${p.dif}</span></td>
    <td><button class="abtn ae" onclick="editP(${p.id})">✏️</button></td>
  </tr>`).join('');
}
async function loadAdmC(){
  const users=await DB.all('users');
  const allJardim=[];
  for(const u of users.filter(x=>x.role==='cliente')){
    const jd=await DB.byIdx('jardim','uid',u.id);
    allJardim.push({uid:u.id,count:jd.length});
  }
  document.getElementById('ctbl').innerHTML=users.filter(u=>u.role==='cliente').map(u=>`<tr>
    <td>${u.avatar} <strong>${u.nome}</strong></td>
    <td>${fmtPh(u.phone)}</td>
    <td>${(allJardim.find(j=>j.uid===u.id)||{count:0}).count} planta(s)</td>
    <td>${fmtD(u.createdAt)}</td>
    <td><button class="abtn ad" onclick="delCli(${u.id})">🗑️</button></td>
  </tr>`).join('');
}
async function delCli(id){
  if(!confirm('Excluir cliente e todos os dados?')) return;
  const jardins=await DB.byIdx('jardim','uid',id);
  for(const j of jardins){
    const logs=await DB.byIdx('logs','jid',j.id), photos=await DB.byIdx('photos','jid',j.id);
    for(const l of logs) await DB.del('logs',l.id);
    for(const ph of photos) await DB.del('photos',ph.id);
    await DB.del('jardim',j.id);
  }
  localStorage.removeItem('fv_'+id);
  await DB.del('users',id);
  toast('🗑️ Cliente excluído'); loadAdmC();
}
// ── PLANT FORM (admin) ──
// Note: In GitHub Pages mode, plants come from dados.json.
// Edits here are local only. To persist globally, update dados.json in GitHub.
function openPF(plant){
  admPh=plant?.photo||null;
  document.getElementById('pf-tit').textContent=plant?'Editar Planta (local)':'Nova Planta (local)';
  document.getElementById('pf-id').value=plant?.id||'';
  ['nm','em','sc','rg','tmp','pt','sl','ad','tx','ob','cu'].forEach(k=>{
    const el=document.getElementById('f-'+k); if(el) el.value=plant?.[{nm:'nome',em:'emoji',sc:'sci',rg:'rega',tmp:'temp',pt:'porte',sl:'solo',ad:'adubacao',tx:'toxicidade',ob:'obs',cu:'curio'}[k]]||'';
  });
  document.getElementById('f-cat').value=plant?.categoria||'interior';
  document.getElementById('f-luz').value=plant?.luz||'Sol pleno';
  document.getElementById('f-dif').value=plant?.dif||'Fácil';
  const prev=document.getElementById('adm-prev');
  prev.querySelectorAll('img').forEach(i=>i.remove());
  const emo=document.getElementById('adm-prev-e');
  if(admPh){const img=document.createElement('img');img.src=admPh;img.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover';prev.appendChild(img);emo.style.display='none';}
  else{emo.style.display='';emo.textContent=plant?.emoji||'🌿';}
  document.getElementById('pf-ov').classList.add('on');
}
function closePF(){ document.getElementById('pf-ov').classList.remove('on'); }
async function handleAdmPh(e){ const f=e.target.files[0]; if(!f)return; admPh=await b64(f); const prev=document.getElementById('adm-prev'); prev.querySelectorAll('img').forEach(i=>i.remove()); const img=document.createElement('img');img.src=admPh;img.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover';prev.appendChild(img);document.getElementById('adm-prev-e').style.display='none'; }
function editP(id){ const p=allP.find(x=>x.id===id); if(p) openPF(p); }
function savePF(){
  const nm=document.getElementById('f-nm').value.trim(); if(!nm){toast('⚠️ Informe o nome');return;}
  const id=parseInt(document.getElementById('pf-id').value);
  const data={nome:nm,emoji:document.getElementById('f-em').value||'🌿',sci:document.getElementById('f-sc').value,
    categoria:document.getElementById('f-cat').value,luz:document.getElementById('f-luz').value,
    rega:document.getElementById('f-rg').value,dif:document.getElementById('f-dif').value,
    temp:document.getElementById('f-tmp').value,porte:document.getElementById('f-pt').value,
    solo:document.getElementById('f-sl').value,adubacao:document.getElementById('f-ad').value,
    toxicidade:document.getElementById('f-tx').value||'Não tóxica',
    obs:document.getElementById('f-ob').value,curio:document.getElementById('f-cu').value,
    photo:admPh||null,ambiente:'Interior/Exterior',agua:'Moderada'};
  if(id){ const idx=allP.findIndex(x=>x.id===id); if(idx>=0) allP[idx]={...allP[idx],...data}; toast('✅ Atualizado (local)! Para salvar definitivamente, edite dados.json no GitHub.'); }
  else{ const newId=Math.max(...allP.map(x=>x.id),0)+1; allP.push({...data,id:newId,views:0,createdAt:new Date().toISOString()}); toast('✅ Adicionado (local)! Para salvar definitivamente, edite dados.json no GitHub.'); }
  closePF(); loadAdmP();
}
// ── PRODUCTS ──
async function loadAdmProd(){
  let prods=[]; try{prods=await DB.all('produtos');}catch(e){}
  const tbody=document.getElementById('prodtbl');
  if(!prods.length){tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:#6B7A58;padding:20px">Nenhum produto</td></tr>';return;}
  const icons={vasos:'🏺',adubos:'🌿',substratos:'🪨',ferramentas:'🔧',sementes:'🌱',mudas:'🪴',outros:'📦'};
  tbody.innerHTML=prods.map(p=>`<tr>
    <td><strong>${icons[p.categoria]||'📦'} ${p.nome}</strong>${p.descricao?`<br><span style="font-size:11px;color:#6B7A58">${p.descricao.slice(0,40)}</span>`:''}</td>
    <td style="text-transform:capitalize">${p.categoria}</td>
    <td>${p.quantidade} ${p.unidade}</td>
    <td style="color:#2D5016;font-weight:600">R$ ${Number(p.valor).toFixed(2).replace('.',',')}</td>
    <td><button class="abtn ae" onclick="editProd(${p.id})">✏️</button><button class="abtn ad" onclick="delProd(${p.id})">🗑️</button></td>
  </tr>`).join('');
}
function openProdF(prod){
  document.getElementById('prod-tit').textContent=prod?'Editar Produto':'Novo Produto';
  document.getElementById('prod-id').value=prod?.id||'';
  document.getElementById('pr-nm').value=prod?.nome||'';
  document.getElementById('pr-cat').value=prod?.categoria||'vasos';
  document.getElementById('pr-un').value=prod?.unidade||'un';
  document.getElementById('pr-qt').value=prod?.quantidade||'';
  document.getElementById('pr-vl').value=prod?.valor||'';
  document.getElementById('pr-ds').value=prod?.descricao||'';
  document.getElementById('prod-ov').classList.add('on');
}
function closeProdF(){ document.getElementById('prod-ov').classList.remove('on'); }
async function editProd(id){ let prods=[]; try{prods=await DB.all('produtos');}catch(e){} const p=prods.find(x=>x.id===id); if(p) openProdF(p); }
async function delProd(id){ if(!confirm('Excluir produto?'))return; await DB.del('produtos',id); toast('🗑️ Produto excluído'); loadAdmProd(); }
async function saveProdF(){
  const nm=document.getElementById('pr-nm').value.trim(); if(!nm){toast('⚠️ Informe o nome');return;}
  const id=document.getElementById('prod-id').value;
  const data={nome:nm,categoria:document.getElementById('pr-cat').value,unidade:document.getElementById('pr-un').value,
    quantidade:parseFloat(document.getElementById('pr-qt').value)||0,
    valor:parseFloat(document.getElementById('pr-vl').value)||0,
    descricao:document.getElementById('pr-ds').value,createdAt:new Date().toISOString()};
  if(id){const ex=await DB.get('produtos',parseInt(id));await DB.put('produtos',{...ex,...data,id:parseInt(id)});toast('✅ Produto atualizado!');}
  else{await DB.add('produtos',data);toast('✅ Produto cadastrado!');}
  closeProdF(); loadAdmProd();
}
// ── EXPORT / IMPORT ──
async function exportData(){
  toast('⏳ Gerando backup...');
  try{
    const users=await DB.all('users'),jardim=await DB.all('jardim').catch(()=>[]),
          logs=await DB.all('logs').catch(()=>[]),photos=await DB.all('photos').catch(()=>[]),
          produtos=await DB.all('produtos').catch(()=>[]);
    const backup={version:2,exportedAt:new Date().toISOString(),plants:allP,users,jardim,logs,photos,produtos};
    const json=JSON.stringify(backup,null,2);
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([json],{type:'application/json'}));
    a.download=`minihorto-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast(`✅ Backup exportado! (${(json.length/1024).toFixed(1)} KB)`);
  }catch(err){toast('❌ Erro: '+err.message);}
}
async function importData(event){
  const file=event.target.files[0]; if(!file)return;
  const status=document.getElementById('import-status');
  status.style.display='block';status.style.background='#E3F2FD';status.style.color='#1565C0';status.textContent='⏳ Lendo...';
  try{
    const data=JSON.parse(await file.text());
    if(!data.users) throw new Error('Arquivo inválido');
    if(!confirm(`Importar backup de ${data.exportedAt?new Date(data.exportedAt).toLocaleString('pt-BR'):'?'}?\n• ${data.users?.length||0} usuários\n• ${data.jardim?.length||0} jardins\n• ${data.photos?.length||0} fotos\n⚠️ Dados atuais serão substituídos!`)){
      status.textContent='❌ Cancelado';status.style.background='#FFEBEE';status.style.color='#C62828';event.target.value='';return;
    }
    const stores=['users','jardim','logs','photos','produtos'];
    for(const s of stores){try{const all=await DB.all(s);for(const it of all)await DB.del(s,it.id);}catch(e){}}
    const ins=async(s,items)=>{if(!items?.length)return 0;let c=0;for(const it of items){const{id,...r}=it;try{await DB.add(s,r);c++;}catch(e){}}return c;};
    const uc=await ins('users',data.users),jc=await ins('jardim',data.jardim),
          lc=await ins('logs',data.logs),fc=await ins('photos',data.photos),dc=await ins('produtos',data.produtos);
    status.style.background='#E8F5E9';status.style.color='#2E7D32';
    status.textContent=`✅ Importado! ${uc} usuários · ${jc} jardins · ${lc} históricos · ${fc} fotos · ${dc} produtos`;
    toast('✅ Dados importados!'); event.target.value='';
    setTimeout(()=>{loadDash();loadAdmP();loadAdmC();loadAdmProd();},600);
  }catch(err){status.style.background='#FFEBEE';status.style.color='#C62828';status.textContent='❌ Erro: '+err.message;event.target.value='';}
}
async function clearAllData(){
  if(!confirm('⚠️ Apagar TODOS os dados?\n\nEsta ação NÃO pode ser desfeita!')) return;
  if(!confirm('Confirma a exclusão de todos os dados?')) return;
  const stores=['users','jardim','logs','photos','produtos'];
  for(const s of stores){try{const all=await DB.all(s);for(const it of all)await DB.del(s,it.id);}catch(e){}}
  Object.keys(localStorage).filter(k=>k.startsWith('fv_')||k==='mh_sess').forEach(k=>localStorage.removeItem(k));
  toast('🧹 Dados removidos'); setTimeout(()=>doLogout(),1200);
}

// ── PWA SERVICE WORKER ──
(function(){
  const manifest={name:'MiniHorto',short_name:'MiniHorto',description:'Gestão de plantas e jardinagem',
    start_url:'.',display:'standalone',orientation:'portrait-primary',
    background_color:'#1E3A0F',theme_color:'#2D5016',
    icons:[{src:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' fill='%232D5016' rx='80'/%3E%3Ctext x='256' y='320' font-size='300' text-anchor='middle' font-family='serif'%3E🌿%3C/text%3E%3C/svg%3E",sizes:'512x512',type:'image/svg+xml',purpose:'any maskable'}]};
  const link=document.createElement('link');link.rel='manifest';
  link.href=URL.createObjectURL(new Blob([JSON.stringify(manifest)],{type:'application/manifest+json'}));
  document.head.appendChild(link);
  if('serviceWorker' in navigator){
    const sw=`const C='mh-v1';self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.add('.')));self.skipWaiting();});self.addEventListener('activate',e=>{e.waitUntil(clients.claim());});self.addEventListener('fetch',e=>{if(e.request.url.includes('dados.json'))return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});`;
    const swURL=URL.createObjectURL(new Blob([sw],{type:'application/javascript'}));
    navigator.serviceWorker.register(swURL,{scope:'./'}).catch(()=>{});
  }
})();

// ── START ──
init();
