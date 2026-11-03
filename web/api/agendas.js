import route from './[...path].js';

export default function handler(req, res) {
  req.query.path = req.query.id ? ['agendas', String(req.query.id)] : ['agendas'];
  return route(req, res);
}
