"use client";
import { usePathname } from "next/navigation";
import { Shell } from "../../components/shell";
import { Storefront, ProductDetail } from "../../components/storefront";
import {
  Login,
  Cart,
  Orders,
  Account,
  Tickets,
} from "../../components/customer";
import { Portal } from "../../components/portal";
export default function Page() {
  const path = usePathname();
  return (
    <Shell>
      {path === "/login" || path === "/register" ? (
        <Login register={path === "/register"} />
      ) : path === "/cart" ? (
        <Cart />
      ) : path === "/orders" ? (
        <Orders />
      ) : path === "/account" ? (
        <Account />
      ) : path === "/support" ? (
        <Tickets />
      ) : path.startsWith("/portal") ? (
        <Portal />
      ) : path.startsWith("/product/") ? (
        <ProductDetail id={path.split("/")[2]} />
      ) : (
        <Storefront catalog={path.startsWith("/catalog")} />
      )}
    </Shell>
  );
}
