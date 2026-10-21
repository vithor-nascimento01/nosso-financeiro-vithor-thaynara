(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const BRL = v => (Number(v) || 0).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  const name = slot => slot === 'v' ? 'Vithor' : slot === 't' ? 'Thaynara' : 'Conjunta';
  let api, user, household, slot, channel, refreshTimer, polling, editing = null, refreshing = false;
  let movements = [], goals = [], settings = [], messages = [];
  function show(id) {
    for (const key of ['setup','login','household','workspace']) $(key).hidden = key !== id;
  }
  function notice(message, error=false) {
    $('setupText').textContent = message;
    $('connection').textContent = error ? '● Indisponível' : '● Conectado';
  }
  function toAmount(str) {
    const s = String(str||'').trim().replace(/\s/g,'');
    return Number(s.includes(',') ? s.replace(/\./g,'').replace(',','.') : s);
  }
  function fail(error) {
    const msg = typeof error === 'string' ? error : error?.message || 'Ocorreu um problema com a operação.';
    alert(msg);
    return false;
  }
  function validKind(kind, from, to, goal) {
    if (kind==='income') return !!to;
    if (kind==='expense') return !!from;
    if (kind==='transfer') return !!from && !!to && from!==to;
    if (kind==='goal') return !!from && !!goal;
    if (kind==='withdraw') return !!to && !!goal;
    return false;
  }
  async function init() {
    try {
      const resp = await fetch('/api/public-config', {cache:'no-store'});
      const conf = await resp.json();
      if(!resp.ok || !conf.configured) throw new Error('O banco ainda não está conectado ao projeto Vercel. Nenhuma informação foi enviada.');
      if(!window.supabase?.createClient) throw new Error('Biblioteca de autenticação indisponível. Verifique a conexão com a internet.');
      api = window.supabase.createClient(conf.url, conf.anonKey, {
        auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}
      });
      api.auth.onAuthStateChange(() => {
        // Evita chamadas Supabase dentro do próprio callback de autenticação.
        setTimeout(() => loadSession().catch(fail), 0);
      });
      await loadSession();
    } catch(err) {
      show('setup');
      notice(err.message, true);
    }
  }
  async function loadSession() {
    if(!api) return;
    const {data:{user:account},error} = await api.auth.getUser();
    if(error && error.status !== 400) return fail(error);
    if(!account) {
      user=null;household=null;slot=null;
      if(channel) {await api.removeChannel(channel);channel=null;}
      show('login');$('connection').textContent='● Acesso seguro';
      return;
    }
    user=account;
    const result=await api.rpc('current_household');
    if(result.error) return fail(result.error);
    if(!result.data) {
      show('household');
      $('connection').textContent='● Conta validada';
      return;
    }
    household=result.data;
    const myRole=await api.rpc('my_slot',{p_household:household});
    if(myRole.error)return fail(myRole.error);
    slot=myRole.data;
    $('memberName').textContent=name(slot);
    show('workspace');$('connection').textContent='● Sincronizado';
    await loadData();
    listen();
  }
  async function loadData() {
    if(!api||!household||refreshing)return;
    refreshing=true;
    try {
      const id=household;
      const [a,b,c,d] = await Promise.all([
        api.from('movements').select('*').eq('household_id',id).order('created_at',{ascending:true}),
        api.from('goals').select('*').eq('household_id',id).order('label'),
        api.from('person_settings').select('*').eq('household_id',id),
        api.from('chat_messages').select('*').eq('household_id',id).order('created_at',{ascending:true}).limit(300)
      ]);
      for(const res of [a,b,c,d])if(res.error)throw res.error;
      if(id!==household)return;
      movements=a.data;goals=b.data;settings=c.data;messages=d.data;
      draw();
    } catch(err) {fail(err);}
    finally {refreshing=false;}
  }
  function refreshSoon(){
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(()=>loadData(),250);
  }
  function listen(){
    if(channel)api.removeChannel(channel);
    if(polling)clearInterval(polling);
    channel=api.channel('nosso-financeiro-'+household);
    for(const table of ['movements','goals','person_settings','chat_messages']){
      channel.on('postgres_changes',
        {event:'*',schema:'public',table,filter:'household_id=eq.'+household},
        refreshSoon);
    }
    channel.subscribe();
    // Fallback: caso o canal Realtime caia no Safari ou o app volte do repouso.
    polling=setInterval(()=>{if(!document.hidden)loadData();},15000);
  }
  const goalSaved = code => movements.reduce((n,m) =>
    n + (m.goal_code===code && m.kind==='goal' ? Number(m.amount)
         : m.goal_code===code && m.kind==='withdraw' ? -Number(m.amount) : 0),0);
  const balance = code => movements.reduce((n,m) => {
    const v=Number(m.amount);
    if(m.kind==='income' && m.to_code===code)return n+v;
    if((m.kind==='transfer'||m.kind==='withdraw') && m.to_code===code)return n+v;
    if(['expense','transfer','goal'].includes(m.kind) && m.from_code===code)return n-v;
    return n;
  },0);
  function goalCell(g) {
    const saved=goalSaved(g.code),target=Number(g.target)||0;
    const p=target ? Math.max(0,Math.min(100,100*saved/target)):0;
    return '<button class="goal" data-goal="'+esc(g.code)+'">'+
      '<b>'+esc(g.label)+'</b><span class="big">'+BRL(saved)+'</span>'+
      '<div class="track"><i style="width:'+p+'%"></i></div>'+
      '<span class="description">Meta '+BRL(target)+' · '+p.toFixed(0)+'%</span></button>';
  }
  function movementRow(m,canEdit=true){
    const symbol={income:'↗',expense:'↘',transfer:'⇄',goal:'♡',withdraw:'↪'}[m.kind]||'•';
    const label={income:'Receita',expense:'Despesa',transfer:'Transferência',goal:'Aporte',withdraw:'Resgate'}[m.kind]||m.kind;
    return '<div class="item"><div class="row space"><div>'+
    '<b>'+symbol+' '+esc(m.description||label)+'</b><small>'+label+' · '+name(m.person)+' · '+esc(m.occurred_on)+'</small></div>'+
    '<div style="text-align:right"><b class="'+(m.kind==='expense'?'red':m.kind==='income'?'green':'')+'">'+BRL(m.amount)+'</b>'+
    (canEdit&&m.author_id===user.id?'<br><button class="btnoutline" data-edit="'+esc(m.id)+'" style="padding:6px 9px;margin-top:7px">Editar</button>':'')+
    '</div></div></div>';
  }
  function draw() {
    const available=balance('v')+balance('t')+balance('shared');
    const reserved=goals.reduce((n,g)=>n+goalSaved(g.code),0);
    const receipts=movements.filter(m=>m.kind==='income').reduce((n,m)=>n+Number(m.amount),0);
    const expenses=movements.filter(m=>m.kind==='expense').reduce((n,m)=>n+Number(m.amount),0);
    $('totalBalance').textContent=BRL(available+reserved);
    $('stats').innerHTML=[['Disponível',available],['Reservado',reserved],['Receitas',receipts],['Despesas',expenses]]
      .map(([label,v])=>'<div class="card"><span class="description">'+label+'</span><div class="big">'+BRL(v)+'</div></div>').join('');
    $('accounts').innerHTML=['v','t','shared'].map(code=>
      '<div class="card"><span class="description">'+name(code)+'</span><div class="big">'+BRL(balance(code))+'</div></div>').join('');
    $('recent').innerHTML=movements.length?movements.slice(-5).reverse().map(m=>movementRow(m,false)).join('')
      :'<div class="description">Nenhum lançamento registrado ainda.</div>';
    $('entries').innerHTML=movements.length?movements.slice().reverse().map(m=>movementRow(m,true)).join('')
      :'<div class="description">Toque em Novo para registrar uma despesa ou receita.</div>';
    $('goalCards').innerHTML=goals.map(goalCell).join('');
    $('mGoal').innerHTML=goals.map(g=>'<option value="'+esc(g.code)+'">'+esc(g.label)+'</option>').join('');
    $('messages').innerHTML=messages.map(m=>
      '<div class="bubble '+(m.sender_id===user.id?'mine':'')+'"><small>'+name(m.sender_slot)+'</small>'+
      esc(m.body)+'</div>').join('');
    $('messages').scrollTop=$('messages').scrollHeight;
  }
  function editMovement(id=null,goal=null) {
    editing=movements.find(m=>m.id===id)||null;
    $('entryTitle').textContent=editing?'Editar lançamento':'Novo lançamento';
    $('entryFormWrapper').hidden=false;
    $('entryError').textContent='';
    $('mKind').value=editing?.kind||(goal?'goal':'expense');
    $('mAmount').value=editing?String(editing.amount).replace('.',','):'';
    $('mDate').value=editing?.occurred_on||today();
    $('mDescription').value=editing?.description||'';
    $('mFrom').value=editing?.from_code||slot;
    $('mTo').value=editing?.to_code||'shared';
    if(editing?.goal_code||goal)$('mGoal').value=editing?.goal_code||goal;
    $('mCategory').value=editing?.category||'Outros';
    $('removeEntry').hidden=!editing;
    $('entryFormWrapper').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function saveMovement(e) {
    e.preventDefault();
    $('entryError').textContent='';
    const kind=$('mKind').value,amount=toAmount($('mAmount').value);
    if(!Number.isFinite(amount)||amount<=0||amount>999999999999.99){$('entryError').textContent='Valor inválido.';return;}
    const from=$('mFrom').value,to=$('mTo').value,g=$('mGoal').value;
    if(!validKind(kind,from,to,g)){$('entryError').textContent='Confira origem, destino e meta.';return;}
    const fields={household_id:household,kind,person:slot,author_id:user.id,amount:Math.round(amount*100)/100,
      from_code:['expense','transfer','goal'].includes(kind)?from:null,
      to_code:['income','transfer','withdraw'].includes(kind)?to:null,
      goal_code:['goal','withdraw'].includes(kind)?g:null,
      description:$('mDescription').value.trim(),category:$('mCategory').value,
      occurred_on:$('mDate').value};
    const btn=$('entryForm').querySelector('button[type=submit]');
    btn.disabled=true;
    try {
      let result;
      if(editing){
        // A política RLS permite que o autor altere o próprio lançamento.
        result=await api.from('movements').update(fields).eq('id',editing.id).select();
      }else result=await api.from('movements').insert(fields).select();
      if(result.error)throw result.error;
      if(!result.data?.length)throw new Error('Lançamento não autorizado pela regra de segurança.');
      $('entryFormWrapper').hidden=true;editing=null;
      await loadData();
    } catch(err){$('entryError').textContent=err.message;}
    finally{btn.disabled=false;}
  }
  async function removeMovement(){
    if(!editing||!confirm('Excluir seu lançamento? Os saldos serão recalculados.'))return;
    try{
      const res=await api.from('movements').delete().eq('id',editing.id).eq('author_id',user.id).select();
      if(res.error)throw res.error;
      if(!res.data?.length)throw new Error('Sem autorização para excluir este lançamento.');
      $('entryFormWrapper').hidden=true;editing=null;await loadData();
    }catch(err){fail(err);}
  }
  async function editGoalTarget(code){
    const item=goals.find(g=>g.code===code);if(!item)return;
    const text=prompt('Meta de '+item.label+' (R$):',String(item.target).replace('.',','));
    if(text===null)return;
    const amount=toAmount(text);
    if(!Number.isFinite(amount)||amount<0)return fail('Valor inválido.');
    const res=await api.from('goals').update({target:amount}).eq('household_id',household).eq('code',code);
    if(res.error)return fail(res.error);
    await loadData();
  }
  async function createFamily() {
    const res=await api.rpc('create_household',{p_name:'Nosso Financeiro'});
    if(res.error){$('familyError').textContent=res.error.message;return;}
    await loadSession();
  }
  async function joinFamily() {
    const token=$('inviteInput').value.trim();
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(token)){
      $('familyError').textContent='Cole o convite completo enviado pelo parceiro.';return;
    }
    const res=await api.rpc('join_partner_by_invite',{p_code:token});
    if(res.error){$('familyError').textContent=res.error.message;return;}
    await loadSession();
  }
  async function makeInvite() {
    if(slot!=='v')return fail('O convite é criado pelo primeiro membro da família.');
    const res=await api.rpc('create_partner_invite');
    if(res.error)return fail(res.error);
    const token=res.data;
    $('inviteResult').textContent='Código: '+token+' — encaminhe somente ao parceiro. Expira em 48 horas.';
  }
  async function sendMessage(e){
    e.preventDefault();const text=$('message').value.trim();if(!text)return;
    const res=await api.from('chat_messages').insert({
      household_id:household,sender_id:user.id,sender_slot:slot,body:text
    });
    if(res.error)return fail(res.error);
    $('message').value='';await loadData();
  }
  $('loginForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const email=$('email').value.trim();
    $('loginStatus').textContent='Solicitando link seguro...';
    const res=await api.auth.signInWithOtp({
      email,options:{emailRedirectTo:location.origin+'/cloud.html'}
    });
    $('loginStatus').textContent=res.error ? res.error.message :
      'Confira seu e-mail. Abra o link recebido no mesmo dispositivo.';
  });
  $('createFamily').onclick=createFamily;
  $('joinFamily').onclick=joinFamily;
  $('makeInvite').onclick=makeInvite;
  $('logout').onclick=async()=>{if(polling)clearInterval(polling);await api.auth.signOut();await loadSession();};
  $('newMovement').onclick=()=>editMovement();
  $('cancelEntry').onclick=()=>{$('entryFormWrapper').hidden=true;};
  $('entryForm').onsubmit=saveMovement;
  $('removeEntry').onclick=removeMovement;
  $('messageForm').onsubmit=sendMessage;
  $('entries').addEventListener('click',e=>{
    const btn=e.target.closest('[data-edit]');
    if(btn)editMovement(btn.dataset.edit);
  });
  $('goalCards').addEventListener('click',e=>{
    const btn=e.target.closest('[data-goal]');
    if(btn)editGoalTarget(btn.dataset.goal);
  });
  document.querySelectorAll('.nav [data-tab]').forEach(btn=>{
    btn.onclick=()=>{
      document.querySelectorAll('.nav button').forEach(el=>el.classList.toggle('active',el===btn));
      document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el.id===btn.dataset.tab));
      window.scrollTo(0,0);
    };
  });
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&api&&household)refreshSoon();
  });
  init();
})();
