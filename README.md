# Crescer — Gestão Escolar

Sistema de gestão e acompanhamento escolar do Centro Educacional Crescer.

## Site online

- Endereço principal: https://moreiradv.github.io/Crescer-CentroEscolar/

O GitHub Pages serve a interface completa. O backend seguro e o banco D1 permanecem no Sites, porque o GitHub Pages hospeda apenas arquivos estáticos. A comunicação acontece pela API autenticada e os usuários permanecem no endereço `github.io`.

## Funcionalidades

- Perfis Administrador, Coordenação, Professor e Financeiro
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

