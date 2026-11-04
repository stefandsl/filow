import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { OverflowMenu, handleMenuKey } from "./OverflowMenu";
it("provides a labelled menu button and hidden menu items", () => {
 const html = renderToStaticMarkup(<OverflowMenu items={[{id:"reload",label:"Reload",onSelect(){}},{id:"reset",label:"Reset",onSelect(){}}]} />);
 expect(html).toContain('aria-haspopup="menu"'); expect(html).toContain('aria-expanded="false"');
 expect(html.match(/role="menuitem"/g)).toHaveLength(2);
 expect(html).toMatch(/hidden=""/);
});
it("wraps arrow navigation and Escape closes and restores trigger focus", () => {
 const focus = vi.fn(), close = vi.fn();
 const send = (key:string,index:number) => { const preventDefault = vi.fn(); handleMenuKey({key,preventDefault},index,3,focus,close); expect(preventDefault).toHaveBeenCalled(); };
 send("ArrowDown",2); expect(focus).toHaveBeenLastCalledWith(0);
 send("ArrowUp",0); expect(focus).toHaveBeenLastCalledWith(2);
 send("Home",1); expect(focus).toHaveBeenLastCalledWith(0);
 send("End",1); expect(focus).toHaveBeenLastCalledWith(2);
 send("Escape",1); expect(close).toHaveBeenCalledWith(true);
});
