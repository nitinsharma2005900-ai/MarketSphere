"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { action } from "./providers";
import { Modal, Field, money } from "./ui";
export function SkuManager({
  product,
  close,
}: {
  product: any;
  close: () => void;
}) {
  const client = useQueryClient();
  const [add, setAdd] = useState(false);
  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: any }) =>
      id
        ? action("/seller/variants/" + id, body, "PATCH")
        : action("/seller/products/" + product.id + "/variants", body),
    onSuccess: () => {
      toast.success("SKU saved");
      void client.invalidateQueries();
      close();
    },
  });
  return (
    <Modal title={"SKUs · " + product.name} close={close}>
      <div className="stack">
        {product.variants.map((v: any) => (
          <form
            className="panel"
            style={{ padding: 18 }}
            key={v.id}
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              save.mutate({
                id: v.id,
                body: {
                  price: Number(data.get("price")),
                  name: data.get("name"),
                },
              });
            }}
          >
            <strong>{v.sku}</strong>
            <p className="muted">Current price {money(v.price)}</p>
            <Field label="Variant name">
              <input name="name" defaultValue={v.name} minLength={2} required />
            </Field>
            <Field label="Price (paise)">
              <input
                name="price"
                type="number"
                min={1}
                max={100000000}
                defaultValue={v.price}
                required
              />
            </Field>
            <button className="button secondary" disabled={save.isPending}>
              Update SKU
            </button>
          </form>
        ))}
        {add ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              const data = Object.fromEntries(new FormData(e.currentTarget));
              save.mutate({ body: { ...data, price: Number(data.price) } });
            }}
          >
            <Field label="New SKU">
              <input name="sku" required minLength={3} pattern="[A-Z0-9_-]+" />
            </Field>
            <Field label="Variant name">
              <input name="name" minLength={2} required />
            </Field>
            <Field label="Price (paise)">
              <input
                name="price"
                type="number"
                min={1}
                max={100000000}
                required
              />
            </Field>
            <button className="button" disabled={save.isPending}>
              Create SKU
            </button>
          </form>
        ) : (
          <button className="button" onClick={() => setAdd(true)}>
            Add another variant
          </button>
        )}
        <small className="muted">
          Use Inventory → Receive a SKU to add initial stock after creating a
          variant.
        </small>
      </div>
    </Modal>
  );
}
