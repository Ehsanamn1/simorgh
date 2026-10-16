import { Hono } from 'hono';

type Bindings = {
  DATABASE_URL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'medar-api',
    database: c.env.DATABASE_URL ? 'configured' : 'not_configured',
  }),
);

app.notFound((c) => c.json({ message: 'مسیر API پیدا نشد.' }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ message: 'خطای داخلی سرور.' }, 500);
});

export default app;
