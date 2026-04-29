-- Vendor match-only (no auto-create) + block approve when vendor_id is NULL
-- Run in Supabase SQL Editor

-- 1) Replace invoices vendor_id trigger function (match-only)
CREATE OR REPLACE FUNCTION public.trg_invoices_set_vendor_id()
RETURNS trigger AS $$
DECLARE
  v_id UUID;
  v_gst_digits TEXT;
  v_name_norm TEXT;
BEGIN
  -- If already set, keep it
  IF NEW.vendor_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_gst_digits := NULLIF(regexp_replace(coalesce(NEW.vendor_gst_number, ''), '[^0-9]', '', 'g'), '');
  v_name_norm := NULLIF(regexp_replace(lower(trim(coalesce(NEW.vendor_name, ''))), '\s+', ' ', 'g'), '');

  -- Try match by GST number digits
  IF v_gst_digits IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.vendors
    WHERE NULLIF(regexp_replace(coalesce(gst_number, ''), '[^0-9]', '', 'g'), '') = v_gst_digits
    LIMIT 1;

    IF v_id IS NOT NULL THEN
      NEW.vendor_id := v_id;
      RETURN NEW;
    END IF;
  END IF;

  -- Try match by normalized vendor name
  IF v_name_norm IS NOT NULL THEN
    SELECT id INTO v_id
    FROM public.vendors
    WHERE regexp_replace(lower(trim(name)), '\s+', ' ', 'g') = v_name_norm
    LIMIT 1;

    IF v_id IS NOT NULL THEN
      NEW.vendor_id := v_id;
      RETURN NEW;
    END IF;
  END IF;

  -- No match → leave vendor_id NULL (no vendor creation)
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_before_ins_upd ON public.invoices;
CREATE TRIGGER invoices_before_ins_upd
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.trg_invoices_set_vendor_id();

-- 2) Update invoice_items catalog trigger: remove vendor auto-create block
CREATE OR REPLACE FUNCTION public.trg_invoice_items_set_catalog_ids()
RETURNS trigger AS $$
DECLARE
  inv_vendor_id UUID;
  unit_code TEXT;
  std_val TEXT;
  code_norm TEXT;
  rp_id UUID;
  rp_internal_id TEXT;
BEGIN
  SELECT vendor_id
    INTO inv_vendor_id
  FROM public.invoices WHERE id = NEW.invoice_id;

  -- IMPORTANT: do NOT create vendors here.
  -- If inv_vendor_id is NULL, product_id mapping is skipped.

  IF NEW.unit_id IS NULL THEN
    unit_code := NULLIF(upper(trim(coalesce(NEW.unit, ''))), '');
    IF unit_code IS NOT NULL THEN
      INSERT INTO public.units (code, created_at)
      VALUES (unit_code, NOW())
      ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code
      RETURNING id INTO NEW.unit_id;
    END IF;
  END IF;

  IF NEW.standard_id IS NULL THEN
    std_val := NULLIF(trim(coalesce(NEW.standard, '')), '');
    IF std_val IS NOT NULL THEN
      INSERT INTO public.standards (value, created_at)
      VALUES (std_val, NOW())
      ON CONFLICT (value) DO UPDATE SET value = EXCLUDED.value
      RETURNING id INTO NEW.standard_id;
    END IF;
  END IF;

  IF NEW.product_id IS NULL AND inv_vendor_id IS NOT NULL THEN
    code_norm := public.my_normalize_code(NEW.product_code);

    IF code_norm IS NOT NULL THEN
      rp_internal_id := 'MY' || code_norm;
      IF EXISTS (SELECT 1 FROM public.restaurant_products WHERE restaurant_product_id = rp_internal_id) THEN
        rp_internal_id := public.my_next_restaurant_product_id();
      END IF;

      INSERT INTO public.restaurant_products
        (restaurant_product_id, vendor_id, vendor_product_code, name, unit_id, standard_id, created_at, updated_at)
      VALUES
        (rp_internal_id, inv_vendor_id, code_norm, COALESCE(NULLIF(trim(NEW.description), ''), code_norm),
         NEW.unit_id, NEW.standard_id, NOW(), NOW())
      ON CONFLICT (vendor_id, vendor_product_code) DO UPDATE
        SET name = COALESCE(EXCLUDED.name, public.restaurant_products.name),
            unit_id = COALESCE(EXCLUDED.unit_id, public.restaurant_products.unit_id),
            standard_id = COALESCE(EXCLUDED.standard_id, public.restaurant_products.standard_id),
            updated_at = NOW()
      RETURNING id INTO rp_id;

      NEW.product_id := rp_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoice_items_before_ins_upd ON public.invoice_items;
CREATE TRIGGER invoice_items_before_ins_upd
BEFORE INSERT OR UPDATE ON public.invoice_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_invoice_items_set_catalog_ids();

-- 3) Block approving invoices with NULL vendor_id (DB-side guard)
CREATE OR REPLACE FUNCTION public.trg_invoices_block_approve_without_vendor()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'approved' AND NEW.vendor_id IS NULL THEN
    RAISE EXCEPTION 'Vendor not mapped. Map vendor before approving.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_block_approve_without_vendor ON public.invoices;
CREATE TRIGGER invoices_block_approve_without_vendor
BEFORE UPDATE OF status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.trg_invoices_block_approve_without_vendor();
