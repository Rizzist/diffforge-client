// Standalone icon module so the Orchestrator pill can render the Aura button
// without pulling the three.js scene (AuraMode.jsx is lazy-loaded) into the
// main bundle.

export function AuraModeIcon(props) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="12" cy="12" r="3.1" />
      <ellipse cx="12" cy="12" rx="9.2" ry="3.9" transform="rotate(-28 12 12)" />
      <ellipse cx="12" cy="12" rx="9.2" ry="3.9" transform="rotate(28 12 12)" opacity="0.55" />
      <circle cx="19.4" cy="7.4" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default AuraModeIcon;
