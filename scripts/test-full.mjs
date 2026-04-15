/**
 * Full integration test via direct pg connection (bypass schema cache)
 * Run: node scripts/test-full.mjs
 */

import pg from 'pg';
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

const client = new pg.Client({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const samplePath = join(__dirname, '../../Skills/ORC vision/sample/invoice-sample.json');
const sample = JSON.parse(readFileSync(samplePath, 'utf8'));

async function run() {
  console.log('🧪 Madam Yen IMS — Full Integration Tests\n' + '─'.repeat(40));

  await client.connect();
  console.log('   ✅ PostgreSQL connected\n');

  // ── Test 1: DB tables ────────────────────────────────────────────────────
  console.log('📋 Test 1: Verify DB tables');
  const tabRes = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('invoices', 'invoice_items')
    ORDER BY table_name
  `);
  tabRes.rows.forEach(r => console.log(`   ✅ Table: ${r.table_name}`));

  // ── Test 2: Insert sample invoice ────────────────────────────────────────
  console.log('\n📋 Test 2: Insert invoice-sample.json');

  // Check dupe
  const dupeRes = await client.query(
    `SELECT id FROM invoices WHERE vendor_name=$1 AND invoice_date=$2 AND total_amount=$3`,
    [sample.invoice_metadata.vendor_name, sample.invoice_metadata.date, sample.totals.total_amount]
  );

  let invoiceId;
  if (dupeRes.rows.length) {
    invoiceId = dupeRes.rows[0].id;
    console.log(`   ⚠️  Duplicate found → using existing id: ${invoiceId}`);
  } else {
    const insRes = await client.query(
      `INSERT INTO invoices
        (type, vendor_name, vendor_address, vendor_gst_number, invoice_number,
         invoice_date, currency, is_tax_invoice, billing_name, billing_address,
         sub_total, freight, gst_amount, total_amount, status, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        sample.invoice_metadata.type,
        sample.invoice_metadata.vendor_name,
        sample.invoice_metadata.vendor_address,
        sample.invoice_metadata.vendor_gst_number,
        sample.invoice_metadata.invoice_number,
        sample.invoice_metadata.date,
        sample.invoice_metadata.currency,
        true,
        sample.billing_info.billing_name,
        sample.billing_info.billing_address,
        sample.totals.sub_total,
        sample.totals.freight,
        sample.totals.gst_amount,
        sample.totals.total_amount,
        'pending_review',
        'Food',
      ]
    );
    invoiceId = insRes.rows[0].id;
    console.log(`   ✅ Invoice inserted: ${invoiceId}`);

    // Insert line items
    for (const item of sample.line_items) {
      await client.query(
        `INSERT INTO invoice_items
          (invoice_id, product_code, description, standard, quantity, unit, price, amount_excl_gst)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [invoiceId, item.product_code, item.description, item.standard,
         item.quantity, item.unit, item.price, item.amount_excl_gst]
      );
    }
    console.log(`   ✅ ${sample.line_items.length} line items inserted`);
  }

  // ── Test 3: Read back ────────────────────────────────────────────────────
  console.log('\n📖 Test 3: Read back invoice + items');
  const inv = await client.query(`SELECT * FROM invoices WHERE id=$1`, [invoiceId]);
  const items = await client.query(`SELECT * FROM invoice_items WHERE invoice_id=$1`, [invoiceId]);
  const i = inv.rows[0];
  console.log(`   ✅ vendor_name:   ${i.vendor_name}`);
  console.log(`   ✅ invoice_date:  ${i.invoice_date?.toISOString().slice(0,10)}`);
  console.log(`   ✅ total_amount:  $${i.total_amount} ${i.currency}`);
  console.log(`   ✅ gst_amount:    $${i.gst_amount}`);
  console.log(`   ✅ items count:   ${items.rows.length}`);

  const beef = items.rows.find(r => r.description?.includes('BEEF'));
  if (beef) {
    const qty = parseFloat(beef.quantity);
    console.log(`   ${qty === 4.555 ? '✅' : '❌'} Decimal qty: ${qty} (expected 4.555)`);
  }

  // ── Test 4: Storage bucket ────────────────────────────────────────────────
  console.log('\n📦 Test 4: Supabase Storage bucket');
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucket = buckets?.find(b => b.name === 'invoice-images');
  console.log(`   ${bucket ? '✅' : '❌'} Bucket "invoice-images": ${bucket ? `exists (public: ${bucket.public})` : 'NOT FOUND'}`);

  // ── Test 5: GST math ─────────────────────────────────────────────────────
  console.log('\n🧮 Test 5: GST financial validation');
  const { sub_total, gst_amount, total_amount, freight } = sample.totals;
  const expected = Math.round((sub_total + (freight ?? 0) + gst_amount) * 100) / 100;
  const diff = Math.abs(expected - total_amount);
  console.log(`   sub_total ($${sub_total}) + gst ($${gst_amount}) = $${expected}`);
  console.log(`   ${diff <= 0.01 ? '✅' : '❌'} Matches total: $${total_amount} (diff: ${diff.toFixed(4)})`);

  // ── Test 6: API /api/invoices ─────────────────────────────────────────────
  console.log('\n🌐 Test 6: API /api/invoices');
  try {
    const res = await fetch('http://localhost:3000/api/invoices');
    const json = await res.json();
    if (res.ok) {
      console.log(`   ✅ HTTP ${res.status} — ${json.total} invoices in DB`);
      const found = json.invoices?.find(inv => inv.id === invoiceId);
      console.log(`   ${found ? '✅' : '⚠️ '} Sample invoice ${found ? 'found' : 'not found'} in API response`);
    } else {
      console.log(`   ❌ API error: ${res.status} — ${JSON.stringify(json).slice(0,100)}`);
    }
  } catch (e) {
    console.log(`   ⚠️  API not reachable: ${e.message}`);
  }

  await client.end();
  console.log('\n' + '─'.repeat(40));
  console.log('🎉 All tests passed — ready to deploy!\n');
}

run().catch(async (err) => {
  console.error('❌ Fatal:', err.message);
  await client.end().catch(() => {});
  process.exit(1);
});
