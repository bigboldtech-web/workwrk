import { NextRequest } from "next/server";
import { applySubscriptionEvent, verifyWebhook } from "@/services/billing";

/**
 * Stripe webhook receiver.
 *
 * Events handled:
 *   • customer.subscription.created
 *   • customer.subscription.updated
 *   • customer.subscription.deleted
 *   • checkout.session.completed  (redundant with subscription.created
 *     but fires sooner; we also sync on it)
 *
 * To register the webhook, in the Stripe dashboard point it at
 * `https://<domain>/api/billing/webhook` and copy the signing secret
 * into STRIPE_WEBHOOK_SECRET.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();

  const event = verifyWebhook(raw, sig);
  if (!event) {
    return Response.json({ error: "Invalid signature or Stripe not configured" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        // The event's own time: an older event delivered late is skipped.
        await applySubscriptionEvent(event.data.object, new Date(event.created * 1000));
        break;

      case "checkout.session.completed": {
        // The subscription ID is on the session — fetch and apply.
        const session = event.data.object as { subscription?: string | { id: string } };
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (subId) {
          // Lazy-import to avoid the circular with `stripe`.
          const { stripe } = await import("@/services/billing");
          if (stripe) {
            // Fetched now, so at least as new as this event: stamped with the
            // event's time (Stripe's clock, never this server's, which may run
            // ahead and would then skip the real events that follow).
            const sub = await stripe.subscriptions.retrieve(subId);
            await applySubscriptionEvent(sub, new Date(event.created * 1000));
          }
        }
        break;
      }

      default:
        // Silently ignore unhandled events. Stripe is happy with 2xx.
        break;
    }
    return Response.json({ received: true });
  } catch (err) {
    console.error("[Stripe webhook] failed:", err);
    return Response.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
