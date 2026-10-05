import { isPageKey, PAGES } from "@/lib/link-preview";
import { pageImage } from "@/lib/og";

export const dynamic = "force-static";
export const dynamicParams = false;

export const generateStaticParams = () => Object.keys(PAGES).map((key) => ({ key }));

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return pageImage(isPageKey(key) ? key : "default");
}
