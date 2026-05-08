pub trait CloudOrchestratorAdapter {
    fn mode(&self) -> &'static str;
    fn makes_network_calls(&self) -> bool {
        false
    }
}

pub struct DisabledCloudOrchestratorAdapter;
pub struct MockCloudOrchestratorAdapter;
pub struct HttpStubCloudOrchestratorAdapter;

impl CloudOrchestratorAdapter for DisabledCloudOrchestratorAdapter {
    fn mode(&self) -> &'static str {
        "disabled"
    }
}

impl CloudOrchestratorAdapter for MockCloudOrchestratorAdapter {
    fn mode(&self) -> &'static str {
        "mock"
    }
}

impl CloudOrchestratorAdapter for HttpStubCloudOrchestratorAdapter {
    fn mode(&self) -> &'static str {
        "http_stub"
    }
}
