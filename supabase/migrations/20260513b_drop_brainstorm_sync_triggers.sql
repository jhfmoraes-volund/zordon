-- Drop legacy JSON→table sync triggers for brainstorm + prioritization.
-- UI now writes directly to DesignSessionBrainstormFeature and
-- DesignSessionPriorityItem via /brainstorm-features and /priority-items APIs.
-- Functions are kept around in case rollback is needed within the window.

BEGIN;

DROP TRIGGER IF EXISTS sync_brainstorm_features_trigger ON "DesignSessionStepData";
DROP TRIGGER IF EXISTS sync_brainstorm_buckets_trigger ON "DesignSessionStepData";

COMMIT;
