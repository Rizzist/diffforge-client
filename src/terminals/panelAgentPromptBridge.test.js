import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPanelAgentPromptContextNote,
  normalizePanelAgentPromptContextRefs,
} from "./panelAgentPromptBridge.js";

test("formatPanelAgentPromptContextNote keeps single web context output unchanged", () => {
  const note = formatPanelAgentPromptContextNote([{
    kind: "web-element",
    url: "https://example.test/page",
    title: "Example",
    element: "button.primary",
    selector: "button.primary:nth-of-type(1)",
    text: "Buy now",
    attributes: {
      role: "button",
      "aria-label": "Buy product",
      alt: "ignored",
      placeholder: "ignored",
      href: "/checkout",
    },
    rect: { left: 10.24, top: 20.25, width: 120.26, height: 40.27 },
    scroll: { x: 0, y: 30.24 },
    styles: {
      display: "flex",
      fontSize: "14px",
      fontWeight: "700",
      color: "rgb(1, 2, 3)",
      backgroundColor: "rgb(4, 5, 6)",
      borderRadius: "6px",
      padding: "8px 10px",
    },
    parent: {
      element: "div.card",
      text: "Parent text",
    },
  }]);

  assert.deepEqual(note, {
    title: "Selected web element",
    text: [
      "Selected web element context:",
      "- url: https://example.test/page",
      "- page title: Example",
      "- element: button.primary",
      "- selector: button.primary:nth-of-type(1)",
      "- text: Buy now",
      "- attributes: role=button; aria-label=Buy product; alt=ignored; placeholder=ignored; href=/checkout",
      "- viewport rect: x=10.2, y=20.3, w=120.3, h=40.3",
      "- page scroll: x=0, y=30.2",
      "- styles: display=flex; font=14px/700; color=rgb(1, 2, 3); background=rgb(4, 5, 6); radius=6px; padding=8px 10px",
      "- parent: div.card text=Parent text",
    ].join("\n"),
  });
});

test("formatPanelAgentPromptContextNote renders PCB context blocks", () => {
  const note = formatPanelAgentPromptContextNote([{
    id: "pcbctx_resistor",
    kind: "pcb-element",
    tab: "pcb",
    space: "2d",
    label: "R2 · 0402",
    designator: "R2",
    elementType: "pcb_smtpad",
    footprint: "0402",
    value: "1k",
    position: { xMm: 11.5, yMm: -2.1 },
    layer: "top",
    pads: [
      { pin: "pin1", net: "LED1" },
      { pin: "pin2", net: "VCC" },
    ],
    neighbors: ["D1.anode via net LED1"],
    sourceAnchor: {
      path: "hardware/demo/demo.board.tsx",
      line: 2,
      snippet: '<resistor name="R2" footprint="0402" />',
    },
    boardTitle: "Demo Board",
  }]);

  assert.deepEqual(note, {
    title: "Selected PCB element",
    text: [
      "Selected PCB element context:",
      "- board: Demo Board (hardware/demo/demo.board.tsx)",
      "- view: pcb",
      "- element: R2 · pcb_smtpad · 0402 · 1k",
      "- position: (11.5, -2.1) mm, layer top",
      "- pads: pin1 → LED1, pin2 → VCC",
      "- connected: D1.anode via net LED1",
      "- source: hardware/demo/demo.board.tsx:2",
      '  <resistor name="R2" footprint="0402" />',
    ].join("\n"),
  });
});

test("normalizePanelAgentPromptContextRefs keeps mixed web and PCB contexts capped", () => {
  const contexts = normalizePanelAgentPromptContextRefs([
    { id: "pcb_a", kind: "pcb-element", label: "A" },
    { kind: "web-element", selector: "button", element: "button" },
    { id: "pcb_b", kind: "pcb-element", label: "B" },
    { id: "pcb_c", kind: "pcb-element", label: "C" },
  ]);

  assert.deepEqual(contexts.map((context) => context.kind), [
    "pcb-element",
    "web-element",
    "pcb-element",
  ]);
});

test("formatPanelAgentPromptContextNote keeps each mixed context visible under clamp", () => {
  const longText = "x".repeat(5000);
  const note = formatPanelAgentPromptContextNote([
    {
      kind: "web-element",
      url: `https://example.test/${longText}`,
      title: longText,
      element: `button.${longText}`,
      selector: `main ${longText}`,
      text: longText,
      attributes: {
        role: longText,
        "aria-label": longText,
        alt: longText,
        placeholder: longText,
        href: longText,
      },
      rect: { left: 10, top: 20, width: 120, height: 40 },
      scroll: { x: 0, y: 30 },
      styles: {
        display: longText,
        fontSize: longText,
        fontWeight: longText,
        color: longText,
        backgroundColor: longText,
        borderRadius: longText,
        padding: longText,
      },
      parent: {
        element: `div.${longText}`,
        text: longText,
      },
    },
    {
      id: "pcbctx_resistor",
      kind: "pcb-element",
      tab: "pcb",
      label: "R2",
    },
  ]);

  assert.equal(note.title, "Selected panel contexts");
  assert.ok(note.text.length <= 1600);
  assert.ok(note.text.includes("Selected web element context:"));
  assert.ok(note.text.includes("Selected PCB element context:"));
});
