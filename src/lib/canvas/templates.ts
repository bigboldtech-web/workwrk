// Starter templates for the system-design canvas. Each is a semantic
// DiagramSpec (never pixels) — specToScene lays it out, so a template drops in
// as a real, editable diagram identical in shape to what the AI produces.
//
// Pure + dependency-free (imports only the spec type), so it's safe to call
// from the client and trivially unit-testable.

import type { DiagramSpec } from "./from-spec";

export interface CanvasTemplate {
  id: string;
  label: string;
  blurb: string;
  spec: DiagramSpec;
}

// 1) Microservices — a gateway fronting independent services, each owning its
//    data store, with async work off a queue and a shared cache.
const MICROSERVICES: DiagramSpec = {
  title: "Microservices",
  nodes: [
    { id: "client", label: "Client", kind: "actor" },
    { id: "gateway", label: "API Gateway", kind: "gateway", group: "edge" },
    { id: "auth", label: "Auth Service", kind: "service", group: "services" },
    { id: "orders", label: "Orders Service", kind: "service", group: "services" },
    { id: "payments", label: "Payments Service", kind: "service", group: "services" },
    { id: "authdb", label: "Auth DB", kind: "database", group: "data" },
    { id: "ordersdb", label: "Orders DB", kind: "database", group: "data" },
    { id: "paymentsdb", label: "Payments DB", kind: "database", group: "data" },
    { id: "queue", label: "Message Queue", kind: "queue", group: "async" },
    { id: "notifier", label: "Notification Worker", kind: "service", group: "async" },
    { id: "cache", label: "Redis Cache", kind: "cache", group: "data" },
    { id: "stripe", label: "Stripe", kind: "external" },
  ],
  edges: [
    { from: "client", to: "gateway", label: "HTTPS" },
    { from: "gateway", to: "auth", label: "verify" },
    { from: "gateway", to: "orders", label: "REST" },
    { from: "gateway", to: "payments", label: "REST" },
    { from: "auth", to: "authdb", label: "read / write" },
    { from: "orders", to: "ordersdb", label: "read / write" },
    { from: "payments", to: "paymentsdb", label: "read / write" },
    { from: "orders", to: "cache", label: "cache" },
    { from: "orders", to: "queue", label: "order.placed" },
    { from: "queue", to: "notifier", label: "consume" },
    { from: "payments", to: "stripe", label: "charge" },
  ],
  groups: [
    { id: "edge", label: "Edge" },
    { id: "services", label: "Services" },
    { id: "data", label: "Data" },
    { id: "async", label: "Async" },
  ],
};

// 2) 3-tier web app — the classic presentation / application / data split
//    behind a CDN + load balancer, with a read replica and a cache.
const THREE_TIER: DiagramSpec = {
  title: "3-Tier Web App",
  nodes: [
    { id: "browser", label: "Browser", kind: "actor" },
    { id: "cdn", label: "CDN", kind: "cloud", group: "edge" },
    { id: "lb", label: "Load Balancer", kind: "gateway", group: "edge" },
    { id: "web", label: "Web Tier", kind: "service", group: "app" },
    { id: "app", label: "App Tier", kind: "service", group: "app" },
    { id: "cache", label: "Redis Cache", kind: "cache", group: "app" },
    { id: "primary", label: "Primary DB", kind: "database", group: "data" },
    { id: "replica", label: "Read Replica", kind: "database", group: "data" },
  ],
  edges: [
    { from: "browser", to: "cdn", label: "static" },
    { from: "browser", to: "lb", label: "HTTPS" },
    { from: "lb", to: "web", label: "route" },
    { from: "web", to: "app", label: "API" },
    { from: "app", to: "cache", label: "cache" },
    { from: "app", to: "primary", label: "write" },
    { from: "app", to: "replica", label: "read" },
    { from: "primary", to: "replica", label: "replicate" },
  ],
  groups: [
    { id: "edge", label: "Edge" },
    { id: "app", label: "Application" },
    { id: "data", label: "Data" },
  ],
};

