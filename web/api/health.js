import { ensureSchema } from './[...path].js';

export default async function handler(_req, res) {
  try {
    const db = await ensureSchema();
    const result = await db.query("SELECT to_regclass('public.crescer_library_books') AS library_table, to_regclass('public.crescer_agendas') AS agenda_table");
    const ready = Boolean(result.rows[0]?.library_table && result.rows[0]?.agenda_table);
    res.status(ready ? 200 : 503).setHeader('cache-control', 'no-store');
    return res.json({ ok: ready, database: ready ? 'ready' : 'initializing' });
  } catch (error) {
    console.error(error);
    res.status(503).setHeader('cache-control', 'no-store');
    return res.json({ ok: false, database: 'unavailable' });
  }
}
