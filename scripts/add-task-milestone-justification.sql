-- Date-change justification trail.
-- pmo_tasks.justification     — reason logged for a task's latest start/end change.
-- pmo_milestones.justification — reason carried over when a task's end date runs
--                                past the milestone and auto-extends its due date.
ALTER TABLE pmo_tasks      ADD COLUMN IF NOT EXISTS justification text;
ALTER TABLE pmo_milestones ADD COLUMN IF NOT EXISTS justification text;
