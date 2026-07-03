-- Milestone finish-to-start predecessor (M1 → M2 → M3 chain on the Gantt).
-- Nullable self-reference to pmo_milestones; the first milestone in a chain has none.
ALTER TABLE pmo_milestones
  ADD COLUMN IF NOT EXISTS predecessor_id integer;

-- Backfill: chain each project's existing milestones in their `order` (then
-- created_at as a tiebreak) so every milestone's predecessor is the prior one.
WITH seq AS (
  SELECT id, project_id,
         LAG(id) OVER (PARTITION BY project_id ORDER BY "order", created_at, id) AS prev_id
  FROM pmo_milestones
)
UPDATE pmo_milestones m
SET predecessor_id = seq.prev_id
FROM seq
WHERE m.id = seq.id
  AND seq.prev_id IS NOT NULL
  AND m.predecessor_id IS DISTINCT FROM seq.prev_id;
