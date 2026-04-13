import { useEffect, useState } from "react";
import { json } from "@remix-run/node";
import { useActionData, useNavigation, useSubmit, useLoaderData, Form, Link, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Button,
  Text,
  TextField,
  FormLayout,
  Banner,
} from "@shopify/polaris";
import heroImg from "../assets/hero.png";

export const loader = async ({ request }) => {
  const { default: prisma } = await import("../db.server");
  const { authenticate } = await import("../shopify.server");
  const { getAppConfig } = await import("../models/config.server");

  const url = new URL(request.url);
  let shop = url.searchParams.get("shop");

  if (!shop) {
    const lastSession = await prisma.session.findFirst({
      orderBy: { expires: 'desc' }
    });
    shop = lastSession?.shop;
  }

  if (!shop) {
    throw new Response("Missing shop parameter and no session in DB", { status: 400 });
  }

  await authenticate.admin(request);
  const config = await getAppConfig(shop);
  return json({ shop, config });
};

export const action = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { updateAppConfig } = await import("../models/config.server");

  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const id = formData.get("id");

  // Update both Prisma and Shopify Metafield via helper
  await updateAppConfig(session.shop, { cod: { maxOrder: maxCartTotal } }, admin);

  if (!id || id === "") {
    // If it's the first time, we still need to create the customization itself
    const functionResponse = await admin.graphql(`
      query {
        shopifyFunctions(first: 10) {
          edges { node { id title } }
        }
      }
    `);
    const functionResponseJson = await functionResponse.json();
    const functions = functionResponseJson.data?.shopifyFunctions?.edges || [];
    if (functions.length > 0) {
      const activeFunctionId = functions[0].node.id;
      const config = await getAppConfig(session.shop);
      await admin.graphql(`
        mutation PaymentCustomizationCreate($input: PaymentCustomizationInput!) {
          paymentCustomizationCreate(paymentCustomization: $input) {
            paymentCustomization { id }
            userErrors { field message }
          }
        }
      `, {
        variables: {
          input: {
            title: "CheckoutKit Smart Rules",
            functionId: activeFunctionId,
            enabled: true,
            metafields: [{
              namespace: "$app:cod-payment-logic",
              key: "function-configuration",
              type: "json",
              value: JSON.stringify(config),
            }]
          }
        }
      });
    }
  }

  return json({ success: true, errors: [] });
};

export default function Index() {
  const { existingCustomization, maxTotal: initialMaxTotal } = useLoaderData();
  const actionData = useActionData();
  const nav = useNavigation();
  const navigate = useNavigate();

  const [maxTotal, setMaxTotal] = useState(initialMaxTotal?.toString() || "");

  const isSaving = nav.state === "submitting" || nav.state === "loading";
  const hasErrors = actionData?.errors && actionData?.errors?.length > 0;

  return (
    <Page title="COD Customizer">
      <div className="premium-container" style={{ paddingTop: '0' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
          <Link to="/app/dashboard" className="custom-button" style={{ fontSize: '14px', padding: '10px 24px' }}>
            Open Dashboard →
          </Link>
        </div>
        {/* ── Hero Section ────────────────────────────────────────────────── */}
        <div className="hero-wrapper" style={{ marginTop: '20px' }}>
          <div className="hero-content">
            <span className="hero-badge">v1.2.0 • Premium Edition</span>
            <h1 className="hero-title">Optimize Your Checkout with Smart COD Control</h1>
            <p style={{ fontSize: '18px', opacity: 0.9 }}>
              Increase conversion rates and reduce RTO by dynamically controlling when Cash on Delivery is available.
            </p>
          </div>
          <img src={heroImg} alt="Illustration" className="hero-image" />
        </div>

        {/* ── Feature Grid ────────────────────────────────────────────────── */}
        <div className="feature-grid">
          <div className="feature-card">
            <div className="feature-icon">🚀</div>
            <Text variant="headingMd" as="h3">Smart Interception</Text>
            <Text tone="subdue">Automatically redirects users to your high-converting custom checkout page.</Text>
          </div>
          <div className="feature-card">
            <div className="feature-icon">⚙️</div>
            <Text variant="headingMd" as="h3">Dynamic Thresholds</Text>
            <Text tone="subdue">Set custom cart limits to hide COD for high-value orders instantly.</Text>
          </div>
          <div className="feature-card">
            <div className="feature-icon">💎</div>
            <Text variant="headingMd" as="h3">Premium UI</Text>
            <Text tone="subdue">A beautiful, multi-tenant checkout experience that builds merchant trust.</Text>
          </div>
        </div>

        {/* ── Configuration Section ───────────────────────────────────────── */}
        <div className="premium-card">
          <BlockStack gap="600">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <BlockStack gap="100">
                <Text variant="headingLg" as="h2">COD Payment Rules</Text>
                <Text tone="subdue">Configure your threshold logic below.</Text>
              </BlockStack>
            </div>

            {hasErrors && (
              <Banner tone="critical" title="Errors saving configuration">
                <ul>{actionData.errors?.map((error, idx) => <li key={idx}>{error.message}</li>)}</ul>
              </Banner>
            )}

            {actionData?.success && !hasErrors && (
              <Banner tone="success" title="Configuration updated successfully!" />
            )}
          </BlockStack>
        </div>

        <div style={{ textAlign: 'center', marginTop: '40px', color: '#94a3b8', fontSize: '14px', paddingBottom: '40px' }}>
          &copy; 2026 Smart COD Customizer. Powering modern Shopify stores.
        </div>
      </div>
    </Page>
  );
}
