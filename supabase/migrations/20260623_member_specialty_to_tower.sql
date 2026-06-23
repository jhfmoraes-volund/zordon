-- Reconcilia Member.specialty (especialidade declarada) com as 10 torres do
-- perfil de skills (memberSkills.ts → TOWER_KEYS). O enum legado tinha 6 valores
-- (fullstack, ux-ui, backend, qa, infra, security); 5 deles JÁ são tower keys
-- válidas. Só "fullstack" não é uma torre — é um conceito DERIVADO (Frontend≥70
-- AND Backend≥70). Limpamos esses casos pra null (sem torre declarada); o membro
-- redeclara via novo Member Sheet ou o sistema deriva primaryTower do assessment.
--
-- Idempotente: rodar de novo é no-op.

update public."Member"
set specialty = null
where specialty = 'fullstack';

-- down: irreversível (não há como saber quais eram 'fullstack'); no-op.
