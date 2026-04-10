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

  const maxTotal = parseFloat(configuration.maxCartTotal ?? "0");

  if (maxTotal === 0) {
    return NO_CHANGES;
  }

  const cartTotal = parseFloat(input.cart.cost.totalAmount.amount);

  if (cartTotal > maxTotal) {
    const hideOperations = input.paymentMethods
      .filter((method) => method.name.toLowerCase().includes("cash on delivery") || method.name.toLowerCase().includes("cod"))
      .map((method) => ({
        hide: {
          paymentMethodId: method.id,
        },
      }));
      
    if (hideOperations.length > 0) {
      return {
        operations: hideOperations,
      };
    }
  }

  return NO_CHANGES;
};