// 3) Event-driven — producers publish to a bus, independent consumers project
//    into their own sinks (fan-out, no direct coupling).
const EVENT_DRIVEN: DiagramSpec = {
  title: "Event-Driven",
  nodes: [
    { id: "webapp", label: "Web App", kind: "service", group: "producers" },
    { id: "mobile", label: "Mobile App", kind: "service", group: "producers" },
    { id: "bus", label: "Event Bus (Kafka)", kind: "queue", group: "bus" },
    { id: "analytics", label: "Analytics", kind: "service", group: "consumers" },
    { id: "search", label: "Search Indexer", kind: "service", group: "consumers" },
    { id: "email", label: "Email Worker", kind: "service", group: "consumers" },
    { id: "warehouse", label: "Data Warehouse", kind: "database", group: "sinks" },
    { id: "es", label: "Elasticsearch", kind: "database", group: "sinks" },
    { id: "ses", label: "Email Provider", kind: "external" },
  ],
  edges: [
    { from: "webapp", to: "bus", label: "publish" },
    { from: "mobile", to: "bus", label: "publish" },
    { from: "bus", to: "analytics", label: "subscribe" },
    { from: "bus", to: "search", label: "subscribe" },
    { from: "bus", to: "email", label: "subscribe" },
    { from: "analytics", to: "warehouse", label: "load" },
    { from: "search", to: "es", label: "index" },
    { from: "email", to: "ses", label: "send" },
  ],
  groups: [
    { id: "producers", label: "Producers" },
    { id: "bus", label: "Event Bus" },
    { id: "consumers", label: "Consumers" },
    { id: "sinks", label: "Sinks" },
  ],
};

// 4) ER schema — a small e-commerce data model as real tables with typed
//    columns, PK/FK markers, and crow's-foot cardinality on the relationships.
const ER_SCHEMA: DiagramSpec = {
  title: "E-commerce Schema",
  nodes: [
    { id: "users", label: "users", fields: [
      { name: "id", type: "uuid", key: "pk" },
      { name: "email", type: "text" },
      { name: "name", type: "text" },
      { name: "created_at", type: "timestamp" },
    ] },
    { id: "orders", label: "orders", fields: [
      { name: "id", type: "uuid", key: "pk" },
      { name: "user_id", type: "uuid", key: "fk" },
      { name: "status", type: "text" },
      { name: "total", type: "numeric" },
      { name: "created_at", type: "timestamp" },
    ] },
    { id: "order_items", label: "order_items", fields: [
      { name: "id", type: "uuid", key: "pk" },
      { name: "order_id", type: "uuid", key: "fk" },
      { name: "product_id", type: "uuid", key: "fk" },
      { name: "quantity", type: "int" },
      { name: "unit_price", type: "numeric" },
    ] },
    { id: "products", label: "products", fields: [
      { name: "id", type: "uuid", key: "pk" },
      { name: "sku", type: "text" },
      { name: "name", type: "text" },
      { name: "price", type: "numeric" },
    ] },
  ],
  edges: [
    { from: "orders", to: "users", label: "N:1" },
    { from: "order_items", to: "orders", label: "N:1" },
    { from: "order_items", to: "products", label: "N:1" },
  ],
};

export const CANVAS_TEMPLATES: CanvasTemplate[] = [
  { id: "microservices", label: "Microservices", blurb: "Gateway, services, per-service DBs, a queue and cache", spec: MICROSERVICES },
  { id: "three-tier", label: "3-tier web app", blurb: "CDN, load balancer, app tier, primary + read replica", spec: THREE_TIER },
  { id: "event-driven", label: "Event-driven", blurb: "Producers, an event bus and fan-out consumers", spec: EVENT_DRIVEN },
  { id: "er-schema", label: "ER schema", blurb: "E-commerce tables with keys and cardinality", spec: ER_SCHEMA },
];
