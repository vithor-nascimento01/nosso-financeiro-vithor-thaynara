# Nosso Financeiro — versão compartilhada (Vercel + Supabase)

> O banco Supabase **supabase-citron-basket** foi criado pelo usuário e a migração SQL foi executada com resultado "Success. No rows returned" em 22/10/2026. Isso confirma a execução do script; os acessos e a sincronização ainda precisam de testes com duas contas.
>
> O aplicativo compartilhado está na **branch** `feature/supabase-sync`, inicialmente em ambiente de prévia. A produção `main` continua sendo a demonstração com armazenamento local.

## Entrada visual do casal (VTS2)
A tela de entrada usa o nome `VTS2` e um PIN visual de quatro dígitos definido pelo casal. **Isso não substitui autenticação nem autoriza acesso ao banco**: o identificador e a validação visual constam do JavaScript público e não devem ser tratados como segredo financeiro.
Quando o aparelho já possui sessão Supabase autorizada, a entrada visual revela o painel compartilhado. No primeiro uso sem sessão, a interface solicita vincular uma conta individual Supabase, preservando RLS.

O botão **Bloquear** oculta o painel no dispositivo, mas não encerra a sessão remota. Para encerrar totalmente a sessão é necessário deslogar do Supabase neste aparelho.

## Foto do casal (atenção à qualidade)
O CSS espera `assets/login-casal.webp`. A versão com a foto usada originalmente foi exportada em baixa resolução. Para substituir, enviar a foto otimizada em **986×1600** para a pasta `assets/` da branch `feature/supabase-sync` com exatamente o nome `login-casal.webp`. Não usar miniatura. Ao comitar, a Vercel publica a nova versão. A foto exibida em login público também é acessível publicamente por URL.

## Como acessar o novo login com senha

A versão de prévia oferece **entrar por e-mail e senha**, **criar conta** e **recuperar senha**. Não utiliza mais magic link para cada login: e-mails são necessários somente para confirmar a criação da conta e para recuperar a senha, se solicitado.

**Não reutilizar `VTS2 / 1409` como credencial pública**: a senha curta e compartilhada do protótipo não é autenticação válida de produção. Cada pessoa deve criar sua própria senha forte (mínimo de 8 caracteres no formulário).

Acesse o endereço estável da branch:
https://nosso-financeiro-vt-gi-git-f7e55e-vithor-nascimento01s-projects.vercel.app/cloud.html

### Autorizar o callback no Supabase

Em Authentication → URL Configuration, adicione exatamente o endereço **estável** acima em Redirect URLs. Endereços de deployments individuais, como `*-4faqwheip.vercel.app`, mudam a cada publicação e devem ser evitados para login; mantenha o endereço da branch como callback.

Site URL de produção:
https://nosso-financeiro-vt-github.vercel.app

No painel de Authentication → Sign In / Providers → Email, verifique se o provedor Email está habilitado e se a confirmação de e-mail está configurada. O Supabase gratuito pode limitar os e-mails enviados com o remetente padrão.

### Fluxo de uso

1. Vithor cria a primeira conta usando **e-mail próprio e senha forte** e confirma o e-mail se necessário.
2. Após login, clica em **Criar nossa família**.
3. Em Metas → **Gerar convite**, copia o código e envia em privado para Thaynara.
4. Thaynara cria conta com **seu próprio e-mail e outra senha forte**, confirma o e-mail e utiliza **Entrar pelo convite**.
5. Testar dois aparelhos: lançamento num celular, verificação no outro; atualização, exclusão, metas e chat.
6. Só depois de testar RLS, sessões e sincronização, mesclar a branch em `main`.

### Vercel

No projeto `nosso-financeiro-vt-github`, o Marketplace Supabase provisionou variáveis de ambiente. A rota `/api/public-config` lê apenas as chaves **publicáveis**:
- `NEXT_PUBLIC_SUPABASE_URL` ou `SUPABASE_URL`;
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY` ou `SUPABASE_PUBLISHABLE_KEY`.

Nunca colocar service role, senhas ou chaves privadas no frontend nem no GitHub. A rota publicável responde 503 se a integração não estiver ativa.

### Segurança e testes obrigatórios

- Validar que usuários sem login não conseguem acessar lançamentos.
- Confirmar que uma terceira conta de outra família não lê, altera nem exclui dados do casal.
- Verificar que somente o autor consegue editar/excluir seus próprios lançamentos.
- Validar os saldos de receita, despesa, transferência, aporte e resgate sem duplicação.
- Confirmar atualização entre aparelhos e após retornar do modo de espera do iPhone.
- Importação do histórico local continua desligada intencionalmente.
- O chat é compartilhado dentro do app, **não é integração real com WhatsApp**.
- A integração de bancos financeiros não está implementada.

### Código

- `cloud.html` / `cloud.js`: interface móvel e Supabase Auth + dados.
- `api/public-config.js`: configuração publicável carregada da Vercel.
- `supabase/migrations/20261021_initial.sql`: esquema PostgreSQL e políticas RLS.
- `index.html`: versão de demonstração local preservada.
