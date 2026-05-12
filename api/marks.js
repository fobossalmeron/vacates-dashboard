import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const KEY = 'florvault:marks:v1';

export default async function handler(req, res) {
  const password = req.headers['x-auth-password'];
  if (!process.env.DASHBOARD_PASSWORD || password !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      const data = await redis.get(KEY);
      return res.status(200).json(data || {});
    }
    if (req.method === 'POST') {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'invalid body' });
      }
      await redis.set(KEY, body);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'server error', detail: String(err && err.message || err) });
  }
}
