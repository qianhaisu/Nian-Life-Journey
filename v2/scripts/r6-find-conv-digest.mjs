/**
 * For each story with vague person terms, fetch raw source messages to identify
 * exactly who said what, so we can fix attributions accurately.
 */
import { openRds } from "../.data/night-rds.mjs";

const TARGET_IDS = [
  'event-r23-20250325-nimble-hands',
  'event-r23-20250402-little-tiger',
  'event-v2-c2de94fc880bc3f2712b95904be34834',  // Dec 4
  'event-r22-20260418-big-kid',
  'event-r22-20260427-dinosaur',
  'event-r23-20260715-haircut',
  'event-r23-20260716-eats-porridge',
  'event-r23-20260718-water-play',
  'event-r23-20260727-clean-plate',
  'event-v2-56dbe39e973bd45ed2a7812f304be947',  // Sep 2
];

const rds = await openRds({ readOnly: true });
try {
  for (const id of TARGET_IDS) {
    const { rows: event } = await rds.client.query(`
      SELECT id, occurred_at AT TIME ZONE 'Asia/Shanghai' AS local_date,
             title, story, people, source_ids
      FROM life_events WHERE id = $1
    `, [id]);

    if (!event.length) {
      console.log(`\n[${id}]: NOT FOUND`);
      continue;
    }

    const e = event[0];
    const dateStr = String(e.local_date).slice(0, 10);
    console.log(`\n=== [${dateStr}] ${e.title} ===`);
    console.log(`Story: ${e.story}`);

    const sourceIds = e.source_ids || [];
    if (!sourceIds.length) {
      console.log(`  (no source_ids)`);
      continue;
    }

    const { rows: sources } = await rds.client.query(`
      SELECT id, text, metadata->>'speakerName' AS speaker,
             captured_at AT TIME ZONE 'Asia/Shanghai' AS local_time,
             metadata->>'conversationId' AS conv_id
      FROM raw_sources
      WHERE id = ANY($1::text[])
      ORDER BY captured_at
    `, [sourceIds]);

    console.log(`Sources (${sources.length}):`);
    for (const s of sources) {
      const timeStr = String(s.local_time).slice(0, 19);
      const speaker = s.speaker || '(unknown)';
      console.log(`  [${timeStr}] [${speaker}]: ${(s.text || '').slice(0, 120)}`);
    }
  }
} finally {
  await rds.close();
}
