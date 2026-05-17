use burn::{prelude::*, tensor::ops::PadMode};
use burn_store::{ModuleSnapshot, ModuleStore};

pub mod silero_vad_6 {

    // https://github.com/snakers4/silero-vad/blob/2688a6e352baa21628bb213672ce2c2f7aefd159/src/silero_vad/tinygrad_model.py#L30C9-L53C56
    // import torch
    // from tinygrad import Tensor
    //
    // wav = read_audio(audio_path, sampling_rate=16000).unsqueeze(0)
    // num_samples = 512
    // context_size = 64
    // context = Tensor(np.zeros((1, context_size))).float()
    // outs = []
    // state = None
    // if wav.shape[1] % num_samples:
    //     pad_num = num_samples - (wav.shape[1] % num_samples)
    //     wav = torch.nn.functional.pad(wav, (0, pad_num), 'constant', value=0.0)
    //
    // wav = torch.nn.functional.pad(wav, (context_size, 0))
    //
    // wav = Tensor(wav.numpy()).float()
    //
    // for i in tqdm(range(context_size, wav.shape[1], num_samples)):
    //     wavs_batch = wav[:, i-context_size:i+num_samples]
    //     out_chunk, state = tiny_model(wavs_batch, state)
    //     #outs.append(out_chunk.numpy())
    //     outs.append(out_chunk)
    //
    // predict = outs[0].cat(*outs[1:], dim=1).numpy()

    include!(concat!(
        env!("OUT_DIR"),
        "/models/silero_vad_op18_ifless.rs"
    ));
}

pub struct PredictState<B: Backend> {
    pub context_size: usize,
    pub context: Tensor<B, 2>,
    pub state: Tensor<B, 3>,
}

/// The chunk size for processing audio_16k samples
pub const CHUNK_SIZE: usize = 512;

impl<B: Backend> PredictState<B> {
    /// Create a new PredictState with given batch size and context size
    /// # Arguments
    /// * `context_size` - The size of the context window, which last chunk retains
    /// * `batch_size` - The number of samples processed in parallel, default is 1
    pub fn new(device: &Device<B>, batch_size: usize, context_size: usize) -> Self {
        Self {
            context_size,
            context: Tensor::zeros([batch_size, context_size], device),
            state: Self::init_state(device, batch_size),
        }
    }

    pub fn default(device: &Device<B>) -> Self {
        Self::new(device, 1, 64)
    }

    pub fn input_size(&self) -> usize {
        512
    }

    pub fn init_state(device: &Device<B>, batch_size: usize) -> Tensor<B, 3> {
        Tensor::zeros([2, batch_size, 128], device)
    }
}

pub struct SileroVAD6Model<B: Backend> {
    pub model: silero_vad_6::Model<B>,
}

#[derive(thiserror::Error, Debug)]
pub enum SileroVAD6Error {
    #[error("Invalid input size: expected {expected}, found {found}")]
    InvalidInputSize { expected: usize, found: usize },
}

impl<B: Backend<FloatElem = f32>> SileroVAD6Model<B> {
    pub const SILERO_VAD6_WEIGHTS: &[u8] =
        include_bytes!("../models/silero_vad_6.2_op18_ifless.bpk");

    pub fn new(
        device: &Device<B>,
    ) -> Result<Self, <burn_store::BurnpackStore as ModuleStore>::Error> {
        let mut model = silero_vad_6::Model::<B>::new(device);

        let bytes = burn::tensor::Bytes::from_bytes_vec(Self::SILERO_VAD6_WEIGHTS.to_vec());
        let mut store = burn_store::BurnpackStore::from_bytes(Some(bytes));

        model.load_from(&mut store)?;

        Ok(Self { model })
    }

    /// Forward pass for 16kHz audio input
    pub fn predict(
        &self,
        predict_state: PredictState<B>,
        mut input: Tensor<B, 2>,
    ) -> Result<(PredictState<B>, Tensor<B, 2>), SileroVAD6Error> {
        let input_size = predict_state.input_size();
        if input.shape()[1] > input_size {
            return Err(SileroVAD6Error::InvalidInputSize {
                expected: input_size,
                found: input.shape()[1],
            });
        } else if input.shape()[1] < input_size {
            // Pad input to the expected size
            let pad_size = input_size - input.shape()[1];
            input = input.pad((0, pad_size, 0, 0), PadMode::Constant(0.0));
        }

        let PredictState {
            context_size,
            context,
            state,
        } = predict_state;

        let input_data = burn::Tensor::cat(vec![context, input], 1);
        let context = input_data
            .clone()
            .slice(s![.., -(context_size as i32)..])
            .clone();

        let (out, new_state) = self.model.forward(input_data, 16000, state);
        Ok((
            PredictState {
                context_size,
                context,
                state: new_state,
            },
            out,
        ))
    }
}

#[test]
// cargo test --package silero_vad_burn --lib -- test_silero_vad6_model --exact --nocapture
fn test_silero_vad6_model() {
    let device = burn_ndarray::NdArrayDevice::default();
    let model: SileroVAD6Model<burn_ndarray::NdArray> = SileroVAD6Model::new(&device).unwrap();
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
        let input = Tensor::<burn_ndarray::NdArray, 1>::from_data(chunk, &device).unsqueeze();

        let (new_state, output) = model.predict(predict_state, input).unwrap();
        predict_state = new_state;
        println!("output: {:?}", output);
    }
}
