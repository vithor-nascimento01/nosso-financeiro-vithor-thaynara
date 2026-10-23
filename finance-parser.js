/* Nosso Financeiro V♡T — interpretação local e conservadora do chat.
   Sem API externa: somente verbos financeiros + valor explícito.
   Nenhum lançamento é gravado sem a confirmação do usuário. */
(function(root){
  'use strict';
  const strip = t => String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const numberSource = '(?:\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+\\.\\d{1,2}|\\d+(?:,\\d{1,2})?)';
  const source = '(^|[\\s:(])(?:r\\$\\s*)?('+numberSource+')(?:\\s*(?:reais?|contos?))?(?=$|[\\s.,!?;)])';
  const categories = [
    ['Alimentação',/\b(mercado|supermercado|mercearia|feira|padaria|lanche|restaurante|ifood|comida|almoco|jantar|pizza|cafe|acougue|hortifruti|pao|paes)\b/],
    ['Transporte',/\b(uber|99|combustivel|gasolina|etanol|diesel|onibus|metro|trem|pedagio|estacionamento|passagem|moto|oleo|licenciamento)\b/],
    ['Moradia',/\b(aluguel|condominio|energia|luz|agua|internet|iptu|casa)\b/],
    ['Saúde',/\b(farmacia|remedio|consulta|medico|dentista|hospital|exame|saude)\b/],
    ['Educação',/\b(faculdade|escola|curso|livro|mensalidade|educacao)\b/],
    ['Pets',/\b(cachorro|cachorrinho|cachorra|gato|racao|pet|veterinario)\b/],
    ['Assinaturas',/\b(netflix|spotify|youtube|chatgpt|google one|assinatura|prime video)\b/],
    ['Lazer',/\b(cinema|shopping|jogo|jiu jitsu|barbeiro|festa|show|passeio|lazer)\b/],
    ['Compras',/\b(compras?|loj(as?)?|roupa|tenis|sapato|celular|geladeira|perfume|presente|eletronico)\b/]
  ];
  const amountValue = raw => {
    const decimalOnly=/^\d+\.\d{1,2}$/.test(raw);
    const num=Number(decimalOnly?raw:raw.replace(/\./g,'').replace(',','.'));
    return Number.isFinite(num)&&num>0&&num<=999999999999.99?Math.round(num*100)/100:NaN;
  };
  const localDate = offset => {
    const d=new Date();d.setDate(d.getDate()+offset);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  };
  const parse = message => {
    const original=String(message||'').trim().replace(/\s+/g,' ');
    if(!original || original.length>2000)return null;
    const flat=strip(original);
    const expense=/^(?:eu\s+)?(?:gastei|paguei|comprei|torrei|desembolsei|passei\s+(?:o\s+)?cartao(?:\s+de)?)(?:\s+|$)/;
    const income=/^(?:eu\s+)?(?:recebi|ganhei|faturei|entrou|caiu\s+na\s+conta)(?:\s+|$)/;
    const outgoing=expense.exec(flat);
    const incoming=outgoing?null:income.exec(flat);
    const verb=outgoing||incoming;
    if(!verb)return null;
    const kind=outgoing?'expense':'income';
    const rest=original.slice(verb[0].length).trim(),normalizedRest=strip(rest);
    if(/\b(?:gastei|paguei|recebi|ganhei|transferi|guardei|depositei)\b/.test(normalizedRest))return null;
    const matches=[],re=new RegExp(source,'gi');
    let m;
    while((m=re.exec(rest))!==null){
      const amount=amountValue(m[2]);
      if(Number.isFinite(amount))matches.push({amount,index:m.index+m[1].length,end:re.lastIndex,raw:m[2]});
      if(matches.length>5)break;
    }
    if(!matches.length)return null;
    const priced=matches.find(m=>/\b(?:por|total|valor|custou)\s*(?:r\$\s*)?$/i.test(rest.slice(Math.max(0,m.index-26),m.index)));
    const selected=priced||matches[0];
    const before=rest.slice(0,selected.index).replace(/\b(?:por|de|no valor de|foi|total|custou)\s*$/i,'').trim();
    const after=rest.slice(selected.end).replace(/^\s*(?:reais?|contos?)\b/i,'').replace(/^[\s,.:;!?]+/,'').replace(/^(?:no|na|nos|nas|em|com|de|do|da|dos|das|para|pelo|pela)\s+/i,'').trim();
    const details=(before+' '+after).replace(/\b(?:hoje|ontem)\b/gi,'').replace(/\s+/g,' ').trim();
    const description=(details||(kind==='expense'?'Despesa':'Receita')).slice(0,150);
    const context=strip(details);
    const category=kind==='income'?'Renda':(categories.find(([,regex])=>regex.test(context))||['Outros'])[0];
    return {kind,amount:selected.amount,category,description:description[0].toUpperCase()+description.slice(1),
      occurred_on:/\bontem\b/.test(normalizedRest)?localDate(-1):localDate(0),
      original,needsReview:matches.length>1&&!priced};
  };
  root.NFVTFinance={parse};
})(typeof window !== 'undefined'?window:globalThis);
