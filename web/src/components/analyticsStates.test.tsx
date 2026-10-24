// @vitest-environment jsdom
import { act, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type ErrorProps = { error: Error; reset: () => void };
const errors: Record<string, () => Promise<{ default: ComponentType<ErrorProps> }>> = {
  "district/[slug]": () => import("../app/district/[slug]/error"),
  "street": () => import("../app/street/error"),
  "street/[district]/[street]": () => import("../app/street/[district]/[street]/error"),
  "street/[district]/[street]/[house]": () => import("../app/street/[district]/[street]/[house]/error"),
  "compare": () => import("../app/compare/error"),
  "insights": () => import("../app/insights/error"),
};
const loading: Record<string, () => Promise<{ default: ComponentType }>> = {
  "insights": () => import("../app/insights/loading"),
  "compare": () => import("../app/compare/loading"),
  "street/[district]/[street]/[house]": () => import("../app/street/[district]/[street]/[house]/loading"),
};

it("every analytics segment and the street-layout ancestor has an actionable error boundary", async () => {
  const paths = ["district/[slug]", "street", "street/[district]/[street]", "street/[district]/[street]/[house]", "compare", "insights"];
  for (const path of paths) {
    const load = errors[path];
    expect(load, `${path} error boundary`).toBeTypeOf("function");
    const Boundary = (await load()).default;
    const reset = vi.fn();
    refresh.mockClear();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Boundary error={new Error("private database credentials")} reset={reset} />));
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("Kunde inte ladda");
      expect(container.textContent).not.toContain("private database credentials");
      expect(container.querySelector('a[href="/"]')?.textContent).toBe("Till kartan");
      const button = container.querySelector("button")!;
      expect(button.textContent).toBe("Försök igen");
      await act(async () => button.click());
      expect(refresh).toHaveBeenCalledOnce();
      expect(reset).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
});

it("insights, comparison and address loading states announce progress", async () => {
  for (const path of ["insights", "compare", "street/[district]/[street]/[house]"]) {
    const load = loading[path];
    expect(load, `${path} loading state`).toBeTypeOf("function");
    const Loading = (await load()).default;
    const html = renderToStaticMarkup(<Loading />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Laddar");
  }
});
