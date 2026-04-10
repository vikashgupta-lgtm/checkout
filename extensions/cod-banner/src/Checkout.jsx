import '@shopify/ui-extensions/preact';
import { render } from "preact";

export default async () => {
  render(<Extension />, document.body)
};

function Extension() {
  return (
    <s-banner heading="Cash on Delivery Options" tone="info">
      <s-stack gap="base">
        <s-text>
          Partial Cash on Delivery limits may actively apply to this checkout based on Store settings. If you do not see the COD option, your cart total has likely exceeded the allowed limits!
        </s-text>
      </s-stack>
    </s-banner>
  );
}