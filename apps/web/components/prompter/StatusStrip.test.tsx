import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StatusStrip } from "./StatusStrip";
it("keeps diagnostics collapsed while exposing live statistics", () => {
 const html = renderToStaticMarkup(<StatusStrip summary="Computer" details={<div>CPU</div>} stats="Calls 3" />);
 expect(html).toContain('<details>'); expect(html).not.toMatch(/<details[^>]*open/);
 expect(html).toContain('<summary>'); expect(html).toContain('CPU'); expect(html).toContain('Calls 3');
});
