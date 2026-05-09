-- Add parentTaskId to Task for Intent → Steps tree decomposition in World Shell Chain Mode.
-- Nullable self-reference: NULL = top-level / standalone task; non-null = child step of an Intent.

ALTER TABLE "Task" ADD COLUMN "parentTaskId" TEXT;

ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey"
    FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");
