/**
 * Integration test: Insert invoice-sample.json directly into DB
 * and verify the full read-back via API
 * Run: node scripts/test-sample.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()]; })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Load ground-truth sample
const samplePath = join(__dirname, '../../Skills/ORC vision/sample/invoice-sample.json');
const sample = JSON.parse(readFileSync(samplePath, 'utf8'));

async function testDBInsert() {
  console.log('\n📋 Test 1: Insert invoice-sample.json into DB');

  // Map sample → invoices schema
  const invoiceRow = {
    type:              sample.invoice_metadata.type,
    vendor_name:       sample.invoice_metadata.vendor_name,
    vendor_address:    sample.invoice_metadata.vendor_address,
    vendor_gst_number: sample.invoice_metadata.vendor_gst_number,
    invoice_number:    sample.invoice_metadata.invoice_number,
    invoice_date:      sample.invoice_metadata.date,
    currency:          sample.invoice_metadata.currency,
    is_tax_invoice:    sample.invoice_metadata.status !== 'quote',
    billing_name:      sample.billing_info.billing_name,
    billing_address:   sample.billing_info.billing_address,
    sub_total:         sample.totals.sub_total,
    freight:           sample.totals.freight,
    gst_amount:        sample.totals.gst_amount,
    total_amount:      sample.totals.total_amount,
    image_url:         null,
    status:            'pending_review',
    category:          'Food',
  };

  // Check duplicate first
  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('vendor_name', invoiceRow.vendor_name)
    .eq('invoice_date', invoiceRow.invoice_date)
    .eq('total_amount', invoiceRow.total_amount)
    .maybeSingle();

  if (existing) {
    console.log(`   ⚠️  Duplicate detected (id: ${existing.id}) — skipping insert`);
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from('invoices')
    .insert(invoiceRow)
    .select('id')
    .single();

  if (error) {
    console.error(`   ❌ Insert failed: ${error.message}`);
    return null;
  }
  console.log(`   ✅ Invoice inserted: ${inserted.id}`);

  // Insert line items
  const items = sample.line_items.map(item => ({
    invoice_id:      inserted.id,
    product_code:    item.product_code,
    description:     item.description,
    standard:        item.standard,
    quantity:        item.quantity,
    unit:            item.unit,
    price:           item.price,
    amount_excl_gst: item.amount_excl_gst,
  }));

  const { error: itemErr } = await supabase.from('invoice_items').insert(items);
  if (itemErr) {
    console.error(`   ❌ Items insert failed: ${itemErr.message}`);
  } else {
    console.log(`   ✅ ${items.length} line items inserted`);
  }

  return inserted.id;
}

async function testDBRead(invoiceId) {
  console.log('\n📖 Test 2: Read back invoice with items');

  const { data, error } = await supabase
    .from('invoices')
    .select(`*, invoice_items(*)`)
    .eq('id', invoiceId)
    .single();

  if (error) {
    console.error(`   ❌ Read failed: ${error.message}`);
    return;
  }

  console.log(`   ✅ vendor_name:    ${data.vendor_name}`);
  console.log(`   ✅ invoice_date:   ${data.invoice_date}`);
  console.log(`   ✅ total_amount:   $${data.total_amount} NZD`);
  console.log(`   ✅ gst_amount:     $${data.gst_amount}`);
  console.log(`   ✅ status:         ${data.status}`);
  console.log(`   ✅ items count:    ${data.invoice_items?.length ?? 0}`);

  // Verify decimal precision on quantity
  const beefItem = data.invoice_items?.find(i => i.description?.includes('BEEF'));
  if (beefItem) {
    const qty = parseFloat(beefItem.quantity);
    const pass = qty === 4.555;
    console.log(`   ${pass ? '✅' : '❌'} Decimal qty: ${qty} (expected 4.555)`);
  }
}

async function testAPIList() {
  console.log('\n🌐 Test 3: GET /api/invoices');
  const BASE = 'http://localhost:3000';
  try {
    const res = await fetch(`${BASE}/api/invoices?limit=5`);
    const json = await res.json();
    console.log(`   ✅ Status: ${res.status}`);
    console.log(`   ✅ Total invoices in DB: ${json.total}`);
    console.log(`   ✅ Returned: ${json.invoices?.length} invoices`);
  } catch (e) {
    console.log(`   ⚠️  API not reachable (dev server not running?): ${e.message}`);
  }
}

async function testStorageBucket() {
  console.log('\n📦 Test 4: Verify Supabase Storage bucket');
  const { data } = await supabase.storage.listBuckets();
  const bucket = data?.find(b => b.name === 'invoice-images');
  if (bucket) {
    console.log(`   ✅ Bucket "invoice-images" exists (public: ${bucket.public})`);
  } else {
    console.log(`   ❌ Bucket "invoice-images" NOT found`);
  }
}

async function testGST() {
  console.log('\n🧮 Test 5: GST financial validation');
  const { sub_total, gst_amount, total_amount } = sample.totals;
  const calc = Math.round((sub_total + gst_amount) * 100) / 100;
  const diff = Math.abs(calc - total_amount);
  const pass = diff <= 0.01;
  console.log(`   sub_total + gst = ${calc} | total = ${total_amount} | diff = ${diff.toFixed(4)}`);
  console.log(`   ${pass ? '✅' : '❌'} GST validation ${pass ? 'PASSED' : 'FAILED'}`);
}

// ── Run all tests ──────────────────────────────────────────────────────────
async function main() {
  console.log('🧪 Madam Yen IMS — Integration Tests\n' + '─'.repeat(40));

  await testStorageBucket();

  const invoiceId = await testDBInsert();
  if (invoiceId) await testDBRead(invoiceId);

  await testAPIList();
  await testGST();

  console.log('\n' + '─'.repeat(40));
  console.log('✅ All tests complete!\n');
}

main().catch(console.error);
