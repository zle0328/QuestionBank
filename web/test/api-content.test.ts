import { describe, expect, it } from "vitest";
import { plainTextToHtml } from "../src/api/content";

describe("api content mapping", () => {
  it("renders plain API content as safe readable paragraphs", () => {
    const html = plainTextToHtml("第一段正文。\n\n第二段 <script>alert(1)</script>");

    expect(html).toBe("<p>第一段正文。</p><p>第二段 &lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });
});
