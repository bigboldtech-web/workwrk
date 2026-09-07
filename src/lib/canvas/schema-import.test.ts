import { describe, expect, it } from "vitest";
import { parseSchema } from "./schema-import";
import { schemaFromScene } from "./schema-export";
import { CANVAS_TEMPLATES } from "./templates";

const erScene = () => CANVAS_TEMPLATES.find((t) => t.id === "er-schema")!.build();

describe("parseSchema — SQL DDL", () => {
  it("parses tables, types, PK and FK", () => {
    const spec = parseSchema(`
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        email text NOT NULL,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE orders (
        id uuid PRIMARY KEY,
        user_id uuid REFERENCES users(id),
        total numeric(10,2)
      );
    `);
    expect(spec).not.toBeNull();
    const users = spec!.nodes.find((n) => n.id === "users")!;
    const orders = spec!.nodes.find((n) => n.id === "orders")!;
    expect(users.fields!.find((f) => f.name === "id")?.key).toBe("pk");
    expect(users.fields!.find((f) => f.name === "created_at")?.type).toBe("timestamp");
    expect(orders.fields!.find((f) => f.name === "user_id")?.key).toBe("fk");
    expect(orders.fields!.find((f) => f.name === "total")?.type).toBe("numeric");
    // a relationship orders -> users
    expect(spec!.edges).toEqual([{ from: "orders", to: "users", label: "N:1" }]);
  });

  it("handles table-level FOREIGN KEY constraints and quoted idents", () => {
    const spec = parseSchema(`
      CREATE TABLE "order_items" (
        "id" uuid PRIMARY KEY,
        "order_id" uuid,
        "product_id" uuid,
        FOREIGN KEY ("order_id") REFERENCES "orders" ("id")
      );
      CREATE TABLE "orders" ( "id" uuid PRIMARY KEY );
    `);
    const oi = spec!.nodes.find((n) => n.id === "order_items")!;
    expect(oi.fields!.find((f) => f.name === "order_id")?.key).toBe("fk");
    expect(spec!.edges).toContainEqual({ from: "order_items", to: "orders", label: "N:1" });
  });
});

describe("parseSchema — Prisma", () => {
  it("parses models, @id, @db types and relations", () => {
    const spec = parseSchema(`
      model User {
        id    String @id @db.Uuid
        email String
        posts Post[]
      }
      model Post {
        id       String @id @db.Uuid
        title    String
        authorId String @db.Uuid
        author   User   @relation(fields: [authorId], references: [id])
      }
    `);
    const post = spec!.nodes.find((n) => n.id === "Post")!;
    expect(post.fields!.find((f) => f.name === "id")?.type).toBe("uuid");
    expect(post.fields!.find((f) => f.name === "authorId")?.key).toBe("fk");
    expect(spec!.edges).toContainEqual({ from: "Post", to: "User", label: "N:1" });
  });
});

describe("round-trip", () => {
  it("export → import reproduces the tables and relationships (SQL)", () => {
    const scene = erScene();
    const { sql } = schemaFromScene(scene);
    const spec = parseSchema(sql)!;
    expect(spec.nodes.map((n) => n.id).sort()).toEqual(["order_items", "orders", "products", "users"]);
    // 3 FK relationships survive the round-trip
    expect(spec.edges!.length).toBe(3);
    const oi = spec.nodes.find((n) => n.id === "order_items")!;
    expect(oi.fields!.filter((f) => f.key === "fk").map((f) => f.name).sort()).toEqual(["order_id", "product_id"]);
  });

  it("export → import reproduces the tables and relationships (Prisma)", () => {
    const scene = erScene();
    const { prisma } = schemaFromScene(scene);
    const spec = parseSchema(prisma)!;
    expect(spec.nodes.length).toBe(4);
    expect(spec.edges!.length).toBe(3);
  });

  it("returns null for junk", () => {
    expect(parseSchema("hello world")).toBeNull();
    expect(parseSchema("")).toBeNull();
  });
});
