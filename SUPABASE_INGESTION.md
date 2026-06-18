# Supabase Ingestion Reset

This reset moves only the S3 data-ingestion path to Supabase. Other backend
functions can continue using their existing stores until they are migrated.

## 1. Recreate Supabase schema

Run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL editor.
It creates:

- `customers`, `suppliers`
- `sales`, `purchases`
- `sales_items`, `purchase_items`
- `ingestion_files`
- dashboard views for revenue, purchases, GST, suppliers, SKUs, and item margin
- authenticated read policies for the frontend

## 2. Configure secrets

The ingest Lambda needs:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The frontend needs:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 3. Deploy ingestion

Build and deploy `lambda/ingest`. Terraform now gives the ingest Lambda only S3
read/log permissions and passes the Supabase environment variables.

## 4. Upload the SGS files

Upload the exports through the Data Ingest page:

- `Customers.csv`
- `Suppliers.csv`
- `Sales.csv`
- `Purchase.csv`
- `Item wise sales.csv`
- `Item wise purchase.csv`

The Lambda is idempotent: summary registers upsert by invoice number, master
records upsert by name, and item rows use deterministic row keys.
