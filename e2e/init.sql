CREATE TABLE IF NOT EXISTS public.orders (
  id serial PRIMARY KEY,
  status text NOT NULL,
  amount numeric(10, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.orders (status, amount, created_at)
SELECT
  (ARRAY['processing', 'completed', 'shipped'])[1 + (i % 3)],
  (10 + (i % 90))::numeric,
  now() - (i || ' hours')::interval
FROM generate_series(1, 600) AS i;
