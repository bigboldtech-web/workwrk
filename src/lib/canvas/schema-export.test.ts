import { describe, expect, it } from "vitest";
import { schemaFromScene } from "./schema-export";
import { specToScene } from "./from-spec";
import { CANVAS_TEMPLATES } from "./templates";
import { emptyScene } from "./scene";

describe("schemaFromScene", () => {
  const erSpec = CANVAS_TEMPLATES.find((t) => t.id === "er-schema")!.spec;

  it("emits CREATE TABLE with a primary key for each table", () => {
    const { sql, tableCount } = schemaFromScene(specToScene(erSpec));
    expect(tableCount).toBe(4);
    expect(sql).toContain('CREATE TABLE "users"');
    expect(sql).toContain('CREATE TABLE "orders"');
    expect(sql).toContain('"id" uuid PRIMARY KEY');
    // typed columns map to Postgres types
    expect(sql).toContain('"created_at" timestamptz');
    expect(sql).toContain('"total" numeric');
  });

  it("infers foreign keys from fk fields + the drawn relationships", () => {
    const { sql } = schemaFromScene(specToScene(erSpec));
    // orders.user_id → users.id
    expect(sql).toMatch(/FOREIGN KEY \("user_id"\) REFERENCES "users" \("id"\)/);
    // order_items.order_id → orders.id and product_id → products.id
    expect(sql).toMatch(/FOREIGN KEY \("order_id"\) REFERENCES "orders" \("id"\)/);
    expect(sql).toMatch(/FOREIGN KEY \("product_id"\) REFERENCES "products" \("id"\)/);
  });

  it("emits a Prisma schema with models, @id, and both relation sides", () => {
    const { prisma } = schemaFromScene(specToScene(erSpec));
    expect(prisma).toContain("model User {");
    expect(prisma).toContain("model OrderItem {");
    expect(prisma).toMatch(/id String @id @db\.Uuid/);
    // child relation field + scalar reference
    expect(prisma).toMatch(/order Order @relation\(fields: \[order_id\], references: \[id\]\)/);
    // back-relation on the parent
    expect(prisma).toMatch(/model Order \{[\s\S]*OrderItem\[\]/);
  });

  it("returns a friendly note when there are no tables", () => {
    const { sql, prisma, tableCount } = schemaFromScene(emptyScene());
    expect(tableCount).toBe(0);
    expect(sql).toContain("Add ER tables");
    expect(prisma).toContain("Add ER tables");
  });
});
