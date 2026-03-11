-- Create new enum type with all required values
CREATE TYPE "DeliverableStatus_new" AS ENUM ('PREPARATION', 'PRODUCTION', 'RETOUR', 'VALIDATION', 'VALIDE');

-- Drop the default constraint first
ALTER TABLE "deliverables" ALTER COLUMN "status" DROP DEFAULT;

-- Alter the column to use the new enum
ALTER TABLE "deliverables" ALTER COLUMN "status" TYPE "DeliverableStatus_new" USING 'PREPARATION'::"DeliverableStatus_new";

-- Set the new default value
ALTER TABLE "deliverables" ALTER COLUMN "status" SET DEFAULT 'PREPARATION'::"DeliverableStatus_new";

-- Drop the old enum
DROP TYPE "DeliverableStatus";

-- Rename the new enum to the original name
ALTER TYPE "DeliverableStatus_new" RENAME TO "DeliverableStatus";
