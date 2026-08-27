import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPanelAgentPromptContextNote,
  normalizePanelAgentPromptContextRefs,
} from "./panelAgentPromptBridge.js";

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

test("normalizePanelAgentPromptContextRefs drops non-PCB contexts and caps PCB contexts", () => {
  const contexts = normalizePanelAgentPromptContextRefs([
    { id: "pcb_a", kind: "pcb-element", label: "A" },
    { kind: "unknown-element", label: "Unknown" },
    { id: "pcb_b", kind: "pcb-element", label: "B" },
    { id: "pcb_c", kind: "pcb-element", label: "C" },
    { id: "pcb_d", kind: "pcb-element", label: "D" },
  ]);

  assert.deepEqual(contexts.map((context) => context.kind), [
    "pcb-element",
    "pcb-element",
    "pcb-element",
  ]);
});

test("formatPanelAgentPromptContextNote keeps each PCB context visible under clamp", () => {
  const longText = "x".repeat(5000);
  const contexts = ["R1", "R2", "R3"].map((designator) => ({
    id: `pcbctx_${designator}`,
    kind: "pcb-element",
    tab: longText,
    designator,
    elementType: longText,
    footprint: longText,
    value: longText,
    boardTitle: longText,
    sourceAnchor: {
      path: longText,
      line: 1,
      snippet: longText,
    },
  }));
  const note = formatPanelAgentPromptContextNote(contexts);

  assert.equal(note.title, "Selected PCB elements");
  assert.ok(note.text.length <= 1600);
  contexts.forEach(({ designator }) => assert.ok(note.text.includes(designator)));
});
