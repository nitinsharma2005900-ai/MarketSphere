"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Plus,
  Search,
  RefreshCw,
  Package,
  ShoppingBag,
  IndianRupee,
  Boxes,
  Clock,
  Users,
  AlertTriangle,
  ShieldCheck,
  FileSpreadsheet,
  ImagePlus,
} from "lucide-react";
import { toast } from "sonner";
import { api, action, useAuth } from "./providers";
import { SkuManager } from "./sku-manager";
import {
  money,
  date,
  Loading,
  ErrorState,
  Empty,
  Modal,
  Field,
  Badge,
} from "./ui";
import { Orders, Tickets } from "./customer";
const names: Record<string, string> = {
  ADMIN: "Marketplace",
  SELLER: "Seller",
  WAREHOUSE: "Warehouse",
  SUPPORT: "Support",
};
export function Portal() {
  const { user, ready } = useAuth(),
    path = usePathname();
  if (!ready) return <Loading />;
  if (!user)
    return (
      <Empty
        title="Your workspace is one sign in away"
        text="Use a seller, warehouse, support, or administrator account."
      >
        <Link className="button" href="/login">
          Sign in
        </Link>
      </Empty>
    );
  if (user.role === "CUSTOMER")
    return (
      <Empty
        title="Welcome to MarketSphere"
        text="Your shopping account is ready."
      >
        <Link href="/account" className="button">
          Your account
        </Link>
      </Empty>
    );
  const section = path.split("/")[2] ?? "";
  const allowed: Record<string, string[]> = {
    products: ["ADMIN", "SELLER"],
    orders: ["ADMIN", "SELLER", "WAREHOUSE"],
    inventory: ["ADMIN", "SELLER", "WAREHOUSE"],
    returns: ["ADMIN", "SELLER", "WAREHOUSE", "SUPPORT"],
    tickets: ["ADMIN", "SUPPORT"],
    disputes: ["ADMIN", "SUPPORT"],
    settlements: ["ADMIN", "SELLER"],
    sellers: ["ADMIN"],
    users: ["ADMIN"],
    promotions: ["ADMIN"],
    categories: ["ADMIN"],
    audit: ["ADMIN"],
    health: ["ADMIN"],
  };
  if (section && (!allowed[section] || !allowed[section].includes(user.role)))
    return (
      <Empty
        title="This workspace is unavailable"
        text="Choose an area from your workspace navigation."
      />
    );
  return (
    <>
      <div className="portal-topline">
        <span>
          {names[user.role]} workspace <span>/ {section || "Overview"}</span>
        </span>
        <div>
          <span className="environment-pill">
            <span />
            Local sandbox
          </span>
          <span className="avatar">{user.name[0]}</span>
        </div>
      </div>
      {section === "products" ? (
        <Products />
      ) : section === "orders" ? (
        <Orders portal />
      ) : section === "inventory" ? (
        <Inventory />
      ) : section === "returns" ? (
        <Returns />
      ) : section === "tickets" ? (
        <Tickets portal />
      ) : section === "settlements" ? (
        <Settlements />
      ) : section ? (
        <Administration section={section} />
      ) : (
        <Overview />
      )}
    </>
  );
}
function useRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      body,
      method = "POST",
      idempotent = false,
    }: {
      path: string;
      body?: unknown;
      method?: string;
      idempotent?: boolean;
    }) => action(path, body, method, idempotent),
    onSuccess: () => {
      toast.success("Changes saved");
      void client.invalidateQueries();
    },
  });
}
function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-title title-row">
      <div>
        <span className="eyebrow">{eyebrow ?? "YOUR BUSINESS, CONNECTED"}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
