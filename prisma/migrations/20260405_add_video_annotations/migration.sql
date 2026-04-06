-- AddColumn annotation_x and annotation_y to feedbacks table
ALTER TABLE "feedbacks" ADD COLUMN "annotation_x" DOUBLE PRECISION;
ALTER TABLE "feedbacks" ADD COLUMN "annotation_y" DOUBLE PRECISION;
