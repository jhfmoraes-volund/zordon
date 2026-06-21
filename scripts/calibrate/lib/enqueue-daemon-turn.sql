-- Harness de runbook automatizado contra o DAEMON (não OpenRouter).
-- Cria thread FRESH (re-rodável, sem colidir) + msg do user + ChatTurn(queued) +
-- ForgeJob(kind=chat) — exatamente o que streamViaClaudeDaemon faz, menos o SSE.
-- O daemon claima e processa; o harness faz poll do ChatTurn.
-- Vars: :channel :session(agentName) :owner :title :msg
WITH th AS (
  INSERT INTO "ChatThread" ("agentName","channel","createdBy","title")
  VALUES (:'session', :'channel', :'owner', :'title')
  RETURNING id
), umsg AS (
  INSERT INTO "ChatMessage" ("threadId","role","content")
  SELECT id,'user',:'msg' FROM th
  RETURNING id, "threadId"
), turn AS (
  INSERT INTO "ChatTurn" ("threadId","userMessageId","agentSlug","mode","systemPrompt","status")
  SELECT "threadId", id, 'vitoria','claude-daemon','','queued' FROM umsg
  RETURNING id, "threadId"
), job AS (
  INSERT INTO "ForgeJob" ("prdSlug","ownerId","status","assignToAnyone","kind","meta")
  SELECT 'chat:vitoria', :'owner', 'queued', true, 'chat',
         jsonb_build_object('chatTurnId', turn.id::text, 'threadId', turn."threadId"::text)
  FROM turn
  RETURNING id
)
SELECT (SELECT id FROM turn)::text || '|' || (SELECT id FROM th)::text;
