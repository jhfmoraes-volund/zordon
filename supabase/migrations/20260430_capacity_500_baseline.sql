-- Backfill Member.fpCapacity with the new 500-FP/sprint senior baseline.
-- Formula: roleBase × seniorityMult × dedication
--   roleBase: 500 for every role except guest (0)
--   seniority: junior 0.70, mid 0.85, senior 1.00, principal 1.15
--   default seniority for NULL = mid (Pleno)
--   isExternal no longer affects capacity

UPDATE "Member"
SET "fpCapacity" = ROUND(
  CASE role
    WHEN 'guest' THEN 0
    ELSE 500
  END
  * CASE COALESCE(seniority, 'mid')
      WHEN 'junior' THEN 0.70
      WHEN 'mid' THEN 0.85
      WHEN 'senior' THEN 1.00
      WHEN 'principal' THEN 1.15
      ELSE 0.85
    END
  * COALESCE("dedicationPercent", 100) / 100.0
)::int;
