import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import premiumStyles from "../styles/premium.css?url";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: premiumStyles }
];

export const loader = async ({ request }) => {
  const { authenticate } = await import("../shopify.server");
  const { default: prisma } = await import("../db.server");

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
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "", shop });
};

export default function App() {
  const { apiKey, shop } = useLoaderData();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to={`/app/dashboard?shop=${shop}`} rel="home">
          Home
        </Link>
        <Link to="/app/dashboard">Dashboard</Link>
        <Link to="/app/dashboard/payments">Payments</Link>
        <Link to="/app/additional">Additional page</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  const error = useRouteError();
  return boundary.error(error);
}
