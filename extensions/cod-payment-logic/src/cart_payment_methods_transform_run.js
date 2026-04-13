// @ts-check

/**
 * @typedef {import("../generated/api").CartPaymentMethodsTransformRunInput} CartPaymentMethodsTransformRunInput
 * @typedef {import("../generated/api").CartPaymentMethodsTransformRunResult} CartPaymentMethodsTransformRunResult
 */

/**
 * @type {CartPaymentMethodsTransformRunResult}
 */
const NO_CHANGES = {
  operations: [],
};

/**
 * @param {import("../generated/api").RunInput} input
 * @returns {import("../generated/api").FunctionRunResult}
 */
export function cartPaymentMethodsTransformRun(input) {
  const configuration = JSON.parse(
    input?.paymentCustomization?.metafield?.value ?? "{}"
  );

  // If no config, do nothing
  if (!configuration.cod) {
    return NO_CHANGES;
  }

  const operations = [];
  const cartTotal = parseFloat(input.cart.cost.totalAmount.amount);
  const zipCode = input.cart.deliveryGroups?.[0]?.deliveryAddress?.zip || "";

  // Helper to identify method types
  const getMethodType = (name) => {
    const n = name.toLowerCase();
    if (n.includes("cash on delivery") || n.includes("cod")) return "cod";
    if (n.includes("upi") || n.includes("paynow") || n.includes("phonepe") || n.includes("paytm")) return "upi";
    if (n.includes("card") || n.includes("visa") || n.includes("mastercard")) return "card";
    if (n.includes("net banking") || n.includes("netbanking")) return "net";
    if (n.includes("wallet")) return "wallet";
    if (n.includes("bnpl") || n.includes("emi") || n.includes("simpl")) return "bnpl";
    return null;
  };

  input.paymentMethods.forEach((method) => {
    const type = getMethodType(method.name);
    if (!type) return;

    // 1. Check Visibility Toggles
    const methodConfig = configuration.payments.methods.find(m => m.id === type);
    if (methodConfig && methodConfig.enabled === false) {
      operations.push({ hide: { paymentMethodId: method.id } });
      return; // If hidden, no need to check other rules
    }

    // 2. COD Specific Rules
    if (type === "cod") {
      let shouldHideCOD = false;

      // Global Master switch
      if (configuration.cod.globalEnable === false || configuration.cod.enabled === false) {
        shouldHideCOD = true;
      }

      // Order total limits
      if (cartTotal < (configuration.cod.minOrder || 0)) shouldHideCOD = true;
      if (configuration.cod.maxOrder > 0 && cartTotal > configuration.cod.maxOrder) shouldHideCOD = true;

      // Pincode blocklist
      if (configuration.cod.blockedPincodes?.includes(zipCode)) shouldHideCOD = true;

      if (shouldHideCOD) {
        operations.push({ hide: { paymentMethodId: method.id } });
        return;
      }
    }

    // 3. Renaming (if not hidden)
    if (methodConfig && methodConfig.label && methodConfig.label !== method.name) {
      operations.push({
        rename: {
          paymentMethodId: method.id,
          name: methodConfig.label
        }
      });
    }
  });

  return {
    operations,
  };
};