import { afterAll } from "vitest";
import { blockTestModelPort } from "../../../apps/desktop/qa.js";

const attempts = [];
const restore = blockTestModelPort(error => attempts.push(error));
afterAll(() => {
  restore();
  if (attempts.length) throw attempts[0];
});
