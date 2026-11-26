"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Search,
  ShoppingBag,
  UserRound,
  ChevronDown,
  Globe2,
  ShieldCheck,
  Package,
  Menu,
  LogOut,
  Sparkles,
  Store,
  LayoutDashboard,
  Boxes,
  Truck,
  LifeBuoy,
  Users,
  ReceiptText,
  Tags,
  ScrollText,
  Activity,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, useAuth } from "./providers";
import { useState } from "react";
export function Logo() {
  return (
    <Link className="logo" href="/">
      <span className="brandmark">
        <Globe2 size={23} />
      </span>
      Market<span>Sphere</span>
      <span className="logo-dot" />
    </Link>
  );
}
export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const path = usePathname(),
    router = useRouter();
  const [search, setSearch] = useState(""),
    [open, setOpen] = useState(false);
  const cart = useQuery({
    queryKey: ["cart"],
    queryFn: () => api("/cart"),
    enabled: user?.role === "CUSTOMER",
  });
  const portal = path.startsWith("/portal");
  const nav = [
    {
      label: "Overview",
      href: "/portal",
      icon: LayoutDashboard,
      roles: ["SELLER", "ADMIN", "WAREHOUSE", "SUPPORT"],
    },
    {
      label: "Products",
      href: "/portal/products",
      icon: Store,
      roles: ["SELLER", "ADMIN"],
    },
    {
      label: "Orders",
      href: "/portal/orders",
      icon: ShoppingBag,
      roles: ["SELLER", "ADMIN", "WAREHOUSE"],
    },
    {
      label: "Inventory",
      href: "/portal/inventory",
      icon: Boxes,
      roles: ["SELLER", "ADMIN", "WAREHOUSE"],
    },
    {
      label: "Returns",
      href: "/portal/returns",
      icon: ReceiptText,
      roles: ["SELLER", "ADMIN", "WAREHOUSE", "SUPPORT"],
    },
    {
      label: "Support tickets",
      href: "/portal/tickets",
      icon: LifeBuoy,
      roles: ["SUPPORT", "ADMIN"],
    },
    {
      label: "Disputes",
      href: "/portal/disputes",
      icon: ShieldCheck,
      roles: ["SUPPORT", "ADMIN"],
    },
    {
      label: "Settlements",
      href: "/portal/settlements",
      icon: ReceiptText,
      roles: ["SELLER", "ADMIN"],
    },
    {
      label: "Sellers",
      href: "/portal/sellers",
      icon: Users,
      roles: ["ADMIN"],
    },
    {
      label: "Customers",
      href: "/portal/users",
      icon: UserRound,
      roles: ["ADMIN"],
    },
    {
      label: "Promotions",
      href: "/portal/promotions",
      icon: Tags,
      roles: ["ADMIN"],
    },
    {
      label: "Categories",
      href: "/portal/categories",
      icon: Boxes,
      roles: ["ADMIN"],
    },
    {
      label: "Audit trail",
      href: "/portal/audit",
      icon: ScrollText,
      roles: ["ADMIN"],
    },
    {
      label: "System health",
      href: "/portal/health",
      icon: Activity,
      roles: ["ADMIN"],
    },
  ];
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="announcement">
        <span>A world of independent brands. One thoughtful marketplace.</span>
        <Link href="/catalog">
          Discover something good <Sparkles size={13} />
        </Link>
      </div>
      <header className="site-header">
        <div className="header-inner">
          <Logo />
          <nav className="desktop-nav">
            <Link className={path === "/" ? "active" : ""} href="/">
              Discover
            </Link>
            <Link
              className={path === "/catalog" ? "active" : ""}
              href="/catalog"
            >
              Shop all
            </Link>
            <Link href="/catalog?sort=newest">New arrivals</Link>
          </nav>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              router.push("/catalog?search=" + encodeURIComponent(search));
            }}
          >
            <Search size={18} />
            <input
              aria-label="Search products"
              placeholder="Search your next good find"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>Enter</kbd>
          </form>
          <div className="header-actions">
            {user && user.role !== "CUSTOMER" ? (
              <Link className="account-link" href="/portal">
                <LayoutDashboard size={19} />
                <span>Workspace</span>
              </Link>
            ) : (
              <Link
                className="account-link"
                href={user ? "/account" : "/login"}
              >
                <UserRound size={20} />
                <span>{user ? user.name.split(" ")[0] : "Sign in"}</span>
              </Link>
            )}
            <Link className="cart-link" href="/cart" aria-label="Shopping bag">
              <ShoppingBag size={21} />
              <span>
                {cart.data?.data?.items?.reduce(
                  (n: number, i: any) => n + i.quantity,
                  0,
                ) ?? 0}
              </span>
            </Link>
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => setOpen(!open)}
            >
              <Menu />
            </button>
          </div>
        </div>
        {open && (
          <nav className="mobile-nav">
            <Link href="/catalog" onClick={() => setOpen(false)}>
              Shop all
            </Link>
            <Link
              href={user?.role === "CUSTOMER" ? "/orders" : "/portal"}
              onClick={() => setOpen(false)}
            >
              Your workspace
            </Link>
            <Link href="/support" onClick={() => setOpen(false)}>
              Support
            </Link>
          </nav>
        )}
      </header>
      {portal ? (
        <div className="portal-shell">
          <aside className="portal-sidebar">
            <div className="workspace-label">WORKSPACE</div>
            <div className="workspace-person">
              <span>{user?.name.slice(0, 1) ?? "M"}</span>
              <div>
                <strong>{user?.name ?? "MarketSphere"}</strong>
                <small>{user?.role.toLowerCase()} account</small>
              </div>
            </div>
            <nav>
              {nav
                .filter((n) => user && n.roles.includes(user.role))
                .map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={path === n.href ? "selected" : ""}
                  >
                    <n.icon size={18} />
                    {n.label}
                  </Link>
                ))}
            </nav>
            <div className="sidebar-bottom">
              <Link href="/">
                <Store size={18} />
                Visit storefront
              </Link>
              <button
                onClick={() => {
                  logout();
                  router.push("/login");
                }}
              >
                <LogOut size={18} />
                Sign out
              </button>
              <small>Local sandbox environment</small>
            </div>
          </aside>
          <main id="main" className="portal-main">
            {children}
          </main>
        </div>
      ) : (
        <>
          <main id="main">{children}</main>
          <section className="trust-strip">
            <div>
              <Truck />
              <span>
                <strong>Considered delivery</strong>
                <small>Follow your order, every step</small>
              </span>
            </div>
            <div>
              <ShieldCheck />
              <span>
                <strong>Shop with confidence</strong>
                <small>Secure sandbox checkout</small>
              </span>
            </div>
            <div>
              <Store />
              <span>
                <strong>Independent by design</strong>
                <small>Discover our community of sellers</small>
              </span>
            </div>
            <div>
              <Package />
              <span>
                <strong>Made for everyday</strong>
                <small>Quality finds, lasting value</small>
              </span>
            </div>
          </section>
          <footer>
            <div>
              <Logo />
              <p>
                Good finds. Independent minds.
                <br />
                Your everyday, a little better.
              </p>
            </div>
            <div>
              <strong>Explore</strong>
              <Link href="/catalog">All products</Link>
              <Link href="/catalog?category=home-living">Home & living</Link>
              <Link href="/catalog?category=electronics">Electronics</Link>
            </div>
            <div>
              <strong>Your MarketSphere</strong>
              <Link href="/orders">Your orders</Link>
              <Link href="/support">Help & support</Link>
              <Link href="/register">Become a seller</Link>
            </div>
            <div>
              <strong>Built on trust</strong>
              <p>
                Synthetic products. Local sandbox payments.
                <br />
                An educational marketplace experience.
              </p>
              <span className="footer-badge">
                <ShieldCheck size={15} />
                Thoughtfully connected
              </span>
            </div>
            <div className="footer-bottom">
              © {new Date().getFullYear()} MarketSphere{" "}
              <span>
                INR · India <ChevronDown size={13} />
              </span>
            </div>
          </footer>
        </>
      )}
    </>
  );
}
