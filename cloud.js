(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const BRL = v => (Number(v) || 0).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  const name = slot => slot === 'v' ? 'Vithor' : slot === 't' ? 'Thaynara' : 'Conjunta';
  let api, user, household, slot, channel, refreshTimer, polling, editing = null, refreshing = false, refreshAgain = false;
  let recovering = false, quickUnlocked = false, pinDismissed = false, gatewayUnlocked = false;
  let accountSwitching = false, authRevision = 0;
  let gatewayFailures = 0, gatewayLockedUntil = 0;
  let pinFailures = 0, pinLockedUntil = 0;
  let movements = [], goals = [], settings = [], messages = [], householdMembers = [];
  let pendingFinance = null, pendingSourceId = null, installPrompt = null;
  const INVITE_KEY = 'nfvt-pending-invite-v1';
  let activeInviteLink = '';
  function inviteIsValid(code){
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code || '');
  }
  function pendingInvite(){
    try{
      const data=JSON.parse(localStorage.getItem(INVITE_KEY)||'null');
      if(data && inviteIsValid(data.code) && Number(data.until)>Date.now())return data.code;
      localStorage.removeItem(INVITE_KEY);
    }catch(e){/* Navegador pode bloquear armazenamento. */}
    return '';
  }
  function captureInvite(){
    // O fragmento (#convite=...) não é enviado ao servidor ou às ferramentas de análise.
    if(!location.hash.startsWith('#convite='))return;
    const code=location.hash.slice('#convite='.length).trim();
    if(inviteIsValid(code)){
      try{localStorage.setItem(INVITE_KEY,JSON.stringify({code,until:Date.now()+48*60*60*1000}));}
      catch(e){window.__nfvtInvitation=code;}
    }
    // Remove o token da barra de endereços assim que o convite é recebido.
    try{history.replaceState(history.state,'',location.pathname+location.search);}catch(e){}
  }
  function availableInvite(){
    return pendingInvite() || (inviteIsValid(window.__nfvtInvitation) ? window.__nfvtInvitation : '');
  }
  function clearInvite(){
    try{localStorage.removeItem(INVITE_KEY);}catch(e){}
    delete window.__nfvtInvitation;
  }
  function inviteBaseURL(){
    // URLs individuais de preview mudam a cada commit; o alias da branch é estável.
    const branchURL='https://nosso-financeiro-vt-gi-git-f7e55e-vithor-nascimento01s-projects.vercel.app';
    const transientPreview=/^nosso-financeiro-vt-github-[a-z0-9]+\.vercel\.app$/i.test(location.hostname);
    return (transientPreview ? branchURL : location.origin) + '/cloud.html';
  }
  function show(id) {
    document.body.classList.toggle('auth-screen',id!=='workspace');
    for (const key of ['setup','gate','login','signup','forgot','setPassword','quicklock','pinSetup','household','workspace']) $(key).hidden = key !== id;
    if(id==='household'){
      $('setupAccountEmail').textContent=user?.email||'Conta não identificada';
      const code=availableInvite();
      $('createFamily').disabled=!!code;
      if(code){
        $('inviteInput').value=code;
        $('familyError').textContent='Convite encontrado. Use Entrar pelo convite; não crie outra família.';
      }else $('familyError').textContent='';
    }
    if(id==='gate' && availableInvite()){
      $('gateStatus').textContent='♡ Você recebeu um convite. Entre para vincular seu celular ao financeiro do casal.';
    }
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
    captureInvite();
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
        if (!recovering && !accountSwitching) setTimeout(() => loadSession().catch(fail), 0);
      });
      if (!recovering) await loadSession();
    } catch(err) {
      show('setup');
      notice(err.message, true);
    }
  }
  async function loadSession() {
    if(!api || recovering || accountSwitching) return;
    const revision=authRevision;
    if(!gatewayUnlocked){show('gate');$('connection').textContent='● Acesso do casal';return;}
    const {data:{user:account},error} = await api.auth.getUser();
    if(revision!==authRevision || accountSwitching)return;
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
    if(revision!==authRevision || accountSwitching)return;
    if(result.error) return fail(result.error);
    if(!result.data) {
      show('household');
      $('connection').textContent='● Conta validada';
      return;
    }
    household=result.data;
    const myRole=await api.rpc('my_slot',{p_household:household});
    if(revision!==authRevision || accountSwitching)return;
    if(myRole.error)return fail(myRole.error);
    slot=myRole.data;
    if(!storedPIN && !pinDismissed && window.crypto?.subtle){
      show('pinSetup');$('connection').textContent='● Acesso seguro';
      return;
    }
    $('memberName').textContent=name(slot);
    $('accountEmail').textContent=user.email||'Conta não identificada';
    $('familyIdentifier').textContent=String(household).slice(0,8).toUpperCase();
    $('memberRole').textContent=name(slot);
    const invitePending=availableInvite();
    const alert=$('membershipAlert');
    alert.hidden=!(invitePending&&slot==='v');
    if(!alert.hidden)alert.textContent='Um convite de outra família está pendente, mas esta conta já foi criada com o perfil Vithor. Confira sua conta antes de registrar gastos.';
    show('workspace');$('connection').textContent='● Banco conectado';
    await loadData();
    listen();
  }
  async function loadData() {
    if(!api||!household)return false;
    if(refreshing){refreshAgain=true;return false;}
    refreshing=true;
    try {
      const id=household;
      const [a,b,c,d,e] = await Promise.all([
        api.from('movements').select('*').eq('household_id',id).order('created_at',{ascending:true}),
        api.from('goals').select('*').eq('household_id',id).order('label'),
        api.from('person_settings').select('*').eq('household_id',id),
        api.from('chat_messages').select('*').eq('household_id',id).order('created_at',{ascending:true}).limit(300),
        api.from('household_members').select('user_id,slot').eq('household_id',id)
      ]);
      for(const res of [a,b,c,d,e])if(res.error)throw res.error;
      if(id!==household)return;
      movements=a.data;goals=b.data;settings=c.data;messages=d.data;
      householdMembers=e.data||[];
      $('connection').textContent=householdMembers.length>=2?'● Dois membros conectados':'● Aguardando parceiro';
      $('membershipAlert').hidden=householdMembers.length>=2;
      if(householdMembers.length<2){
        $('membershipAlert').textContent='Esta família financeira tem apenas um membro. A outra pessoa precisa entrar com a conta própria e aceitar o convite para os dados serem realmente compartilhados. Compare o identificador do grupo nos dois celulares.';
      }
      draw();
      return true;
    } catch(err) {fail(err);return false;}
    finally {
      refreshing=false;
      if(refreshAgain){refreshAgain=false;setTimeout(()=>loadData().catch(fail),50);}
    }
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
    $('messages').innerHTML=messages.map(m=>{
      const self=m.sender_id===user.id;
      const potential=window.NFVTFinance?.parse?.(m.body);
      let status='';
      if(potential){
        const existing=movements.some(row=>
          row.author_id===m.sender_id && row.kind===potential.kind &&
          Math.abs(Number(row.amount)-potential.amount)<0.005 &&
          row.description.trim().toLowerCase()===potential.description.trim().toLowerCase() &&
          row.occurred_on===potential.occurred_on
        );
        status=existing
          ? '<span class="finance-status">✓ Lançamento correspondente encontrado no Extrato</span>'
          : self
            ? '<span class="finance-status">⚠ Só mensagem — ainda não entrou no Extrato</span>'+
              '<button type="button" class="register-chat" data-finance-message="'+esc(m.id)+'">Revisar e registrar no Extrato</button>'
            : '<span class="finance-status">⏳ Mensagem financeira ainda não registrada. Aguardando confirmação de '+name(m.sender_slot)+'.</span>';
      }
      return '<div class="bubble '+(self?'mine':'')+'"><small>'+name(m.sender_slot)+'</small>'+
        esc(m.body)+status+'</div>';
    }).join('');
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
    clearInvite();
    $('familyError').textContent='Convite aceito! Abrindo o financeiro compartilhado.';
    await loadSession();
  }
  async function makeInvite() {
    if(slot!=='v')return fail('O convite é criado pelo primeiro membro da família.');
    const button=$('makeInvite');
    button.disabled=true;
    $('inviteResult').textContent='Preparando o convite...';
    try{
      const res=await api.rpc('create_partner_invite');
      if(res.error)throw res.error;
      if(!inviteIsValid(res.data))throw new Error('O banco não retornou um convite válido.');
      activeInviteLink=inviteBaseURL()+'#convite='+res.data;
      const text='Amor, te convidei para o nosso financeiro ❤️ Abra este link no seu celular. Depois de entrar e criar sua conta online, toque em “Entrar pelo convite”. O convite já vai ficar preenchido: '+activeInviteLink;
      $('inviteWhatsapp').href='https://wa.me/?text='+encodeURIComponent(text);
      $('inviteWhatsapp').hidden=false;
      $('inviteCopy').hidden=false;
      $('inviteResult').textContent='Convite pronto! Envie pelo WhatsApp. Válido por 48 horas e para uso único.';
    }catch(err){$('inviteResult').textContent=err?.message||'Não foi possível gerar o convite.';}
    finally{button.disabled=false;}
  }
  function clearFinanceDraft(){
    pendingFinance=null;pendingSourceId=null;
    $('financeDraft').hidden=true;
    $('draftError').textContent='';
    $('draftConfirm').disabled=false;
    $('draftConfirm').textContent='✓ Confirmar registro';
  }
  function presentFinanceDraft(item, sourceId=null){
    $('chatActionStatus').hidden=true;
    pendingFinance=item;
    pendingSourceId=sourceId;
    $('draftAmount').textContent=BRL(item.amount);
    $('draftType').textContent=item.kind==='expense'?'Despesa':'Receita';
    $('draftTitle').textContent='♡ Entendi sua mensagem!';
    $('draftWarning').textContent=item.needsReview
      ? 'Encontrei mais de um número. Confira com atenção: o valor sugerido pode não ser o total.'
      : 'Confirme ou corrija os dados antes de salvar no Extrato compartilhado.';
    $('draftDescription').value=item.description;
    $('draftCategory').value=item.category;
    $('draftAccount').value=slot;
    $('draftDate').value=item.occurred_on;
    $('draftError').textContent='';
    $('financeSaved').hidden=true;
    $('financeDraft').hidden=false;
    $('draftConfirm').disabled=false;
    $('draftConfirm').textContent='✓ Confirmar registro';
    $('financeDraft').scrollTop=0;
  }
  async function postChatText(text){
    const result=await api.from('chat_messages').insert({
      household_id:household,sender_id:user.id,sender_slot:slot,body:text
    });
    if(result.error)throw result.error;
    return true;
  }
  async function sendMessage(e){
    e.preventDefault();
    const text=$('message').value.trim();
    if(!text || !api || !household || !user || !['v','t'].includes(slot))return;
    const parsed=window.NFVTFinance?.parse?.(text);
    if(parsed){
      presentFinanceDraft(parsed);
      return;
    }
    clearFinanceDraft();
    const form=$('messageForm'),button=form.querySelector('button[type=submit]');
    button.disabled=true;
    try{
      await postChatText(text);
      if($('message').value.trim()===text)$('message').value='';
      await loadData();
    }catch(err){fail(err);}
    finally{button.disabled=false;}
  }
  async function confirmFinanceDraft(){
    if(!pendingFinance)return;
    if(!api||!user||!household||!['v','t'].includes(slot)){
      $('draftError').textContent='Sua conta precisa estar conectada para registrar.';return;
    }
    const item=pendingFinance;
    if(!pendingSourceId && $('message').value.trim()!==item.original){
      $('draftError').textContent='A mensagem foi alterada. Toque em enviar novamente para revisar os dados.';return;
    }
    const description=$('draftDescription').value.trim().slice(0,150);
    const category=$('draftCategory').value;
    const account=$('draftAccount').value;
    const date=$('draftDate').value;
    if(!description || !['v','t','shared'].includes(account) || !/^\d{4}-\d{2}-\d{2}$/.test(date)){
      $('draftError').textContent='Verifique descrição, carteira e data.';return;
    }
    if(!Number.isFinite(item.amount)||item.amount<=0){
      $('draftError').textContent='O valor não é válido.';return;
    }
    const fields={
      household_id:household,kind:item.kind,person:slot,author_id:user.id,
      amount:item.amount,from_code:item.kind==='expense'?account:null,
      to_code:item.kind==='income'?account:null,goal_code:null,
      description,category,occurred_on:date
    };
    const button=$('draftConfirm');
    button.disabled=true;
    button.textContent='Salvando...';
    let saved=false;
    try{
      // Somente a confirmação grava o movimento. A RLS valida usuário e família.
      const response=await api.from('movements').insert(fields).select('id');
      if(response.error)throw response.error;
      if(!response.data?.length)throw new Error('O lançamento não foi autorizado.');
      saved=true;
      try{
        const categoryText=category==='Outros'?'':', '+category;
        const msg='✓ Registrado: '+(item.kind==='expense'?'despesa':'receita')+
          ' de '+BRL(item.amount)+' — '+description+categoryText+'.';
        await postChatText(msg);
      }catch(chatError){
        // Nunca tenta gravar o movimento novamente só porque a mensagem falhou.
        console.warn('Movimento salvo. Aviso no chat não enviado.',chatError);
      }
      if($('message').value.trim()===item.original)$('message').value='';
      clearFinanceDraft();
      $('chatActionStatus').textContent='✓ Registro salvo com sucesso no Extrato compartilhado! Saldos e totais atualizados para Vithor e Thaynara.';
      $('chatActionStatus').hidden=false;
      await loadData();
    }catch(err){
      $('draftError').textContent=saved
        ? 'Lançamento salvo. Atualize o Extrato para conferir.'
        : 'Não foi possível salvar: '+(err?.message||'verifique sua conexão.');
    }finally{
      button.disabled=false;
      button.textContent='✓ Confirmar registro';
    }
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
  // Sempre use o alias estável, inclusive se o cadastro começou em um preview temporário.
  const redirectTo = () => inviteBaseURL();
  const feedback = (id, message) => { $(id).textContent=message; };
  const authError = err => {
    if (!err) return '';
    const msg=err.message||'', code=err.code||'', status=Number(err.status)||0;
    if (/email_address_not_authorized/i.test(code+' '+msg)) return 'O serviço de e-mail padrão do Supabase não permite enviar confirmação para esse endereço. O administrador deve configurar SMTP próprio ou criar uma conta confirmada em Authentication > Users.';
    if (/over_email_send_rate_limit|email rate limit/i.test(code+' '+msg)) return 'O Supabase atingiu o limite de e-mails de confirmação. NÃO envie o cadastro novamente agora. O administrador pode verificar a conta em Authentication > Users e, se ainda não existir, criá-la manualmente. O convite do casal continua separado.';
    if (/over_request_rate_limit|too many requests|rate limit|security purposes, you can only request/i.test(code+' '+msg) || status===429) return 'Muitas tentativas em pouco tempo. Evite apertar novamente e confira no Supabase > Authentication > Users se a conta foi criada. Aguarde a liberação do limite antes de tentar outra vez.';
    if (/invalid login credentials/i.test(msg)) return 'Login ou senha incorretos. Confira os dados ou recupere a senha.';
    if (/email not confirmed|email_not_confirmed/i.test(code+' '+msg)) return 'O e-mail desta conta ainda precisa ser confirmado. Confira o e-mail recebido ou peça ao administrador para verificar o estado em Authentication > Users.';
    if (/user already registered|user_already_exists/i.test(code+' '+msg)) return 'Essa conta já está cadastrada. Volte ao login e use o e-mail e a senha que vocês criaram.';
    if (/password should|password is too short|weak_password/i.test(code+' '+msg)) return 'Escolha uma senha mais forte, com pelo menos 8 caracteres.';
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
    $('signupHelp').hidden=true;
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
        'Cadastro solicitado. Se não chegar o e-mail de confirmação, veja as instruções abaixo. Não repita o cadastro.');
      $('signupHelp').hidden=!!res.data?.session;
      if(res.data?.session)await loadSession();
    }catch(err){
      feedback('signupStatus',authError(err));
      $('signupHelp').hidden=false;
    }
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
  $('backToGate').onclick=()=>{gatewayUnlocked=false;show('gate');};
  $('createFamily').onclick=createFamily;
  $('joinFamily').onclick=joinFamily;
  $('makeInvite').onclick=makeInvite;
  $('inviteCopy').onclick=async()=>{
    if(!activeInviteLink)return;
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(activeInviteLink);
      else throw new Error('sem acesso');
      $('inviteResult').textContent='Link copiado! Agora é só enviar à Thaynara. Expira em 48 horas.';
    }catch(e){
      window.prompt('Copie o convite para enviar à Thaynara:',activeInviteLink);
    }
  };
  $('switchAccount').onclick=async()=>{
    const btn=$('switchAccount');
    btn.disabled=true;
    accountSwitching=true;
    authRevision++;
    // A troca de conta deve mostrar a tela de login imediatamente no iPhone.
    gatewayUnlocked=true;quickUnlocked=false;pinDismissed=true;
    user=null;household=null;slot=null;
    movements=[];goals=[];settings=[];messages=[];householdMembers=[];
    if(polling){clearInterval(polling);polling=null;}
    if(channel){api.removeChannel(channel).catch(()=>{});channel=null;}
    show('login');
    $('email').value='';$('password').value='';
    $('loginStatus').textContent='Saindo da conta anterior neste aparelho...';
    submitBusy($('loginForm'),true);
    try{
      if(!api)throw new Error('Sem conexão com o banco.');
      // Não desconectar o Vithor dos outros aparelhos (escopo global é o padrão).
      const res=await api.auth.signOut({scope:'local'});
      if(res.error)throw res.error;
      $('loginStatus').textContent='Conta anterior desconectada. Entre com o e-mail e a senha da Thaynara.';
      $('connection').textContent='● Trocar conta';
    }catch(err){
      $('loginStatus').textContent='Não foi possível encerrar a sessão anterior: '+(err?.message||'erro na conexão')+'. Confira a internet e toque em Trocar conta novamente.';
    }finally{
      accountSwitching=false;
      btn.disabled=false;
      submitBusy($('loginForm'),false);
    }
  };
  $('logout').onclick=async()=>{gatewayUnlocked=false;quickUnlocked=false;pinDismissed=true;for(const id of ['entries','recent','messages','goalCards','accounts','stats']){if($(id))$(id).textContent='';}show('gate');$('connection').textContent='● Acesso do casal';};
  $('refreshLedger').onclick=async()=>{const btn=$('refreshLedger');btn.disabled=true;try{await loadData();}finally{btn.disabled=false;}};
  $('newMovement').onclick=()=>editMovement();
  $('cancelEntry').onclick=()=>{$('entryFormWrapper').hidden=true;};
  $('entryForm').onsubmit=saveMovement;
  $('removeEntry').onclick=removeMovement;
  $('messageForm').onsubmit=sendMessage;
  $('refreshChat').onclick=async()=>{
    const btn=$('refreshChat');btn.disabled=true;
    try{
      const ok=await loadData();
      $('chatActionStatus').textContent=ok?'↻ Conversa, Extrato e saldos atualizados.':'Atualização em andamento. Confira novamente em alguns segundos.';
      $('chatActionStatus').hidden=false;
    }catch(err){
      $('chatActionStatus').textContent='Não foi possível atualizar. Confira a conexão.';
      $('chatActionStatus').hidden=false;
    }finally{btn.disabled=false;}
  };
  $('messages').addEventListener('click',event=>{
    const button=event.target.closest('[data-finance-message]');
    if(!button)return;
    const msg=messages.find(m=>m.id===button.dataset.financeMessage && m.sender_id===user?.id);
    const parsed=msg && window.NFVTFinance?.parse?.(msg.body);
    if(!parsed)return;
    presentFinanceDraft(parsed,msg.id);
  });
  $('draftConfirm').onclick=confirmFinanceDraft;
  $('draftCancel').onclick=()=>clearFinanceDraft();
  $('draftSendText').onclick=async()=>{
    const text=pendingFinance?.original;
    if(!text || !api || !household)return;
    const button=$('draftSendText');
    button.disabled=true;
    try{
      await postChatText(text);
      if($('message').value.trim()===text)$('message').value='';
      clearFinanceDraft();
      $('chatActionStatus').textContent='Mensagem enviada como conversa. Nenhum gasto foi registrado no Extrato.';
      $('chatActionStatus').hidden=false;
      await loadData();
    }catch(err){$('draftError').textContent='Não foi possível enviar: '+(err?.message||'erro de conexão.');}
    finally{button.disabled=false;}
  };
  $('message').addEventListener('input',()=>{
    if(pendingFinance && !pendingSourceId && $('message').value.trim()!==pendingFinance.original)clearFinanceDraft();
  });
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
      if(['ledger','conversation','dashboard'].includes(btn.dataset.tab))refreshSoon();
    };
  });
  // Instalação como aplicativo progressivo — login seguro permanece online.
  window.addEventListener('beforeinstallprompt', event=>{
    event.preventDefault();
    installPrompt=event;
  });
  const showInstallGuide=()=>{
    const guide=$('appInstallGuide');
    guide.hidden=false;
    const iphone=/iPhone|iPad|iPod/i.test(navigator.userAgent);
    guide.textContent=iphone
      ? 'No iPhone: abra o Nosso Financeiro no Safari (não no navegador do WhatsApp), toque em Compartilhar ⤴, escolha “Adicionar à Tela de Início” e confirme. O ícone V♡T aparecerá no celular.'
      : 'No Android: abra o Nosso Financeiro no Chrome, toque nos três pontos ⋮ e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”. Se disponível, use o botão de instalação.';
    guide.scrollIntoView({behavior:'smooth',block:'start'});
  };
  $('installGuide').onclick=async()=>{
    if(installPrompt){
      const prompt=installPrompt;installPrompt=null;
      try{await prompt.prompt();await prompt.userChoice;}
      catch(err){showInstallGuide();}
    }else showInstallGuide();
  };
  if('serviceWorker' in navigator && location.protocol==='https:'){
    window.addEventListener('load',()=>navigator.serviceWorker.register('./cloud-sw.js',{scope:'./cloud.html'})
      .catch(error=>console.warn('Atalho funciona mesmo sem cache de instalação.',error)));
  }
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&api&&household)refreshSoon();
  });
  init();
})();
