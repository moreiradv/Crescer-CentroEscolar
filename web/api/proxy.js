import route from './[...path].js';

export default function handler(req, res) {
  const target = String(req.query.target || '');
  let parsed;
  try { parsed = new URL(target, 'https://educlass.local'); }
  catch { return res.status(400).json({ error: 'Rota de destino inválida.' }); }
  if (!parsed.pathname.startsWith('/api/')) return res.status(400).json({ error: 'Rota de destino inválida.' });
  req.query.path = parsed.pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  return route(req, res);
}
