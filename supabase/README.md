# Conexão real: Nosso Financeiro (Supabase + Vercel)

> **Status: estrutura preparada, banco ainda não provisionado.** Esta branch não substitui a versão de demonstração, que continua funcionando em `main`.

1. No projeto Vercel `nosso-financeiro-vt-github`, abra **Storage → Browse Marketplace → Supabase → Connect**. Revise o plano e custos.
2. No Supabase criado/conectado, abra **SQL Editor** e aplique `migrations/20261021_initial.sql`. Faça primeiro em um banco vazio de testes. O SQL cria as políticas RLS, as contas, as metas, os convites e a publicação Realtime.
3. Em **Authentication → URL Configuration**, configure o endereço HTTPS `https://nosso-financeiro-vt-github.vercel.app/cloud.html` como redirect permitido. Ative Email OTP (link mágico). Não desative confirmação de e-mail.
4. Na Vercel, verifique as variáveis de ambiente do projeto (produção e preview): `SUPABASE_URL` (URL do projeto) e `SUPABASE_PUBLISHABLE_KEY` (chave **publishable/anon**). **Nunca** use `service_role` no frontend nem nesta API.
5. Faça deploy de preview desta branch, abra `/cloud.html`, crie contas separadas para os dois e execute os testes de autorização descritos abaixo.
6. Somente após os testes, mescle a branch no GitHub para a produção.

## Validação obrigatória

- Um usuário sem login não lê nem escreve qualquer movimento.
- O primeiro usuário cria a família e um convite temporário. O segundo entra com sua própria conta e usa o convite.
- Ambos veem despesas, metas e mensagens da mesma família em dispositivos diferentes após a atualização/realtime.
- Um usuário de OUTRA família não consulta movimentos nem mensagens.
- Receita aumenta uma carteira; despesa diminui; transferência é neutra no patrimônio; aporte é neutro e aumenta a meta; resgate é neutro e devolve à carteira.
- Atualizar/excluir um lançamento altera saldos nos dois dispositivos.
- Importação de histórico local é intencionalmente DESABILITADA nesta primeira etapa para evitar registros duplicados e vazamentos.

## Segurança

Esta aplicação é um protótipo financeiro. Não oferece integração bancária nem WhatsApp real. RLS é obrigatória, não é suficiente publicar HTML com senha hardcoded. As contas de usuários usam o provedor de autenticação Supabase, e o banco armazena movimentos sem tokens privados no browser.

## Padrão do código

- `cloud.html` / `cloud.js`: interface e sincronização.
- `api/public-config.js`: fornece **somente** os dados publicáveis da conexão, lidos do ambiente Vercel.
- `supabase/migrations/20261021_initial.sql`: tabelas e controles de acesso.
- `index.html`: versão local de demonstração mantida isolada.
