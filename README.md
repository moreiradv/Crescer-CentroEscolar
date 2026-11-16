# Crescer — Gestão Escolar

Sistema de gestão e acompanhamento escolar do Centro Educacional Crescer.

## Site online

- Endereço principal: https://crescer-escola-web.vercel.app/
- Atalho do GitHub: https://moreiradv.github.io/Crescer-CentroEscolar/

O domínio da Vercel serve a interface e a camada de segurança da API. O atalho do GitHub Pages redireciona automaticamente para o endereço oficial. Os registros legados continuam preservados no backend escolar existente, enquanto Agenda e Biblioteca utilizam o banco persistente conectado à Vercel.

## Funcionalidades

- Perfis Administrador, Gestão Escolar, Professor e Financeiro
- Gestão de usuários, turmas e alunos
- Agenda escolar compartilhada
- Frequência por turma e data
- Indicadores calculados com dados reais
- Histórico de alterações e exportação CSV
- Dados persistentes e sincronizados entre usuários

## Desenvolvimento

```bash
node scripts/build.mjs
node scripts/validate.mjs
```

Os dados sensíveis das contas-base ficam em `BOOTSTRAP_USERS_JSON`, configurado como segredo do ambiente de hospedagem. Eles não devem ser adicionados ao Git.

