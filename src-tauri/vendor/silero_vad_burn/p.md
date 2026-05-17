# 别让 2MB 的模型绑架上 500MB 的依赖

用 Rust + Burn 实现 Silero VAD，整个二进制文件不到 10MB

## 什么是 VAD？

Voice Activity Detection（语音活动检测）是音频处理的基础技术。它能在音频流中区分「有人说话」和「没人说话」，自动检测语音的起止时间戳。

没有 VAD，语音识别系统会浪费大量算力去处理静音和噪声；有了 VAD，系统可以在真正说话时才启动识别，大幅提升效率。

## Silero VAD：企业级语音检测模型

[Silero VAD](https://github.com/snakers4/silero-vad) 是目前最优秀的开源 VAD 方案之一。相比传统的基于能量阈值或特征工程的方法，Silero VAD 采用深度神经网络，在数千小时真实音频数据上训练而成。准确度远超传统的 WebRTC VAD。

最重要的是——**模型文件只有 2MB**。

## 问题：杀鸡用牛刀

但问题来了。想用这个 2MB 的模型，你得先安装：

| 方案 | 依赖大小 |
|------|---------|
| ONNX Runtime | ~100MB+ |
| LibTorch | ~500MB+ |

为了跑一个 2MB 的模型，要拖上几百 MB 的 C++ 库，还得处理各种系统依赖和版本兼容问题。这太不合理了。

## 解决方案

Rust 的 [Burn](https://github.com/tracel-ai/burn) 可以帮助我们从 onnx 文件直接生成用 rust 代码实现的模型。
同时它提供多种后端可选，ndarray、tch(libtorch)、onnx 等。
对于这种小模型，ndarray 完全够用了。

**结果：整个可执行文件（含模型权重）不到 10MB。(ndarray)**

### 对比

| 方案 | 大小 |
|------|------|
| ONNX Runtime | ~100MB+ |
| LibTorch | ~500MB+ |
| **Burn (ndarray)** | **< 10MB** |

## 优势

- **极致轻量**：零外部依赖，无需安装 ONNX 或 PyTorch
- **跨平台**：纯 Rust 实现，支持 Linux/Windows/macOS，甚至嵌入式和 WASM
- **安全高效**：Rust 的内存安全保证 + 零成本抽象

## 适用场景

- 语音助手唤醒词检测
- 实时通话语音分析
- 音频转写预处理
- 嵌入式语音交互设备

## 快速上手

```bash
cargo add silero_vad_burn
```

```rust
let device = burn_ndarray::NdArrayDevice::default();
let model = SileroVAD6Model::new(&device, "./models/silero_vad_6.2_op18_ifless.bpk");
let mut state = PredictState::default(&device);

// 读取音频，分块处理
for chunk in wav_data.chunks(state.input_size()) {
    let input = Tensor::from_data(chunk, &device).unsqueeze();
    let (new_state, output) = model.predict(state, input).unwrap();
    state = new_state;
    println!("VAD output: {:?}", output);
}
```

## 结语

如果你需要在 Rust 中使用语音活动检测，或者厌倦了庞大的深度学习依赖，可以试试这个项目。

**少即是多。**

如果你还有其他的项目，为了运行几M的小模型不得不安装几百MB的依赖，也可以尝试以下 [Burn](https://github.com/tracel-ai/burn)。

---

[GitHub: silero_vad_burn](https://github.com/second-state/silero_vad_server.git)

**Sources:**
- [Silero VAD GitHub](https://github.com/snakers4/silero-vad)
- [One Voice Detector to Rule Them All](https://thegradient.pub/one-voice-detector-to-rule-them-all/)
- [Enhance Speech Detection with Silero-VAD](https://onegen.ai/project/enhance-speech-detection-with-silero-vad-a-comprehensive-guide-to-tuning-and-implementation/)
