(() => {
"use strict";
const STORAGE = "nosso-financeiro-vt-public-demo-v1";
const goals = [
  {id:"casamento",name:"Casamento",icon:"💍",target:30000,owner:"shared"},
  {id:"casa",name:"Nossa Casa",icon:"🏡",target:100000,owner:"shared"},
  {id:"viagens",name:"Viagens",icon:"✈️",target:8000,owner:"shared"},
  {id:"seguranca",name:"Reserva de Segurança do Casal",icon:"🛡️",target:15000,owner:"shared"},
  {id:"emergencia",name:"Emergência",icon:"🚨",target:10000,owner:"shared"},
  {id:"reserva_v",name:"Reserva individual Vithor",icon:"🔐",target:0,owner:"v"},
  {id:"reserva_t",name:"Reserva individual Thaynara",icon:"🔐",target:0,owner:"t"},
  {id:"invest_v",name:"Investimentos Vithor",icon:"📈",target:10000,owner:"v"},
  {id:"invest_t",name:"Investimentos Thaynara",icon:"📈",target:10000,owner:"t"}
];
const people = {v:"Vithor",t:"Thaynara",shared:"Conjunta"};
const initial = {person:"v",filter:"all",entries:[],salaries:{v:0,t:0},
  targets:Object.fromEntries(goals.map(g=>[g.id,g.target])),
  chat:[{who:"ia",text:"Bem-vindos! ♡ Enviem: 'Gastei R$ 85 no mercado', 'Recebi R$ 2.250 de salário', ou 'Guardei R$ 300 para o casamento'."}]};
let state = initial;
try {
  const json = JSON.parse(localStorage.getItem(STORAGE));
  if(json && Array.isArray(json.entries) && Array.isArray(json.chat)) {
    state = {...initial,...json,salaries:{...initial.salaries,...json.salaries},
      targets:{...initial.targets,...json.targets}};
  }
} catch(e) {}
const $ = id => document.getElementById(id);
const esc = v => String(v??"").replace(/[&<>"']/g,ch => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[ch]);
const real = n => (Number(n)||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const save = () => {try{localStorage.setItem(STORAGE,JSON.stringify(state));}catch(e){}};
const sum = predicate => state.entries.reduce((n,e)=>n+(predicate(e)?Number(e.amount):0),0);
const goalSaved = id => sum(e=>e.kind==="goal"&&e.goal===id)-sum(e=>e.kind==="withdraw"&&e.goal===id);
const balance = id => {
  let n=0;
  state.entries.forEach(e=>{
    if(e.kind==="income" && e.to===id)n+=e.amount;
    if(e.kind==="transfer" && e.to===id)n+=e.amount;
    if(e.kind==="withdraw" && e.to===id)n+=e.amount;
    if(["expense","transfer","goal"].includes(e.kind) && e.from===id)n-=e.amount;
  });
  return n;
};
const reserved = () => goals.reduce((n,g)=>n+goalSaved(g.id),0);
const available = () => ["v","t","shared"].reduce((n,k)=>n+balance(k),0);
const currLabel = t => t.kind==="income"?"Receita":t.kind==="expense"?"Despesa":t.kind==="transfer"?"Transferência":t.kind==="goal"?"Aporte":"Resgate";
const parseMoney = text => {
  let s=String(text||"").trim().replace(/\s|R\$/gi,"");
  if(s.includes(","))s=s.replace(/\./g,"").replace(",",".");
  else if(/^\d{1,3}(?:\.\d{3})+$/.test(s))s=s.replace(/\./g,"");
  const n=Number(s);
  return Number.isFinite(n)?Math.round(n*100)/100:NaN;
};
function goalCard(g){
  const val=goalSaved(g.id),target=Number(state.targets[g.id])||0;
  const pct=target?Math.min(100,Math.max(0,val/target*100)):0;
  return '<button class="goal" data-goal="'+esc(g.id)+'"><span class="emoji">'+g.icon+'</span><b>'+esc(g.name)+'</b><div class="saved">'+real(val)+'</div><div class="target">Meta: '+real(target)+' · '+pct.toFixed(0)+'%</div><div class="progress"><i style="width:'+pct+'%"></i></div></button>';
}
function entryRow(e) {
  const symbol=e.kind==="income"?"↗":e.kind==="expense"?"↘":"⇄";
  const color=e.kind==="income"?"green":e.kind==="expense"?"red":"";
  return '<div class="row"><div class="symbol">'+symbol+'</div><div class="flex1"><b>'+esc(e.description||currLabel(e))+'</b><small>'+esc(currLabel(e))+' · '+esc(people[e.person])+' · '+esc(e.date||"")+'</small></div><span class="amount '+color+'">'+real(e.amount)+'</span><button class="edit" data-edit="'+esc(e.id)+'" aria-label="Editar movimento">✎</button></div>';
}
function renderChat(){
  const box=$("mensagens");
  box.innerHTML=state.chat.map(msg=>'<div class="bubble '+(msg.who==="ia"?"":"me")+'"><b>'+esc(msg.who==="ia"?"♡ Assistente":people[msg.who])+'</b>'+esc(msg.text)+'</div>').join("");
  box.scrollTop=box.scrollHeight;
}
function render(){
  const v=balance("v"),t=balance("t"),c=balance("shared"),r=reserved();
  $("patrimonio").textContent=real(v+t+c+r);
  const stats=[["Disponível",v+t+c,""],["Reservado nas metas",r,""],["Receitas",sum(e=>e.kind==="income"),"green"],["Despesas",sum(e=>e.kind==="expense"),"red"]];
  $("stats").innerHTML=stats.map(s=>'<div class="card"><small>'+s[0]+'</small><strong class="'+s[2]+'">'+real(s[1])+'</strong></div>').join("");
  $("resumoMetas").innerHTML=goals.filter(g=>g.owner==="shared").map(goalCard).join("");
  $("todasMetas").innerHTML=goals.filter(g=>g.owner==="shared").map(goalCard).join("");
  $("recentes").innerHTML=state.entries.length?state.entries.slice().reverse().slice(0,5).map(entryRow).join(""):'<div class="empty">Nenhum lançamento ainda. Comecem pelo botão "Lançar gasto".</div>';
  $("cardsCarteiras").innerHTML=Object.keys(people).map(k=>'<div class="card row" style="margin-bottom:10px"><div class="symbol">▣</div><div class="flex1"><b>'+esc(people[k])+'</b><small>Saldo disponível</small></div><strong>'+real(balance(k))+'</strong></div>').join("");
  $("individuais").innerHTML=["v","t"].map(k=>{
    const salary=state.salaries[k]||0, reserve=k==="v"?"reserva_v":"reserva_t",invest=k==="v"?"invest_v":"invest_t";
    const pct=salary?Math.min(100,Math.max(0,100*goalSaved(reserve)/salary)):0;
    return '<div class="card" style="margin-bottom:11px"><div class="sectionline"><b>'+esc(people[k])+'</b><button class="edit" data-salary="'+k+'">Editar salário</button></div><p>Salário: '+real(salary)+' · 50% livres para gastos: '+real(salary/2)+'</p><p>Reserva individual de 1 salário: '+real(goalSaved(reserve))+' / '+real(salary)+'</p><div class="progress"><i style="width:'+pct+'%"></i></div><p>Meta investida: '+real(goalSaved(invest))+' / '+real(state.targets[invest])+'</p></div>';
  }).join("");
  const selected=state.filter||"all";
  const entries=state.entries.filter(e=>selected==="all"||e.person===selected||e.from===selected||e.to===selected);
  $("movimentos").innerHTML=entries.length?entries.slice().reverse().map(entryRow).join(""):'<div class="empty">Nenhum lançamento neste filtro.</div>';
  renderChat();
}
function selectOptions(values,chosen){
  return values.map(o=>'<option value="'+esc(o[0])+'"'+(o[0]===chosen?' selected':'')+'>'+esc(o[1])+'</option>').join("");
}
function openModal(title,html){
  $("modalTitle").textContent=title;$("modalBody").innerHTML=html;
  $("modalwrap").classList.add("visible");$("modalwrap").setAttribute("aria-hidden","false");
}
function closeModal(){
  $("modalwrap").classList.remove("visible");$("modalwrap").setAttribute("aria-hidden","true");
}
function editMovement(kind="expense",goal="",id=""){
  const old=state.entries.find(t=>t.id===id);
  if(old)kind=old.kind;
  const person=old?old.person:state.person;
  const fields= '<form id="movementForm">'+
    '<div class="field"><label>Tipo de movimentação</label><select id="mKind">'+selectOptions([["expense","Despesa"],["income","Receita"],["transfer","Transferência"],["goal","Aporte para meta"],["withdraw","Resgate de meta"]],kind)+'</select></div>'+
    '<div class="field"><label>Quem registrou</label><select id="mPerson">'+selectOptions([["v","Vithor"],["t","Thaynara"]],person)+'</select></div>'+
    '<div class="two"><div class="field"><label>Valor R$</label><input id="mAmount" inputmode="decimal" required placeholder="0,00" value="'+(old?String(old.amount).replace(".",","):"")+'"></div>'+
    '<div class="field"><label>Data</label><input id="mDate" type="date" required value="'+esc(old?old.date:new Date().toISOString().slice(0,10))+'"></div></div>'+
    '<div class="field"><label>Descrição</label><input id="mDescription" value="'+esc(old?old.description:"")+'" placeholder="Ex.: Mercado, salário"></div>'+
    '<div class="field"><label>Carteira de origem (despesa, transferência, aporte)</label><select id="mFrom">'+selectOptions(Object.entries(people),old?old.from:person)+'</select></div>'+
    '<div class="field"><label>Carteira de destino (receita, transferência, resgate)</label><select id="mTo">'+selectOptions(Object.entries(people),old?old.to:"shared")+'</select></div>'+
    '<div class="field"><label>Meta (aporte e resgate)</label><select id="mGoal">'+selectOptions(goals.map(g=>[g.id,g.name]),old?old.goal:goal||"casamento")+'</select></div>'+
    '<div class="field"><label>Categoria</label><select id="mCategory">'+selectOptions(["Alimentação","Moradia","Transporte","Saúde","Lazer","Pessoal","Outros"].map(x=>[x,x]),old?old.category:"Outros")+'</select></div>'+
    '<p class="footnote">Transferências e aportes são movimentações internas e não aumentam o total de despesas.</p>'+
    '<div class="buttons"><button type="button" class="secondary" id="cancelar">Cancelar</button><button class="primary" type="submit">Salvar</button></div>'+
    (old?'<button type="button" class="secondary red" id="excluir" style="margin-top:12px;width:100%">Excluir lançamento</button>':'')+
    '</form>';
  openModal(old?"Editar lançamento":"Nova movimentação",fields);
  $("cancelar").onclick=closeModal;
  $("movementForm").onsubmit=e=>{
    e.preventDefault();
    const amount=parseMoney($("mAmount").value);
    if(!Number.isFinite(amount)||amount<=0){alert("Digite um valor válido, maior que zero.");return;}
    const entry={id:old?old.id:String(Date.now())+Math.random().toString(36).slice(2),
      kind:$("mKind").value,amount,person:$("mPerson").value,
      from:$("mFrom").value,to:$("mTo").value,goal:$("mGoal").value,
      category:$("mCategory").value,date:$("mDate").value,
      description:$("mDescription").value.trim()};
    if(entry.kind==="transfer"&&entry.from===entry.to){alert("Origem e destino precisam ser diferentes.");return;}
    if(!entry.description)entry.description=currLabel(entry);
    if(old)state.entries=state.entries.map(x=>x.id===old.id?entry:x);
    else state.entries.push(entry);
    save();closeModal();render();
  };
  if(old)$("excluir").onclick=()=>{
    if(confirm("Excluir lançamento? Os saldos serão recalculados.")){
      state.entries=state.entries.filter(x=>x.id!==old.id);save();closeModal();render();
    }
  };
}
function editSalary(person){
  openModal("Salário de "+people[person],
    '<form id="salaryForm"><div class="field"><label>Salário mensal R$</label><input id="salaryValue" required inputmode="decimal" value="'+String(state.salaries[person]||0).replace(".",",")+'"></div><p class="footnote">O valor define as metas e o limite de 50%, mas não cria uma receita automaticamente.</p><button class="primary">Salvar salário</button></form>');
  $("salaryForm").onsubmit=e=>{
    e.preventDefault();const n=parseMoney($("salaryValue").value);
    if(!Number.isFinite(n)||n<0)return alert("Salário inválido.");
    state.salaries[person]=n;state.targets[person==="v"?"reserva_v":"reserva_t"]=n;
    save();closeModal();render();
  };
}
function editTargets(){
  const inputs=goals.map(g=>'<div class="field"><label>'+esc(g.name)+'</label><input data-target="'+g.id+'" inputmode="decimal" value="'+String(state.targets[g.id]||0).replace(".",",")+'"></div>').join("");
  openModal("Editar metas",'<form id="targetsForm">'+inputs+'<button class="primary" type="submit">Salvar metas</button></form>');
  $("targetsForm").onsubmit=e=>{
    e.preventDefault();
    document.querySelectorAll("[data-target]").forEach(el=>{
      const n=parseMoney(el.value);if(Number.isFinite(n)&&n>=0)state.targets[el.dataset.target]=n;
    });
    save();closeModal();render();
  };
}
function textAmount(s){
  const m=s.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(mil|k))?/i);
  if(!m)return 0;
  let n=parseMoney(m[1]);if(m[2])n*=1000;
  return Number.isFinite(n)?n:0;
}
function detectGoal(s){
  if(/casamento|casar/.test(s))return "casamento";
  if(/viag|férias|ferias/.test(s))return "viagens";
  if(/emergencia/.test(s))return "emergencia";
  if(/reserva/.test(s))return "seguranca";
  if(/casa|imovel/.test(s))return "casa";
  return null;
}
function onMessage(text){
  const s=text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const amount=textAmount(text),goal=detectGoal(s),person=state.person;
  state.chat.push({who:person,text});
  let answer="",kind=null,from=person,to=person,category="Outros";
  if(/quanto|saldo|resumo|relatorio/.test(s)){
    answer=goal
      ?'Meta '+goals.find(g=>g.id===goal).name+': '+real(goalSaved(goal))+' de '+real(state.targets[goal])+'.'
      :'Saldo Vithor: '+real(balance("v"))+'\nSaldo Thaynara: '+real(balance("t"))+'\nCarteira conjunta: '+real(balance("shared"))+'\nReservado nas metas: '+real(reserved());
  } else if(!amount){
    answer='Não encontrei o valor. Exemplo: Gastei R$ 85 no mercado.';
  } else {
    if(/transferi|mandei|enviei/.test(s)&&/conjunta|casal/.test(s)){kind="transfer";to="shared";}
    else if(/guardei|reservei|separei|aportei|investi/.test(s)){
      if(goal)kind="goal";else answer="Para qual meta devemos reservar? Não registrei este valor.";
    } else if(/recebi|salario|ganhei|entrou/.test(s)){kind="income";}
    else if(/gastei|paguei|comprei|mercado|gasolina|aluguel/.test(s)){
      kind="expense";
      if(/conjunta|do casal/.test(s))from="shared";
      if(/mercado|comida/.test(s))category="Alimentação";
      if(/gasolina|combustivel/.test(s))category="Transporte";
    } else answer="Posso registrar receitas, despesas, transferências e aportes. Ex.: Guardei R$ 100 para o casamento.";
    if(kind){
      state.entries.push({id:String(Date.now())+Math.random(),kind,person,amount,from,to,goal:goal||"casamento",
        category,date:new Date().toISOString().slice(0,10),description:text});
      answer="✓ "+real(amount)+" registrado como "+({income:"receita",expense:"despesa",transfer:"transferência",goal:"aporte"}[kind])+".\nPainel atualizado neste aparelho.";
    }
  }
  state.chat.push({who:"ia",text:answer});
  save();render();
}
$("person").value=state.person;
$("person").onchange=function(){state.person=this.value;save();render();};
document.querySelectorAll(".navbar button").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".navbar button").forEach(x=>x.classList.toggle("active",x===b));
  document.querySelectorAll(".page").forEach(x=>x.classList.toggle("active",x.id===b.dataset.page));
  window.scrollTo(0,0);
});
document.querySelectorAll(".filters button").forEach(b=>b.onclick=()=>{
  state.filter=b.dataset.filter;
  document.querySelectorAll(".filters button").forEach(x=>x.classList.toggle("selected",x===b));
  render();
});
document.body.addEventListener("click",e=>{
  let b=e.target.closest("[data-new]");if(b){editMovement(b.dataset.new);return;}
  b=e.target.closest("[data-goal]");if(b){editMovement("goal",b.dataset.goal);return;}
  b=e.target.closest("[data-edit]");if(b){editMovement("expense","",b.dataset.edit);return;}
  b=e.target.closest("[data-salary]");if(b){editSalary(b.dataset.salary);return;}
});
$("editarMetas").onclick=editTargets;
$("fecharModal").onclick=closeModal;
$("modalwrap").onclick=e=>{if(e.target===$("modalwrap"))closeModal();};
$("chatForm").onsubmit=e=>{
  e.preventDefault();
  const msg=$("chatInput").value.trim();
  if(msg){$("chatInput").value="";onMessage(msg);}
};
render();
if("serviceWorker"in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
})();