(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const BRL = v => (Number(v) || 0).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  const name = slot => slot === 'v' ? 'Vithor' : slot === 't' ? 'Thaynara' : 'Conjunta';
  let api, user, household, slot, channel, refreshTimer, polling, editing = null, refreshing = false;
  let recovering = false, quickUnlocked = false, pinDismissed = false, gatewayUnlocked = false;
  let gatewayFailures = 0, gatewayLockedUntil = 0;
  let pinFailures = 0, pinLockedUntil = 0;
  let movements = [], goals = [], settings = [], messages = [];
  function show(id) {
    document.body.classList.toggle('auth-screen',id!=='workspace');
    for (const key of ['setup','gate','login','signup','forgot','setPassword','quicklock','pinSetup','household','workspace']) $(key).hidden = key !== id;
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
      api.auth.onAuthStateChange(event => {
        if (event === 'PASSWORD_RECOVERY') {
          recovering = true;
          show('setPassword');
          $('connection').textContent='● Recuperação segura';
          return;
        }
        // As consultas devem ocorrer fora do callback para evitar bloqueios do SDK.
        if (!recovering) setTimeout(() => loadSession().catch(fail), 0);
      });
      if (!recovering) await loadSession();
    } catch(err) {
      show('setup');
      notice(err.message, true);
    }
  }
  async function loadSession() {
    if(!api || recovering) return;
    if(!gatewayUnlocked){show('gate');$('connection').textContent='● Acesso do casal';return;}
    const {data:{user:account},error} = await api.auth.getUser();
    if(error && error.status !== 400) return fail(error);
    if(!account) {
      user=null;household=null;slot=null;
      if(channel) {await api.removeChannel(channel);channel=null;}
      show('login');$('connection').textContent='● Acesso seguro';
      return;
    }
    if(user?.id && user.id!==account.id){quickUnlocked=false;pinDismissed=false;}
    user=account;
    const storedPIN=readDevicePin();
    if(storedPIN && !quickUnlocked){
      show('quicklock');$('connection').textContent='● Acesso rápido';
      return;
    }
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
    if(!storedPIN && !pinDismissed && window.crypto?.subtle){
      show('pinSetup');$('connection').textContent='● Acesso seguro';
      return;
    }
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

  // O PIN é uma trava de conveniência local. Ele NÃO é autenticação remota
  // e só funciona depois que o Supabase tiver uma sessão real deste usuário.
  const devicePinKey = () => user ? 'nfvt-local-pin-v1-'+user.id : null;
  function readDevicePin(){
    try {return JSON.parse(localStorage.getItem(devicePinKey())||'null');}
    catch(e){return null;}
  }
  async function pinDigest(pin,salt){
    const bytes=new TextEncoder().encode('nfvt-pin-v1:'+salt+':'+pin);
    const raw=await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(raw)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  function pinFeedback(id,message){$(id).textContent=message;}
  $('pinSetupForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const pin=$('setupPin').value,confirm=$('setupPinConfirm').value;
    if(!/^\d{4}$/.test(pin))return pinFeedback('pinSetupStatus','Informe um PIN de 4 dígitos.');
    if(pin!==confirm)return pinFeedback('pinSetupStatus','Os dois PINs precisam ser iguais.');
    if(!user || !window.crypto?.subtle)return pinFeedback('pinSetupStatus','Sessão não disponível. Entre novamente pela conta segura.');
    const salt=Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const hash=await pinDigest(pin,salt);
    try {localStorage.setItem(devicePinKey(),JSON.stringify({salt,hash}));}
    catch(e){return pinFeedback('pinSetupStatus','Não foi possível salvar o PIN neste navegador. Continue sem PIN.');}
    $('setupPin').value='';$('setupPinConfirm').value='';
    quickUnlocked=true;
    await loadSession();
  });
  $('skipPin').onclick=async()=>{pinDismissed=true;await loadSession();};
  $('quickForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const alias=$('quickUser').value.trim().toUpperCase(),pin=$('quickPin').value,config=readDevicePin();
    if(Date.now()<pinLockedUntil)return pinFeedback('quickStatus','Muitas tentativas. Aguarde alguns minutos.');
    if(alias!=='VTS2'||!config||!/^\d{4}$/.test(pin)){
      pinFeedback('quickStatus','Login ou PIN inválido.');return;
    }
    const actual=await pinDigest(pin,config.salt);
    $('quickPin').value='';
    if(actual!==config.hash){
      pinFailures++;
      if(pinFailures>=5){pinLockedUntil=Date.now()+5*60*1000;pinFailures=0;}
      pinFeedback('quickStatus','Login ou PIN inválido.');
      return;
    }
    pinFailures=0;
    quickUnlocked=true;
    pinFeedback('quickStatus','Acesso liberado neste aparelho.');
    await loadSession();
  });
  $('useSecureAccount').onclick=async()=>{
    quickUnlocked=false;pinDismissed=false;
    await api.auth.signOut();
    await loadSession();
  };

  // Acesso decorativo escolhido pelo casal. Não concede sessão Supabase.
  // A sincronização real só é liberada após autenticação do provedor.
  $('gateForm').addEventListener('submit', async event => {
    event.preventDefault();
    if(Date.now()<gatewayLockedUntil){
      $('gateStatus').textContent='Muitas tentativas. Tente novamente em alguns minutos.';return;
    }
    const login=$('gateUser').value.trim().toUpperCase();
    const pass=$('gatePass').value;
    $('gatePass').value='';
    if(login!=='VTS2' || pass!=='1409'){
      gatewayFailures++;
      if(gatewayFailures>=5){gatewayLockedUntil=Date.now()+3*60*1000;gatewayFailures=0;}
      $('gateStatus').textContent='Login ou senha incorretos.';return;
    }
    if(!api){$('gateStatus').textContent='Sem conexão com o banco online no momento.';return;}
    gatewayFailures=0;gatewayUnlocked=true;quickUnlocked=true;pinDismissed=true;
    $('gateStatus').textContent='';
    await loadSession();
  });
  const redirectTo = () => location.origin + '/cloud.html';
  const feedback = (id, message) => { $(id).textContent=message; };
  const authError = err => {
    if (!err) return '';
    const msg=err.message||'';
    if (/invalid login credentials/i.test(msg)) return 'Login ou senha incorretos. Confira os dados ou recupere a senha.';
    if (/email not confirmed/i.test(msg)) return 'Você precisa confirmar seu e-mail antes de entrar.';
    if (/password should|password is too short|weak_password/i.test(msg)) return 'Escolha uma senha mais forte, com pelo menos 8 caracteres.';
    if (/rate limit|too many requests|email rate limit/i.test(msg)) return 'Limite temporário de tentativas ou de e-mails. Tente novamente mais tarde.';
    return msg || 'Não foi possível concluir o acesso.';
  };
  const submitBusy = (form, busy) => {
    const button=form.querySelector('button[type=submit]');
    if(button)button.disabled=busy;
  };
  $('loginForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!api)return;
    const form=e.currentTarget, email=$('email').value.trim(), password=$('password').value;
    feedback('loginStatus','Verificando login...');
    submitBusy(form,true);
    try {
      const res=await api.auth.signInWithPassword({email,password});
      if(res.error) throw res.error;
      $('password').value='';
      feedback('loginStatus','Acesso autorizado.');
      await loadSession();
    } catch(err) {feedback('loginStatus',authError(err));}
    finally {submitBusy(form,false);}
  });
  $('openSignup').onclick=()=>{
    $('signupEmail').value=$('email').value;
    feedback('signupStatus','');
    show('signup');
  };
  $('openForgot').onclick=()=>{
    $('forgotEmail').value=$('email').value;
    feedback('forgotStatus','');
    show('forgot');
  };
  document.querySelectorAll('[data-go-login]').forEach(b=>b.onclick=()=>{
    feedback('loginStatus','');
    show('login');
  });
  $('signupForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!api)return;
    const password=$('signupPassword').value, confirm=$('signupConfirm').value, email=$('signupEmail').value.trim();
    if(password.length<8)return feedback('signupStatus','A senha precisa ter pelo menos 8 caracteres.');
    if(password!==confirm)return feedback('signupStatus','As senhas informadas não são iguais.');
    const form=e.currentTarget;
    submitBusy(form,true);
    feedback('signupStatus','Criando sua conta segura...');
    try{
      const res=await api.auth.signUp({email,password,options:{emailRedirectTo:redirectTo()}});
      if(res.error) throw res.error;
      $('signupPassword').value='';$('signupConfirm').value='';
      feedback('signupStatus',res.data?.session ?
        'Cadastro criado. Abrindo sua conta...' :
        'Verifique sua caixa de entrada e confirme seu e-mail pelo link recebido. Depois volte e faça o login com sua senha.');
      if(res.data?.session)await loadSession();
    }catch(err){feedback('signupStatus',authError(err));}
    finally{submitBusy(form,false);}
  });
  $('forgotForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!api)return;
    const form=e.currentTarget;
    submitBusy(form,true);
    feedback('forgotStatus','Solicitando recuperação...');
    try{
      const res=await api.auth.resetPasswordForEmail($('forgotEmail').value.trim(),{redirectTo:redirectTo()});
      if(res.error)throw res.error;
      feedback('forgotStatus','Se esse e-mail estiver cadastrado, você receberá um link para definir uma nova senha.');
    }catch(err){feedback('forgotStatus',authError(err));}
    finally{submitBusy(form,false);}
  });
  $('resetPasswordForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!api||!recovering)return;
    const password=$('resetPassword').value, confirm=$('resetConfirm').value;
    if(password.length<8)return feedback('resetStatus','Use uma senha com pelo menos 8 caracteres.');
    if(password!==confirm)return feedback('resetStatus','As senhas não coincidem.');
    const form=e.currentTarget;
    submitBusy(form,true);
    feedback('resetStatus','Atualizando sua senha...');
    try{
      const res=await api.auth.updateUser({password});
      if(res.error)throw res.error;
      $('resetPassword').value='';$('resetConfirm').value='';
      await api.auth.signOut();
      recovering=false;
      show('login');
      feedback('loginStatus','Senha alterada. Entre com seu e-mail e a nova senha.');
    }catch(err){feedback('resetStatus',authError(err));}
    finally{submitBusy(form,false);}
  });
  $('createFamily').onclick=createFamily;
  $('joinFamily').onclick=joinFamily;
  $('makeInvite').onclick=makeInvite;
  $('logout').onclick=async()=>{gatewayUnlocked=false;quickUnlocked=false;pinDismissed=true;show('gate');$('connection').textContent='● Acesso do casal';};
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
