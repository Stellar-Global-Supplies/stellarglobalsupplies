-- Stellar Global Supplies - Supabase reset schema
-- Run this in the Supabase SQL editor after deleting the old schema.

create extension if not exists pgcrypto;

drop view if exists public.inventory_summary;
drop view if exists public.item_margin;
drop view if exists public.material_split;
drop view if exists public.monthly_gst;
drop view if exists public.monthly_business;
drop view if exists public.top_suppliers;
drop view if exists public.top_skus;
drop view if exists public.top_customers;
drop view if exists public.monthly_revenue;
drop view if exists public.analytics_summary;

drop table if exists public.purchase_items;
drop table if exists public.sales_items;
drop table if exists public.purchases;
drop table if exists public.sales;
drop table if exists public.suppliers;
drop table if exists public.customers;
drop table if exists public.ingestion_files;

create table public.ingestion_files (
  source_file text primary key,
  bucket text,
  file_type text not null,
  row_count integer not null default 0,
  status text not null check (status in ('complete', 'error')),
  error_message text,
  ingested_at timestamptz not null default now()
);

create table public.customers (
  customer_name text primary key,
  gstin text,
  source_file text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.suppliers (
  supplier_name text primary key,
  gstin text,
  source_file text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sales (
  invoice_no text primary key,
  invoice_date date not null,
  customer_name text not null,
  invoice_type text,
  total_amount numeric(14, 2) not null default 0,
  source_file text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchases (
  invoice_no text primary key,
  invoice_id text,
  invoice_date date not null,
  supplier_name text not null,
  invoice_type text,
  total_amount numeric(14, 2) not null default 0,
  source_file text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sales_items (
  row_key text primary key,
  invoice_no text not null,
  invoice_date date not null,
  customer_name text not null,
  item_name text not null,
  quantity numeric(14, 3) not null default 0,
  unit text,
  material_type text not null default 'OTHER',
  base_amount numeric(14, 2) not null default 0,
  gst_rate numeric(7, 3) not null default 0,
  gst_amount numeric(14, 2) not null default 0,
  total_amount numeric(14, 2) not null default 0,
  source_file text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchase_items (
  row_key text primary key,
  invoice_no text not null,
  invoice_date date not null,
  supplier_name text not null,
  item_name text not null,
  quantity numeric(14, 3) not null default 0,
  unit text,
  material_type text not null default 'OTHER',
  base_amount numeric(14, 2) not null default 0,
  gst_rate numeric(7, 3) not null default 0,
  gst_amount numeric(14, 2) not null default 0,
  total_amount numeric(14, 2) not null default 0,
  source_file text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sales_invoice_date_idx on public.sales (invoice_date);
create index sales_customer_idx on public.sales (customer_name);
create index purchases_invoice_date_idx on public.purchases (invoice_date);
create index purchases_supplier_idx on public.purchases (supplier_name);
create index sales_items_invoice_idx on public.sales_items (invoice_no);
create index sales_items_item_idx on public.sales_items (item_name);
create index purchase_items_invoice_idx on public.purchase_items (invoice_no);
create index purchase_items_item_idx on public.purchase_items (item_name);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger customers_touch_updated_at before update on public.customers
for each row execute function public.touch_updated_at();
create trigger suppliers_touch_updated_at before update on public.suppliers
for each row execute function public.touch_updated_at();
create trigger sales_touch_updated_at before update on public.sales
for each row execute function public.touch_updated_at();
create trigger purchases_touch_updated_at before update on public.purchases
for each row execute function public.touch_updated_at();
create trigger sales_items_touch_updated_at before update on public.sales_items
for each row execute function public.touch_updated_at();
create trigger purchase_items_touch_updated_at before update on public.purchase_items
for each row execute function public.touch_updated_at();

create view public.analytics_summary as
select
  coalesce(sum(total_amount), 0)::numeric(14, 2) as total_revenue,
  count(*)::integer as total_invoices,
  coalesce(avg(total_amount), 0)::numeric(14, 2) as avg_invoice_value,
  (select count(*) from public.customers)::integer as customer_count,
  (select count(*) from public.suppliers)::integer as supplier_count,
  (select coalesce(sum(total_amount), 0) from public.purchases)::numeric(14, 2) as total_purchase,
  (
    coalesce(sum(total_amount), 0)
    - (select coalesce(sum(total_amount), 0) from public.purchases)
  )::numeric(14, 2) as gross_profit
from public.sales;

create view public.monthly_revenue as
select
  to_char(date_trunc('month', invoice_date), 'YYYY-MM') as month,
  sum(total_amount)::numeric(14, 2) as revenue,
  count(*)::integer as invoices
from public.sales
group by 1
order by 1;

create view public.top_customers as
select
  customer_name,
  sum(total_amount)::numeric(14, 2) as total_revenue,
  count(*)::integer as invoice_count
from public.sales
group by customer_name
order by total_revenue desc;

create view public.top_skus as
select
  item_name as sku,
  sum(total_amount)::numeric(14, 2) as total_revenue,
  sum(quantity)::numeric(14, 3) as total_qty,
  max(material_type) as material_type
from public.sales_items
group by item_name
order by total_revenue desc;

create view public.material_split as
select
  material_type,
  sum(total_amount)::numeric(14, 2) as total_revenue
from public.sales_items
group by material_type
order by total_revenue desc;

create view public.top_suppliers as
select
  supplier_name,
  sum(total_amount)::numeric(14, 2) as total_purchase,
  count(*)::integer as invoice_count
from public.purchases
group by supplier_name
order by total_purchase desc;

create view public.monthly_business as
with sales_months as (
  select
    to_char(date_trunc('month', invoice_date), 'YYYY-MM') as month,
    sum(total_amount) as sales,
    count(*) as sales_invoices
  from public.sales
  group by 1
),
purchase_months as (
  select
    to_char(date_trunc('month', invoice_date), 'YYYY-MM') as month,
    sum(total_amount) as purchases,
    count(*) as purchase_invoices
  from public.purchases
  group by 1
)
select
  coalesce(s.month, p.month) as month,
  coalesce(s.sales, 0)::numeric(14, 2) as sales,
  coalesce(p.purchases, 0)::numeric(14, 2) as purchases,
  (coalesce(s.sales, 0) - coalesce(p.purchases, 0))::numeric(14, 2) as gross_profit,
  case
    when coalesce(s.sales, 0) = 0 then 0
    else (((coalesce(s.sales, 0) - coalesce(p.purchases, 0)) / s.sales) * 100)::numeric(8, 2)
  end as gross_margin_pct,
  coalesce(s.sales_invoices, 0)::integer as sales_invoices,
  coalesce(p.purchase_invoices, 0)::integer as purchase_invoices
from sales_months s
full join purchase_months p using (month)
order by 1;

create view public.monthly_gst as
with sales_gst as (
  select to_char(date_trunc('month', invoice_date), 'YYYY-MM') as month, sum(gst_amount) as output_gst
  from public.sales_items
  group by 1
),
purchase_gst as (
  select to_char(date_trunc('month', invoice_date), 'YYYY-MM') as month, sum(gst_amount) as input_gst
  from public.purchase_items
  group by 1
)
select
  coalesce(s.month, p.month) as month,
  coalesce(s.output_gst, 0)::numeric(14, 2) as output_gst,
  coalesce(p.input_gst, 0)::numeric(14, 2) as input_gst,
  (coalesce(s.output_gst, 0) - coalesce(p.input_gst, 0))::numeric(14, 2) as net_gst
from sales_gst s
full join purchase_gst p using (month)
order by 1;

create view public.item_margin as
with sales_items_rollup as (
  select item_name, sum(quantity) as sales_qty, sum(total_amount) as sales_amount
  from public.sales_items
  group by item_name
),
purchase_items_rollup as (
  select item_name, sum(quantity) as purchase_qty, sum(total_amount) as purchase_amount
  from public.purchase_items
  group by item_name
)
select
  coalesce(s.item_name, p.item_name) as item_name,
  coalesce(s.sales_qty, 0)::numeric(14, 3) as sales_qty,
  coalesce(p.purchase_qty, 0)::numeric(14, 3) as purchase_qty,
  coalesce(s.sales_amount, 0)::numeric(14, 2) as sales_amount,
  coalesce(p.purchase_amount, 0)::numeric(14, 2) as purchase_amount,
  (coalesce(s.sales_amount, 0) - coalesce(p.purchase_amount, 0))::numeric(14, 2) as gross_profit
from sales_items_rollup s
full join purchase_items_rollup p using (item_name)
order by sales_amount desc;

-- Inventory summary: purchase_items (incoming) - sales_items (outgoing) = current stock
create view public.inventory_summary as
with purchase_rollup as (
  select
    item_name,
    coalesce(sum(quantity), 0)::numeric(14, 3) as purchased_qty,
    max(unit) as unit,
    max(material_type) as material_type
  from public.purchase_items
  group by item_name
),
sales_rollup as (
  select
    item_name,
    coalesce(sum(quantity), 0)::numeric(14, 3) as sold_qty,
    max(unit) as unit,
    max(material_type) as material_type
  from public.sales_items
  group by item_name
)
select
  coalesce(p.item_name, s.item_name) as item_name,
  coalesce(p.purchased_qty, 0)::numeric(14, 3) as purchased_qty,
  coalesce(s.sold_qty, 0)::numeric(14, 3) as sold_qty,
  (coalesce(p.purchased_qty, 0) - coalesce(s.sold_qty, 0))::numeric(14, 3) as current_stock,
  coalesce(p.unit, s.unit, 'units') as unit,
  coalesce(p.material_type, s.material_type, 'OTHER') as material_type
from purchase_rollup p
full join sales_rollup s using (item_name)
order by current_stock desc;

alter view public.analytics_summary set (security_invoker = true);
alter view public.monthly_revenue set (security_invoker = true);
alter view public.top_customers set (security_invoker = true);
alter view public.top_skus set (security_invoker = true);
alter view public.material_split set (security_invoker = true);
alter view public.top_suppliers set (security_invoker = true);
alter view public.monthly_business set (security_invoker = true);
alter view public.monthly_gst set (security_invoker = true);
alter view public.item_margin set (security_invoker = true);
alter view public.inventory_summary set (security_invoker = true);

alter table public.ingestion_files enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.sales enable row level security;
alter table public.purchases enable row level security;
alter table public.sales_items enable row level security;
alter table public.purchase_items enable row level security;

create policy "Authenticated users can read ingestion files" on public.ingestion_files
for select to authenticated using (true);
create policy "Authenticated users can read customers" on public.customers
for select to authenticated using (true);
create policy "Authenticated users can read suppliers" on public.suppliers
for select to authenticated using (true);
create policy "Authenticated users can read sales" on public.sales
for select to authenticated using (true);
create policy "Authenticated users can read purchases" on public.purchases
for select to authenticated using (true);
create policy "Authenticated users can read sales items" on public.sales_items
for select to authenticated using (true);
create policy "Authenticated users can read purchase items" on public.purchase_items
for select to authenticated using (true);

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant select on all sequences in schema public to authenticated;
