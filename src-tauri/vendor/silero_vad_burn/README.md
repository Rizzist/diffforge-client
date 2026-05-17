# Silero-VAD V6 in Rust (based on Burn)

  

This is a Rust implementation of [Silero-VAD V6](https://github.com/snakers4/silero-vad). Silero-VAD is a Voice Activity Detection (VAD) system that can detect speech segments in audio files, separating speech from silence and noise.

  

## What is VAD?

  

Voice Activity Detection (VAD) is used to:

-  **Detect speech segments** in audio recordings

-  **Generate timestamps** for when speech starts and ends

-  **Remove silence** from audio for further processing

-  **Preprocess audio** for speech recognition systems

-  **Analyze conversations** and meetings

  

## Requirements

  

-  **Rust**: 1.90.0 or later

-  ~~**LibTorch**: 1.13.0 or later~~

-  ~~**System**: GCC 11.4.0+ (Linux), MSVC 2019+ (Windows), or Xcode Command Line Tools (macOS)~~


## Why [Burn](https://github.com/tracel-ai/burn.git)?

Silero VAD is extremely compact—the ONNX model is only 2MB. However, dependencies like ONNX Runtime and LibTorch are massive, often requiring hundreds of megabytes or even gigabytes of disk space. Installing such heavy libraries just to run a tiny 2MB model is clearly overkill.

Burn supports a wide variety of backends, and for Silero VAD, the `ndarray` backend is more than sufficient. With release optimizations, the entire binary—including model weights—weighs in at under 10MB and is compatible with virtually any machine.


## Usage

```rust
    let device = burn_ndarray::NdArrayDevice::default();
    let model: SileroVAD6Model<burn_ndarray::NdArray<f32>> = SileroVAD6Model::new(&device).unwrap();
    let mut predict_state = PredictState::default(&device);

    let file_in = std::fs::File::open("test_wav/hello_beep.wav").unwrap();
    let (header, wav_data) = wav_io::read_from_file(file_in).unwrap();
    print!("wav header: {:?}\n", header);

    let chunk_size = predict_state.input_size();

    for chunk in wav_data.chunks(chunk_size) {
        // println!("chunk {:?}", chunk);
        if chunk.len() != chunk_size {
            break;
        }
        let input = Tensor::<burn_ndarray::NdArray<f32>, 1>::from_data(chunk, &device).unsqueeze();

        let (new_state, output) = model.predict(predict_state, input).unwrap();
        predict_state = new_state;
        println!("output: {:?}", output);
    }
```
  

## License

  

This project follows the same license as the original Silero-VAD project.