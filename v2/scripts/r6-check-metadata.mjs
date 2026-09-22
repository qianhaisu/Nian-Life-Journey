import { openRds } from "../.data/night-rds.mjs";

const rds = await openRds({ readOnly: true });
try {
  // Check content_quality_reviews columns
  const { rows: cqrCols } = await rds.client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'content_quality_reviews'
    ORDER BY ordinal_position
  `);
  console.log("=== content_quality_reviews columns ===");
  for (const c of cqrCols) console.log(`  ${c.column_name}: ${c.data_type} (nullable=${c.is_nullable})`);

  // Check life_events columns
  const { rows: leCols } = await rds.client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'life_events'
    ORDER BY ordinal_position
  `);
  console.log("\n=== life_events columns ===");
  for (const c of leCols) console.log(`  ${c.column_name}: ${c.data_type} (nullable=${c.is_nullable})`);

  // Count approved stories that have vague person terms
  const { rows: count } = await rds.client.query(`
    SELECT COUNT(*) AS n
    FROM life_events le
    WHERE (le.title LIKE '%家里人%' OR le.title LIKE '%一家人%' OR le.title LIKE '%有人说%'
        OR le.title LIKE '%有人问%' OR le.title LIKE '%大家说%' OR le.title LIKE '%家里说%'
        OR le.story LIKE '%家里人%' OR le.story LIKE '%一家人%' OR le.story LIKE '%有人说%'
        OR le.story LIKE '%有人问%' OR le.story LIKE '%大家说%' OR le.story LIKE '%家里说%')
      AND EXISTS (
        SELECT 1 FROM content_quality_reviews cqr
        WHERE cqr.target_id = le.id AND cqr.decision = 'approved'
      )
  `);
  console.log(`\n=== Approved stories with vague terms: ${count[0].n} ===`);

  // Show them
  const { rows } = await rds.client.query(`
    SELECT le.id,
           le.occurred_at AT TIME ZONE 'Asia/Shanghai' AS local_date,
           le.title, left(le.story, 200) AS story_preview,
           le.people, le.source_ids
    FROM life_events le
    WHERE (le.title LIKE '%家里人%' OR le.title LIKE '%一家人%' OR le.title LIKE '%有人说%'
        OR le.title LIKE '%有人问%' OR le.title LIKE '%大家说%' OR le.title LIKE '%家里说%'
        OR le.story LIKE '%家里人%' OR le.story LIKE '%一家人%' OR le.story LIKE '%有人说%'
        OR le.story LIKE '%有人问%' OR le.story LIKE '%大家说%' OR le.story LIKE '%家里说%')
      AND EXISTS (
        SELECT 1 FROM content_quality_reviews cqr
        WHERE cqr.target_id = le.id AND cqr.decision = 'approved'
      )
    ORDER BY le.occurred_at
  `);

  for (const r of rows) {
    const dateStr = String(r.local_date).slice(0, 10);
    console.log(`\n[${dateStr}] id=${r.id}`);
    console.log(`  title: ${r.title}`);
    console.log(`  story: ${r.story_preview}`);
    console.log(`  people: ${JSON.stringify(r.people)}`);
    console.log(`  source_count: ${(r.source_ids || []).length}`);
  }

} finally {
  await rds.close();
}