function Overview() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["dashboard", user?.id],
    queryFn: () => api("/dashboard"),
  });
  const orders = useQuery({
    queryKey: ["recent-orders", user?.id],
    queryFn: () => api("/orders?limit=5"),
    enabled: user?.role !== "SUPPORT",
  });
  const client = useQueryClient();
  if (query.isLoading) return <Loading />;
  if (query.isError)
    return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const d = query.data.data;
  const cards =
    user?.role === "WAREHOUSE"
      ? [
          ["Available units", d.available, Boxes],
          ["Reserved units", d.reserved, Clock],
          ["Low stock SKUs", d.lowStock, AlertTriangle],
          ["Total orders", d.orderCount, ShoppingBag],
        ]
      : user?.role === "SUPPORT"
        ? [
            ["Open tickets", d.openTickets, Package],
            ["Returns", d.returnCount, RefreshCw],
            ["Pending sellers", d.pendingSellers, Users],
            ["Total orders", d.orderCount, ShoppingBag],
          ]
        : [
            ["Net sales", money(d.net), IndianRupee],
            ["Total orders", d.orderCount, ShoppingBag],
            ["Catalog products", d.products, Package],
            ["Available units", d.available, Boxes],
          ];
  return (
    <>
      <Heading
        eyebrow="THE BIG PICTURE"
        title={"Good to see you, " + user?.name.split(" ")[0] + "."}
        description="Here’s what’s happening across your MarketSphere today."
      >
        <button
          className="button secondary"
          onClick={() => client.invalidateQueries()}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
        <Link
          className="button"
          href={
            user?.role === "SUPPORT"
              ? "/portal/tickets"
              : user?.role === "WAREHOUSE"
                ? "/portal/inventory"
                : "/portal/products"
          }
        >
          <Plus size={17} />
          {user?.role === "SUPPORT"
            ? "Support queue"
            : user?.role === "WAREHOUSE"
              ? "Manage stock"
              : "Manage products"}
        </Link>
      </Heading>
      <div className="metric-grid">
        {cards.map(([label, value, Icon]: any) => (
          <div className="metric-card" key={label}>
            <div>
              <span>{label}</span>
              <Icon size={19} />
            </div>
            <strong>{value ?? 0}</strong>
            <small>From current marketplace records</small>
          </div>
        ))}
      </div>
      <div className="dashboard-columns">
        <section className="panel analytics-panel">
          <div className="section-heading">
            <div>
              <h2>
                {user?.role === "WAREHOUSE"
                  ? "Stock overview"
                  : user?.role === "SUPPORT"
                    ? "Support overview"
                    : "Revenue overview"}
              </h2>
              <p>
                {user?.role === "WAREHOUSE"
                  ? "Live available and reserved quantities"
                  : user?.role === "SUPPORT"
                    ? "Your active service workload"
                    : "Gross sales · last 14 days · INR"}
              </p>
            </div>
            <span className="subtle-tag">Live database</span>
          </div>
          {["SELLER", "ADMIN"].includes(user?.role ?? "") ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height={270}>
                <AreaChart data={d.series}>
                  <defs>
                    <linearGradient
                      id="revenueFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#4268e8"
                        stopOpacity={0.22}
                      />
                      <stop offset="100%" stopColor="#4268e8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#edf0f5" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => v.slice(5)}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#8993a4", fontSize: 12 }}
                  />
                  <YAxis
                    tickFormatter={(v) => "₹" + (v / 100000).toFixed(0) + "k"}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#8993a4", fontSize: 12 }}
                  />
                  <Tooltip formatter={(v) => money(Number(v))} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#4268e8"
                    strokeWidth={2.5}
                    fill="url(#revenueFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="operations-summary">
              <div>
                <Boxes size={38} />
                <strong>
                  {user?.role === "WAREHOUSE" ? d.available : d.openTickets}
                </strong>
                <span>
                  {user?.role === "WAREHOUSE"
                    ? "units ready for fulfillment"
                    : "tickets awaiting attention"}
                </span>
              </div>
              <Link
                className="button secondary"
                href={
                  user?.role === "WAREHOUSE"
                    ? "/portal/inventory"
                    : "/portal/tickets"
                }
              >
                Open your queue
              </Link>
            </div>
          )}
        </section>
        <section className="panel attention-panel">
          <h2>Worth a closer look</h2>
          <p>A few details that keep things moving.</p>
          {["ADMIN", "SELLER", "WAREHOUSE"].includes(user?.role ?? "") && (
            <Link href="/portal/inventory">
              <span className="attention-icon amber">
                <Boxes size={19} />
              </span>
              <div>
                <strong>{d.lowStock} SKUs running low</strong>
                <small>Review available inventory</small>
              </div>
              <span>›</span>
            </Link>
          )}
          {["ADMIN", "SUPPORT"].includes(user?.role ?? "") && (
            <Link href="/portal/tickets">
              <span className="attention-icon blue">
                <Package size={19} />
              </span>
              <div>
                <strong>{d.openTickets} open conversations</strong>
                <small>Keep your customers in the loop</small>
              </div>
              <span>›</span>
            </Link>
          )}
          {user?.role === "ADMIN" && (
            <Link href="/portal/sellers">
              <span className="attention-icon green">
                <Users size={19} />
              </span>
              <div>
                <strong>{d.pendingSellers} sellers awaiting approval</strong>
                <small>Welcome your next independent brand</small>
              </div>
              <span>›</span>
            </Link>
          )}
          <div className="workspace-note">
            <ShieldCheck size={20} />
            <p>
              Every change leaves a trail.
              <br />
              <span>
                Stock movements and important actions are recorded for review.
              </span>
            </p>
          </div>
        </section>
      </div>
      {orders.data?.data && (
        <section className="panel recent-orders">
          <div className="section-heading">
            <div>
              <h2>Recent orders</h2>
              <p>The latest finds making their way home.</p>
            </div>
            <Link className="text-link" href="/portal/orders">
              View all orders
            </Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Product</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {orders.data.data.map((o: any) => (
                  <tr key={o.id}>
                    <td>
                      <Link className="text-link" href="/portal/orders">
                        #{o.id.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td>
                      {o.items[0]?.name}
                      <small>
                        {o.items.length > 1
                          ? `+${o.items.length - 1} more items`
                          : ""}
                      </small>
                    </td>
                    <td>{date(o.createdAt)}</td>
                    <td>
                      <Badge>{o.status}</Badge>
                    </td>
                    <td className="right">
                      <strong>{money(o.total)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {user?.role === "SELLER" && (
        <div className="finance-footnote">
          Gross {money(d.gross)} · Refunded {money(d.refunded)} · Commission{" "}
          {money(d.commission)} · Provisional seller net {money(d.sellerNet)}.
          Settlement eligibility excludes returned lines.
        </div>
      )}
    </>
  );
}
function Products() {
  const { user } = useAuth(),
    client = useQueryClient();
  const products = useQuery({
    queryKey: ["seller-products"],
    queryFn: () => api("/seller/products"),
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api("/categories"),
  });
  const [search, setSearch] = useState(""),
    [editing, setEditing] = useState<any>(null),
    [skuProduct, setSkuProduct] = useState<any>(null),
    [showImport, setShowImport] = useState(false),
    [importMode, setImportMode] = useState("prices"),
    [csv, setCsv] = useState(""),
    [feed, setFeed] = useState<any>(null),
    [image, setImage] = useState("/products/product-1.svg");
  const file = useRef<HTMLInputElement>(null);
  const run = useRun();
  const save = useMutation({
    mutationFn: async (body: any) => {
      const { sku, variantName, price, ...product } = body;
      if (editing?.id) {
        await action("/seller/products/" + editing.id, product, "PATCH");
        if (editing.variants[0])
          await action(
            "/seller/variants/" + editing.variants[0].id,
            { price: Number(price), name: variantName },
            "PATCH",
          );
        return;
      }
      return action("/seller/products", {
        ...product,
        variants: [{ sku, name: variantName, price: Number(price) }],
      });
    },
    onSuccess: () => {
      setEditing(null);
      toast.success("Product saved");
      void client.invalidateQueries({ queryKey: ["seller-products"] });
    },
  });
  const importFeed = useMutation({
    mutationFn: (apply: boolean) =>
      action(
        importMode === "prices" ? "/seller/import" : "/seller/catalog-import",
        { csv, apply },
      ),
    onSuccess: (r) => {
      setFeed(r.data);
      if (r.data.applied) {
        toast.success("Prices imported");
        void client.invalidateQueries();
      }
    },
  });
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const data = new FormData();
      data.append("image", f);
      return api("/uploads", { method: "POST", body: data });
    },
    onSuccess: (r) => {
      setImage(r.data.url);
      toast.success("Image uploaded to object storage");
    },
  });
  const list =
    products.data?.data.filter((p: any) =>
      (p.name + " " + p.variants.map((v: any) => v.sku).join(" "))
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <>
      <Heading
        title="Your product collection"
        description="Good products. Clear details. A catalog your customers can count on."
      >
        {user?.role === "SELLER" && (
          <>
            <button
              className="button secondary"
              onClick={() => setShowImport(true)}
            >
              <FileSpreadsheet size={16} />
              Import CSV
            </button>
            <button
              className="button"
              onClick={() => {
                setImage("/products/product-1.svg");
                setEditing({});
              }}
            >
              <Plus size={17} />
              Add product
            </button>
          </>
        )}
      </Heading>
      <div className="panel">
        <div className="table-toolbar">
          <div className="search">
            <Search size={17} />
            <input
              aria-label="Search catalog"
              placeholder="Search products or SKUs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="muted">{list.length} products</span>
        </div>
        {products.isLoading ? (
          <Loading />
        ) : products.isError ? (
          <ErrorState error={products.error} />
        ) : !list.length ? (
          <Empty
            title="Your collection starts here"
            text="Create your first product or try another search."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>Available</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p: any) => (
                  <tr key={p.id}>
                    <td>
                      <div className="table-product">
                        <img src={p.image} alt="" />
                        <div>
                          <strong>{p.name}</strong>
                          <small>
                            {p.variants[0]?.sku} · {p.seller.name}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>{p.category.name}</td>
                    <td>{money(p.variants[0]?.price)}</td>
                    <td>
                      {p.variants.reduce(
                        (n: number, v: any) =>
                          n +
                          v.inventory.reduce(
                            (s: number, i: any) => s + i.onHand - i.reserved,
                            0,
                          ),
                        0,
                      )}{" "}
                      units
                    </td>
                    <td>
                      <Badge>{p.status}</Badge>
                    </td>
                    <td>
                      <div className="inline-actions">
                        <button
                          className="text-link"
                          onClick={() => {
                            setImage(p.image);
                            setEditing(p);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="text-link"
                          onClick={() => setSkuProduct(p)}
                        >
                          SKUs
                        </button>
                        {user?.role === "ADMIN" && (
                          <select
                            aria-label={"Moderate " + p.name}
                            value={p.status}
                            onChange={(e) =>
                              run.mutate({
                                path: "/admin/products/" + p.id + "/moderate",
                                body: { status: e.target.value },
                                method: "PATCH",
                              })
                            }
                          >
                            {["PENDING", "ACTIVE", "REJECTED", "ARCHIVED"].map(
                              (s) => (
                                <option key={s} disabled={s === "PENDING"}>
                                  {s}
                                </option>
                              ),
                            )}
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {skuProduct && (
        <SkuManager product={skuProduct} close={() => setSkuProduct(null)} />
      )}
      {editing && (
        <Modal
          title={editing.id ? "Edit product" : "Add a considered find"}
          close={() => setEditing(null)}
        >
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({
                ...Object.fromEntries(new FormData(e.currentTarget)),
                image,
              });
            }}
          >
            <Field label="Product name">
              <input
                name="name"
                defaultValue={editing.name}
                minLength={2}
                maxLength={200}
                required
              />
            </Field>
            <Field label="Category">
              <select
                name="categoryId"
                defaultValue={editing.categoryId}
                required
              >
                {categories.data?.data.map((c: any) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description">
              <textarea
                name="description"
                defaultValue={editing.description}
                required
                minLength={10}
                maxLength={5000}
              />
            </Field>
            <div className="image-upload">
              <img src={image} alt="Product preview" />
              <button
                type="button"
                className="button secondary"
                disabled={upload.isPending}
                onClick={() => file.current?.click()}
              >
                <ImagePlus size={16} />
                {upload.isPending ? "Uploading…" : "Upload image"}
              </button>
              <input
                hidden
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                }}
              />
              <small>PNG, JPEG, WebP · max 5 MB</small>
            </div>
            <div className="form-grid">
              <Field label="SKU">
                <input
                  name="sku"
                  defaultValue={editing.variants?.[0]?.sku}
                  readOnly={!!editing.id}
                  required
                  pattern="[A-Za-z0-9_-]+"
                  minLength={3}
                />
              </Field>
              <Field label="Variant name">
                <input
                  name="variantName"
                  defaultValue={editing.variants?.[0]?.name ?? "Standard"}
                  required
                  minLength={2}
                />
              </Field>
            </div>
            <Field label="Price (integer paise)">
              <input
                name="price"
                type="number"
                min={1}
                max={100000000}
                step={1}
                defaultValue={editing.variants?.[0]?.price ?? 100000}
                required
              />
            </Field>
            {editing.variants?.length > 1 && (
              <small className="muted">
                This form edits the first SKU. Additional SKU pricing is
                available in inventory and the REST API.
              </small>
            )}
            <button
              className="button"
              disabled={save.isPending || upload.isPending}
            >
              {save.isPending ? "Saving…" : "Save product"}
            </button>
            {save.isError && (
              <p className="field-error">{save.error.message}</p>
            )}
          </form>
        </Modal>
      )}
      {showImport && (
        <Modal
          title="Bulk CSV import"
          close={() => {
            setShowImport(false);
            setFeed(null);
          }}
        >
          <div className="stack">
            <Field label="Import type">
              <select
                value={importMode}
                onChange={(e) => {
                  setImportMode(e.target.value);
                  setFeed(null);
                }}
              >
                <option value="prices">Update prices</option>
                <option value="catalog">Import products</option>
              </select>
            </Field>
            <p>
              Upload a CSV with <code>sku,price</code> headers. Prices use
              integer paise. Only your own SKUs can be imported.
              {importMode === "catalog" &&
                " Catalog imports also require name,description,category_slug. Products are submitted for moderation."}
            </p>
            <input
              type="file"
              aria-label="Price CSV file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setCsv(await f.text());
              }}
            />
            <Field label="CSV contents">
              <textarea
                value={csv}
                onChange={(e) => {
                  setCsv(e.target.value);
                  setFeed(null);
                }}
                placeholder={"sku,price\nMS-001-STD,899900"}
              />
            </Field>
            <div className="inline-actions">
              <button
                className="button secondary"
                disabled={!csv || importFeed.isPending}
                onClick={() => importFeed.mutate(false)}
              >
                Validate feed
              </button>
              <button
                className="button"
                disabled={
                  !feed || feed.errors.length > 0 || importFeed.isPending
                }
                onClick={() => importFeed.mutate(true)}
              >
                Apply valid feed
              </button>
            </div>
            {feed && (
              <div className="feed-results">
                <strong>
                  {feed.valid} valid · {feed.invalid} invalid
                </strong>
                {feed.errors.map((e: any, n: number) => (
                  <p className="field-error" key={n}>
                    Row {e.row}: {e.error}
                  </p>
                ))}
                {feed.applied && <Badge>APPLIED</Badge>}
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
function Inventory() {
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<any>(null),
    [history, setHistory] = useState<any>(null),
    [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["inventory", page],
    queryFn: () => api("/inventory?limit=50&page=" + page),
  });
  const run = useRun();
  const skus = useQuery({
    queryKey: ["inventory-skus"],
    queryFn: () => api("/inventory/skus"),
    enabled: !!selected?.isNew,
  });
  const warehouses = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => api("/warehouses"),
    enabled: !!selected?.isNew,
  });
  const rows =
    query.data?.data.filter((i: any) =>
      (i.variant.sku + " " + i.variant.product.name + " " + i.warehouse.name)
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <>
      <Heading
        title="Inventory, in the clear."
        description="Track available units, active reservations, and every movement in between."
      >
        <button className="button secondary" onClick={() => query.refetch()}>
          <RefreshCw size={16} />
          Refresh stock
        </button>
        <button className="button" onClick={() => setSelected({ isNew: true })}>
          <Plus size={16} />
          Receive a SKU
        </button>
      </Heading>
      <div className="panel">
        <div className="table-toolbar">
          <div className="search">
            <Search size={17} />
            <input
              aria-label="Search inventory"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search this page by SKU or warehouse"
            />
          </div>
          <span className="muted">Page {page}</span>
        </div>
        {query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState error={query.error} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SKU / product</th>
                  <th>Warehouse</th>
                  <th>On hand</th>
                  <th>Reserved</th>
                  <th>Available</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i: any) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.variant.product.name}</strong>
                      <small>
                        {i.variant.sku} · {i.variant.name}
                      </small>
                    </td>
                    <td>
                      {i.warehouse.city}
                      <small>{i.warehouse.name}</small>
                    </td>
                    <td>{i.onHand}</td>
                    <td>{i.reserved}</td>
                    <td>
                      <span
                        className={
                          i.onHand - i.reserved <= i.threshold
                            ? "low-stock"
                            : ""
                        }
                      >
                        {i.onHand - i.reserved}{" "}
                        {i.onHand - i.reserved <= i.threshold
                          ? "· Low stock"
                          : ""}
                      </span>
                    </td>
                    <td>
                      <div className="inline-actions">
                        <button
                          className="text-link"
                          onClick={() => setSelected(i)}
                        >
                          Adjust stock
                        </button>
                        <button
                          className="text-link"
                          onClick={() => setHistory(i)}
                        >
                          Movements
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <button
            className="button secondary"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            className="button secondary"
            disabled={(query.data?.data.length ?? 0) < 50}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
      {selected && (
        <Modal
          title="Receive or reconcile stock"
          close={() => setSelected(null)}
        >
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                await run.mutateAsync({
                  path: "/inventory/adjust",
                  body: {
                    variantId: selected.variantId ?? form.get("variantId"),
                    warehouseId:
                      selected.warehouseId ?? form.get("warehouseId"),
                    delta: Number(form.get("delta")),
                    reason: form.get("reason"),
                  },
                  idempotent: true,
                });
                setSelected(null);
              } catch {}
            }}
          >
            {selected.isNew ? (
              <>
                <Field label="SKU">
                  <select name="variantId" required>
                    {skus.data?.data.map((v: any) => (
                      <option key={v.id} value={v.id}>
                        {v.sku} · {v.product.name} · {v.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Warehouse">
                  <select name="warehouseId" required>
                    {warehouses.data?.data.map((w: any) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : (
              <p>
                <strong>{selected.variant.product.name}</strong>
                <br />
                {selected.variant.sku} · {selected.warehouse.name}
              </p>
            )}
            <Field label="Quantity change (+ receive / − reconcile)">
              <input
                name="delta"
                type="number"
                step={1}
                min={-100000}
                max={100000}
                required
              />
            </Field>
            <Field label="Reason">
              <textarea name="reason" minLength={5} maxLength={300} required />
            </Field>
            <p className="muted">
              Reserved units cannot be consumed by a downward adjustment. Every
              accepted change creates an immutable ledger record.
            </p>
            <button className="button" disabled={run.isPending}>
              Record stock movement
            </button>
          </form>
        </Modal>
      )}
      {history && (
        <Modal title="Stock movement history" close={() => setHistory(null)}>
          <p>
            {history.variant.sku} · {history.warehouse.name}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Movement</th>
                  <th>On hand Δ</th>
                  <th>Reserved Δ</th>
                </tr>
              </thead>
              <tbody>
                {history.movements.map((m: any) => (
                  <tr key={m.id}>
                    <td>{date(m.createdAt)}</td>
                    <td>
                      <Badge>{m.kind}</Badge>
                      <small>{m.reason}</small>
                    </td>
                    <td>{m.deltaOnHand}</td>
                    <td>{m.deltaReserved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Active reservations</h3>
          {history.reservations.length ? (
            history.reservations.map((r: any) => (
              <p key={r.id}>
                Order #{r.orderId.slice(0, 8)} · {r.quantity} units · until{" "}
                {new Date(r.expiresAt).toLocaleString("en-IN")}
              </p>
            ))
          ) : (
            <p className="muted">No active reservations.</p>
          )}
        </Modal>
      )}
    </>
  );
}
function Returns() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["returns"],
    queryFn: () => api("/returns"),
  });
  const run = useRun();
  const [confirm, setConfirm] = useState<any>(null);
  return (
    <>
      <Heading
        title="Returns & refunds"
        description="A clear resolution, from the first request to the final refund."
      />
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : query.data?.data.length ? (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Return / order</th>
                <th>Reason</th>
                <th>Items</th>
                <th>Status</th>
                <th>Refund</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    #{r.id.slice(0, 8)}
                    <small>
                      Order #{r.orderId.slice(0, 8)} · {date(r.createdAt)}
                    </small>
                  </td>
                  <td>{r.reason}</td>
                  <td>
                    {r.items.map((i: any) => (
                      <small key={i.id}>
                        {i.orderItem.name} × {i.quantity}
                      </small>
                    ))}
                  </td>
                  <td>
                    <Badge>{r.status}</Badge>
                  </td>
                  <td>{r.refund ? money(r.refund.amount) : "—"}</td>
                  <td>
                    <div className="inline-actions">
                      {r.status === "REQUESTED" && user?.role !== "SELLER" && (
                        <>
                          <button
                            className="text-link"
                            onClick={() =>
                              setConfirm({ r, kind: "receive", accept: true })
                            }
                          >
                            Receive & restock
                          </button>
                          <button
                            className="text-link danger-text"
                            onClick={() =>
                              setConfirm({ r, kind: "receive", accept: false })
                            }
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {r.status === "RECEIVED" &&
                        ["ADMIN", "SUPPORT"].includes(user?.role ?? "") && (
                          <button
                            className="button small-button"
                            onClick={() => setConfirm({ r, kind: "refund" })}
                          >
                            Issue sandbox refund
                          </button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="No return requests"
          text="New requests will appear here after a customer’s order is delivered."
        />
      )}
      {confirm && (
        <Modal
          title={
            confirm.kind === "refund"
              ? "Confirm sandbox refund"
              : confirm.accept
                ? "Confirm return inspection"
                : "Reject return request"
          }
          close={() => setConfirm(null)}
        >
          <div className="stack">
            <p>
              {confirm.kind === "refund"
                ? "The charged line amount will be refunded through the configured sandbox provider. Repeating this action cannot create a second refund."
                : confirm.accept
                  ? "Confirm that these units were received and inspected. This will add them back to available inventory."
                  : "This request will be marked rejected without a stock movement."}
            </p>
            <button
              className="button"
              disabled={run.isPending}
              onClick={async () => {
                try {
                  await run.mutateAsync({
                    path: "/returns/" + confirm.r.id + "/" + confirm.kind,
                    body:
                      confirm.kind === "receive"
                        ? { accept: confirm.accept }
                        : undefined,
                  });
                  setConfirm(null);
                } catch {}
              }}
            >
              Confirm action
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function Settlements() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["settlements"],
    queryFn: () => api("/settlements"),
  });
  const sellers = useQuery({
    queryKey: ["sellers"],
    queryFn: () => api("/admin/sellers"),
    enabled: user?.role === "ADMIN",
  });
  const [selected, setSelected] = useState("");
  const reversals = useQuery({
    queryKey: ["financial-movements"],
    queryFn: () => api("/financial-movements"),
  });
  const run = useRun();
  return (
    <>
      <Heading
        title="Seller settlements"
        description="Delivered sales, recorded commissions, and a clear financial trail."
      />
      {user?.role === "ADMIN" && (
        <div className="panel settlement-create">
          <Field label="Seller">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose a seller</option>
              {sellers.data?.data.map((s: any) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <button
            className="button"
            disabled={!selected || run.isPending}
            onClick={() =>
              run.mutate({
                path: "/admin/sellers/" + selected + "/settle",
                idempotent: true,
              })
            }
          >
            Record sandbox settlement
          </button>
          <small>
            Records eligible delivered lines once. No real funds are
            transferred. Returned lines require manual review.
          </small>
        </div>
      )}
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : query.data?.data.length ? (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Settlement</th>
                <th>Seller</th>
                <th>Date</th>
                <th>Lines</th>
                <th>Status</th>
                <th className="right">Seller amount</th>
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((s: any) => (
                <tr key={s.id}>
                  <td>#{s.id.slice(0, 8)}</td>
                  <td>{s.seller.name}</td>
                  <td>{date(s.createdAt)}</td>
                  <td>{s.items.length}</td>
                  <td>
                    <Badge>{s.status}</Badge>
                  </td>
                  <td className="right">{money(s.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="No settlements yet"
          text="Eligible delivered orders are recorded here when an administrator runs a settlement."
        />
      )}
      {reversals.data?.data.length > 0 && (
        <section className="panel table-wrap" style={{ marginTop: 24 }}>
          <div className="table-toolbar">
            <h2>Refund & commission reversals</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Seller</th>
                <th>Refund</th>
                <th>Sales reversal</th>
                <th>Commission reversal</th>
              </tr>
            </thead>
            <tbody>
              {reversals.data.data.map((m: any) => (
                <tr key={m.id}>
                  <td>{date(m.createdAt)}</td>
                  <td>{m.seller.name}</td>
                  <td>#{m.refundId.slice(0, 8)}</td>
                  <td>{money(m.amount)}</td>
                  <td>{money(m.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
function Administration({ section }: { section: string }) {
  const endpoint: Record<string, string> = {
    sellers: "/admin/sellers",
    users: "/admin/users?limit=100",
    promotions: "/promotions",
    categories: "/categories",
    audit: "/admin/audit?limit=100",
    health: "/admin/health",
    disputes: "/disputes",
  };
  const title: Record<string, string> = {
    sellers: "Our independent sellers",
    users: "Marketplace customers",
    promotions: "Promotions with purpose",
    categories: "A place for every good find",
    audit: "Every change, accounted for.",
    health: "System health",
    disputes: "Dispute resolutions",
  };
  const description: Record<string, string> = {
    sellers: "Approve stores, review their catalog, and manage commissions.",
    users: "Manage customer access without exposing authentication secrets.",
    promotions: "Single-use customer coupons with server-enforced limits.",
    categories: "Organize the collection for better discovery.",
    audit: "An immutable record of important marketplace actions.",
    health: "Dependency status, outbox delivery, and failed background jobs.",
    disputes: "Review escalations and record a clear resolution.",
  };
  const query = useQuery({
    queryKey: ["admin", section],
    queryFn: () => api(endpoint[section]),
  });
  const run = useRun();
  const [dialog, setDialog] = useState(false),
    [resolve, setResolve] = useState<any>(null),
    [editSeller, setEditSeller] = useState<any>(null),
    [suspend, setSuspend] = useState<any>(null);
  const rows = query.data?.data;
  return (
    <>
      <Heading title={title[section]} description={description[section]}>
        <button className="button secondary" onClick={() => query.refetch()}>
          <RefreshCw size={16} />
          Refresh
        </button>
        {["categories", "promotions"].includes(section) && (
          <button className="button" onClick={() => setDialog(true)}>
            <Plus size={16} />
            Add {section === "categories" ? "category" : "promotion"}
          </button>
        )}
      </Heading>
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState error={query.error} />
      ) : section === "health" ? (
        <>
          <div className="metric-grid">
            {[
              ["Database", rows.database ? "Connected" : "Unavailable"],
              ["Redis", rows.redis],
              ["Pending outbox", rows.outboxPending],
              ["Failed jobs", rows.jobs.failed ?? 0],
            ].map(([name, value]) => (
              <div className="metric-card" key={name}>
                <span>{name}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="panel health-panel">
            <h2>Queue activity</h2>
            <div className="queue-counts">
              {Object.entries(rows.jobs).map(([name, value]) => (
                <div key={name}>
                  <Badge>{name}</Badge>
                  <strong>{String(value)}</strong>
                </div>
              ))}
            </div>
            <h2>Failed jobs</h2>
            {rows.failed.length ? (
              rows.failed.map((job: any) => (
                <article className="failed-job" key={job.id}>
                  <strong>
                    {job.name} · #{job.id}
                  </strong>
                  <p>{job.failedReason}</p>
                  <button
                    className="button secondary"
                    disabled={run.isPending}
                    onClick={() =>
                      run.mutate({ path: "/admin/jobs/" + job.id + "/retry" })
                    }
                  >
                    Retry job
                  </button>
                </article>
              ))
            ) : (
              <Empty
                title="No failed jobs"
                text="Failed retry-safe jobs will appear here for controlled recovery."
              />
            )}
          </div>
        </>
      ) : !rows?.length ? (
        <Empty
          title="Nothing waiting here"
          text="New marketplace activity will appear here."
        />
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                {(section === "sellers"
                  ? ["Seller", "Catalog", "Status", "Commission", "Actions"]
                  : section === "users"
                    ? ["Name", "Email", "Role", "Status", "Actions"]
                    : section === "promotions"
                      ? [
                          "Code",
                          "Discount",
                          "Minimum",
                          "Maximum discount",
                          "Expires",
                        ]
                      : section === "categories"
                        ? ["Name", "Slug", "Category ID"]
                        : section === "disputes"
                          ? [
                              "Ticket",
                              "Date",
                              "Status",
                              "Resolution",
                              "Actions",
                            ]
                          : ["When", "Who", "Action", "Resource"]
                ).map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.id ?? row.code}>
                  {section === "sellers" ? (
                    <>
                      <td>
                        <strong>{row.name}</strong>
                        <small>{row.user.email}</small>
                      </td>
                      <td>{row._count.products} products</td>
                      <td>
                        <Badge>{row.status}</Badge>
                      </td>
                      <td>{(row.commissionBps / 100).toFixed(2)}%</td>
                      <td>
                        <button
                          className="text-link"
                          onClick={() => setEditSeller(row)}
                        >
                          Manage seller
                        </button>
                      </td>
                    </>
                  ) : section === "users" ? (
                    <>
                      <td>{row.name}</td>
                      <td>{row.email}</td>
                      <td>
                        <Badge>{row.role}</Badge>
                      </td>
                      <td>
                        <Badge>{row.active ? "ACTIVE" : "SUSPENDED"}</Badge>
                      </td>
                      <td>
                        <button
                          className="text-link"
                          onClick={() => setSuspend(row)}
                        >
                          {row.active ? "Suspend" : "Reactivate"}
                        </button>
                      </td>
                    </>
                  ) : section === "promotions" ? (
                    <>
                      <td>
                        <strong>{row.code}</strong>
                      </td>
                      <td>{row.discountBps / 100}%</td>
                      <td>{money(row.minSubtotal)}</td>
                      <td>{money(row.maxDiscount)}</td>
                      <td>{date(row.endsAt)}</td>
                    </>
                  ) : section === "categories" ? (
                    <>
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td>{row.slug}</td>
                      <td>
                        <code>{row.id}</code>
                      </td>
                    </>
                  ) : section === "disputes" ? (
                    <>
                      <td>
                        {row.ticket.subject}
                        <small>#{row.ticketId.slice(0, 8)}</small>
                      </td>
                      <td>{date(row.createdAt)}</td>
                      <td>
                        <Badge>{row.status}</Badge>
                      </td>
                      <td>{row.resolution ?? "Awaiting review"}</td>
                      <td>
                        {row.status !== "RESOLVED" && (
                          <button
                            className="text-link"
                            onClick={() => setResolve(row)}
                          >
                            Resolve
                          </button>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{new Date(row.createdAt).toLocaleString("en-IN")}</td>
                      <td>{row.user?.name ?? "System worker"}</td>
                      <td>
                        <Badge>{row.action}</Badge>
                      </td>
                      <td>
                        <code>{row.resourceId}</code>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && (
        <Modal
          title={section === "categories" ? "Add category" : "Create promotion"}
          close={() => setDialog(false)}
        >
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const data: any = Object.fromEntries(
                new FormData(e.currentTarget),
              );
              if (section === "promotions") {
                for (const n of ["discountBps", "minSubtotal", "maxDiscount"])
                  data[n] = Number(data[n]);
                data.endsAt = new Date(data.endsAt).toISOString();
              }
              try {
                await run.mutateAsync({
                  path: "/admin/" + section,
                  body: data,
                });
                setDialog(false);
              } catch {}
            }}
          >
            {section === "categories" ? (
              <>
                <Field label="Category name">
                  <input name="name" required minLength={2} maxLength={200} />
                </Field>
                <Field label="URL slug">
                  <input
                    name="slug"
                    required
                    minLength={2}
                    pattern="[a-z0-9-]+"
                    placeholder="home-living"
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Coupon code">
                  <input
                    name="code"
                    required
                    minLength={3}
                    maxLength={40}
                    pattern="[A-Z0-9]+"
                  />
                </Field>
                <Field label="Discount (basis points; 1000 = 10%)">
                  <input
                    type="number"
                    name="discountBps"
                    min={1}
                    max={5000}
                    required
                  />
                </Field>
                <Field label="Minimum subtotal (paise)">
                  <input type="number" name="minSubtotal" min={0} required />
                </Field>
                <Field label="Maximum discount (paise)">
                  <input type="number" name="maxDiscount" min={1} required />
                </Field>
                <Field label="Expiry">
                  <input type="datetime-local" name="endsAt" required />
                </Field>
              </>
            )}
            <button className="button" disabled={run.isPending}>
              Create {section === "categories" ? "category" : "promotion"}
            </button>
          </form>
        </Modal>
      )}
      {editSeller && (
        <Modal
          title={"Manage " + editSeller.name}
          close={() => setEditSeller(null)}
        >
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                await run.mutateAsync({
                  path: "/admin/sellers/" + editSeller.id,
                  method: "PATCH",
                  body: {
                    status: form.get("status"),
                    commissionBps: Number(form.get("commissionBps")),
                  },
                });
                setEditSeller(null);
              } catch {}
            }}
          >
            <Field label="Seller status">
              <select name="status" defaultValue={editSeller.status}>
                {["PENDING", "APPROVED", "SUSPENDED"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Commission (basis points)">
              <input
                type="number"
                name="commissionBps"
                min={0}
                max={5000}
                defaultValue={editSeller.commissionBps}
                required
              />
            </Field>
            <button className="button" disabled={run.isPending}>
              Save seller settings
            </button>
          </form>
        </Modal>
      )}
      {suspend && (
        <Modal
          title={suspend.active ? "Suspend account?" : "Reactivate account?"}
          close={() => setSuspend(null)}
        >
          <div className="stack">
            <p>
              {suspend.name} · {suspend.email}. Refresh sessions will be revoked
              and API access will follow the new status.
            </p>
            <button
              className="button"
              disabled={run.isPending}
              onClick={async () => {
                try {
                  await run.mutateAsync({
                    path: "/admin/users/" + suspend.id,
                    method: "PATCH",
                    body: { active: !suspend.active },
                  });
                  setSuspend(null);
                } catch {}
              }}
            >
              Confirm account change
            </button>
          </div>
        </Modal>
      )}
      {resolve && (
        <Modal title="Resolve dispute" close={() => setResolve(null)}>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await run.mutateAsync({
                  path: "/disputes/" + resolve.id,
                  body: {
                    resolution: new FormData(e.currentTarget).get("resolution"),
                  },
                  method: "PATCH",
                });
                setResolve(null);
              } catch {}
            }}
          >
            <p>
              {resolve.ticket.subject}: {resolve.ticket.message}
            </p>
            <Field label="Resolution">
              <textarea
                name="resolution"
                minLength={10}
                maxLength={3000}
                required
              />
            </Field>
            <button className="button" disabled={run.isPending}>
              Record resolution
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
