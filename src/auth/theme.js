// Local copy of the Diff Forge brand palette used by the auth/boot flow.
// Source of truth: next-diffforge/src/styles/tokens.js (`C`, static dark
// constants). Copied here so src/auth/ has zero imports from the rest of
// the app — keep values byte-identical to the marketing tokens when they
// change upstream.

export const C = {
  black: "#030508",
  ink: "#060910",
  inkRaised: "#0a0f17",
  panel: "#0d141f",
  panelRaised: "#111a26",
  panelBright: "#172232",
  line: "rgba(255,255,255,0.10)",
  lineStrong: "rgba(255,255,255,0.18)",
  lineBlue: "rgba(47,128,255,0.36)",
  lineOrange: "rgba(255,122,24,0.36)",
  white: "#f7f9ff",
  text: "#e8eef8",
  textDim: "#a7b2c2",
  textMuted: "#687386",
  blue: "#2f80ff",
  blueBright: "#62a0ff",
  blueSoft: "rgba(47,128,255,0.14)",
  orange: "#ff7a18",
  orangeBright: "#ff9a3d",
  orangeSoft: "rgba(255,122,24,0.14)",
};

export default C;
