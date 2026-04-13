import prisma from "../db.server";

const DEFAULT_CONFIG = {
  payments: {
    methods: [
      { id: 'cod', name: "Cash on Delivery", enabled: true, label: "Cash on Delivery" },
      { id: 'upi', name: "UPI / PayNow", enabled: true, label: "Pay via UPI" },
      { id: 'card', name: "Credit / Debit Card", enabled: true, label: "Credit / Debit Card" },
      { id: 'net', name: "Net banking", enabled: true, label: "Net banking" },
      { id: 'wallet', name: "Wallets (Paytm, PhonePe)", enabled: true, label: "Wallets (Paytm, PhonePe)" },
      { id: 'bnpl', name: "Buy now, pay later", enabled: true, label: "Buy now, pay later" },
    ]
  },
  cod: {
    enabled: true,
    globalEnable: true,
    blockPrepaid: false,
    requireOTP: false,
    minOrder: 0,
    maxOrder: 0,
    blockedPincodes: []
  },
  partialCod: {
    enabled: true,
    upfrontPercentage: 0,
    upfrontLabel: "Pay now (advance)",
    deliveryLabel: "Pay on delivery",
    customerNote: "",
    minOrder: 0,
    excludeSale: false,
    allowWithCoupon: true
  },
  rules: []
};

export async function getAppConfig(shop) {
  let configRecord = await prisma.appConfig.findUnique({
    where: { shop },
  });

  if (!configRecord) {
    configRecord = await prisma.appConfig.create({
      data: {
        shop,
        settings: JSON.stringify(DEFAULT_CONFIG),
      },
    });
  }

  const dbSettings = JSON.parse(configRecord.settings);

  // Return merge of DEFAULT_CONFIG and dbSettings to ensure all keys exist
  // We strictly trust the DB for rules and pincodes to allow empty states
  return {
    ...DEFAULT_CONFIG,
    ...dbSettings,
    rules: dbSettings.rules || [],
    cod: {
      ...DEFAULT_CONFIG.cod,
      ...(dbSettings.cod || {}),
      blockedPincodes: dbSettings.cod?.blockedPincodes || []
    }
  };
}

export async function updateAppConfig(shop, newSettings, admin) {
  const currentSettings = await getAppConfig(shop);
  const updatedSettings = { ...currentSettings, ...newSettings };

  await prisma.appConfig.update({
    where: { shop },
    data: {
      settings: JSON.stringify(updatedSettings),
    },
  });

  // Sync to Shopify Metafield for the Payment Customization Function
  await syncToShopify(shop, updatedSettings, admin);

  return updatedSettings;
}

async function syncToShopify(shop, settings, admin) {
  let shopifyAdmin = admin;

  // If we don't have an authenticated admin client, try to get an unauthenticated one
  if (!shopifyAdmin) {
    try {
      const { admin: unauthAdmin } = await shopify.unauthenticated.admin(shop);
      shopifyAdmin = unauthAdmin;
    } catch (e) {
      console.error("Failed to get unauthenticated admin client for shop:", shop, e);
      return; // Can't sync if we don't have admin access
    }
  }

  // 1. Find the existing payment customization
  const response = await shopifyAdmin.graphql(`
    query {
      paymentCustomizations(first: 1) {
        edges {
          node {
            id
          }
        }
      }
    }
  `);

  const responseJson = await response.json();
  const edges = responseJson.data?.paymentCustomizations?.edges || [];

  if (edges.length > 0) {
    const customizationId = edges[0].node.id;

    // 2. Update the metafield
    await shopifyAdmin.graphql(`
      mutation paymentCustomizationUpdate($id: ID!, $input: PaymentCustomizationInput!) {
        paymentCustomizationUpdate(id: $id, paymentCustomization: $input) {
          paymentCustomization { id }
          userErrors { field message }
        }
      }
    `, {
      variables: {
        id: customizationId,
        input: {
          metafields: [{
            namespace: "$app:cod-payment-logic",
            key: "function-configuration",
            type: "json",
            value: JSON.stringify(settings),
          }]
        }
      }
    });
  }
}
