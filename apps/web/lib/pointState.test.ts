import { expect, it } from "vitest";
import { pointState } from "./pointState";
it("gives completion precedence over hot and ignores stale confidence", () => {
 expect(pointState({started:true,confidence:0.2},true)).toBe("done");
 expect(pointState({started:false,confidence:0.5},true)).toBe("active");
 expect(pointState({started:false,confidence:0.9},false)).toBe("waiting");
});
