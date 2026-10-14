import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayingCard } from "../components/PlayingCard";

describe("разметка игральных карт", () => {
  it("создаёт отдельный SVG-узор рубашки для каждой карты", () => {
    const markup = renderToStaticMarkup(
      <>
        <PlayingCard card={{ id: "qa-a", rank: "A" }} faceUp />
        <PlayingCard card={{ id: "qa-k", rank: "K" }} faceUp />
      </>,
    );
    const patternIds = [...markup.matchAll(/<pattern id="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(patternIds).toHaveLength(2);
    expect(new Set(patternIds).size).toBe(patternIds.length);
    for (const patternId of patternIds) {
      expect(markup).toContain(`fill="url(#${patternId})"`);
    }
  });
});
