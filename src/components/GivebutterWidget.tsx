"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

// Givebutter floating Donate button. Same campaign + account ids as
// creativegrowth.org so donations funnel to the existing CG campaign.
// The loader script registers the <givebutter-widget> custom element;
// rendering the markup via dangerouslySetInnerHTML keeps TypeScript
// happy without JSX intrinsic-element augmentation.
const ACCOUNT = "WZJTcxrPdsZ0MAnv";
const CAMPAIGN = "24D67J";
const LOADER_SRC = `https://widgets.givebutter.com/latest.umd.cjs?acct=${ACCOUNT}&p=other`;
const WIDGET_ID = "Ly2Qwg";

export default function GivebutterWidget() {
  const pathname = usePathname();
  if (pathname?.startsWith("/admin")) return null;

  return (
    <>
      <Script src={LOADER_SRC} strategy="lazyOnload" />
      <div
        // The custom element registers itself once the loader script
        // runs and reads its data-* + child attributes.
        dangerouslySetInnerHTML={{
          __html: `<givebutter-widget id="${WIDGET_ID}" campaign="${CAMPAIGN}"></givebutter-widget>`,
        }}
      />
    </>
  );
}
