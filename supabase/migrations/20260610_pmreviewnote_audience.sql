-- PMReviewNote.audience — separa a review detalhada ('detail') do digest
-- executivo que a Vitoria entrega junto do report ('executive').
-- Overview consome 'executive' quando existir (fallback: agregação das 'detail');
-- página da review e contexto da Vitoria seguem lendo só 'detail'.
ALTER TABLE "PMReviewNote"
  ADD COLUMN "audience" text NOT NULL DEFAULT 'detail'
  CHECK ("audience" IN ('detail', 'executive'));
