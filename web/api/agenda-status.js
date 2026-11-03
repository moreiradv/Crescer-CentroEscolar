import route from './[...path].js';

export default function handler(req, res) {
  req.query.path = ['agenda-status'];
  return route(req, res);
}
