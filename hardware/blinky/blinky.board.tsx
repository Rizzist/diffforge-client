// blinky — tscircuit board. Edit components and traces; the panel
// renders Circuits (schematic), Wiring (PCB), and 3D live on save.
export default () => (
  <board width="12mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-3} pcbY={0} />
    <led name="D1" footprint="0402" pcbX={3} pcbY={0} />
    <trace from=".R1 .pin2" to=".D1 .anode" />
  </board>
);
