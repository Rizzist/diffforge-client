import styled from "styled-components";

export default function ThreeGraphRenderer() {
  return (
    <DisabledRendererNotice>
      Three renderer is disabled. Xyflow remains the active graph renderer.
    </DisabledRendererNotice>
  );
}

const DisabledRendererNotice = styled.div`
  align-items: center;
  color: rgba(219, 231, 247, 0.48);
  display: flex;
  font-size: 12px;
  font-weight: 680;
  height: 100%;
  justify-content: center;
  padding: 14px;
`;
