import route from './[...path].js';

export default function handler(req, res) {
  req.query.path = req.query.id ? ['library-books', String(req.query.id)] : ['library-books'];
  return route(req, res);
}
