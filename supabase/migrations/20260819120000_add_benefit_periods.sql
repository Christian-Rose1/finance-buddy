-- Add benefit period support to product_benefits and wallet_benefits

-- Add period_type column to product_benefits
ALTER TABLE public.product_benefits
ADD COLUMN period_type text NOT NULL DEFAULT 'none';

-- Add check constraint for valid period_type values
ALTER TABLE public.product_benefits
ADD CONSTRAINT product_benefits_period_type_check
CHECK (period_type IN ('none', 'calendar_year', 'cardmember_year', 'quarter', 'month'));

-- Add period_start and period_end columns to wallet_benefits
ALTER TABLE public.wallet_benefits
ADD COLUMN period_start timestamptz,
ADD COLUMN period_end timestamptz;

-- Update the CSP $100 Chase Travel Hotel Credit to use cardmember_year period
UPDATE public.product_benefits
SET period_type = 'cardmember_year'
WHERE title = '$100 Annual Chase Travel Hotel Credit'
  AND type = 'statement_credit'
  AND eligible_category = 'travel:hotels';