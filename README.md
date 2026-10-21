# Nosso Financeiro — Vithor + Thaynara ♡

Aplicativo web de **controle financeiro do casal** com visão das carteiras individuais e conjunta, lançamentos, transferências, aportes e metas.

## Estado atual
Esta edição é uma **demonstração pública, sem fotos pessoais, sem senha de demonstração e sem informações financeiras reais**. O protótipo utiliza armazenamento local (`localStorage`): cada dispositivo possui dados separados. Não há autenticação bancária, conexão com bancos, sincronização de dados entre aparelhos nem integração oficial ao WhatsApp nesta versão.

**Não utilize dados financeiros sensíveis nesta etapa.**

## Testar
Abra o `index.html` por HTTPS em um site estático, ou use o projeto Vercel já existente. Pelo Safari, use **Compartilhar → Adicionar à Tela de Início**.

## Evolução planejada
- Backend PostgreSQL/Supabase com autenticação individual e políticas RLS.
- Família compartilhada entre Vithor e Thaynara; carteiras individuais e conjunta.
- Histórico de edição e exclusão, saldos derivados e transferências sem dupla contagem.
- Metas: Casamento, Nossa Casa, Viagens, Reserva de Segurança do Casal e Emergência.
- Reserva individual: 1 salário de segurança, 50% como referência para gastos livres e objetivo de R$ 10.000 investidos.
- Reintroduzir fotos reais **somente depois de tornar o repositório privado e implementar acesso apropriado**.
- Integração com mensagens quando viável e autorizada.

## Tecnologias
HTML5, CSS, JavaScript, manifest PWA e service worker. Sem dependências externas e sem chaves no código.

## Segurança
Nunca versionar senhas, tokens, credenciais ou fotos privadas em repositório público. Arquivos de ambiente devem permanecer fora do Git.
