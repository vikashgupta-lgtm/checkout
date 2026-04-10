import { useEffect, useState } from "react";
import { json } from "@remix-run/node";
import { useActionData, useNavigation, useSubmit, useLoaderData, Form } from "@remix-run/react";
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
import { authenticate } from "../shopify.server";
import heroImg from "../assets/hero.png";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(`
    query {
      paymentCustomizations(first: 1) {
        edges {
          node {
            id
            metafield(namespace: "$app:cod-payment-logic", key: "function-configuration") {
              id
              value
            }
          }
        }
      }
    }
  `);

  const responseJson = await response.json();
  const edges = responseJson.data?.paymentCustomizations?.edges || [];

  let existingCustomization = null;
  let maxTotal = "0";

  if (edges.length > 0) {
    existingCustomization = edges[0].node;
    if (existingCustomization.metafield?.value) {
      try {
        const config = JSON.parse(existingCustomization.metafield.value);
        maxTotal = config.maxCartTotal || "0";
      } catch (e) {}
    }
  }

  return json({ existingCustomization, maxTotal });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const maxCartTotal = formData.get("maxCartTotal") || "0";
  const id = formData.get("id");

  const configuration = JSON.stringify({ maxCartTotal });

  if (id && id !== "") {
    const response = await admin.graphql(`
      mutation paymentCustomizationUpdate($id: ID!, $input: PaymentCustomizationInput!) {
        paymentCustomizationUpdate(id: $id, paymentCustomization: $input) {
          paymentCustomization { id }
          userErrors { field message }
        }
      }
    `, {
      variables: {
        id,
        input: {
          metafields: [{
            namespace: "$app:cod-payment-logic",
            key: "function-configuration",
            type: "json",
            value: configuration,
          }]
        }
      }
    });
    const result = await response.json();
    return json({ success: true, errors: result.data.paymentCustomizationUpdate.userErrors });
  } else {
    const functionResponse = await admin.graphql(`
      query {
        shopifyFunctions(first: 10) {
          edges { node { id title } }
        }
      }
    `);
    const functionResponseJson = await functionResponse.json();
    const functions = functionResponseJson.data?.shopifyFunctions?.edges || [];
    if (functions.length === 0) {
      return json({ success: false, errors: [{ message: "No function found. Ensure extension is running." }] });
    }
    const activeFunctionId = functions[0].node.id;
    const response = await admin.graphql(`
      mutation PaymentCustomizationCreate($input: PaymentCustomizationInput!) {
        paymentCustomizationCreate(paymentCustomization: $input) {
          paymentCustomization { id }
          userErrors { field message }
        }
      }
    `, {
      variables: {
        input: {
          title: "Hide COD by Cart Threshold",
          functionId: activeFunctionId,
          enabled: true,
          metafields: [{
            namespace: "$app:cod-payment-logic",
            key: "function-configuration",
            type: "json",
            value: configuration,
          }]
        }
      }
    });
    const result = await response.json();
    return json({ success: true, errors: result.data.paymentCustomizationCreate.userErrors });
  }
};

export default function Index() {
  const { existingCustomization, maxTotal: initialMaxTotal } = useLoaderData();
  const actionData = useActionData();
  const nav = useNavigation();

  const [maxTotal, setMaxTotal] = useState(initialMaxTotal?.toString() || "");

  const isSaving = nav.state === "submitting" || nav.state === "loading";
  const hasErrors = actionData?.errors && actionData.errors.length > 0;

  return (
    <div className="premium-container">
      {/* ── Hero Section ────────────────────────────────────────────────── */}
      <div className="hero-wrapper">
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
              <ul>{actionData.errors.map((error, idx) => <li key={idx}>{error.message}</li>)}</ul>
            </Banner>
          )}

          {actionData?.success && !hasErrors && (
            <Banner tone="success" title="Configuration updated successfully!" />
          )}

          <Form method="post">
            {existingCustomization?.id && <input type="hidden" name="id" value={existingCustomization.id} />}
            <div className="premium-input-group">
              <TextField
                label="Maximum Cart Total for COD"
                type="number"
                name="maxCartTotal"
                value={maxTotal}
                onChange={setMaxTotal}
                helpText="If cart total exceeds this amount, COD will be hidden."
                prefix="$"
                autoComplete="off"
              />
            </div>

            <div style={{ marginTop: '30px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
              <button type="submit" className="custom-button" disabled={isSaving}>
                {isSaving ? "Saving..." : (existingCustomization ? "Update Configuration" : "Activate App Logic")}
              </button>
            </div>
          </Form>
        </BlockStack>
      </div>
      
      <div style={{ textAlign: 'center', marginTop: '40px', color: '#94a3b8', fontSize: '14px' }}>
        &copy; 2026 Smart COD Customizer. Powering modern Shopify stores.
      </div>
    </div>
  );
}
