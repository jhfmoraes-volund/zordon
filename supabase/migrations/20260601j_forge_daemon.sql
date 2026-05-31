-- ForgeDaemon registry — tracks live daemons regardless of job execution state.
-- Banner "Active Builders" reads from here so an idle daemon (subscribed, no job)
-- still shows as active. Job-level heartbeat (ForgeJob.heartbeatAt) remains
-- the source for orphan-recovery; this table is purely for presence.

CREATE TABLE "ForgeDaemon" (
  "daemonId"        uuid PRIMARY KEY,
  "memberId"        uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  hostname          text,
  "startedAt"       timestamptz NOT NULL DEFAULT now(),
  "lastHeartbeatAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_forgedaemon_heartbeat ON "ForgeDaemon" ("lastHeartbeatAt" DESC);

ALTER TABLE "ForgeDaemon" ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated member can see active builders (count is broadcast in UI)
CREATE POLICY "forgedaemon_select" ON "ForgeDaemon" FOR SELECT USING (
  auth.role() = 'authenticated'
);

-- Insert/update: service_role only (daemon authenticates via service key)
CREATE POLICY "forgedaemon_write" ON "ForgeDaemon" FOR ALL USING (
  auth.role() = 'service_role'
) WITH CHECK (
  auth.role() = 'service_role'
);
