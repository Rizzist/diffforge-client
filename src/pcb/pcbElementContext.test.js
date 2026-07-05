import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePcbElementContexts,
  resolvePcbPickedElementContext,
} from "./pcbElementContext.js";

const circuitJson = [
  {
    type: "source_component",
    source_component_id: "source_component_r2",
    ftype: "simple_resistor",
    name: "R2",
    resistance: 1000,
    display_resistance: "1k",
  },
  {
    type: "source_component",
    source_component_id: "source_component_d1",
    ftype: "simple_led",
    name: "D1",
  },
  {
    type: "source_port",
    source_port_id: "source_port_r2_1",
    source_component_id: "source_component_r2",
    name: "pin1",
    pin_number: 1,
    port_hints: ["pin1", "1"],
    subcircuit_connectivity_map_key: "net_led1",
  },
  {
    type: "source_port",
    source_port_id: "source_port_r2_2",
    source_component_id: "source_component_r2",
    name: "pin2",
    pin_number: 2,
    port_hints: ["pin2", "2"],
    subcircuit_connectivity_map_key: "net_vcc",
  },
  {
    type: "source_port",
    source_port_id: "source_port_d1_anode",
    source_component_id: "source_component_d1",
    name: "anode",
    pin_number: 1,
    port_hints: ["anode", "1"],
    subcircuit_connectivity_map_key: "net_led1",
  },
  {
    type: "source_net",
    source_net_id: "source_net_led1",
    name: "LED1",
    subcircuit_connectivity_map_key: "net_led1",
    member_source_group_ids: [],
  },
  {
    type: "source_net",
    source_net_id: "source_net_vcc",
    name: "VCC",
    subcircuit_connectivity_map_key: "net_vcc",
    member_source_group_ids: [],
  },
  {
    type: "source_trace",
    source_trace_id: "source_trace_led1",
    connected_source_port_ids: ["source_port_r2_1", "source_port_d1_anode"],
    connected_source_net_ids: ["source_net_led1"],
    display_name: "R2.pin1 to D1.anode",
    subcircuit_connectivity_map_key: "net_led1",
  },
  {
    type: "source_trace",
    source_trace_id: "source_trace_vcc",
    connected_source_port_ids: ["source_port_r2_2"],
    connected_source_net_ids: ["source_net_vcc"],
    display_name: "R2.pin2 to VCC",
    subcircuit_connectivity_map_key: "net_vcc",
  },
  {
    type: "pcb_component",
    pcb_component_id: "pcb_component_r2",
    source_component_id: "source_component_r2",
    center: { x: 12.3456, y: -2.111 },
    width: 2,
    height: 1,
    layer: "top",
  },
  {
    type: "pcb_component",
    pcb_component_id: "pcb_component_d1",
    source_component_id: "source_component_d1",
    center: { x: 15, y: -2 },
    width: 2,
    height: 1,
    layer: "top",
  },
  {
    type: "pcb_port",
    pcb_port_id: "pcb_port_r2_1",
    pcb_component_id: "pcb_component_r2",
    source_port_id: "source_port_r2_1",
    x: 11.5,
    y: -2.1,
    layers: ["top"],
  },
  {
    type: "pcb_port",
    pcb_port_id: "pcb_port_r2_2",
    pcb_component_id: "pcb_component_r2",
    source_port_id: "source_port_r2_2",
    x: 13.2,
    y: -2.1,
    layers: ["top"],
  },
  {
    type: "pcb_smtpad",
    pcb_smtpad_id: "pcb_smtpad_r2_1",
    pcb_component_id: "pcb_component_r2",
    pcb_port_id: "pcb_port_r2_1",
    port_hints: ["1"],
    x: 11.5,
    y: -2.1,
    width: 1,
    height: 1,
    layer: "top",
    shape: "rect",
  },
  {
    type: "pcb_smtpad",
    pcb_smtpad_id: "pcb_smtpad_r2_2",
    pcb_component_id: "pcb_component_r2",
    pcb_port_id: "pcb_port_r2_2",
    port_hints: ["2"],
    x: 13.2,
    y: -2.1,
    width: 1,
    height: 1,
    layer: "top",
    shape: "rect",
  },
  {
    type: "cad_component",
    cad_component_id: "cad_component_r2",
    pcb_component_id: "pcb_component_r2",
    source_component_id: "source_component_r2",
    footprinter_string: "0402",
    position: { x: 12.3456, y: -2.111, z: 0.7 },
  },
];

test("resolvePcbPickedElementContext enriches a picked resistor from circuit-json", () => {
  const context = resolvePcbPickedElementContext({
    id: "pcbctx_resistor",
    tab: "pcb",
    space: "2d",
    elementType: "pcb_smtpad",
    circuitElementId: "pcb_smtpad_r2_1",
    pointMm: { x: 11.499, y: -2.101 },
  }, {
    circuitJson,
    source: [
      "export default () => (",
      '  <resistor name="R2" footprint="0402" resistance="1k" />',
      ");",
    ].join("\n"),
    boardPath: "hardware/demo/demo.board.tsx",
    boardTitle: "Demo Board",
  });

  assert.deepEqual(context, {
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
    nets: ["LED1", "VCC"],
    neighbors: ["D1.anode via net LED1"],
    sourceAnchor: {
      path: "hardware/demo/demo.board.tsx",
      line: 2,
      snippet: 'export default () => (\n<resistor name="R2" footprint="0402" resistance="1k" />\n);',
    },
    pointMm: { x: 11.5, y: -2.1 },
    boardTitle: "Demo Board",
  });
});

test("normalizePcbElementContexts drops invalid entries and caps at three", () => {
  const contexts = normalizePcbElementContexts([
    null,
    { id: "a", kind: "pcb-element", label: "A" },
    { id: "", kind: "pcb-element", label: "invalid" },
    { id: "b", kind: "pcb-element", label: "B" },
    { id: "c", kind: "pcb-element", label: "C" },
    { id: "d", kind: "pcb-element", label: "D" },
  ]);

  assert.deepEqual(contexts.map((context) => context.id), ["a", "b", "c"]);
});
